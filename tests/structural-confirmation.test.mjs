import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistoricalStructuralConfirmations, createStructuralConfirmationEngine,
  StructuralConfirmationInputError } from
  "../lib/traderbrain/analysis/structural-confirmation.ts";
import { createControlEngine } from "../lib/traderbrain/analysis/control-engine.ts";
import { createDisplacementEngine } from "../lib/traderbrain/analysis/displacement-engine.ts";

const start = Date.parse("2026-03-02T10:00:00Z");
const at = (i) => start + i * 60_000;
function raw(i, type, id = `raw:${i}:${type}`) {
  const direction = type.includes("BULLISH") ? "BULLISH" : "BEARISH";
  return { id, timeframe: "1m", type, breakKind: "CLOSE_BREAK",
    direction, side: direction === "BULLISH" ? "HIGH" : "LOW",
    timestamp: at(i), createdAt: at(i), availableAt: at(i),
    price: 100, levelPrice: 99, sourceIndex: i, brokenSwingId: `swing:${i}` };
}
function transfer(i, direction) {
  return { id: `transfer:${i}:${direction}`, direction,
    createdAt: at(i), availableAt: at(i),
    previousControl: direction === "SELLER_TO_BUYER" ? "SELLER_CONTROL" : "BUYER_CONTROL",
    newControl: direction === "SELLER_TO_BUYER" ? "BUYER_CONTROL" : "SELLER_CONTROL",
    interactionId: `interaction:${i}`, liquidityId: `liquidity:${i}`,
    supportingStructureEventId: null, reasons: [] };
}
function displacement(i, direction, context, source = null, id = `displacement:${i}:${direction}`,
  classification = "VALID") {
  return { id, direction, context, createdAt: at(i - 1), availableAt: at(i),
    ignitionAt: at(i - 1), confirmedAt: at(i), classification,
    referenceAtr: 10, totalTravel: 20, totalTravelAtr: 2,
    maxAdverseRetracement: 2, maxAdverseRetracementAtr: 0.2,
    barsToConfirm: 1, controlState: direction === "BULLISH" ?
      "BUYER_CONTROL" : "SELLER_CONTROL",
    controlTransferId: source?.id ?? null,
    interactionId: source?.interactionId ?? null,
    liquidityId: source?.liquidityId ?? null, reasons: [] };
}
function control(i, state, lastTransferId = null) {
  return { timestamp: at(i), state, pressure: state === "BUYER_CONTROL" ?
    "BULLISH" : "BEARISH", previousConfirmedState: state,
    transitionDirection: null, transitionBars: 0, lastTransferId, reasons: [] };
}
function run(length, raws = [], transfers = [], displacements = [],
  state = "BUYER_CONTROL", config = {}) {
  const engine = createStructuralConfirmationEngine(config);
  for (let i = 0; i < length; i++) {
    let latest = null;
    for (const item of transfers) if (item.availableAt <= at(i)) latest = item;
    const activeState = latest ? latest.newControl : state;
    engine.push({ timestamp: at(i), structureEvents: raws,
      controlTransferEvents: transfers, displacementEvents: displacements,
      currentControl: control(i, activeState, latest?.id ?? null) });
  }
  return engine;
}

test("bullish and bearish BOS require aligned continuation displacement", () => {
  for (const [direction, state] of [
    ["BULLISH", "BUYER_CONTROL"], ["BEARISH", "SELLER_CONTROL"]]) {
    const source = raw(2, `${direction}_CONTINUATION_BREAK`);
    const impulse = displacement(3, direction, "CONTINUATION");
    const result = run(4, [source], [], [impulse], state);
    assert.equal(result.confirmations.length, 1);
    const item = result.confirmations[0];
    assert.equal(item.type, `${direction}_BOS`);
    assert.equal(item.createdAt, at(2));
    assert.equal(item.availableAt, at(3));
    assert.equal(item.structureEventId, source.id);
    assert.equal(item.brokenSwingId, source.brokenSwingId);
    assert.equal(item.displacementEventId, impulse.id);
    assert.equal(item.controlTransferId, null);
  }
});

test("bullish and bearish MSS require matching transfer and interaction lineage", () => {
  for (const [direction, transferType, state] of [
    ["BULLISH", "SELLER_TO_BUYER", "SELLER_CONTROL"],
    ["BEARISH", "BUYER_TO_SELLER", "BUYER_CONTROL"]]) {
    const source = transfer(1, transferType);
    const shift = raw(2, `RAW_${direction}_STRUCTURE_SHIFT`);
    const impulse = displacement(3, direction, "TRANSFER", source);
    const result = run(4, [shift], [source], [impulse], state);
    assert.equal(result.confirmations.length, 1);
    const item = result.confirmations[0];
    assert.equal(item.type, `${direction}_MSS`);
    assert.equal(item.context, "REVERSAL");
    assert.equal(item.controlTransferId, source.id);
    assert.equal(item.interactionId, source.interactionId);
    assert.equal(item.liquidityId, source.liquidityId);
    assert.equal(item.createdAt, at(2));
    assert.equal(item.availableAt, at(3));
  }
});

test("raw shift alone, transfer alone, and displacement alone do not confirm", () => {
  const shift = raw(1, "RAW_BEARISH_STRUCTURE_SHIFT");
  const source = transfer(1, "BUYER_TO_SELLER");
  const impulse = displacement(2, "BEARISH", "TRANSFER", source);
  assert.equal(run(9, [shift]).confirmations.length, 0);
  assert.equal(run(9, [], [source]).confirmations.length, 0);
  assert.equal(run(9, [], [], [impulse], "SELLER_CONTROL").confirmations.length, 0);
  const pending = run(9, [shift]);
  assert.equal(pending.diagnostics.pendingEventsExpired, 1);
  assert.equal(pending.diagnostics.rejectedByReason.NO_ALIGNED_DISPLACEMENT, 1);
});

test("MSS rejects missing transfer, missing lineage, and wrong transfer direction", () => {
  const shift = raw(1, "RAW_BEARISH_STRUCTURE_SHIFT");
  const noTransfer = displacement(2, "BEARISH", "TRANSFER");
  const absent = run(9, [shift], [], [noTransfer], "SELLER_CONTROL");
  assert.equal(absent.confirmations.length, 0);
  assert.equal(absent.diagnostics.rejectedByReason.NO_CONTROL_TRANSFER, 1);
  const source = transfer(1, "BUYER_TO_SELLER");
  const missingLineage = { ...displacement(2, "BEARISH", "TRANSFER", source),
    interactionId: null };
  const missing = run(9, [shift], [source], [missingLineage], "BUYER_CONTROL");
  assert.equal(missing.confirmations.length, 0);
  assert.equal(missing.diagnostics.rejectedByReason.NO_INTERACTION_LINEAGE, 1);
  const wrong = transfer(1, "SELLER_TO_BUYER");
  const wrongImpulse = displacement(2, "BEARISH", "TRANSFER", wrong);
  const wrongResult = run(9, [shift], [wrong], [wrongImpulse], "BUYER_CONTROL");
  assert.equal(wrongResult.confirmations.length, 0);
});

test("accepted-break continuation produces BOS without transfer lineage", () => {
  const result = run(4, [raw(2, "BULLISH_CONTINUATION_BREAK")], [],
    [displacement(3, "BULLISH", "CONTINUATION")]);
  assert.equal(result.confirmations[0].type, "BULLISH_BOS");
  assert.equal(result.diagnostics.confirmedMss, 0);
  assert.equal(result.confirmations[0].interactionId, null);
});

test("direction mismatch, wrong context, weak displacement, and opposed control reject", () => {
  const shift = raw(1, "RAW_BEARISH_STRUCTURE_SHIFT");
  const bullish = displacement(2, "BULLISH", "TRANSFER");
  const mismatch = run(9, [shift], [], [bullish], "SELLER_CONTROL");
  assert.equal(mismatch.confirmations.length, 0);
  assert.equal(mismatch.diagnostics.rejectedByReason.DIRECTION_MISMATCH, 1);
  const continuation = raw(1, "BULLISH_CONTINUATION_BREAK");
  const wrong = run(9, [continuation], [],
    [displacement(2, "BULLISH", "TRANSFER")]);
  assert.equal(wrong.diagnostics.rejectedByReason.WRONG_CONTEXT, 1);
  const weak = run(9, [continuation], [],
    [displacement(2, "BULLISH", "CONTINUATION")],
    "BUYER_CONTROL", { minimumDisplacementClassForBos: "STRONG" });
  assert.equal(weak.diagnostics.rejectedByReason.DISPLACEMENT_TOO_WEAK, 1);
  const opposed = run(9, [continuation], [],
    [displacement(2, "BULLISH", "CONTINUATION")], "SELLER_CONTROL");
  assert.equal(opposed.diagnostics.rejectedByReason.CONTROL_NOT_ALIGNED, 1);
});

test("displacement before raw structure confirms at the later structure timestamp", () => {
  const source = transfer(1, "BUYER_TO_SELLER");
  const impulse = displacement(2, "BEARISH", "TRANSFER", source);
  const shift = raw(3, "RAW_BEARISH_STRUCTURE_SHIFT");
  const result = run(4, [shift], [source], [impulse], "BUYER_CONTROL");
  assert.equal(result.confirmations[0].createdAt, at(3));
  assert.equal(result.confirmations[0].availableAt, at(3));
});

test("future displacement and future raw shift never backdate MSS", () => {
  const source = transfer(1, "BUYER_TO_SELLER");
  const shift = raw(2, "RAW_BEARISH_STRUCTURE_SHIFT");
  const impulse = displacement(3, "BEARISH", "TRANSFER", source);
  const beforeImpulse = run(3, [shift], [source], [impulse], "BUYER_CONTROL");
  assert.equal(beforeImpulse.confirmations.length, 0);
  const afterImpulse = run(4, [shift], [source], [impulse], "BUYER_CONTROL");
  assert.equal(afterImpulse.confirmations[0].availableAt, at(3));
  const earlyImpulse = displacement(2, "BEARISH", "TRANSFER", source);
  const laterShift = raw(3, "RAW_BEARISH_STRUCTURE_SHIFT");
  const beforeShift = run(3, [laterShift], [source], [earlyImpulse], "BUYER_CONTROL");
  assert.equal(beforeShift.confirmations.length, 0);
  const afterShift = run(4, [laterShift], [source], [earlyImpulse], "BUYER_CONTROL");
  assert.equal(afterShift.confirmations[0].availableAt, at(3));
});

test("same-timestamp transfer, displacement, and shift use causal precedence", () => {
  const source = transfer(2, "BUYER_TO_SELLER");
  const shift = raw(2, "RAW_BEARISH_STRUCTURE_SHIFT");
  const impulse = displacement(2, "BEARISH", "TRANSFER", source);
  const result = run(3, [shift], [source], [impulse], "BUYER_CONTROL");
  assert.equal(result.confirmations.length, 1);
  assert.equal(result.confirmations[0].availableAt, at(2));
  assert.equal(result.confirmations[0].controlTransferId, source.id);
});

test("correlation window expiry prevents old raw shift from matching later displacement", () => {
  const source = transfer(1, "BUYER_TO_SELLER");
  const shift = raw(1, "RAW_BEARISH_STRUCTURE_SHIFT");
  const impulse = displacement(8, "BEARISH", "TRANSFER", source);
  const result = run(10, [shift], [source], [impulse], "BUYER_CONTROL");
  assert.equal(result.confirmations.length, 0);
  assert.ok(result.diagnostics.pendingEventsExpired >= 1);
  assert.ok(result.diagnostics.rejectedByReason.CORRELATION_WINDOW_EXPIRED >= 1);
});

test("duplicate raw events confirm once and nearest displacement wins", () => {
  const shift = raw(3, "BULLISH_CONTINUATION_BREAK");
  const earlier = displacement(2, "BULLISH", "CONTINUATION", null, "earlier");
  const exact = displacement(3, "BULLISH", "CONTINUATION", null, "exact");
  const result = run(4, [shift, { ...shift }], [], [earlier, exact]);
  assert.equal(result.confirmations.length, 1);
  assert.equal(result.confirmations[0].displacementEventId, "exact");
  assert.equal(result.diagnostics.duplicateStructures, 1);
});

test("opposite transfer invalidates stale continuation before BOS", () => {
  const source = transfer(3, "BUYER_TO_SELLER");
  const impulse = displacement(2, "BULLISH", "CONTINUATION");
  const rawBreak = raw(4, "BULLISH_CONTINUATION_BREAK");
  const result = run(12, [rawBreak], [source], [impulse]);
  assert.equal(result.confirmations.length, 0);
  assert.equal(result.diagnostics.rejectedByReason.CONTROL_NOT_ALIGNED, 1);
});

test("an intervening opposite transfer still invalidates an older impulse after control recovers", () => {
  const seller = transfer(3, "BUYER_TO_SELLER");
  const buyer = transfer(4, "SELLER_TO_BUYER");
  const impulse = displacement(2, "BULLISH", "CONTINUATION");
  const rawBreak = raw(5, "BULLISH_CONTINUATION_BREAK");
  const result = run(13, [rawBreak], [seller, buyer], [impulse]);
  assert.equal(result.confirmations.length, 0);
  assert.equal(result.diagnostics.rejectedByReason.CONTROL_NOT_ALIGNED, 1);
});

test("input sources stay immutable and confirmation fields remain finite", () => {
  const raws = Object.freeze([Object.freeze(raw(1, "BULLISH_CONTINUATION_BREAK"))]);
  const impulses = Object.freeze([Object.freeze(displacement(2, "BULLISH", "CONTINUATION"))]);
  const result = run(3, raws, [], impulses);
  assert.equal(result.confirmations.length, 1);
  assert.ok(result.confirmations.every((item) =>
    [item.createdAt, item.availableAt, item.structurePrice].every(Number.isFinite)));
});

function candle(i) {
  const data = i === 20 ? [100, 111, 99, 110] :
    i === 21 ? [110, 116, 108, 115] :
      i === 22 ? [115, 119, 113, 118] : [100, 101, 99, 100.5];
  return { timestamp: at(i), open: data[0], high: data[1], low: data[2],
    close: data[3], volume: null, symbol: "XAUUSD", timeframe: "1m" };
}
const baseEvidence = { strongBullishClose: true, strongBearishClose: false,
  upperRejection: false, lowerRejection: false, indecision: false,
  expansion: false, compression: false, momentumIncreasing: false, momentumDecaying: false };
function feature(i) {
  const impulse = i >= 20 && i <= 22;
  return { timestamp: at(i), timeframe: "1m", sourceComplete: true,
    direction: "BULLISH", atrReady: true, atr: 10,
    rangeToATR: impulse ? 1.2 : 0.2,
    bodyToATR: impulse ? 1 : 0.05, bodyToRangeRatio: 0.8,
    closePosition: 0.9, overlapRatio: 0.2,
    directionalEfficiency: 0.8, closeAbovePreviousHigh: true,
    closeBelowPreviousLow: false, consecutiveBullishCount: 2,
    consecutiveBearishCount: 0, evidence: baseEvidence };
}
test("historical batch equals the same incremental engines; 1001/2001 prefixes are invariant", () => {
  const count = 2001;
  const candles = Array.from({ length: count }, (_, i) => candle(i));
  const features = candles.map((_, i) => feature(i));
  const structures = [raw(22, "BULLISH_CONTINUATION_BREAK")];
  const historical = { status: "READY", candles1m: candles };
  const psychology = { status: "READY", timeframes: { "1m": { features } } };
  const structure = { status: "READY", timeframes: { "1m": { events: structures } } };
  const interaction = { status: "READY", events: [] };
  const batch = analyzeHistoricalStructuralConfirmations(historical, psychology,
    structure, interaction);
  const repeat = analyzeHistoricalStructuralConfirmations(historical, psychology,
    structure, interaction);
  assert.equal(batch.status, "READY");
  assert.deepEqual(batch.confirmations, repeat.confirmations);
  assert.deepEqual(batch.latest, repeat.latest);
  assert.deepEqual(batch.diagnostics, repeat.diagnostics);
  const controlEngine = createControlEngine();
  const displacementEngine = createDisplacementEngine();
  const structuralEngine = createStructuralConfirmationEngine();
  const prefixes = new Map();
  for (let i = 0; i < count; i++) {
    const snapshot = controlEngine.push({ candle: candles[i], psychology: features[i],
      interactionEvents: [], structureEvents: structures });
    displacementEngine.push({ candle: candles[i], psychology: features[i],
      control: snapshot, controlTransferEvents: controlEngine.transfers });
    structuralEngine.push({ timestamp: at(i), currentControl: snapshot,
      structureEvents: structures, controlTransferEvents: controlEngine.transfers,
      displacementEvents: displacementEngine.confirmed });
    if (i === 1000 || i === 2000) {
      prefixes.set(i, structuredClone(structuralEngine.confirmations));
    }
  }
  assert.deepEqual(batch.confirmations, structuralEngine.confirmations);
  assert.deepEqual(batch.latest, structuralEngine.latest);
  assert.deepEqual(batch.diagnostics, structuralEngine.diagnostics);
  for (const [index, facts] of prefixes) {
    assert.deepEqual(facts,
      batch.confirmations.filter((item) => item.availableAt <= at(index)));
  }
});

test("misaligned control and out-of-order structure block", () => {
  const engine = createStructuralConfirmationEngine();
  assert.throws(() => engine.push({ timestamp: at(0),
    currentControl: control(1, "BUYER_CONTROL"), structureEvents: [],
    controlTransferEvents: [], displacementEvents: [] }), (error) =>
    error instanceof StructuralConfirmationInputError && error.code === "CONTROL_ALIGNMENT");
  const stream = [raw(2, "BULLISH_CONTINUATION_BREAK"),
    raw(1, "BULLISH_CONTINUATION_BREAK")];
  for (let i = 0; i < 2; i++) engine.push({ timestamp: at(i),
    currentControl: control(i, "BUYER_CONTROL"), structureEvents: stream,
    controlTransferEvents: [], displacementEvents: [] });
  assert.throws(() => engine.push({ timestamp: at(2),
    currentControl: control(2, "BUYER_CONTROL"), structureEvents: stream,
    controlTransferEvents: [], displacementEvents: [] }), (error) =>
    error instanceof StructuralConfirmationInputError && error.code === "STRUCTURE_ORDER");
});
