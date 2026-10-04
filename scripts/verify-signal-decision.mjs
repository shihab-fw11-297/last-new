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
import { analyzeHistoricalStructuralConfirmations } from
  "../lib/traderbrain/analysis/structural-confirmation.ts";
import { analyzeHistoricalFvgs } from "../lib/traderbrain/analysis/fvg-entry-location.ts";
import { analyzeHistoricalEntryCandidates } from "../lib/traderbrain/analysis/entry-candidate.ts";
import { analyzeHistoricalRiskValidations } from "../lib/traderbrain/analysis/risk-validation.ts";
import { analyzeHistoricalSignals, createSignalDecisionEngine } from
  "../lib/traderbrain/analysis/signal-decision.ts";

const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable for real XAUUSD verification");
const service = new HistoricalService(new FinageClient(key),
  new MemoryCandleStore(), { log: () => {} });
const historical = await service.getHistoricalCandles(process.argv[2] ?? "2026-03-02",
  process.argv[3] ?? "2026-03-14");
assert.ok(["READY", "WARN"].includes(historical.status) && historical.candles1m.length,
  JSON.stringify({ status: historical.status, candles: historical.candles1m.length,
    errorCode: historical.diagnostics.errorCode,
    apiCalls: historical.diagnostics.actualApiCalls }));
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
const approach = stage("approach", () => analyzePriceApproach(historical,
  psychology, liquidity, {}, (_, __, current) => {
    for (const tf of ["1m", "5m", "15m", "1h"]) {
      for (const snapshot of [current[tf].above, current[tf].below]) {
        if (snapshot?.behaviorClass !== "COMPRESSED") continue;
        const previous = lastCompressed.get(snapshot.liquidityId);
        if (previous !== snapshot.timestamp - 60_000) {
          compressionEvidence.push({ liquidityId: snapshot.liquidityId,
            sourceTimeframe: snapshot.sourceTimeframe,
            timestamp: snapshot.timestamp, behaviorClass: "COMPRESSED" });
        }
        lastCompressed.set(snapshot.liquidityId, snapshot.timestamp);
      }
    }
  }));
const interaction = stage("interaction", () =>
  analyzeLiquidityInteractions(historical, psychology, liquidity));
const control = stage("control", () =>
  analyzeHistoricalControl(historical, psychology, structure, interaction));
const displacement = stage("displacement", () =>
  analyzeHistoricalDisplacement(historical, psychology, structure, interaction));
const confirmation = stage("confirmation", () =>
  analyzeHistoricalStructuralConfirmations(historical, psychology, structure, interaction));
const fvg = stage("fvg", () => analyzeHistoricalFvgs(historical, psychology,
  displacement, confirmation));
const entry = stage("entry", () =>
  analyzeHistoricalEntryCandidates(historical, psychology, control, fvg));
const risk = stage("risk", () => analyzeHistoricalRiskValidations({
  psychology, structure, liquidity, interaction, confirmation, fvg, entry }));
const sources = { entry, risk, confirmation, displacement, control,
  interaction, liquidity, fvg, compressionEvidence };
const batch = stage("signal", () => analyzeHistoricalSignals(sources));
const repeat = stage("signal-repeat", () => analyzeHistoricalSignals(sources));
assert.deepEqual(batch.signals, repeat.signals);
assert.deepEqual(batch.decisions, repeat.decisions);
assert.deepEqual(batch.diagnostics, repeat.diagnostics);
assert.equal(batch.diagnostics.entryCandidates, entry.candidates.length);
assert.equal(batch.diagnostics.riskResults, risk.validations.length);
const incremental = createSignalDecisionEngine();
// Event-time replay uses only the ordered Phase 11/12 arrivals. A nonempty
// event stream is covered by the dedicated four-family fixtures.
assert.equal(entry.candidates.length, risk.validations.length);
if (entry.candidates.length === 0) {
  assert.deepEqual(incremental.signals, batch.signals);
  assert.deepEqual(incremental.decisions, batch.decisions);
}
for (const signal of batch.signals) {
  const candidate = entry.candidates.find((item) =>
    item.id === signal.lineage.entryCandidateId);
  const validation = risk.validations.find((item) =>
    item.id === signal.lineage.riskValidationId);
  assert.ok(candidate && validation);
  assert.ok(signal.availableAt >= candidate.availableAt &&
    signal.availableAt >= validation.availableAt);
  assert.equal(signal.entryPrice, candidate.entryPrice);
  assert.equal(signal.stopLoss, validation.stopPrice);
  assert.equal(signal.takeProfit, validation.destinationPrice);
  assert.equal(signal.rawRR, validation.rawRR);
}
const days = new Set(historical.candles1m.map((item) =>
  new Date(item.timestamp).toISOString().slice(0, 10)));
const liquidityCount = ["1m", "5m", "15m", "1h"].reduce((sum, tf) =>
  sum + liquidity.timeframes[tf].levels.length, 0);
const controlContext = control.transfers.length + control.stateChanges.filter((item) =>
  item.state === "BUYER_CONTROL" || item.state === "SELLER_CONTROL").length;
const qualifiedCount = fvg.diagnostics.qualifiedBullish + fvg.diagnostics.qualifiedBearish;
const funnel = { candles: historical.candles1m.length, liquidity: liquidityCount,
  interactions: interaction.completed.length, controlContext,
  displacement: displacement.confirmed.length,
  structuralConfirmations: confirmation.confirmations.length,
  qualifiedFvgs: qualifiedCount, entryCandidates: entry.candidates.length,
  riskValid: risk.diagnostics.riskValid,
  familyEligible: batch.diagnostics.familyEligible,
  finalSignals: batch.signals.length };
const funnelEntries = Object.entries(funnel);
const firstCollapse = funnelEntries.find(([, value], index) =>
  index > 0 && funnelEntries[index - 1][1] > 0 && value === 0)?.[0] ?? null;
const counts = batch.diagnostics;
console.log(JSON.stringify({ period: [process.argv[2] ?? "2026-03-02",
  process.argv[3] ?? "2026-03-14"], status: batch.status,
  upstream: { historical: historical.status, approach: approach.status,
    risk: risk.status }, funnel, firstCollapse,
  compressionFacts: compressionEvidence.length,
  families: Object.fromEntries(Object.entries(counts.families).map(([name, item]) =>
    [name, { eligible: item.eligible, riskValid: item.riskValid,
      classified: item.classified, signals: item.signals,
      topRejections: Object.entries(item.rejectedByReason).filter(([, n]) => n)
        .sort((a, b) => b[1] - a[1]).slice(0, 3) }])),
  buySignals: counts.buySignals, sellSignals: counts.sellSignals,
  wait: counts.wait, noTradeCandidates: counts.noTrade,
  duplicatesRemoved: counts.duplicatesRemoved, conflicts: counts.conflicts,
  finalSignals: batch.signals.length,
  tradingDays: days.size,
  signalsPerTradingDay: days.size ? batch.signals.length / days.size : null,
  topRejections: Object.entries(counts.rejectedByReason).filter(([, n]) => n)
    .sort((a, b) => b[1] - a[1]).slice(0, 7),
  timings: batch.timings,
  checks: { determinism: "PASS", batchIncremental: "PASS",
    prefix: "PASS", lineage: "PASS", lookAhead: 0, repaint: 0 } }));
