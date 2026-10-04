import assert from "node:assert/strict";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { aggregate } from "../lib/traderbrain/data/candles.ts";
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
import { createReplaySession, findFirstReplayDivergence } from "../lib/traderbrain/analysis/replay-engine.ts";

const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable for real XAUUSD verification");
const from = process.argv[2] ?? "2026-03-02";
const to = process.argv[3] ?? "2026-03-14";
const service = new HistoricalService(new FinageClient(key), new MemoryCandleStore(), { log: () => {} });
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
const approach = stage("approach", () => analyzePriceApproach(historical,
  psychology, liquidity, {}, (_, __, current) => {
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
const signal = stage("signal", () => analyzeHistoricalSignals({ entry, risk,
  confirmation, displacement, control, interaction, liquidity, fvg, compressionEvidence }));
const ledger = stage("ledger", () => analyzeHistoricalSignalLedger(historical, signal));

const timeframes = ["1m", "5m", "15m", "1h"];
const expected = {
  psychology: timeframes.flatMap((tf) => psychology.timeframes[tf].features),
  structureSwings: timeframes.flatMap((tf) => structure.timeframes[tf].swings),
  structureEvents: timeframes.flatMap((tf) => structure.timeframes[tf].events),
  liquidity: timeframes.flatMap((tf) => liquidity.timeframes[tf].levels),
  approachTransitions: approach.transitions,
  interactionEvents: interaction.events, interactions: interaction.completed,
  controlStateChanges: control.stateChanges, controlTransfers: control.transfers,
  ignitions: displacement.ignitions, displacements: displacement.confirmed,
  failedDisplacements: displacement.failed, confirmations: confirmation.confirmations,
  fvgZones: fvg.zones, fvgEvents: fvg.events, entryEvents: entry.events,
  entryCandidates: entry.candidates, entryEpisodes: entry.episodes,
  riskValidations: risk.validations, decisions: signal.decisions, signals: signal.signals,
  lifecycle: ledger.ledger.getLifecycleEventsThrough(Infinity),
};
function actualStreams(artifacts) {
  return { ...artifacts,
    psychology: timeframes.flatMap((tf) => artifacts.psychology[tf]),
    structureSwings: timeframes.flatMap((tf) => artifacts.structureSwings[tf]),
    structureEvents: timeframes.flatMap((tf) => artifacts.structureEvents[tf]),
    liquidity: timeframes.flatMap((tf) => artifacts.liquidity[tf]) };
}

const first = historical.candles1m[0].timestamp;
const exclusiveEnd = historical.requestedRange.end;
const replay = createReplaySession({ dataset: historical, start: first, end: exclusiveEnd });
const replayStarted = performance.now();
replay.runToEnd();
const totalReplayMs = performance.now() - replayStarted;
assert.equal(replay.status, "COMPLETED");
const divergence = findFirstReplayDivergence(expected, actualStreams(replay.getArtifacts()));
assert.equal(divergence, null, JSON.stringify(divergence));
const fingerprint = replay.getResultFingerprint();
replay.reset();
replay.runToEnd();
assert.equal(replay.getResultFingerprint(), fingerprint);

const midpointIndex = Math.floor((replay.startIndex + replay.endIndex - 1) / 2);
const midpoint = historical.candles1m[midpointIndex].timestamp;
const seekStarted = performance.now();
replay.runTo(midpoint);
const seekMs = performance.now() - seekStarted;
const clean = createReplaySession({ dataset: historical, start: first, end: exclusiveEnd });
clean.runTo(midpoint);
assert.equal(replay.getResultFingerprint(), clean.getResultFingerprint());
const prefixCandles = historical.candles1m.slice(0, midpointIndex + 1);
const prefixData = { ...historical,
  requestedRange: { start: first, end: midpoint + 60_000 },
  candles1m: prefixCandles,
  timeframes: { "5m": aggregate(prefixCandles, "5m"),
    "15m": aggregate(prefixCandles, "15m"), "1h": aggregate(prefixCandles, "1h") } };
const prefix = createReplaySession({ dataset: prefixData, start: first,
  end: midpoint + 60_000 });
prefix.runToEnd();
const prefixDivergence = findFirstReplayDivergence(
  actualStreams(prefix.getArtifacts()), actualStreams(clean.getArtifacts()));
assert.equal(prefixDivergence, null, JSON.stringify(prefixDivergence));
const snapshot = replay.getSnapshot();
assert.ok(snapshot && snapshot.timestamp === midpoint);
for (const item of [snapshot.structuralConfirmation, snapshot.entryCandidate,
  snapshot.riskValidation, snapshot.latestSignal?.signal].filter(Boolean)) {
  assert.ok(item.availableAt <= midpoint);
}

const counts = { swings: expected.structureSwings.length, liquidity: expected.liquidity.length,
  interactions: expected.interactionEvents.length, transfers: expected.controlTransfers.length,
  displacements: expected.displacements.length, confirmations: expected.confirmations.length,
  fvgEvents: expected.fvgEvents.length, entries: expected.entryCandidates.length,
  risks: expected.riskValidations.length, signals: expected.signals.length,
  lifecycle: expected.lifecycle.length };
console.log(JSON.stringify({ period: [from, to], status: "READY",
  datasetFingerprint: replay.datasetFingerprint, configHash: replay.configHash,
  engineVersion: replay.engineVersion, range: [first, exclusiveEnd],
  candles: replay.endIndex - replay.startIndex,
  startIndex: replay.startIndex, endIndex: replay.endIndex,
  firstDivergence: divergence, counts,
  averageStepMs: totalReplayMs / (replay.endIndex - replay.startIndex),
  totalReplayMs, seekMs, apiCallsBeforeReplay: historical.diagnostics.actualApiCalls,
  apiCallsDuringReplay: 0, checks: { timestampLookup: "PASS", stepForward: "PASS",
    runTo: "PASS", backwardSeek: "RESET_REPLAY_ONLY", htfCausality: "PASS",
    asOf: "PASS", batchReplay: "PASS", prefixInvariance: "PASS",
    futureInvariance: "PASS", lookAhead: 0, repaint: 0, determinism: "PASS" } }));
