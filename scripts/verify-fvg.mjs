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
import { analyzeHistoricalFvgs, createFvgEngine } from
  "../lib/traderbrain/analysis/fvg-entry-location.ts";

const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable for real XAUUSD verification");
const service = new HistoricalService(new FinageClient(key),
  new MemoryCandleStore(), { log: () => {} });
const historical = await service.getHistoricalCandles(process.argv[2] ?? "2026-03-02",
  process.argv[3] ?? "2026-03-14");
assert.ok(["READY", "WARN"].includes(historical.status) && historical.candles1m.length);
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
const batch = stage("fvg", () => analyzeHistoricalFvgs(historical, psychology,
  displacement, confirmation));
const repeat = stage("fvg-repeat", () => analyzeHistoricalFvgs(historical, psychology,
  displacement, confirmation));
assert.deepEqual(batch.zones, repeat.zones);
assert.deepEqual(batch.events, repeat.events);
assert.deepEqual(batch.diagnostics, repeat.diagnostics);

const incremental = createFvgEngine();
const candles = historical.candles1m;
const features = psychology.timeframes["1m"].features;
let d = 0;
let c = 0;
const prefixes = [];
for (let i = 0; i < candles.length; i++) {
  const now = candles[i].timestamp;
  const newD = [];
  const newC = [];
  while (d < displacement.confirmed.length &&
    displacement.confirmed[d].availableAt <= now) newD.push(displacement.confirmed[d++]);
  while (c < confirmation.confirmations.length &&
    confirmation.confirmations[c].availableAt <= now) newC.push(confirmation.confirmations[c++]);
  incremental.push({ candle: candles[i], psychology: features[i],
    displacementEvents: newD, structuralConfirmations: newC });
  if (i === 1000 || i === 2000) {
    prefixes.push({ timestamp: now, events: structuredClone(incremental.events),
      raw: incremental.zones.map((zone) => ({ id: zone.id, lower: zone.lower,
        upper: zone.upper, sizeAtr: zone.sizeAtr, referenceAtr: zone.referenceAtr,
        rawAvailableAt: zone.rawAvailableAt })) });
  }
}
assert.equal(d, displacement.confirmed.length);
assert.equal(c, confirmation.confirmations.length);
assert.deepEqual(batch.zones, incremental.zones);
assert.deepEqual(batch.events, incremental.events);
assert.deepEqual(batch.diagnostics, incremental.diagnostics);
for (const prefix of prefixes) {
  assert.deepEqual(prefix.events, batch.events.filter((event) =>
    event.availableAt <= prefix.timestamp));
  assert.deepEqual(prefix.raw, batch.zones.filter((zone) =>
    zone.rawAvailableAt <= prefix.timestamp).map((zone) => ({ id: zone.id,
      lower: zone.lower, upper: zone.upper, sizeAtr: zone.sizeAtr,
      referenceAtr: zone.referenceAtr, rawAvailableAt: zone.rawAvailableAt })));
}
assert.ok(batch.zones.every((zone) => zone.formationAt < zone.rawAvailableAt &&
  zone.lower < zone.upper && zone.size === zone.upper - zone.lower &&
  (zone.qualifiedAt === null || zone.qualifiedAt >= zone.rawAvailableAt) &&
  (zone.filledAt === null || zone.filledAt > zone.rawAvailableAt) &&
  (zone.referenceAtr === null || zone.sizeAtr === zone.size / zone.referenceAtr)));
const counts = batch.diagnostics;
const statuses = { OPEN: 0, PARTIAL: 0, FILLED: 0 };
for (const zone of batch.zones) if (zone.qualifiedAt !== null) statuses[zone.status]++;
const topRejections = Object.entries(counts.rejectedByReason)
  .filter(([, count]) => count).sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(JSON.stringify({ status: batch.status, candlesProcessed: candles.length,
  displacementsConsumed: counts.displacementsConsumed,
  structuralConfirmationsConsumed: counts.structuralConfirmationsConsumed,
  rawBullishFvg: counts.rawBullishFvg, rawBearishFvg: counts.rawBearishFvg,
  tooSmall: counts.tooSmall, pendingQualification: counts.pendingQualification,
  qualifiedBullish: counts.qualifiedBullish, qualifiedBearish: counts.qualifiedBearish,
  qualifiedFromMss: counts.qualifiedFromMss,
  qualifiedFromBos: counts.qualifiedFromBos, partialTransitions: counts.partial,
  filledTransitions: counts.filled, qualifiedStatuses: statuses,
  filledBeforeQualification: counts.filledBeforeQualification,
  expiredUnqualified: counts.expiredUnqualified,
  currentlyOpenQualifiedZones: counts.currentlyOpenQualifiedZones,
  confirmationsWithoutMatchingFvg: counts.confirmationsWithoutMatchingFvg,
  topRejections, timings: batch.timings,
  upstream: { historical: historical.status, psychology: psychology.status,
    structure: structure.status, liquidity: liquidity.status, approach: approach.status,
    interaction: interaction.status, control: control.status,
    displacement: displacement.status, confirmation: confirmation.status },
  checks: { batchIncremental: "PASS", prefix: "PASS", determinism: "PASS",
    lineage: "PASS", lookAhead: 0 } }));
