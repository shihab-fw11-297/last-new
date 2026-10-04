import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../lib/traderbrain/data/candles.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity, createLiquidityEngine } from "../lib/traderbrain/analysis/liquidity.ts";
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

const origin = Date.parse("2026-03-02T10:00:00Z");
const at = (i) => origin + i * 60_000;
const evidence = { strongBullishClose: false, strongBearishClose: false,
  upperRejection: false, lowerRejection: false, indecision: false,
  expansion: false, compression: false, momentumIncreasing: false,
  momentumDecaying: false };
const bar = (i, open, high, low, close) => ({ timestamp: at(i), open, high, low, close,
  volume: null, symbol: "XAUUSD", timeframe: "1m" });
function feature(candle, direction, ignition = false) {
  return { timestamp: candle.timestamp, timeframe: "1m", sourceComplete: true,
    direction, atrReady: true, atr: 10, directionalEfficiency: 0.8,
    rangeToATR: ignition ? 1.2 : 0.2, bodyToATR: ignition ? 1 : 0.1,
    bodyToRangeRatio: 0.8, closePosition: direction === "BEARISH" ? 0.1 : 0.9,
    overlapRatio: 0.2, closeAbovePreviousHigh: direction === "BULLISH",
    closeBelowPreviousLow: direction === "BEARISH",
    consecutiveBullishCount: direction === "BULLISH" ? 2 : 0,
    consecutiveBearishCount: direction === "BEARISH" ? 2 : 0,
    evidence: { ...evidence, strongBullishClose: direction === "BULLISH",
      strongBearishClose: direction === "BEARISH" } };
}

function run(kind) {
  const candles = Array.from({ length: 20 }, (_, i) => bar(i, 108, 109.5, 107.5, 109));
  let direction;
  let rawType;
  if (kind === "reversal") {
    candles.push(bar(20, 109, 112, 108, 109), bar(21, 109, 110, 106, 107),
      bar(22, 107, 108, 104, 105), bar(23, 105, 106, 94, 95),
      bar(24, 95, 97, 89, 90), bar(25, 90, 92, 84, 85));
    direction = "BEARISH";
    rawType = "RAW_BEARISH_STRUCTURE_SHIFT";
  } else if (kind === "continuation") {
    candles.push(bar(20, 109, 113, 108, 112), bar(21, 112, 115, 111, 114),
      bar(22, 114, 125, 113, 124), bar(23, 124, 130, 122, 129),
      bar(24, 129, 134, 128, 133), bar(25, 133, 134, 131, 132));
    direction = "BULLISH";
    rawType = "BULLISH_CONTINUATION_BREAK";
  } else {
    candles.push(bar(20, 109, 110, 108, 109), bar(21, 109, 109.5, 108, 109),
      bar(22, 109, 109.5, 108, 109), bar(23, 109, 109.5, 108, 109),
      bar(24, 109, 109.5, 108, 109), bar(25, 109, 109.5, 108, 109));
    direction = "NEUTRAL";
    rawType = null;
  }
  const features = candles.map((candle, i) => feature(candle,
    i < 20 ? "BULLISH" : kind === "reversal" && i >= 21 ? "BEARISH" : direction,
    kind === "reversal" ? i >= 23 : kind === "continuation" && i >= 22 && i <= 24));
  const levelEngine = createLiquidityEngine("1m");
  const [upper] = levelEngine.pushSwing({ id: "known-upper-swing", timeframe: "1m",
    type: "SWING_HIGH", timestamp: at(0), createdAt: at(0), availableAt: at(10),
    sourceIndex: 0, price: 110, previousSameTypeSwingId: null,
    classification: "UNCLASSIFIED" }, features[0]);
  const liquidity = { status: "READY", timeframes: Object.fromEntries(
    ["1m", "5m", "15m", "1h"].map((tf) => [tf, { status: "READY", timeframe: tf,
      levels: tf === "1m" ? [upper] : [] }])) };
  const raw = rawType ? [{ id: `raw:${kind}`, timeframe: "1m", type: rawType,
    breakKind: "CLOSE_BREAK", direction, side: direction === "BEARISH" ? "LOW" : "HIGH",
    timestamp: at(25), createdAt: at(25), availableAt: at(25), price: candles[25].close,
    levelPrice: direction === "BEARISH" ? 90 : 130, sourceIndex: 25,
    brokenSwingId: `broken:${kind}` }] : [];
  const historical = { status: "READY", candles1m: candles };
  const psychology = { status: "READY", timeframes: { "1m": { features } } };
  const structure = { status: "READY", timeframes: { "1m": { events: raw } } };
  const approach = analyzePriceApproach(historical, psychology, liquidity);
  const interaction = analyzeLiquidityInteractions(historical, psychology, liquidity);
  const control = analyzeHistoricalControl(historical, psychology, structure, interaction);
  const displacement = analyzeHistoricalDisplacement(historical, psychology, structure, interaction);
  const confirmation = analyzeHistoricalStructuralConfirmations(historical, psychology,
    structure, interaction);
  return { upper, approach, interaction, control, displacement, confirmation };
}

test("upper liquidity sweep flows through transfer, displacement, and one bearish MSS", () => {
  const result = run("reversal");
  assert.equal(result.approach.status, "READY");
  assert.ok(result.approach.transitions.some((item) => item.nextState === "TOUCHING"));
  assert.ok(result.interaction.events.some((item) => item.type === "SWEEP_CONFIRMED"));
  assert.equal(result.control.transfers.length, 1);
  assert.equal(result.control.transfers[0].direction, "BUYER_TO_SELLER");
  assert.equal(result.displacement.confirmed.length, 1);
  assert.equal(result.displacement.confirmed[0].context, "TRANSFER");
  assert.deepEqual(result.confirmation.confirmations.map((item) => item.type), ["BEARISH_MSS"]);
  const mss = result.confirmation.confirmations[0];
  assert.equal(mss.controlTransferId, result.control.transfers[0].id);
  assert.equal(mss.interactionId, result.control.transfers[0].interactionId);
  assert.equal(mss.liquidityId, result.upper.id);
  assert.equal(mss.availableAt, at(25));
});

test("accepted upper break preserves buyer control and confirms one bullish BOS", () => {
  const result = run("continuation");
  assert.ok(result.interaction.events.some((item) => item.type === "ACCEPTANCE_CONFIRMED"));
  assert.equal(result.control.transfers.length, 0);
  assert.ok(result.displacement.confirmed.some((item) => item.context === "CONTINUATION"));
  assert.deepEqual(result.confirmation.confirmations.map((item) => item.type), ["BULLISH_BOS"]);
});

test("upper liquidity touch without reclaim or impulse cannot create MSS/BOS", () => {
  const result = run("negative");
  assert.ok(result.interaction.events.some((item) => item.type === "TOUCH_DETECTED"));
  assert.equal(result.control.transfers.length, 0);
  assert.equal(result.displacement.confirmed.length, 0);
  assert.equal(result.confirmation.confirmations.length, 0);
});

// Closed OHLC bars below are deterministic test data. Every feature, swing,
// liquidity level and downstream event is produced by the real phase engines.
function fullOhlcScenario(kind) {
  const closes = Array.from({ length: 15 }, (_, i) => 100 + (i % 2 ? 0.2 : 0));
  closes.push(...[104, 108, 112, 116, 112, 109, 106, 110, 114, 118, 114, 110,
    108, 112, 116, 120, 116, 112, 110]);
  closes.push(...[110.5, 111.5, 112.5, 113.5, 114.5, 115.5, 116.5,
    117.5, 118.5, 119.5]);
  closes.push(...(kind === "continuation" ? [128, 134, 139, 141, 142] :
    kind === "negative" ? [119.5, 119.4, 119.5, 119.4, 119.5] :
      [119.5, 116, 112, 104, 99, 95, 93, 92, 91]));
  if (kind === "reversal-entry") closes.push(...[94, 97, 100, 103, 106, 102.5]);
  const candles = closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    let high = Math.max(open, close) + 0.6;
    let low = Math.min(open, close) - 0.6;
    if (i >= 34 && i <= 43) {
      high = Math.max(open, close) + 0.05;
      low = Math.min(open, close) - 0.05;
    }
    if (i === 44 && kind.startsWith("reversal")) high = 123;
    if (i === 44 && kind === "negative") high = 120.6;
    return { timestamp: at(i), open, high, low, close,
      volume: null, symbol: "XAUUSD", timeframe: "1m" };
  });
  const historical = { status: "READY", candles1m: candles,
    timeframes: { "5m": aggregate(candles, "5m"),
      "15m": aggregate(candles, "15m"), "1h": aggregate(candles, "1h") } };
  const psychology = analyzeHistoricalPsychology(historical);
  const structure = analyzeHistoricalMarketStructure(historical, psychology);
  const liquidity = analyzeHistoricalLiquidity(structure, psychology);
  const approach = analyzePriceApproach(historical, psychology, liquidity);
  const interaction = analyzeLiquidityInteractions(historical, psychology, liquidity);
  const control = analyzeHistoricalControl(historical, psychology, structure, interaction);
  const displacement = analyzeHistoricalDisplacement(historical, psychology, structure, interaction);
  const confirmation = analyzeHistoricalStructuralConfirmations(historical, psychology,
    structure, interaction);
  const fvg = analyzeHistoricalFvgs(historical, psychology, displacement, confirmation);
  const entry = analyzeHistoricalEntryCandidates(historical, psychology, control, fvg);
  const risk = analyzeHistoricalRiskValidations({ psychology, structure, liquidity,
    interaction, confirmation, fvg, entry });
  const signal = analyzeHistoricalSignals({ entry, risk, confirmation, displacement,
    control, interaction, liquidity, fvg });
  const ledger = analyzeHistoricalSignalLedger(historical, signal);
  for (const result of [psychology, structure, liquidity, approach, interaction,
    control, displacement, confirmation, fvg, entry, risk, signal, ledger]) {
    assert.equal(result.status, "READY");
  }
  return { candles, psychology, structure, liquidity, approach, interaction,
    control, displacement, confirmation, fvg, entry, risk, signal, ledger };
}

test("full OHLC reversal flows from a confirmed swing through one bearish MSS", () => {
  const result = fullOhlcScenario("reversal");
  const high = result.structure.timeframes["1m"].swings.find((swing) =>
    swing.type === "SWING_HIGH" && swing.price === 120.6);
  assert.ok(high && high.availableAt === at(32));
  const upper = result.liquidity.timeframes["1m"].levels.find((level) =>
    level.sourceSwingIds.includes(high.id));
  assert.ok(upper && upper.availableAt === high.availableAt);
  const sweep = result.interaction.events.find((event) =>
    event.liquidityId === upper.id && event.type === "RAID_CONFIRMED");
  assert.ok(sweep && sweep.availableAt === at(44));
  const transfer = result.control.transfers;
  assert.equal(transfer.length, 1);
  assert.equal(transfer[0].direction, "BUYER_TO_SELLER");
  assert.equal(transfer[0].liquidityId, upper.id);
  const impulse = result.displacement.confirmed.find((event) =>
    event.context === "TRANSFER");
  assert.ok(impulse && impulse.controlTransferId === transfer[0].id);
  const shift = result.structure.timeframes["1m"].events.find((event) =>
    event.type === "RAW_BEARISH_STRUCTURE_SHIFT");
  assert.ok(shift && shift.availableAt === at(47));
  assert.deepEqual(result.confirmation.confirmations.map((event) => event.type), ["BEARISH_MSS"]);
  const mss = result.confirmation.confirmations[0];
  assert.equal(mss.structureEventId, shift.id);
  assert.equal(mss.displacementEventId, impulse.id);
  assert.equal(mss.controlTransferId, transfer[0].id);
  assert.equal(mss.liquidityId, upper.id);
  assert.equal(mss.availableAt, at(48));
  assert.ok(result.fvg.zones.some((zone) => zone.structuralConfirmationId === mss.id &&
    zone.direction === "BEARISH" && zone.displacementEventId === impulse.id &&
    zone.qualifiedAt >= mss.availableAt));
  assert.equal(result.entry.diagnostics.qualifiedLocationsConsumed,
    result.fvg.diagnostics.qualifiedBearish + result.fvg.diagnostics.qualifiedBullish);
});

test("full OHLC reversal later retraces into the MSS FVG and creates one bearish candidate", () => {
  const result = fullOhlcScenario("reversal-entry");
  assert.equal(result.confirmation.confirmations[0]?.type, "BEARISH_MSS");
  assert.equal(result.entry.candidates.length, 1);
  const candidate = result.entry.candidates[0];
  const source = result.fvg.zones.find((item) => item.id === candidate.fvgId);
  assert.ok(source && source.qualifiedAt < candidate.availableAt);
  assert.equal(candidate.entryPrice, result.candles.at(-1).close);
  assert.equal(candidate.direction, "BEARISH");
  assert.equal(candidate.structuralConfirmationId,
    result.confirmation.confirmations[0].id);
  assert.equal(candidate.displacementEventId,
    result.confirmation.confirmations[0].displacementEventId);
  assert.ok(candidate.distanceFromZoneAtr <= result.entry.config.maxEntryExtensionAtr);
  assert.equal(result.risk.validations.length, 1);
  assert.equal(result.risk.validations[0].entryCandidateId, candidate.id);
  assert.equal(result.risk.validations[0].availableAt, candidate.availableAt);
  assert.notEqual(result.risk.validations[0].status, "INVALIDATED");
  assert.equal(result.signal.decisions.length, 1);
  assert.equal(result.signal.decisions[0].entryCandidateId, candidate.id);
  assert.equal(result.ledger.ledger.signalCount, result.signal.signals.length);
});

test("full OHLC accepted upper break confirms one bullish BOS without transfer", () => {
  const result = fullOhlcScenario("continuation");
  assert.ok(result.interaction.events.some((event) =>
    event.type === "ACCEPTANCE_CONFIRMED" && event.liquiditySide === "BSL"));
  assert.equal(result.control.transfers.length, 0);
  assert.ok(result.displacement.confirmed.some((event) =>
    event.context === "CONTINUATION" && event.availableAt === at(46)));
  assert.deepEqual(result.confirmation.confirmations.map((event) => event.type), ["BULLISH_BOS"]);
  assert.ok(result.fvg.zones.some((zone) =>
    zone.structuralConfirmationType === "BULLISH_BOS" && zone.direction === "BULLISH"));
  assert.equal(result.entry.diagnostics.qualifiedLocationsConsumed,
    result.fvg.diagnostics.qualifiedBearish + result.fvg.diagnostics.qualifiedBullish);
});

test("full OHLC level touch without follow-through creates no BOS or MSS", () => {
  const result = fullOhlcScenario("negative");
  assert.ok(result.interaction.events.some((event) =>
    event.type === "TOUCH_DETECTED" && event.availableAt === at(44)));
  assert.equal(result.control.transfers.length, 0);
  assert.equal(result.confirmation.confirmations.length, 0);
  assert.equal(result.fvg.diagnostics.qualifiedBullish + result.fvg.diagnostics.qualifiedBearish, 0);
  assert.equal(result.entry.candidates.length, 0);
});
