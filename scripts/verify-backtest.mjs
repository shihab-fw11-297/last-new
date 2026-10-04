import assert from "node:assert/strict";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity } from "../lib/traderbrain/analysis/liquidity.ts";
import { analyzePriceApproach } from "../lib/traderbrain/analysis/price-approach.ts";
import { analyzeLiquidityInteractions } from "../lib/traderbrain/analysis/liquidity-interaction.ts";
import { analyzeHistoricalControl } from "../lib/traderbrain/analysis/control-engine.ts";
import { analyzeHistoricalDisplacement } from "../lib/traderbrain/analysis/displacement-engine.ts";
import { analyzeHistoricalStructuralConfirmations } from "../lib/traderbrain/analysis/structural-confirmation.ts";
import { analyzeHistoricalFvgs } from "../lib/traderbrain/analysis/fvg-entry-location.ts";
import { analyzeHistoricalEntryCandidates } from "../lib/traderbrain/analysis/entry-candidate.ts";
import { analyzeHistoricalRiskValidations } from "../lib/traderbrain/analysis/risk-validation.ts";
import { analyzeHistoricalSignals } from "../lib/traderbrain/analysis/signal-decision.ts";
import { analyzeHistoricalSignalLedger } from "../lib/traderbrain/analysis/signal-ledger.ts";
import { createReplaySession } from "../lib/traderbrain/analysis/replay-engine.ts";
import { runBacktest } from "../lib/traderbrain/analysis/backtest-engine.ts";

const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable for real XAUUSD verification");
const from = process.argv[2] ?? "2026-03-02";
const to = process.argv[3] ?? "2026-03-14";
const service = new HistoricalService(new FinageClient(key), new MemoryCandleStore(),
  { log: () => {} });
const historical = await service.getHistoricalCandles(from, to);
assert.ok(["READY", "WARN"].includes(historical.status) && historical.candles1m.length,
  JSON.stringify({ status: historical.status, candles: historical.candles1m.length,
    errorCode: historical.diagnostics.errorCode }));
function stage(name, run) {
  const result = run();
  assert.ok(["READY", "WARN"].includes(result.status),
    `${name} blocked: ${result.diagnostics?.errorCode ?? result.errorCode}`);
  return result;
}
const psychology = stage("psychology", () => analyzeHistoricalPsychology(historical));
const structure = stage("structure", () => analyzeHistoricalMarketStructure(historical, psychology));
const liquidity = stage("liquidity", () => analyzeHistoricalLiquidity(structure, psychology));
const compressionEvidence = [];
const lastCompressed = new Map();
stage("approach", () => analyzePriceApproach(historical, psychology, liquidity, {},
  (_, __, current) => {
    for (const timeframe of ["1m", "5m", "15m", "1h"]) {
      for (const item of [current[timeframe].above, current[timeframe].below]) {
        if (item?.behaviorClass !== "COMPRESSED") continue;
        const previous = lastCompressed.get(item.liquidityId);
        if (previous !== item.timestamp - 60_000) compressionEvidence.push({
          liquidityId: item.liquidityId, sourceTimeframe: item.sourceTimeframe,
          timestamp: item.timestamp, behaviorClass: "COMPRESSED" });
        lastCompressed.set(item.liquidityId, item.timestamp);
      }
    }
  }));
const interaction = stage("interaction", () => analyzeLiquidityInteractions(historical, psychology, liquidity));
const control = stage("control", () => analyzeHistoricalControl(historical, psychology, structure, interaction));
const displacement = stage("displacement", () => analyzeHistoricalDisplacement(historical, psychology, structure, interaction));
const confirmation = stage("confirmation", () => analyzeHistoricalStructuralConfirmations(historical, psychology, structure, interaction));
const fvg = stage("fvg", () => analyzeHistoricalFvgs(historical, psychology, displacement, confirmation));
const entry = stage("entry", () => analyzeHistoricalEntryCandidates(historical, psychology, control, fvg));
const risk = stage("risk", () => analyzeHistoricalRiskValidations({ psychology,
  structure, liquidity, interaction, confirmation, fvg, entry }));
const signals = stage("signals", () => analyzeHistoricalSignals({ entry, risk,
  confirmation, displacement, control, interaction, liquidity, fvg,
  compressionEvidence }));
const ledger = stage("ledger", () => analyzeHistoricalSignalLedger(historical, signals));

const first = historical.candles1m[0].timestamp;
const end = historical.requestedRange.end;
const evaluationStart = Math.max(first, Date.parse(process.argv[4] ?? "2026-03-04"));
const replay = createReplaySession({ dataset: historical, start: first, end });
replay.runToEnd();
const replaySignals = replay.getArtifacts().signals;
assert.deepEqual(replaySignals, signals.signals);
const referenceAtrByRiskValidationId = new Map(risk.validations.flatMap((item) =>
  item.referenceAtr !== null && item.referenceAtr > 0 ? [[item.id, item.referenceAtr]] : []));
const input = { dataset: historical, evaluationStart, evaluationEnd: end,
  dataWarmupStart: historical.requestedRange.start,
  strategyConfigHash: replay.configHash,
  strategyEngineVersion: replay.engineVersion,
  datasetFingerprint: replay.datasetFingerprint,
  referenceAtrByRiskValidationId, phase14Ledger: ledger.ledger };
const started = performance.now();
const batch = runBacktest({ ...input, signals: signals.signals });
const runtimeMs = performance.now() - started;
const replayResult = runBacktest({ ...input, signals: replaySignals });
const repeat = runBacktest({ ...input, signals: signals.signals });
const semantic = (result) => ({ ...result, timingMs: 0 });
assert.deepEqual(semantic(batch), semantic(replayResult));
assert.deepEqual(semantic(batch), semantic(repeat));
assert.equal(batch.diagnostics.lookAheadViolations, 0);
assert.equal(batch.diagnostics.repaintViolations, 0);
assert.equal(batch.diagnostics.phase14Differences.length, 0);

const s = batch.summary;
console.log(JSON.stringify({
  backtestRunId: batch.metadata.runId,
  resultFingerprint: batch.metadata.resultFingerprint,
  datasetFingerprint: batch.metadata.datasetFingerprint,
  engineVersion: batch.metadata.strategyEngineVersion,
  backtestEngineVersion: batch.metadata.backtestEngineVersion,
  strategyConfigHash: batch.metadata.strategyConfigHash,
  executionConfigHash: batch.metadata.executionConfigHash,
  warmupRange: [batch.metadata.dataWarmupStart, batch.metadata.evaluationStart],
  evaluationRange: [batch.metadata.evaluationStart, batch.metadata.evaluationEnd],
  executionMode: batch.executionConfig.entryExecutionMode,
  spreadModel: batch.executionConfig.costModel === "RAW_PRICE" ?
    "HISTORICAL_SPREAD_NOT_AVAILABLE" : "CONFIGURED_FIXED",
  slippageModel: batch.executionConfig.costModel === "RAW_PRICE" ?
    "NOT_AVAILABLE" : "CONFIGURED_FIXED",
  signals: s.totalSignals, filled: s.filledTrades, unfilled: s.unfilledSignals,
  resolved: s.resolvedTrades, wins: s.wins, losses: s.losses,
  ambiguousExit: s.ambiguousExits, ambiguousEntryExit: s.ambiguousEntryExits,
  openAtEnd: s.openAtEnd,
  buyTrades: batch.directions.BUY.filled, sellTrades: batch.directions.SELL.filled,
  signalsPerDay: batch.frequency.signalsPerTradingDay,
  setupFamilies: batch.setupFamilies,
  rawMetrics: batch.summary.raw,
  adjustedMetrics: batch.summary.adjusted,
  mfe: { averageR: s.averageMfeR, medianR: s.medianMfeR },
  mae: { averageR: s.averageMaeR, medianR: s.medianMaeR },
  averageBarsInTrade: s.averageBarsInTrade,
  maxSimultaneousActiveTrades: batch.diagnostics.maxSimultaneousActiveTrades,
  maxPendingEntries: batch.diagnostics.maxPendingSignals,
  maxTradeSequenceDrawdownR: s.maxTradeSequenceDrawdownR,
  maxWinStreak: s.maxConsecutiveWins, maxLossStreak: s.maxConsecutiveLosses,
  executionDegradation: batch.executionDegradation,
  ambiguityRate: s.ambiguityRate,
  lookAhead: batch.diagnostics.lookAheadViolations,
  repaint: batch.diagnostics.repaintViolations,
  determinism: "PASS", phase15SignalStreamMatch: "PASS",
  phase14LifecycleMatch: "PASS",
  candlesProcessed: batch.diagnostics.candlesProcessed,
  finageCallsBeforeBacktest: historical.diagnostics.actualApiCalls,
  finageCallsDuringBacktest: 0,
  runtimeMs, domainVerification: "PASS"
}));
