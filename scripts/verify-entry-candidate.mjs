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
import { analyzeHistoricalEntryCandidates, createEntryCandidateEngine } from
  "../lib/traderbrain/analysis/entry-candidate.ts";

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
const approach = stage("approach", () => analyzePriceApproach(historical, psychology, liquidity));
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
const batch = stage("entry-candidate", () =>
  analyzeHistoricalEntryCandidates(historical, psychology, control, fvg));
const repeat = stage("entry-repeat", () =>
  analyzeHistoricalEntryCandidates(historical, psychology, control, fvg));
assert.deepEqual(batch.candidates, repeat.candidates);
assert.deepEqual(batch.episodes, repeat.episodes);
assert.deepEqual(batch.events, repeat.events);
assert.deepEqual(batch.diagnostics, repeat.diagnostics);

const incremental = createEntryCandidateEngine();
const candles = historical.candles1m;
const features = psychology.timeframes["1m"].features;
const zoneById = new Map(fvg.zones.map((zone) => [zone.id, zone]));
const candleByTime = new Map(candles.map((candle) => [candle.timestamp, candle]));
let e = 0; let s = 0; let t = 0;
let state = "UNCLEAR";
let lastTransferId = null;
const prefixes = [];
for (let i = 0; i < candles.length; i++) {
  const now = candles[i].timestamp;
  while (s < control.stateChanges.length &&
    control.stateChanges[s].availableAt <= now) state = control.stateChanges[s++].state;
  while (t < control.transfers.length &&
    control.transfers[t].availableAt <= now) lastTransferId = control.transfers[t++].id;
  const updates = [];
  const newZones = [];
  while (e < fvg.events.length && fvg.events[e].availableAt <= now) {
    const event = fvg.events[e++];
    updates.push(event);
    if (event.type === "FVG_QUALIFIED") newZones.push(zoneById.get(event.zoneId));
  }
  incremental.push({ candle: candles[i], psychology: features[i],
    control: { timestamp: now, state, lastTransferId },
    newZones, zoneUpdates: updates });
  if (i === 1000 || i === 2000) {
    prefixes.push({ timestamp: now, candidates: structuredClone(incremental.candidates),
      events: structuredClone(incremental.events),
      episodes: structuredClone(incremental.episodes) });
  }
}
assert.equal(e, fvg.events.length);
assert.equal(s, control.stateChanges.length);
assert.equal(t, control.transfers.length);
assert.deepEqual(batch.candidates, incremental.candidates);
assert.deepEqual(batch.episodes, incremental.episodes);
assert.deepEqual(batch.events, incremental.events);
assert.deepEqual(batch.diagnostics, incremental.diagnostics);
for (const prefix of prefixes) {
  assert.deepEqual(prefix.candidates, batch.candidates.filter((candidate) =>
    candidate.availableAt <= prefix.timestamp));
  assert.deepEqual(prefix.events, batch.events.filter((event) =>
    event.availableAt <= prefix.timestamp));
  assert.deepEqual(prefix.episodes, batch.episodes.filter((episode) =>
    episode.completedAt <= prefix.timestamp));
}
assert.ok(batch.candidates.every((candidate) => {
  const zone = zoneById.get(candidate.fvgId);
  return zone && candidate.availableAt >= zone.qualifiedAt &&
    candidate.entryPrice === candleByTime.get(candidate.availableAt)?.close &&
    candidate.distanceFromZoneAtr <= batch.config.maxEntryExtensionAtr &&
    candidate.structuralConfirmationId === zone.structuralConfirmationId &&
    candidate.displacementEventId === zone.displacementEventId;
}));
const setups = new Set(batch.candidates.map((candidate) =>
  `${candidate.structuralConfirmationId}:${candidate.displacementEventId}:${candidate.direction}`));
assert.equal(setups.size, batch.candidates.length);
const counts = batch.diagnostics;
const topRejections = Object.entries(counts.rejectedByReason)
  .filter(([, count]) => count).sort((a, b) => b[1] - a[1]).slice(0, 7);
console.log(JSON.stringify({ status: batch.status,
  candlesProcessed: candles.length,
  qualifiedLocationsConsumed: counts.qualifiedLocationsConsumed,
  zonesReachedAfterQualification: counts.zonesReachedAfterQualification,
  retracementsStarted: counts.retracementsStarted,
  qualityObserved: counts.qualityObserved,
  responseTriggers: counts.responseTriggers,
  candidateAttempts: counts.candidateAttempts,
  noChasePass: counts.noChasePass,
  entryCandidates: counts.entryCandidates, missed: counts.missed,
  invalidated: counts.invalidated, expired: counts.expired,
  averageBarsQualificationToRetrace: counts.zonesReachedAfterQualification ?
    counts.sumBarsQualificationToRetrace / counts.zonesReachedAfterQualification : null,
  averageBarsRetraceToCandidate: counts.entryCandidates ?
    counts.sumBarsRetraceToCandidate / counts.entryCandidates : null,
  averageEntryExtensionAtr: counts.entryCandidates ?
    counts.sumEntryExtensionAtr / counts.entryCandidates : null,
  topRejections, timings: batch.timings,
  upstream: { historical: historical.status, psychology: psychology.status,
    structure: structure.status, liquidity: liquidity.status, approach: approach.status,
    interaction: interaction.status, control: control.status,
    displacement: displacement.status, confirmation: confirmation.status,
    fvg: fvg.status, fvgQualified: fvg.diagnostics.qualifiedBullish +
      fvg.diagnostics.qualifiedBearish },
  checks: { batchIncremental: "PASS", prefix: "PASS", determinism: "PASS",
    causalEntry: "PASS", oneEntryPerSetup: "PASS", lookAhead: 0 } }));
