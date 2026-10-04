import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistoricalControl, createControlEngine, ControlInputError } from
  "../lib/traderbrain/analysis/control-engine.ts";

const base = Date.parse("2026-03-02T10:00:00Z");
const at = (i) => base + i * 60_000;
const evidence = { strongBullishClose: false, strongBearishClose: false,
  upperRejection: false, lowerRejection: false, indecision: false,
  expansion: false, compression: false, momentumIncreasing: false, momentumDecaying: false };
function candle(i) {
  return { timestamp: at(i), open: 100, high: 101, low: 99, close: 100,
    volume: null, symbol: "XAUUSD", timeframe: "1m" };
}
function feature(i, direction = "NEUTRAL", extra = {}) {
  return { timestamp: at(i), timeframe: "1m", sourceComplete: true,
    atrReady: true, atr: 2, directionalEfficiency: 0.8, direction,
    closeAbovePreviousHigh: direction === "BULLISH",
    closeBelowPreviousLow: direction === "BEARISH",
    consecutiveBullishCount: direction === "BULLISH" ? 2 : 0,
    consecutiveBearishCount: direction === "BEARISH" ? 2 : 0,
    ...extra, evidence: { ...evidence, strongBullishClose: direction === "BULLISH",
      strongBearishClose: direction === "BEARISH", ...extra.evidence } };
}
function interaction(i, side, type, suffix = "") {
  return { id: `int:${i}:${side}:${type}:${suffix}`,
    interactionId: `episode:${side}:${suffix}`, liquidityId: `level:${side}:${suffix}`,
    liquiditySide: side, sourceTimeframe: "1m", type, timestamp: at(i),
    createdAt: at(i), availableAt: at(i), price: 100, liquidityPrice: 100,
    penetrationAtr: 0.2, reactionAtr: 0.4 };
}
function structure(i, type) {
  return { id: `structure:${i}:${type}`, timeframe: "1m", type,
    availableAt: at(i), createdAt: at(i), timestamp: at(i) };
}
function run(directions, interactions = [], structures = [], length = directions.length) {
  const engine = createControlEngine();
  const snapshots = [];
  for (let i = 0; i < length; i++) {
    snapshots.push(engine.push({ candle: candle(i), psychology: feature(i, directions[i]),
      interactionEvents: interactions, structureEvents: structures }));
  }
  return { engine, snapshots };
}
const directions = (n, first = "BULLISH") => Array(n).fill(first);

test("BSL sweep begins transition at 10:20 and confirms only after two later seller bars", () => {
  const values = directions(24);
  values[21] = "BEARISH"; values[22] = "BEARISH";
  const result = run(values, [interaction(20, "BSL", "SWEEP_CONFIRMED")]);
  assert.equal(result.snapshots[19].state, "BUYER_CONTROL");
  assert.equal(result.snapshots[20].state, "TRANSITION");
  assert.equal(result.snapshots[21].state, "TRANSITION");
  assert.equal(result.snapshots[22].state, "SELLER_CONTROL");
  assert.equal(result.engine.transfers.length, 1);
  assert.equal(result.engine.transfers[0].direction, "BUYER_TO_SELLER");
  assert.equal(result.engine.transfers[0].availableAt, at(22));
  assert.equal(result.engine.transfers[0].interactionId, "episode:BSL:");
});

test("valid zero ATR is unready control evidence, not malformed input", () => {
  const engine = createControlEngine();
  const snapshot = engine.push({ candle: candle(0), psychology:
    feature(0, "NEUTRAL", { atr: 0 }), interactionEvents: [], structureEvents: [] });
  assert.equal(snapshot.state, "UNCLEAR");
  assert.equal(engine.diagnostics.processedCandles, 1);
});

test("BSL accepted break continues buyer control and never starts seller transfer", () => {
  const result = run(directions(24), [
    interaction(20, "BSL", "BREAK_CONFIRMED"),
    interaction(21, "BSL", "ACCEPTANCE_CONFIRMED")]);
  assert.equal(result.snapshots[21].state, "BUYER_CONTROL");
  assert.equal(result.engine.transfers.length, 0);
  assert.equal(result.engine.diagnostics.failedTransferCandidates, 0);
});

test("SSL accepted break continues seller control", () => {
  const result = run(directions(24, "BEARISH"), [
    interaction(20, "SSL", "BREAK_CONFIRMED"),
    interaction(21, "SSL", "ACCEPTANCE_CONFIRMED")]);
  assert.equal(result.snapshots[21].state, "SELLER_CONTROL");
  assert.equal(result.engine.transfers.length, 0);
});

test("failed BSL break and subsequent seller pressure cause a transfer", () => {
  const values = directions(24);
  values[21] = "BEARISH"; values[22] = "BEARISH";
  const result = run(values, [interaction(19, "BSL", "BREAK_CONFIRMED"),
    interaction(20, "BSL", "RECLAIM_CONFIRMED"),
    interaction(20, "BSL", "FAILED_BREAK_CONFIRMED")]);
  assert.equal(result.snapshots[20].state, "TRANSITION");
  assert.equal(result.engine.transfers[0].direction, "BUYER_TO_SELLER");
  assert.ok(result.engine.transfers[0].reasons.includes("FAILED_BREAK_ABOVE"));
});

test("SSL reclaim and bullish follow-through transfer seller to buyer", () => {
  const values = directions(24, "BEARISH");
  values[21] = "BULLISH"; values[22] = "BULLISH";
  const result = run(values, [interaction(20, "SSL", "RECLAIM_CONFIRMED")]);
  assert.equal(result.snapshots[20].state, "TRANSITION");
  assert.equal(result.engine.transfers[0].direction, "SELLER_TO_BUYER");
  assert.equal(result.snapshots[22].state, "BUYER_CONTROL");
});

test("one seller candle followed by buyer recovery cancels transition", () => {
  const values = directions(25);
  values[21] = "BEARISH";
  const result = run(values, [interaction(20, "BSL", "SWEEP_CONFIRMED")]);
  assert.equal(result.snapshots[21].state, "TRANSITION");
  assert.equal(result.snapshots[23].state, "BUYER_CONTROL");
  assert.equal(result.engine.transfers.length, 0);
  assert.equal(result.engine.diagnostics.failedTransferCandidates, 1);
  assert.equal(result.engine.diagnostics.failedTransferByReason.FOLLOW_THROUGH_FAILED, 1);
});

test("transition times out after bounded neutral bars", () => {
  const values = directions(27);
  for (let i = 21; i <= 25; i++) values[i] = "NEUTRAL";
  const result = run(values, [interaction(20, "BSL", "SWEEP_CONFIRMED")]);
  assert.equal(result.snapshots[24].state, "TRANSITION");
  assert.equal(result.snapshots[25].state, "BUYER_CONTROL");
  assert.equal(result.engine.diagnostics.failedTransferCandidates, 1);
  assert.equal(result.engine.diagnostics.failedTransferByReason.TRANSITION_TIMEOUT, 1);
  assert.equal(result.engine.transfers.length, 0);
  assert.ok(result.engine.stateChanges.at(-1).reasons.includes("TRANSITION_TIMEOUT"));
});

test("same-time conflicting reclaims follow current pressure", () => {
  const values = directions(23);
  values[20] = "BEARISH";
  const buyer = interaction(20, "SSL", "RECLAIM_CONFIRMED", "buyer");
  const seller = interaction(20, "BSL", "RECLAIM_CONFIRMED", "seller");
  for (const events of [[buyer, seller], [seller, buyer]]) {
    const result = run(values, events);
    assert.equal(result.snapshots[20].state, "TRANSITION");
    assert.equal(result.engine.stateChanges.find((event) =>
      event.state === "TRANSITION").interactionId, seller.interactionId);
  }
});

test("neutral overlapping market is balanced and ATR warmup stays unclear", () => {
  const engine = createControlEngine();
  const states = [];
  for (let i = 0; i < 5; i++) {
    const psych = feature(i, "NEUTRAL", { directionalEfficiency: 0.1,
      atrReady: i > 0, atr: i > 0 ? 2 : null,
      overlapRatio: 0.9, evidence: { compression: true } });
    states.push(engine.push({ candle: candle(i), psychology: psych,
      interactionEvents: [] }).state);
  }
  assert.equal(states[0], "UNCLEAR");
  assert.equal(states.at(-1), "BALANCED");
  assert.equal(engine.transfers.length, 0);
});

test("raw structure shift supports transfer only at its availableAt", () => {
  const values = directions(27);
  values[21] = "BEARISH"; values[22] = "BEARISH";
  const events = [interaction(20, "BSL", "FAILED_BREAK_CONFIRMED")];
  const shift = structure(22, "RAW_BEARISH_STRUCTURE_SHIFT");
  const result = run(values, events, [shift]);
  assert.equal(result.snapshots[21].state, "TRANSITION");
  assert.equal(result.engine.transfers[0].supportingStructureEventId, shift.id);
  assert.ok(result.engine.transfers[0].reasons.includes("BEARISH_STRUCTURE_SUPPORT"));
});

test("future structure and reclaim cannot affect earlier control facts", () => {
  const values = directions(26);
  values[21] = "BEARISH"; values[22] = "BEARISH";
  const future = [interaction(22, "BSL", "RECLAIM_CONFIRMED")];
  const shift = [structure(25, "RAW_BEARISH_STRUCTURE_SHIFT")];
  const result = run(values, future, shift);
  assert.equal(result.snapshots[21].state, "BUYER_CONTROL");
  assert.equal(result.engine.transfers.length, 0);
  assert.equal(result.engine.diagnostics.structureEventsConsumed, 1);
  const prefix = run(values, future, shift, 22);
  assert.equal(prefix.engine.diagnostics.interactionEventsConsumed, 0);
  assert.equal(prefix.engine.diagnostics.structureEventsConsumed, 0);
  assert.equal(prefix.engine.transfers.length, 0);
});

test("batch, incremental, prefix, and replay are identical", () => {
  const values = directions(2001);
  values[21] = "BEARISH"; values[22] = "BEARISH";
  const ints = [interaction(20, "BSL", "SWEEP_CONFIRMED")];
  const structs = [structure(22, "RAW_BEARISH_STRUCTURE_SHIFT")];
  const full = run(values, ints, structs);
  const replay = run(values, ints, structs);
  assert.deepEqual(full.engine.stateChanges, replay.engine.stateChanges);
  assert.deepEqual(full.engine.transfers, replay.engine.transfers);
  assert.deepEqual(full.engine.current, replay.engine.current);
  for (const length of [1001, 2001]) {
    const prefix = run(values, ints, structs, length);
    assert.deepEqual(prefix.engine.stateChanges,
      full.engine.stateChanges.filter((event) => event.availableAt <= at(length - 1)));
    assert.deepEqual(prefix.engine.transfers,
      full.engine.transfers.filter((event) => event.availableAt <= at(length - 1)));
    assert.deepEqual(prefix.engine.current, full.snapshots[length - 1]);
  }
  const historical = { status: "READY", candles1m: values.map((_, i) => candle(i)) };
  const psychology = { status: "READY",
    timeframes: { "1m": { features: values.map((value, i) => feature(i, value)) } } };
  const structureResult = { status: "READY", timeframes: { "1m": { events: structs } } };
  const interactionResult = { status: "READY", events: ints };
  const batch = analyzeHistoricalControl(historical, psychology, structureResult, interactionResult);
  assert.deepEqual(batch.stateChanges, full.engine.stateChanges);
  assert.deepEqual(batch.transfers, full.engine.transfers);
  assert.deepEqual(batch.current, full.engine.current);
  assert.deepEqual(batch.diagnostics, full.engine.diagnostics);
  const incremental = createControlEngine();
  const visibleInts = []; const visibleStructs = [];
  for (let i = 0; i < values.length; i++) {
    if (i === 20) visibleInts.push(ints[0]);
    if (i === 22) visibleStructs.push(structs[0]);
    incremental.push({ candle: candle(i), psychology: feature(i, values[i]),
      interactionEvents: visibleInts, structureEvents: visibleStructs });
  }
  assert.deepEqual(incremental.stateChanges, batch.stateChanges);
  assert.deepEqual(incremental.transfers, batch.transfers);
  assert.deepEqual(incremental.current, batch.current);
});

test("misaligned psychology and unordered event streams block", () => {
  const engine = createControlEngine();
  assert.throws(() => engine.push({ candle: candle(0), psychology: feature(1),
    interactionEvents: [] }), (error) =>
    error instanceof ControlInputError && error.code === "INPUT_ALIGNMENT");
  const bad = [interaction(2, "BSL", "SWEEP_CONFIRMED"),
    interaction(1, "BSL", "RECLAIM_CONFIRMED")];
  for (let i = 0; i < 2; i++) engine.push({ candle: candle(i),
    psychology: feature(i, "BULLISH"), interactionEvents: bad });
  assert.throws(() => engine.push({ candle: candle(2),
    psychology: feature(2, "BULLISH"), interactionEvents: bad }), (error) =>
    error instanceof ControlInputError && error.code === "INTERACTION_ORDER");
});
