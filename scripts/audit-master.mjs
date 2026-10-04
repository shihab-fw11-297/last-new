import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { aggregate } from "../lib/traderbrain/data/candles.ts";
import { analyzeHistoricalPsychology, createCandlePsychologyEngine } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure, createMarketStructureEngine } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity, createLiquidityEngine } from "../lib/traderbrain/analysis/liquidity.ts";
import { analyzePriceApproach, createPriceApproachEngine } from "../lib/traderbrain/analysis/price-approach.ts";
import { analyzeLiquidityInteractions, createLiquidityInteractionEngine } from "../lib/traderbrain/analysis/liquidity-interaction.ts";
import { analyzeHistoricalControl, createControlEngine } from "../lib/traderbrain/analysis/control-engine.ts";
import { analyzeHistoricalDisplacement, createDisplacementEngine } from "../lib/traderbrain/analysis/displacement-engine.ts";
import { analyzeHistoricalStructuralConfirmations, createStructuralConfirmationEngine } from "../lib/traderbrain/analysis/structural-confirmation.ts";
import { analyzeHistoricalFvgs } from "../lib/traderbrain/analysis/fvg-entry-location.ts";
import { analyzeHistoricalEntryCandidates } from "../lib/traderbrain/analysis/entry-candidate.ts";
import { analyzeHistoricalRiskValidations } from "../lib/traderbrain/analysis/risk-validation.ts";
import { analyzeHistoricalSignals } from "../lib/traderbrain/analysis/signal-decision.ts";
import { analyzeHistoricalSignalLedger } from "../lib/traderbrain/analysis/signal-ledger.ts";
import { createReplaySession, findFirstReplayDivergence } from "../lib/traderbrain/analysis/replay-engine.ts";
import { runBacktest } from "../lib/traderbrain/analysis/backtest-engine.ts";

const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable on the server");
const service = new HistoricalService(new FinageClient(key), new MemoryCandleStore(), { log: () => {} });
const small = await service.getHistoricalCandles("2026-03-03", "2026-03-04");
console.log(JSON.stringify({ stage: "smallFinageProbe", status: small.status,
  candles: small.candles1m.length, calls: small.diagnostics.actualApiCalls,
  first: small.diagnostics.firstTimestamp, last: small.diagnostics.lastTimestamp,
  error: small.diagnostics.errorCode }));
assert.ok(small.candles1m.length > 0 && !["BLOCKED", "FAILED"].includes(small.status),
  "Small real XAUUSD request must pass before extended certification");

const historical = await service.getHistoricalCandles(process.argv[2] ?? "2026-03-02",
  process.argv[3] ?? "2026-03-14");
console.log(JSON.stringify({ stage: "historical", status: historical.status,
  counts: { "1m": historical.candles1m.length, "5m": historical.timeframes["5m"].length,
    "15m": historical.timeframes["15m"].length, "1h": historical.timeframes["1h"].length },
  diagnostics: {
    calls: historical.diagnostics.actualApiCalls, retries: historical.diagnostics.retryCount,
    splits: historical.diagnostics.splitCount, first: historical.diagnostics.firstTimestamp,
    last: historical.diagnostics.lastTimestamp, gaps: historical.diagnostics.internalGapCount,
    missingMinutes: historical.diagnostics.internalMissingMinuteCount,
    largestGapMinutes: historical.diagnostics.largestGapMinutes,
    duplicates: historical.diagnostics.duplicateCount,
    conflicts: historical.diagnostics.duplicateConflictCount,
    invalidCandles: historical.diagnostics.invalidCandleCount,
    truncation: historical.diagnostics.providerTruncationDetected,
    error: historical.diagnostics.errorCode }, timings: historical.timings }));
assert.ok(historical.candles1m.length > 0 && !["BLOCKED", "FAILED"].includes(historical.status));

function measure(label, run) {
  const start = performance.now();
  const result = run();
  console.log(JSON.stringify({ stage: label, status: result.status,
    elapsedMs: Math.round((performance.now() - start) * 100) / 100,
    error: result.errorCode ?? result.diagnostics?.errorCode }));
  assert.ok(!["BLOCKED", "FAILED"].includes(result.status), `${label} blocked`);
  return result;
}
const psychology = measure("psychology", () => analyzeHistoricalPsychology(historical));
const structure = measure("structure", () => analyzeHistoricalMarketStructure(historical, psychology));
const liquidity = measure("liquidity", () => analyzeHistoricalLiquidity(structure, psychology));
const compressionEvidence = [];
const lastCompressed = new Map();
const approach = measure("approach", () => analyzePriceApproach(historical, psychology,
  liquidity, {}, (_, __, current) => {
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
const interaction = measure("interaction", () => analyzeLiquidityInteractions(historical, psychology, liquidity));
const control = measure("control", () => analyzeHistoricalControl(historical, psychology, structure, interaction));
const displacement = measure("displacement", () => analyzeHistoricalDisplacement(historical, psychology, structure, interaction));
const confirmation = measure("confirmation", () => analyzeHistoricalStructuralConfirmations(
  historical, psychology, structure, interaction));
const fvg = measure("fvg", () => analyzeHistoricalFvgs(historical, psychology,
  displacement, confirmation));
const entry = measure("entry", () => analyzeHistoricalEntryCandidates(historical,
  psychology, control, fvg));
const risk = measure("risk", () => analyzeHistoricalRiskValidations({ psychology,
  structure, liquidity, interaction, confirmation, fvg, entry }));
const signal = measure("signal", () => analyzeHistoricalSignals({ entry, risk,
  confirmation, displacement, control, interaction, liquidity, fvg,
  compressionEvidence }));
const ledger = measure("ledger", () => analyzeHistoricalSignalLedger(historical, signal));

const countBy = (items, key) => items.reduce((counts, item) => {
  counts[item[key]] = (counts[item[key]] ?? 0) + 1;
  return counts;
}, {});
const allStructure = Object.values(structure.timeframes);
const allLiquidity = Object.values(liquidity.timeframes);
const configs = { psychology: psychology.config, structure: structure.config,
  liquidity: liquidity.config, approach: approach.config, interaction: interaction.config,
  control: control.config, displacement: displacement.config,
  confirmation: confirmation.config, fvg: fvg.config, entry: entry.config,
  risk: risk.config };
const configHash = createHash("sha256").update(JSON.stringify(configs)).digest("hex");
console.log(JSON.stringify({ stage: "configuration", sha256: configHash, configs }));
console.log(JSON.stringify({ stage: "funnel", psychology: Object.fromEntries(
  Object.entries(psychology.timeframes).map(([tf, value]) => [tf, value.features.length])),
  swings1m: countBy(structure.timeframes["1m"].swings, "type"),
  swings: countBy(allStructure.flatMap((s) => s.swings), "type"),
  rawStructure1m: countBy(structure.timeframes["1m"].events, "type"),
  rawStructure: countBy(allStructure.flatMap((s) => s.events), "type"),
  liquidity: countBy(allLiquidity.flatMap((s) => s.levels), "kind"),
  liquiditySides: countBy(allLiquidity.flatMap((s) => s.levels), "side"),
  approachTransitions: countBy(approach.transitions, "nextState"),
  approachObservations: approach.diagnostics.stateObservations,
  interactionEvents: countBy(interaction.events, "type"),
  interactionCompleted: countBy(interaction.completed, "finalType"),
  controlChanges: countBy(control.stateChanges, "state"),
  transfers: countBy(control.transfers, "direction"),
  ignitions: displacement.ignitions.length,
  displacement: countBy(displacement.confirmed, "classification"),
  displacementContexts: countBy(displacement.confirmed, "context"),
  failedDisplacements: displacement.failed.length,
  confirmations: countBy(confirmation.confirmations, "type"),
  rawFvg: { bullish: fvg.diagnostics.rawBullishFvg,
    bearish: fvg.diagnostics.rawBearishFvg },
  qualifiedFvg: { bullish: fvg.diagnostics.qualifiedBullish,
    bearish: fvg.diagnostics.qualifiedBearish },
  retracements: entry.diagnostics.retracementsStarted,
  entryEpisodes: countBy(entry.episodes, "state"),
  entryCandidates: entry.candidates.length,
  risk: countBy(risk.validations, "status"),
  familyEligible: signal.diagnostics.familyEligible,
  signals: { buy: signal.diagnostics.buySignals, sell: signal.diagnostics.sellSignals },
  ledgerSignals: ledger.diagnostics.uniqueSignals,
  rejections: { interaction: interaction.diagnostics.rejectedByReason,
    control: control.diagnostics, displacement: {
    failures: displacement.diagnostics.failureReasons,
    ignition: displacement.diagnostics.ignitionRejections },
    confirmation: confirmation.diagnostics.rejectedByReason,
    fvg: fvg.diagnostics.rejectedByReason,
    entry: entry.diagnostics.rejectedByReason,
    risk: risk.diagnostics.rejectedByReason,
    signal: signal.diagnostics.rejectedByReason } }));

const cacheReplay = await service.getHistoricalCandles(historical.requestedRange.start,
  historical.requestedRange.end);
assert.equal(cacheReplay.diagnostics.actualApiCalls, 0);
assert.deepEqual(cacheReplay.candles1m, historical.candles1m);
for (const timeframe of ["5m", "15m", "1h"]) {
  assert.deepEqual(cacheReplay.timeframes[timeframe], historical.timeframes[timeframe]);
}
const allSources = { "1m": historical.candles1m, ...historical.timeframes };
for (const timeframe of ["1m", "5m", "15m", "1h"]) {
  const psychEngine = createCandlePsychologyEngine(timeframe);
  const structEngine = createMarketStructureEngine(timeframe);
  const source = allSources[timeframe];
  const replayFeatures = [];
  for (const candle of source) {
    const fact = psychEngine.push(candle);
    replayFeatures.push(fact);
    structEngine.push(candle, fact);
  }
  assert.deepEqual(replayFeatures,
    psychology.timeframes[timeframe].features);
  assert.deepEqual(structEngine.swings, structure.timeframes[timeframe].swings);
  assert.deepEqual(structEngine.events, structure.timeframes[timeframe].events);
  const liquidityEngine = createLiquidityEngine(timeframe);
  for (const swing of structEngine.swings) {
    liquidityEngine.pushSwing(swing,
      replayFeatures[swing.sourceIndex]);
  }
  assert.deepEqual(liquidityEngine.levels, liquidity.timeframes[timeframe].levels);
}
const approachEngine = createPriceApproachEngine();
const interactionEngine = createLiquidityInteractionEngine();
const controlEngine = createControlEngine();
const displacementEngine = createDisplacementEngine();
const confirmationEngine = createStructuralConfirmationEngine();
const cursors = { "1m": 0, "5m": 0, "15m": 0, "1h": 0 };
const checkpoints = [];
const replayStarted = performance.now();
const structureEvents = structure.timeframes["1m"].events;
const controlBars = { UNCLEAR: 0, BUYER_CONTROL: 0, SELLER_CONTROL: 0,
  BALANCED: 0, TRANSITION: 0 };
for (let i = 0; i < historical.candles1m.length; i++) {
  const candle = historical.candles1m[i];
  const feature = psychology.timeframes["1m"].features[i];
  const newLiquidity = [];
  for (const timeframe of ["1m", "5m", "15m", "1h"]) {
    const levels = liquidity.timeframes[timeframe].levels;
    while (cursors[timeframe] < levels.length &&
        levels[cursors[timeframe]].availableAt <= candle.timestamp) {
      newLiquidity.push(levels[cursors[timeframe]++]);
    }
  }
  const current = approachEngine.push({ candle, psychology: feature, newLiquidity });
  interactionEngine.push({ candle, psychology: feature, current });
  const state = controlEngine.push({ candle, psychology: feature,
    interactionEvents: interactionEngine.events, structureEvents });
  controlBars[state.state]++;
  displacementEngine.push({ candle, psychology: feature, control: state,
    controlTransferEvents: controlEngine.transfers });
  confirmationEngine.push({ timestamp: candle.timestamp, currentControl: state,
    structureEvents, controlTransferEvents: controlEngine.transfers,
    displacementEvents: displacementEngine.confirmed });
  if (i === 1000 || i === 2000 || i === 10000) {
    checkpoints.push({ cutoff: candle.timestamp,
      approach: structuredClone(approachEngine.transitions),
      interaction: structuredClone(interactionEngine.events),
      control: structuredClone(controlEngine.transfers),
      displacement: structuredClone(displacementEngine.confirmed),
      confirmation: structuredClone(confirmationEngine.confirmations) });
  }
}
assert.deepEqual(approachEngine.transitions, approach.transitions);
assert.deepEqual(interactionEngine.events, interaction.events);
assert.deepEqual(controlEngine.transfers, control.transfers);
assert.deepEqual(displacementEngine.ignitions, displacement.ignitions);
assert.deepEqual(displacementEngine.confirmed, displacement.confirmed);
assert.deepEqual(displacementEngine.failed, displacement.failed);
assert.deepEqual(confirmationEngine.confirmations, confirmation.confirmations);
for (const checkpoint of checkpoints) {
  for (const [name, events] of [
    ["approach", approach.transitions], ["interaction", interaction.events],
    ["control", control.transfers], ["displacement", displacement.confirmed],
    ["confirmation", confirmation.confirmations]]) {
    assert.deepEqual(checkpoint[name], events.filter((event) =>
      event.availableAt <= checkpoint.cutoff));
  }
}
for (const checkpoint of checkpoints) {
  const prefixCandles = historical.candles1m.filter((candle) =>
    candle.timestamp <= checkpoint.cutoff);
  const prefixHistorical = { ...historical, candles1m: prefixCandles,
    timeframes: { "5m": aggregate(prefixCandles, "5m"),
      "15m": aggregate(prefixCandles, "15m"),
      "1h": aggregate(prefixCandles, "1h") } };
  const prefixPsychology = analyzeHistoricalPsychology(prefixHistorical);
  const prefixStructure = analyzeHistoricalMarketStructure(prefixHistorical, prefixPsychology);
  const prefixLiquidity = analyzeHistoricalLiquidity(prefixStructure, prefixPsychology);
  const prefixApproach = analyzePriceApproach(prefixHistorical, prefixPsychology, prefixLiquidity);
  const prefixInteraction = analyzeLiquidityInteractions(prefixHistorical, prefixPsychology,
    prefixLiquidity);
  const prefixControl = analyzeHistoricalControl(prefixHistorical, prefixPsychology,
    prefixStructure, prefixInteraction);
  const prefixDisplacement = analyzeHistoricalDisplacement(prefixHistorical, prefixPsychology,
    prefixStructure, prefixInteraction);
  const prefixConfirmation = analyzeHistoricalStructuralConfirmations(prefixHistorical,
    prefixPsychology, prefixStructure, prefixInteraction);
  for (const result of [prefixPsychology, prefixStructure, prefixLiquidity,
    prefixApproach, prefixInteraction, prefixControl, prefixDisplacement, prefixConfirmation]) {
    assert.ok(result.status === "READY" || result.status === "WARN", "Prefix blocked");
  }
  for (const timeframe of ["1m", "5m", "15m", "1h"]) {
    const complete = (candle) => timeframe === "1m" ?
      candle.timestamp <= checkpoint.cutoff :
      candle.isComplete && candle.bucketEnd - 60_000 <= checkpoint.cutoff;
    const fullFeatures = psychology.timeframes[timeframe].features.filter((_, i) =>
      complete(allSources[timeframe][i]));
    const prefixFeatures = prefixPsychology.timeframes[timeframe].features.filter((_, i) =>
      complete(prefixHistorical.timeframes[timeframe]?.[i] ?? prefixCandles[i]));
    assert.deepEqual(prefixFeatures, fullFeatures);
    assert.deepEqual(prefixStructure.timeframes[timeframe].swings,
      structure.timeframes[timeframe].swings.filter((item) => item.availableAt <= checkpoint.cutoff));
    assert.deepEqual(prefixStructure.timeframes[timeframe].events,
      structure.timeframes[timeframe].events.filter((item) => item.availableAt <= checkpoint.cutoff));
    assert.deepEqual(prefixLiquidity.timeframes[timeframe].levels,
      liquidity.timeframes[timeframe].levels.filter((item) => item.availableAt <= checkpoint.cutoff));
  }
  for (const [prefixEvents, fullEvents] of [
    [prefixApproach.transitions, approach.transitions],
    [prefixInteraction.events, interaction.events],
    [prefixControl.transfers, control.transfers],
    [prefixDisplacement.confirmed, displacement.confirmed],
    [prefixConfirmation.confirmations, confirmation.confirmations]]) {
    assert.deepEqual(prefixEvents, fullEvents.filter((item) =>
      item.availableAt <= checkpoint.cutoff));
  }
}
console.log(JSON.stringify({ stage: "realCausalityReplay", status: "PASS",
  cacheCalls: cacheReplay.diagnostics.actualApiCalls, phase2To4Incremental: "PASS",
  phase5To9Incremental: "PASS", controlBars, prefixCheckpoints: checkpoints.map((item) =>
    new Date(item.cutoff).toISOString()),
  replayMs: Math.round((performance.now() - replayStarted) * 100) / 100,
  heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) }));

const timeframeNames = ["1m", "5m", "15m", "1h"];
const expectedStreams = {
  psychology: timeframeNames.flatMap((tf) => psychology.timeframes[tf].features),
  structureSwings: timeframeNames.flatMap((tf) => structure.timeframes[tf].swings),
  structureEvents: timeframeNames.flatMap((tf) => structure.timeframes[tf].events),
  liquidity: timeframeNames.flatMap((tf) => liquidity.timeframes[tf].levels),
  approachTransitions: approach.transitions, interactionEvents: interaction.events,
  interactions: interaction.completed, controlStateChanges: control.stateChanges,
  controlTransfers: control.transfers, ignitions: displacement.ignitions,
  displacements: displacement.confirmed, failedDisplacements: displacement.failed,
  confirmations: confirmation.confirmations, fvgZones: fvg.zones,
  fvgEvents: fvg.events, entryEvents: entry.events,
  entryCandidates: entry.candidates, entryEpisodes: entry.episodes,
  riskValidations: risk.validations, decisions: signal.decisions,
  signals: signal.signals,
  lifecycle: ledger.ledger.getLifecycleEventsThrough(Infinity),
};
const phase15Started = performance.now();
const phase15 = createReplaySession({ dataset: historical,
  start: historical.candles1m[0].timestamp, end: historical.requestedRange.end });
phase15.runToEnd();
const phase15Ms = performance.now() - phase15Started;
const replayArtifacts = phase15.getArtifacts();
const actualStreams = { ...replayArtifacts,
  psychology: timeframeNames.flatMap((tf) => replayArtifacts.psychology[tf]),
  structureSwings: timeframeNames.flatMap((tf) => replayArtifacts.structureSwings[tf]),
  structureEvents: timeframeNames.flatMap((tf) => replayArtifacts.structureEvents[tf]),
  liquidity: timeframeNames.flatMap((tf) => replayArtifacts.liquidity[tf]),
};
const divergence = findFirstReplayDivergence(expectedStreams, actualStreams);
assert.equal(divergence, null, JSON.stringify(divergence));
const firstFingerprint = phase15.getResultFingerprint();
phase15.reset();
phase15.runToEnd();
assert.equal(phase15.getResultFingerprint(), firstFingerprint);
console.log(JSON.stringify({ stage: "phase15", status: phase15.status,
  elapsedMs: Math.round(phase15Ms * 100) / 100,
  datasetFingerprint: phase15.datasetFingerprint, configHash: phase15.configHash,
  resultFingerprint: firstFingerprint, firstDivergence: divergence,
  lookAhead: 0, repaint: 0, determinism: "PASS" }));

const referenceAtrByRiskValidationId = new Map(risk.validations.flatMap((item) =>
  item.referenceAtr !== null && item.referenceAtr > 0 ? [[item.id, item.referenceAtr]] : []));
const evaluationStart = Math.max(historical.candles1m[0].timestamp,
  Date.parse(process.argv[4] ?? "2026-03-04"));
const phase16Started = performance.now();
const backtest = runBacktest({ dataset: historical, signals: signal.signals,
  evaluationStart, evaluationEnd: historical.requestedRange.end,
  dataWarmupStart: historical.requestedRange.start,
  strategyConfigHash: phase15.configHash, strategyEngineVersion: phase15.engineVersion,
  datasetFingerprint: phase15.datasetFingerprint, referenceAtrByRiskValidationId,
  phase14Ledger: ledger.ledger });
const phase16Ms = performance.now() - phase16Started;
console.log(JSON.stringify({ stage: "phase16", status: "READY",
  elapsedMs: Math.round(phase16Ms * 100) / 100,
  runId: backtest.metadata.runId,
  resultFingerprint: backtest.metadata.resultFingerprint,
  executionMode: backtest.executionConfig.entryExecutionMode,
  costModel: backtest.executionConfig.costModel,
  summary: backtest.summary, frequency: backtest.frequency,
  families: backtest.setupFamilies, directions: backtest.directions,
  diagnostics: backtest.diagnostics }));
