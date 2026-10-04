import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistoricalDisplacement, createDisplacementEngine,
  DisplacementInputError } from "../lib/traderbrain/analysis/displacement-engine.ts";
import { createControlEngine } from "../lib/traderbrain/analysis/control-engine.ts";

const start = Date.parse("2026-03-02T10:00:00Z");
const at = (i) => start + i * 60_000;
const evidence = { strongBullishClose: false, strongBearishClose: false,
  upperRejection: false, lowerRejection: false, indecision: false,
  expansion: false, compression: false, momentumIncreasing: false,
  momentumDecaying: false };
function bar(i, open, high, low, close) {
  return { timestamp: at(i), open, high, low, close, volume: null,
    symbol: "XAUUSD", timeframe: "1m" };
}
function feature(i, direction = "BULLISH", options = {}) {
  return { timestamp: at(i), timeframe: "1m", sourceComplete: true,
    direction, atrReady: true, atr: 10, rangeToATR: 1.2, bodyToATR: 1,
    bodyToRangeRatio: 0.8, closePosition: direction === "BULLISH" ? 0.9 : 0.1,
    overlapRatio: 0.2, directionalEfficiency: 0.8,
    closeAbovePreviousHigh: direction === "BULLISH",
    closeBelowPreviousLow: direction === "BEARISH",
    consecutiveBullishCount: direction === "BULLISH" ? 2 : 0,
    consecutiveBearishCount: direction === "BEARISH" ? 2 : 0,
    ...options, evidence: { ...evidence, strongBullishClose: direction === "BULLISH",
      strongBearishClose: direction === "BEARISH", ...options.evidence } };
}
function control(i, state = "BUYER_CONTROL", lastTransferId = null,
  transitionDirection = null) {
  return { timestamp: at(i), state, pressure: state === "SELLER_CONTROL" ?
    "BEARISH" : "BULLISH", previousConfirmedState: state === "TRANSITION" ?
    "SELLER_CONTROL" : state, transitionDirection, transitionBars: 0,
    lastTransferId, reasons: [] };
}
function transfer(i, direction = "SELLER_TO_BUYER") {
  return { id: `transfer:${i}:${direction}`, direction, createdAt: at(i),
    availableAt: at(i), previousControl: direction === "SELLER_TO_BUYER" ?
      "SELLER_CONTROL" : "BUYER_CONTROL",
    newControl: direction === "SELLER_TO_BUYER" ?
      "BUYER_CONTROL" : "SELLER_CONTROL",
    interactionId: `interaction:${i}`, liquidityId: `liquidity:${i}`,
    supportingStructureEventId: null, reasons: [] };
}
const bullish = [
  bar(0, 100, 111, 99, 110),
  bar(1, 110, 116, 108, 115),
  bar(2, 115, 119, 113, 118),
];
const bearish = [
  bar(0, 100, 101, 89, 90),
  bar(1, 90, 92, 84, 85),
  bar(2, 85, 87, 81, 82),
];
function run(candles, features, controls, transfers = []) {
  const engine = createDisplacementEngine();
  const active = [];
  for (let i = 0; i < candles.length; i++) {
    active.push(engine.push({ candle: candles[i], psychology: features[i],
      control: controls[i], controlTransferEvents: transfers }));
  }
  return { engine, active };
}

test("ignition is available on its candle, even large travel cannot confirm it immediately", () => {
  const giant = bar(0, 100, 135, 99, 134);
  const result = run([giant], [feature(0)], [control(0)]);
  assert.equal(result.engine.ignitions.length, 1);
  assert.equal(result.engine.ignitions[0].availableAt, at(0));
  assert.equal(result.engine.confirmed.length, 0);
  assert.equal(result.active[0].status, "CANDIDATE");
  assert.equal(result.active[0].totalTravelAtr, 3.5);
});

test("valid zero ATR produces no ignition without blocking the stream", () => {
  const result = run([bullish[0]], [feature(0, "BULLISH",
    { atr: 0, rangeToATR: null, bodyToATR: null })], [control(0)]);
  assert.equal(result.engine.ignitions.length, 0);
  assert.equal(result.engine.diagnostics.processedCandles, 1);
});

test("bullish and bearish continuation confirm only after two later quality bars", () => {
  for (const [candles, direction, state] of [
    [bullish, "BULLISH", "BUYER_CONTROL"],
    [bearish, "BEARISH", "SELLER_CONTROL"]]) {
    const result = run(candles, candles.map((_, i) => feature(i, direction)),
      candles.map((_, i) => control(i, state)));
    assert.equal(result.engine.ignitions.length, 1);
    assert.equal(result.engine.confirmed.length, 1);
    const displacement = result.engine.confirmed[0];
    assert.equal(displacement.direction, direction);
    assert.equal(displacement.context, "CONTINUATION");
    assert.equal(displacement.classification, "VALID");
    assert.equal(displacement.createdAt, at(0));
    assert.equal(displacement.availableAt, at(2));
    assert.equal(displacement.barsToConfirm, 2);
  }
});

test("progressively larger normalized travel classifies STRONG and EXTREME", () => {
  for (const [last, expected] of [
    [bar(2, 115, 122, 113, 121), "STRONG"],
    [bar(2, 115, 135, 113, 134), "EXTREME"]]) {
    const candles = [bullish[0], bullish[1], last];
    const result = run(candles, candles.map((_, i) => feature(i)),
      candles.map((_, i) => control(i)));
    assert.equal(result.engine.confirmed[0].classification, expected);
  }
});

test("opposite seller control permits early bullish ignition but blocks confirmation", () => {
  const candles = [bullish[0], bar(1, 110, 111, 88, 90)];
  const result = run(candles, [feature(0), feature(1, "BEARISH")],
    [control(0, "SELLER_CONTROL"), control(1, "SELLER_CONTROL")]);
  assert.equal(result.engine.ignitions.length, 1);
  assert.ok(result.engine.ignitions[0].reasons.includes("OPPOSITE_CONTROL_IGNITION"));
  assert.equal(result.engine.confirmed.length, 0);
  assert.equal(result.engine.failed[0].reasons[0], "CONTROL_INVALIDATED");
  assert.equal(result.engine.failed[0].availableAt, at(1));
  assert.equal(result.engine.ignitions[0].availableAt, at(0));
});

test("high overlap and weak close each prevent a large candle from igniting", () => {
  for (const override of [{ overlapRatio: 0.8 }, { closePosition: 0.5 },
    { bodyToRangeRatio: 0.2 }]) {
    const result = run([bullish[0]], [feature(0, "BULLISH", override)], [control(0)]);
    assert.equal(result.engine.ignitions.length, 0);
    assert.equal(result.engine.confirmed.length, 0);
  }
});

test("stalled follow-through fails after bounded timeout and preserves ignition", () => {
  const candles = [bullish[0]];
  for (let i = 1; i <= 6; i++) candles.push(bar(i, 110, 111, 109, 110));
  const features = candles.map((_, i) => feature(i, i === 0 ? "BULLISH" : "NEUTRAL"));
  const result = run(candles, features, candles.map((_, i) => control(i)));
  assert.equal(result.engine.confirmed.length, 0);
  assert.equal(result.engine.failed.length, 1);
  assert.equal(result.engine.failed[0].availableAt, at(6));
  assert.equal(result.engine.ignitions[0].availableAt, at(0));
});

test("adverse closing retracement invalidates an unconfirmed candidate", () => {
  const candles = [bullish[0], bar(1, 110, 112, 96, 99)];
  const result = run(candles, [feature(0), feature(1, "BEARISH")],
    [control(0), control(1)]);
  assert.equal(result.engine.failed[0].reasons[0], "EXCESSIVE_RETRACE");
  assert.equal(result.engine.confirmed.length, 0);
});

test("opposite control transfer invalidates candidate only when available", () => {
  const event = transfer(2, "BUYER_TO_SELLER");
  const candles = [bullish[0], bullish[1], bullish[2]];
  const controls = [control(0), control(1), control(2, "SELLER_CONTROL", event.id)];
  const result = run(candles, candles.map((_, i) => feature(i)), controls, [event]);
  assert.equal(result.engine.failed[0].availableAt, at(2));
  assert.equal(result.engine.confirmed.length, 0);
  const prefix = run(candles.slice(0, 2), [feature(0), feature(1)],
    controls.slice(0, 2), [event]);
  assert.equal(prefix.engine.diagnostics.controlTransfersConsumed, 0);
  assert.equal(prefix.engine.failed.length, 0);
});

test("transfer-context confirmation retains Phase 7 lineage", () => {
  const event = transfer(0);
  const result = run(bullish, bullish.map((_, i) => feature(i)),
    bullish.map((_, i) => control(i, "BUYER_CONTROL", event.id)), [event]);
  const displacement = result.engine.confirmed[0];
  assert.equal(displacement.context, "TRANSFER");
  assert.equal(displacement.controlTransferId, event.id);
  assert.equal(displacement.interactionId, event.interactionId);
  assert.equal(displacement.liquidityId, event.liquidityId);
});

test("ignition during buyer transition adopts a later confirmed transfer", () => {
  const event = transfer(1);
  const controls = [control(0, "TRANSITION", null, "BUYER_CONTROL"),
    control(1, "BUYER_CONTROL", event.id), control(2, "BUYER_CONTROL", event.id)];
  const result = run(bullish, bullish.map((_, i) => feature(i)), controls, [event]);
  assert.equal(result.engine.ignitions[0].context, "CONTINUATION");
  assert.equal(result.engine.confirmed[0].context, "TRANSFER");
  assert.equal(result.engine.confirmed[0].controlTransferId, event.id);
  assert.equal(result.engine.confirmed[0].interactionId, event.interactionId);
});

test("reference ATR freezes at ignition while later ATR changes", () => {
  const candles = [bullish[0], bar(1, 110, 115, 108, 114),
    bar(2, 114, 120, 112, 119)];
  const features = candles.map((_, i) => feature(i, "BULLISH", { atr: i === 0 ? 10 : 15 }));
  const result = run(candles, features, candles.map((_, i) => control(i)));
  assert.equal(result.engine.confirmed[0].referenceAtr, 10);
  assert.equal(result.engine.confirmed[0].totalTravel, 20);
  assert.equal(result.engine.confirmed[0].totalTravelAtr, 2);
});

test("a confirmed five-bar impulse creates one ignition and one displacement", () => {
  const candles = [...bullish, bar(3, 118, 123, 116, 122),
    bar(4, 122, 126, 120, 125)];
  const result = run(candles, candles.map((_, i) => feature(i)),
    candles.map((_, i) => control(i)));
  assert.equal(result.engine.ignitions.length, 1);
  assert.equal(result.engine.confirmed.length, 1);
});

test("batch, incremental, 1001/2001 prefixes, and replay match", () => {
  const count = 2001;
  const candles = Array.from({ length: count }, (_, i) => {
    if (i === 20) return bar(i, 100, 111, 99, 110);
    if (i === 21) return bar(i, 110, 116, 108, 115);
    if (i === 22) return bar(i, 115, 119, 113, 118);
    return bar(i, 100, 101, 99, 100.5);
  });
  const features = candles.map((_, i) => feature(i, "BULLISH",
    i >= 20 && i <= 22 ? {} : { rangeToATR: 0.2, bodyToATR: 0.05 }));
  const historical = { status: "READY", candles1m: candles };
  const psychology = { status: "READY", timeframes: { "1m": { features } } };
  const structure = { status: "READY", timeframes: { "1m": { events: [] } } };
  const interaction = { status: "READY", events: [] };
  const batch = analyzeHistoricalDisplacement(historical, psychology, structure, interaction);
  const replay = analyzeHistoricalDisplacement(historical, psychology, structure, interaction);
  const stable = (result) => ({ ignitions: result.ignitions, confirmed: result.confirmed,
    failed: result.failed, active: result.active, diagnostics: result.diagnostics });
  assert.deepEqual(stable(batch), stable(replay));
  const controlEngine = createControlEngine();
  const displacementEngine = createDisplacementEngine();
  const prefixes = new Map();
  for (let i = 0; i < count; i++) {
    const snapshot = controlEngine.push({ candle: candles[i], psychology: features[i],
      interactionEvents: [], structureEvents: [] });
    displacementEngine.push({ candle: candles[i], psychology: features[i],
      control: snapshot, controlTransferEvents: controlEngine.transfers });
    if (i === 1000 || i === 2000) prefixes.set(i, {
      ignitions: structuredClone(displacementEngine.ignitions),
      confirmed: structuredClone(displacementEngine.confirmed),
      failed: structuredClone(displacementEngine.failed) });
  }
  assert.deepEqual(batch.ignitions, displacementEngine.ignitions);
  assert.deepEqual(batch.confirmed, displacementEngine.confirmed);
  assert.deepEqual(batch.failed, displacementEngine.failed);
  assert.deepEqual(batch.diagnostics, displacementEngine.diagnostics);
  for (const [index, facts] of prefixes) {
    assert.deepEqual(facts.ignitions,
      batch.ignitions.filter((event) => event.availableAt <= at(index)));
    assert.deepEqual(facts.confirmed,
      batch.confirmed.filter((event) => event.availableAt <= at(index)));
    assert.deepEqual(facts.failed,
      batch.failed.filter((event) => event.availableAt <= at(index)));
  }
});

test("misalignment, unordered transfers, and missing transfer lineage block", () => {
  const engine = createDisplacementEngine();
  assert.throws(() => engine.push({ candle: bullish[0], psychology: feature(0),
    control: control(1), controlTransferEvents: [] }), (error) =>
    error instanceof DisplacementInputError && error.code === "INPUT_ALIGNMENT");
  const event = transfer(0);
  assert.throws(() => engine.push({ candle: bullish[0], psychology: feature(0),
    control: control(0, "BUYER_CONTROL", event.id), controlTransferEvents: [] }), (error) =>
    error instanceof DisplacementInputError && error.code === "CONTROL_TRANSFER_ALIGNMENT");
  const orderedEngine = createDisplacementEngine();
  const future = transfer(2);
  const past = transfer(1);
  const stream = [future, past];
  orderedEngine.push({ candle: bullish[0], psychology: feature(0),
    control: control(0), controlTransferEvents: stream });
  orderedEngine.push({ candle: bullish[1], psychology: feature(1),
    control: control(1), controlTransferEvents: stream });
  assert.throws(() => orderedEngine.push({ candle: bullish[2], psychology: feature(2),
    control: control(2, "BUYER_CONTROL", past.id), controlTransferEvents: stream }), (error) =>
    error instanceof DisplacementInputError && error.code === "CONTROL_TRANSFER_ORDER");
});
