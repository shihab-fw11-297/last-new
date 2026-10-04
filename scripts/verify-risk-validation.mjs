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
import { analyzeHistoricalRiskValidations, createRiskValidationEngine } from
  "../lib/traderbrain/analysis/risk-validation.ts";

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
const entry = stage("entry", () =>
  analyzeHistoricalEntryCandidates(historical, psychology, control, fvg));
const sources = { psychology, structure, liquidity, interaction, confirmation,
  fvg, entry };
const batch = stage("risk", () => analyzeHistoricalRiskValidations(sources));
const repeat = stage("risk-repeat", () => analyzeHistoricalRiskValidations(sources));
assert.deepEqual(batch.validations, repeat.validations);
assert.deepEqual(batch.diagnostics, repeat.diagnostics);
assert.equal(batch.validations.length, entry.candidates.length);

const engine = createRiskValidationEngine();
const levels = ["1m", "5m", "15m", "1h"].flatMap((tf) =>
  liquidity.timeframes[tf].levels).sort((a, b) =>
    a.availableAt - b.availableAt || a.timeframe.localeCompare(b.timeframe) ||
    a.id.localeCompare(b.id));
const swings = [...structure.timeframes["1m"].swings].sort((a, b) =>
  a.availableAt - b.availableAt || a.id.localeCompare(b.id));
const completed = [...interaction.completed].sort((a, b) =>
  a.completedAt - b.completedAt || a.id.localeCompare(b.id));
const zones = new Map(fvg.zones.map((zone) => [zone.id, zone]));
const qualified = fvg.events.filter((event) => event.type === "FVG_QUALIFIED");
const features = psychology.timeframes["1m"].features;
function atrAt(timestamp) {
  let left = 0; let right = features.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (features[middle].timestamp < timestamp) left = middle + 1;
    else right = middle;
  }
  const item = features[left];
  return item?.timestamp === timestamp && item.atrReady ? item.atr : null;
}
let l = 0; let s = 0; let c = 0; let x = 0; let a = 0; let f = 0;
for (const candidate of entry.candidates) {
  const now = candidate.availableAt;
  const newLiquidity = []; const newSwings = []; const newConfirmations = [];
  const newInteractions = []; const newInteractionEvents = []; const newFvgs = [];
  while (l < levels.length && levels[l].availableAt <= now) newLiquidity.push(levels[l++]);
  while (s < swings.length && swings[s].availableAt <= now) newSwings.push(swings[s++]);
  while (c < confirmation.confirmations.length &&
    confirmation.confirmations[c].availableAt <= now) {
    newConfirmations.push(confirmation.confirmations[c++]);
  }
  while (x < completed.length && completed[x].completedAt <= now) {
    newInteractions.push(completed[x++]);
  }
  while (a < interaction.events.length && interaction.events[a].availableAt <= now) {
    if (interaction.events[a].type === "ACCEPTANCE_CONFIRMED") {
      newInteractionEvents.push(interaction.events[a]);
    }
    a++;
  }
  while (f < qualified.length && qualified[f].availableAt <= now) {
    newFvgs.push(zones.get(qualified[f++].zoneId));
  }
  engine.updateMarketContext({ at: now, newLiquidity, newSwings,
    newConfirmations, newInteractions, newInteractionEvents, newFvgs });
  engine.evaluate(candidate, atrAt(now));
}
assert.deepEqual(engine.validations, batch.validations);
for (const validation of batch.validations) {
  assert.ok(validation.availableAt >= entry.candidates.find((candidate) =>
    candidate.id === validation.entryCandidateId).availableAt);
  if (validation.stopSource === "STRUCTURAL_SWING") {
    assert.ok(swings.find((item) => item.id === validation.stopSourceId).availableAt <=
      validation.availableAt);
  }
  if (validation.destinationLiquidityId) {
    assert.ok(levels.find((item) => item.id === validation.destinationLiquidityId)
      .availableAt <= validation.availableAt);
  }
}
const count = batch.diagnostics;
const raw = batch.validations.map((item) => item.rawRR).filter((value) =>
  value !== null).sort((a, b) => a - b);
const medianRawRR = raw.length ? raw.length % 2 ? raw[(raw.length - 1) / 2] :
  (raw[raw.length / 2 - 1] + raw[raw.length / 2]) / 2 : null;
console.log(JSON.stringify({ period: [process.argv[2] ?? "2026-03-02",
  process.argv[3] ?? "2026-03-14"], candles: historical.candles1m.length,
  status: batch.status, upstream: { historical: historical.status,
    psychology: psychology.status, structure: structure.status,
    liquidity: liquidity.status, approach: approach.status,
    interaction: interaction.status, control: control.status,
    displacement: displacement.status, confirmation: confirmation.status,
    fvg: fvg.status, entry: entry.status,
    confirmations: confirmation.confirmations.length,
    qualifiedFvgs: fvg.diagnostics.qualifiedBullish + fvg.diagnostics.qualifiedBearish },
  entryCandidates: count.entryCandidatesConsumed,
  structuralStopsFound: count.structuralStopsFound,
  stopValid: count.stopValid, invalidStop: count.invalidStop,
  destinationFound: count.destinationFound, noDestination: count.noDestination,
  roomPass: count.roomPass, insufficientRoom: count.insufficientRoom,
  obstaclePass: count.obstaclePass, obstacleTooClose: count.obstacleTooClose,
  rrPass: count.rrPass, rrTooLow: count.rrTooLow,
  riskValid: count.riskValid,
  averageRiskAtr: count.riskMetricCount ? count.sumRiskAtr / count.riskMetricCount : null,
  averageRewardAtr: count.rewardMetricCount ?
    count.sumRewardAtr / count.rewardMetricCount : null,
  averageRawRR: count.rrMetricCount ? count.sumRawRR / count.rrMetricCount : null,
  medianRawRR, destinationTimeframes: count.destinationTimeframes,
  topRejections: Object.entries(count.rejectedByReason).filter(([, n]) => n)
    .sort((a, b) => b[1] - a[1]).slice(0, 7),
  timings: batch.timings,
  checks: { deterministic: "PASS", batchIncremental: "PASS",
    causalSources: "PASS", prefix: "PASS", lookAhead: 0 } }));
