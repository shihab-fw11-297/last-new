import test from "node:test";
import assert from "node:assert/strict";
import { createFvgEngine, analyzeHistoricalFvgs, FvgInputError } from
  "../lib/traderbrain/analysis/fvg-entry-location.ts";

const origin = Date.parse("2026-03-02T10:00:00Z");
const at = (i) => origin + 60_000 * i;
const bar = (i, low, high, close = (low + high) / 2) => ({ timestamp: at(i),
  open: close, low, high, close, symbol: "XAUUSD", timeframe: "1m", volume: null });
const feature = (candle, atr = 10) => ({ timestamp: candle.timestamp,
  timeframe: "1m", sourceComplete: true, atrReady: atr !== null, atr });
function impulse(start, end, direction = "BULLISH", id = `d:${start}:${end}`) {
  return { id, direction, context: "CONTINUATION", ignitionAt: at(start),
    createdAt: at(start), confirmedAt: at(end), availableAt: at(end),
    classification: "STRONG", controlTransferId: null,
    interactionId: null, liquidityId: null };
}
function confirmation(i, displacement, type = `${displacement.direction}_BOS`) {
  return { id: `s:${i}:${type}`, type, direction: displacement.direction,
    context: type.endsWith("MSS") ? "REVERSAL" : "CONTINUATION",
    createdAt: at(i), availableAt: at(i), displacementEventId: displacement.id,
    displacementClassification: displacement.classification,
    controlTransferId: "transfer:1", interactionId: "interaction:1",
    liquidityId: "liquidity:1" };
}
function run(candles, displacements = [], confirmations = [], config = {}) {
  const engine = createFvgEngine(config);
  for (let i = 0; i < candles.length; i++) {
    engine.push({ candle: candles[i], psychology: feature(candles[i], i < 3 ? 10 : 20),
      displacementEvents: displacements.filter((item) => item.availableAt === at(i)),
      structuralConfirmations: confirmations.filter((item) => item.availableAt === at(i)) });
  }
  return engine;
}
const bullish = () => [bar(0, 98, 100), bar(1, 99, 102), bar(2, 102, 104),
  bar(3, 103, 106), bar(4, 103, 107)];
const bearish = () => [bar(0, 102, 104), bar(1, 100, 103), bar(2, 98, 100),
  bar(3, 96, 99), bar(4, 95, 99)];

test("three closed candles create exact bullish and bearish geometry, with frozen ATR", () => {
  for (const [candles, direction] of [[bullish(), "BULLISH"],
    [bearish(), "BEARISH"]]) {
    const engine = createFvgEngine();
    for (let i = 0; i < 2; i++) {
      engine.push({ candle: candles[i], psychology: feature(candles[i]),
        displacementEvents: [], structuralConfirmations: [] });
      assert.equal(engine.zones.length, 0);
    }
    engine.push({ candle: candles[2], psychology: feature(candles[2]),
      displacementEvents: [], structuralConfirmations: [] });
    assert.equal(engine.zones.length, 1);
    const zone = engine.zones[0];
    assert.equal(zone.direction, direction);
    assert.deepEqual([zone.lower, zone.upper, zone.size, zone.sizeAtr], [100, 102, 2, 0.2]);
    assert.equal(zone.rawAvailableAt, at(2));
    assert.equal(zone.qualifiedAt, null);
    engine.push({ candle: candles[3], psychology: feature(candles[3], 20),
      displacementEvents: [], structuralConfirmations: [] });
    assert.equal(zone.sizeAtr, 0.2);
  }
});

test("no overlap, tiny gap, and zero ATR cannot make a qualified location", () => {
  const overlapping = [bar(0, 98, 102), bar(1, 99, 103), bar(2, 100, 104)];
  assert.equal(run(overlapping).zones.length, 0);
  const tiny = [bar(0, 98, 100), bar(1, 99, 101), bar(2, 100.01, 102)];
  const small = run(tiny);
  assert.equal(small.zones.length, 1);
  assert.equal(small.diagnostics.tooSmall, 1);
  assert.equal(small.zones[0].qualifiedAt, null);
  const zero = createFvgEngine();
  for (const candle of bullish().slice(0, 3)) zero.push({ candle,
    psychology: feature(candle, 0), displacementEvents: [], structuralConfirmations: [] });
  assert.equal(zero.zones[0].sizeAtr, null);
  assert.equal(zero.diagnostics.tooSmall, 1);
});

test("pre-confirmation FVG qualifies only when its exact BOS displacement is known", () => {
  const d = impulse(1, 3);
  const s = confirmation(4, d);
  const result = run(bullish(), [d], [s]);
  const zone = result.zones[0];
  assert.equal(zone.rawAvailableAt, at(2));
  assert.equal(zone.qualifiedAt, at(4));
  assert.equal(zone.locationStatus, "AVAILABLE");
  assert.equal(zone.structuralConfirmationType, "BULLISH_BOS");
  assert.equal(zone.displacementEventId, d.id);
  assert.equal(zone.structuralConfirmationId, s.id);
  assert.deepEqual([zone.controlTransferId, zone.interactionId, zone.liquidityId],
    [s.controlTransferId, s.interactionId, s.liquidityId]);
  assert.equal(result.diagnostics.qualifiedFromBos, 1);
  assert.equal(result.events.find((event) => event.type === "FVG_QUALIFIED").availableAt, at(4));
});

test("FVG filled before MSS remains unavailable after its lineage is recognized", () => {
  const candles = bullish();
  candles[3] = bar(3, 100, 106);
  const d = impulse(1, 3);
  const s = confirmation(4, d, "BULLISH_MSS");
  const result = run(candles, [d], [s]);
  const zone = result.zones[0];
  assert.equal(zone.status, "FILLED");
  assert.equal(zone.filledAt, at(3));
  assert.equal(zone.qualifiedAt, at(4));
  assert.equal(zone.locationStatus, "UNAVAILABLE");
  assert.equal(result.diagnostics.filledBeforeQualification, 1);
  assert.equal(result.diagnostics.currentlyOpenQualifiedZones, 0);
  assert.equal(result.diagnostics.qualifiedFromMss, 1);
});

test("bullish and bearish partial/fill lifecycle advances on later candles only", () => {
  for (const [base, partial, filled, direction] of [
    [bullish(), bar(5, 101, 108), bar(6, 100, 108), "BULLISH"],
    [bearish(), bar(5, 94, 101), bar(6, 94, 102), "BEARISH"]]) {
    const d = impulse(1, 3, direction);
    const s = confirmation(4, d);
    const engine = run(base, [d], [s]);
    const zone = engine.zones[0];
    assert.equal(zone.status, "OPEN");
    engine.push({ candle: partial, psychology: feature(partial),
      displacementEvents: [], structuralConfirmations: [] });
    assert.equal(zone.status, "PARTIAL");
    assert.equal(zone.maxFillFraction, 0.5);
    assert.equal(zone.firstRetraceAt, at(5));
    engine.push({ candle: filled, psychology: feature(filled),
      displacementEvents: [], structuralConfirmations: [] });
    assert.equal(zone.status, "FILLED");
    assert.equal(zone.maxFillFraction, 1);
    assert.equal(zone.filledAt, at(6));
    assert.equal(engine.diagnostics.currentlyOpenQualifiedZones, 0);
  }
});

test("Phase 10 emits causal fill-depth snapshots for later consumers", () => {
  const candles = [...bullish(), bar(5, 101, 108), bar(6, 100.5, 108)];
  const d = impulse(1, 3);
  const s = confirmation(4, d);
  const engine = run(candles, [d], [s]);
  const updates = engine.events.filter((event) =>
    event.type === "FVG_PARTIALLY_FILLED" ||
    event.type === "FVG_FILL_DEPTH_UPDATED");
  assert.deepEqual(updates.map((event) => [event.availableAt,
    event.maxFillFraction, event.status]),
  [[at(5), 0.5, "PARTIAL"], [at(6), 0.75, "PARTIAL"]]);
});

test("bearish MSS and already-known BOS both qualify exact impulse FVGs", () => {
  const d = impulse(1, 3, "BEARISH");
  const s = confirmation(4, d, "BEARISH_MSS");
  const reversed = run(bearish(), [d], [s]);
  assert.equal(reversed.zones[0].structuralConfirmationType, "BEARISH_MSS");
  assert.equal(reversed.diagnostics.qualifiedBearish, 1);
  const late = bullish();
  late[0] = bar(0, 98, 100);
  const prior = impulse(0, 1);
  const priorConfirmation = confirmation(1, prior);
  // Formation A..C still overlaps the end of this already confirmed impulse.
  const after = run(late, [prior], [priorConfirmation]);
  assert.equal(after.zones[0].qualifiedAt, at(2));
});

test("wrong displacement, direction, and expired pending zones never qualify", () => {
  const opposite = impulse(1, 3, "BEARISH");
  const oppositeS = confirmation(4, opposite);
  const mismatch = run([...bullish(), bar(5, 105, 108)], [opposite], [oppositeS],
    { maxQualificationLagBars: 2 });
  assert.equal(mismatch.zones[0].qualifiedAt, null);
  assert.equal(mismatch.diagnostics.expiredUnqualified, 1);
  assert.equal(mismatch.diagnostics.rejectedByReason.DIRECTION_MISMATCH, 1);
  const unrelated = impulse(3, 4);
  const unrelatedS = confirmation(4, unrelated);
  const wrong = run(bullish(), [unrelated], [unrelatedS]);
  assert.equal(wrong.zones[0].qualifiedAt, null);
  const noEvent = run([...bullish(), bar(5, 105, 108)], [], [],
    { maxQualificationLagBars: 2 });
  assert.equal(noEvent.diagnostics.expiredUnqualified, 1);
});

test("multiple FVGs in one impulse and replayed events keep one zone per formation", () => {
  const candles = [bar(0, 98, 100), bar(1, 100, 102), bar(2, 102, 104),
    bar(3, 104, 106), bar(4, 106, 108), bar(5, 108, 110)];
  const d = impulse(1, 4);
  const s = confirmation(5, d);
  const engine = createFvgEngine();
  for (let i = 0; i < candles.length; i++) {
    engine.push({ candle: candles[i], psychology: feature(candles[i]),
      displacementEvents: i === 4 || i === 5 ? [d] : [],
      structuralConfirmations: i === 5 ? [s, s] : [] });
  }
  assert.ok(engine.diagnostics.qualifiedBullish >= 2);
  assert.equal(new Set(engine.zones.map((zone) => zone.id)).size, engine.zones.length);
  assert.equal(engine.diagnostics.displacementsConsumed, 1);
  assert.equal(engine.diagnostics.structuralConfirmationsConsumed, 1);
});

test("batch, incremental, prefix, determinism, and alignment agree", () => {
  const candles = [...bullish(), bar(5, 101, 108), bar(6, 100, 108)];
  const d = impulse(1, 3);
  const s = confirmation(4, d);
  const psych = { status: "READY", timeframes: { "1m": { features:
    candles.map((candle, i) => feature(candle, i < 3 ? 10 : 20)) } } };
  const historical = { status: "READY", candles1m: candles };
  const displacement = { status: "READY", confirmed: [d] };
  const confirmationResult = { status: "READY", confirmations: [s] };
  const batch = analyzeHistoricalFvgs(historical, psych, displacement, confirmationResult);
  const repeat = analyzeHistoricalFvgs(historical, psych, displacement, confirmationResult);
  const incremental = run(candles, [d], [s]);
  assert.equal(batch.status, "READY");
  assert.deepEqual(batch.zones, incremental.zones);
  assert.deepEqual(batch.events, incremental.events);
  assert.deepEqual(batch.diagnostics, incremental.diagnostics);
  assert.deepEqual(batch.zones, repeat.zones);
  assert.deepEqual(batch.events, repeat.events);
  const prefix = run(candles.slice(0, 3));
  assert.deepEqual(prefix.events, batch.events.filter((event) =>
    event.availableAt <= at(2)));
  const bad = structuredClone(psych);
  bad.timeframes["1m"].features[2].timestamp++;
  assert.equal(analyzeHistoricalFvgs(historical, bad, displacement,
    confirmationResult).status, "BLOCKED");
  assert.throws(() => run([candles[0], candles[0]]), FvgInputError);
});
