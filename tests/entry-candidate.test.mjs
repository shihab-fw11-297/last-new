import test from "node:test";
import assert from "node:assert/strict";
import { createEntryCandidateEngine, analyzeHistoricalEntryCandidates } from
  "../lib/traderbrain/analysis/entry-candidate.ts";

const origin = Date.parse("2026-03-02T10:00:00Z");
const at = (i) => origin + i * 60_000;
const bar = (i, low, high, close) => ({ timestamp: at(i), open: close,
  low, high, close, symbol: "XAUUSD", timeframe: "1m", volume: null });
function feature(candle, direction = "NEUTRAL", extras = {}) {
  return { timestamp: candle.timestamp, timeframe: "1m", sourceComplete: true,
    atrReady: true, atr: 10, direction, bodyToATR: 0.3,
    bodyToRangeRatio: 0.6, closePosition: direction === "BEARISH" ? 0.1 : 0.9,
    overlapRatio: 0.5, directionalEfficiency: 0.5,
    evidence: { strongBullishClose: false, strongBearishClose: false,
      lowerRejection: false, upperRejection: false, indecision: false,
      compression: false, momentumIncreasing: false, momentumDecaying: false },
    ...extras };
}
function zone(direction = "BULLISH", id = `fvg:${direction}`,
  lower = 100, upper = 102, qualifiedAt = at(0)) {
  return { id, direction, timeframe: "1m", lower, upper,
    midpoint: (lower + upper) / 2, size: upper - lower,
    sizeAtr: (upper - lower) / 10, referenceAtr: 10,
    formationAt: at(-4), rawAvailableAt: at(-2), qualifiedAt,
    status: "PARTIAL", locationStatus: "AVAILABLE", maxFillFraction: 0.5,
    displacementEventId: "displacement:1", displacementClassification: "STRONG",
    structuralConfirmationId: "structure:1", structuralConfirmationType:
      direction === "BULLISH" ? "BULLISH_BOS" : "BEARISH_MSS",
    controlTransferId: direction === "BEARISH" ? "transfer:original" : null,
    interactionId: "interaction:1", liquidityId: "liquidity:1",
    firstRetraceAt: at(2), filledAt: null };
}
function update(i, target, type, status, fraction) {
  return { id: `${target.id}:${type}:${at(i)}`, zoneId: target.id,
    type, availableAt: at(i), status, maxFillFraction: fraction,
    locationStatus: status === "FILLED" ? "UNAVAILABLE" : "AVAILABLE" };
}
const bullishBars = () => [bar(0, 103, 105, 104), bar(1, 103, 105, 103.5),
  bar(2, 101, 104, 102.5), bar(3, 101.5, 104, 103.5)];
const bearishBars = () => [bar(0, 97, 99, 98), bar(1, 97, 99, 98.5),
  bar(2, 97, 101, 99.5), bar(3, 97, 100, 98.5)];
function run(candles, zones, updates, directions, controls = [], config = {},
  features = null) {
  const engine = createEntryCandidateEngine(config);
  for (let i = 0; i < candles.length; i++) {
    const newEvents = updates.filter((event) => event.availableAt === at(i));
    engine.push({ candle: candles[i],
      psychology: features?.[i] ?? feature(candles[i], directions[i]),
      control: controls[i] ?? { timestamp: at(i),
        state: zones[0]?.direction === "BEARISH" ? "SELLER_CONTROL" :
          "BUYER_CONTROL", lastTransferId: null },
      newZones: zones.filter((item) => item.qualifiedAt === at(i)),
      zoneUpdates: newEvents });
  }
  return engine;
}

test("controlled bullish and bearish retracements wait for a closed response", () => {
  for (const [direction, bars, directions] of [
    ["BULLISH", bullishBars(), ["BULLISH", "BEARISH", "BEARISH", "BULLISH"]],
    ["BEARISH", bearishBars(), ["BEARISH", "BULLISH", "BULLISH", "BEARISH"]]]) {
    const z = zone(direction);
    const events = [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
      update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5)];
    const engine = createEntryCandidateEngine();
    for (let i = 0; i < bars.length; i++) {
      engine.push({ candle: bars[i], psychology: feature(bars[i], directions[i]),
        control: { timestamp: at(i), state: direction === "BULLISH" ?
          "BUYER_CONTROL" : "SELLER_CONTROL", lastTransferId: null },
        newZones: i === 0 ? [z] : [],
        zoneUpdates: events.filter((event) => event.availableAt === at(i)) });
      if (i <= 2) assert.equal(engine.candidates.length, 0);
    }
    assert.equal(engine.candidates.length, 1);
    const candidate = engine.candidates[0];
    assert.equal(candidate.direction, direction);
    assert.equal(candidate.availableAt, at(3));
    assert.equal(candidate.entryPrice, bars[3].close);
    assert.equal(candidate.retracementClass, "CONTROLLED");
    assert.equal(candidate.fillFractionAtEntry, 0.5);
    assert.equal(candidate.barsFromQualifiedToRetrace, 2);
    assert.equal(candidate.barsFromRetraceToCandidate, 1);
    assert.equal(candidate.distanceFromZoneAtr, 0.15);
    assert.equal(candidate.structuralConfirmationId, z.structuralConfirmationId);
    assert.equal(engine.diagnostics.qualityObserved.CONTROLLED, 1);
  }
});

test("aggressive retracement needs recovery; deep, shallow, and messy remain descriptive", () => {
  const z = zone();
  const bars = [...bullishBars(), bar(4, 101.5, 104, 103.6)];
  const updates = [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
    update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5)];
  const features = bars.map((candle, i) => feature(candle,
    i === 1 || i === 2 ? "BEARISH" : "BULLISH"));
  features[2].bodyToATR = 1;
  features[2].evidence.momentumIncreasing = true;
  const engine = createEntryCandidateEngine();
  for (let i = 0; i < bars.length; i++) {
    engine.push({ candle: bars[i], psychology: features[i],
      control: { timestamp: at(i), state: "BUYER_CONTROL", lastTransferId: null },
      newZones: i === 0 ? [z] : [],
      zoneUpdates: updates.filter((event) => event.availableAt === at(i)) });
    if (i === 2) assert.equal(engine.diagnostics.qualityObserved.AGGRESSIVE, 1);
    if (i === 3) assert.equal(engine.candidates.length, 0);
  }
  assert.equal(engine.candidates.length, 1);
  assert.equal(engine.candidates[0].availableAt, at(4));
  for (const [fraction, expected] of [[0.8, "DEEP"], [0.1, "SHALLOW"]]) {
    const state = run(bullishBars(), [z], [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
      update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", fraction)],
    ["BULLISH", "BEARISH", "BEARISH", "BULLISH"]);
    assert.equal(state.diagnostics.qualityObserved[expected], 1);
  }
  const messyFeatures = bullishBars().map((candle, i) =>
    feature(candle, i === 3 ? "BULLISH" : "BEARISH"));
  messyFeatures[2].evidence.indecision = true;
  const messy = run(bullishBars(), [z], updates,
    ["BULLISH", "BEARISH", "BEARISH", "BULLISH"], [], {}, messyFeatures);
  assert.equal(messy.diagnostics.qualityObserved.MESSY, 1);
});

test("opposite confirmed transfer and filled zone invalidate without entry", () => {
  const z = zone();
  const updates = [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
    update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5)];
  const controls = bullishBars().map((_, i) => ({ timestamp: at(i),
    state: i < 3 ? "BUYER_CONTROL" : "SELLER_CONTROL",
    lastTransferId: i < 3 ? null : "transfer:opposite" }));
  const invalid = run(bullishBars(), [z], updates,
    ["BULLISH", "BEARISH", "BEARISH", "BULLISH"], controls);
  assert.equal(invalid.candidates.length, 0);
  assert.equal(invalid.episodes[0].state, "INVALIDATED");
  assert.equal(invalid.diagnostics.rejectedByReason.CONTROL_INVALIDATED, 1);
  const filled = run(bullishBars(), [z], [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
    update(2, z, "FVG_FILLED", "FILLED", 1)],
  ["BULLISH", "BEARISH", "BEARISH", "BULLISH"]);
  assert.equal(filled.candidates.length, 0);
  assert.equal(filled.episodes[0].state, "INVALIDATED");
  assert.equal(filled.diagnostics.rejectedByReason.ZONE_FILLED, 1);
  const opposedAtQualification = run(bullishBars(), [z],
    [update(0, z, "FVG_QUALIFIED", "OPEN", 0)],
    ["BULLISH", "BEARISH", "BEARISH", "BULLISH"],
    bullishBars().map((_, i) => ({ timestamp: at(i),
      state: "SELLER_CONTROL", lastTransferId: "transfer:already-opposed" })));
  assert.equal(opposedAtQualification.candidates.length, 0);
  assert.equal(opposedAtQualification.episodes[0].state, "INVALIDATED");
});

test("pre-qualification touch and filled-before-qualification never create retrospective entry", () => {
  const bars = [bar(0, 101, 105, 104), bar(1, 101, 105, 103),
    bar(2, 103, 106, 104), bar(3, 103, 106, 105)];
  const z = zone("BULLISH", "late", 100, 102, at(2));
  const late = run(bars, [z], [update(2, z, "FVG_QUALIFIED", "PARTIAL", 0.5)],
    ["BEARISH", "BEARISH", "BULLISH", "BULLISH"]);
  assert.equal(late.candidates.length, 0);
  assert.equal(late.diagnostics.zonesReachedAfterQualification, 0);
  const stale = run(bars, [z], [update(2, z, "FVG_QUALIFIED", "FILLED", 1)],
    ["BEARISH", "BEARISH", "BULLISH", "BULLISH"]);
  assert.equal(stale.candidates.length, 0);
  assert.equal(stale.diagnostics.rejectedByReason.ZONE_FILLED, 1);
});

test("no chase marks an extended response MISSED; no retrace expires", () => {
  const z = zone();
  const bars = bullishBars();
  bars[3] = bar(3, 102, 112, 111);
  const missed = run(bars, [z], [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
    update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5)],
  ["BULLISH", "BEARISH", "BEARISH", "BULLISH"]);
  assert.equal(missed.candidates.length, 0);
  assert.equal(missed.episodes[0].state, "MISSED");
  assert.equal(missed.diagnostics.rejectedByReason.ENTRY_TOO_EXTENDED, 1);
  const noTouch = [bar(0, 103, 105, 104), bar(1, 103, 105, 104),
    bar(2, 103, 105, 104), bar(3, 103, 105, 104)];
  const expired = run(noTouch, [z], [update(0, z, "FVG_QUALIFIED", "OPEN", 0)],
    ["BULLISH", "BULLISH", "BULLISH", "BULLISH"], [],
    { maxBarsToRetrace: 2 });
  assert.equal(expired.episodes[0].state, "EXPIRED");
  assert.equal(expired.diagnostics.rejectedByReason.NO_RETRACE, 1);
});

test("exact edge touch is causal and multiple FVGs yield one setup candidate", () => {
  const z = zone();
  const edge = bullishBars();
  edge[2] = bar(2, 102, 104, 103);
  const touched = run(edge, [z], [update(0, z, "FVG_QUALIFIED", "OPEN", 0)],
    ["BULLISH", "BEARISH", "BEARISH", "BULLISH"]);
  assert.equal(touched.diagnostics.zonesReachedAfterQualification, 1);
  assert.equal(touched.candidates.length, 1);
  assert.equal(new Set(touched.events.map((event) => event.id)).size,
    touched.events.length);
  const second = zone("BULLISH", "fvg:second", 99, 103);
  const pair = run(bullishBars(), [z, second],
    [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
      update(0, second, "FVG_QUALIFIED", "OPEN", 0),
      update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5),
      update(2, second, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5)],
    ["BULLISH", "BEARISH", "BEARISH", "BULLISH"]);
  assert.equal(pair.candidates.length, 1);
  assert.equal(pair.candidates[0].fvgId, second.id);
  assert.equal(pair.diagnostics.rejectedByReason.DUPLICATE_SETUP_ENTRY, 1);
});

test("a touched zone without directional response expires at entry timeout", () => {
  const z = zone();
  const candles = [...bullishBars().slice(0, 3),
    bar(3, 101, 103, 102), bar(4, 101, 103, 102.1),
    bar(5, 101, 103, 102)];
  const features = candles.map((candle, i) => feature(candle,
    i <= 2 ? "BEARISH" : "NEUTRAL", { bodyToATR: 0,
      bodyToRangeRatio: 0 }));
  const result = run(candles, [z],
    [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
      update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5)],
    [], [], { maxBarsToEntry: 2 }, features);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.episodes[0].state, "EXPIRED");
  assert.equal(result.diagnostics.rejectedByReason.ENTRY_TIMEOUT, 1);
});

test("candidate remains immutable after future control invalidation", () => {
  const z = zone();
  const candles = [...bullishBars(), bar(4, 101, 104, 102)];
  const before = run(candles.slice(0, 4), [z],
    [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
      update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5)],
    ["BULLISH", "BEARISH", "BEARISH", "BULLISH"]);
  const after = run(candles, [z],
    [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
      update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5)],
    ["BULLISH", "BEARISH", "BEARISH", "BULLISH", "BEARISH"],
    candles.map((_, i) => ({ timestamp: at(i),
      state: i === 4 ? "SELLER_CONTROL" : "BUYER_CONTROL",
      lastTransferId: i === 4 ? "transfer:future" : null })));
  assert.deepEqual(after.candidates, before.candidates);
});

test("batch equals incremental, repeated run, and prefix output", () => {
  const candles = bullishBars();
  const z = zone();
  const events = [update(0, z, "FVG_QUALIFIED", "OPEN", 0),
    update(2, z, "FVG_PARTIALLY_FILLED", "PARTIAL", 0.5)];
  const directions = ["BULLISH", "BEARISH", "BEARISH", "BULLISH"];
  const features = candles.map((candle, i) => feature(candle, directions[i]));
  const historical = { status: "READY", candles1m: candles };
  const psych = { status: "READY", timeframes: { "1m": { features } } };
  const control = { status: "READY", diagnostics: { processedCandles: candles.length },
    stateChanges: [{ availableAt: at(0), state: "BUYER_CONTROL" }], transfers: [],
    current: { timestamp: at(3), state: "BUYER_CONTROL", lastTransferId: null } };
  const fvg = { status: "READY", diagnostics: { processedCandles: candles.length },
    zones: [z], events };
  const batch = analyzeHistoricalEntryCandidates(historical, psych, control, fvg);
  const again = analyzeHistoricalEntryCandidates(historical, psych, control, fvg);
  const incremental = run(candles, [z], events, directions);
  assert.equal(batch.status, "READY");
  assert.deepEqual(batch.candidates, incremental.candidates);
  assert.deepEqual(batch.episodes, incremental.episodes);
  assert.deepEqual(batch.events, incremental.events);
  assert.deepEqual(batch.diagnostics, incremental.diagnostics);
  assert.deepEqual(batch.candidates, again.candidates);
  const prefix = run(candles.slice(0, 3), [z], events, directions);
  assert.deepEqual(prefix.events, batch.events.filter((event) =>
    event.availableAt <= at(2)));
  const bad = structuredClone(psych);
  bad.timeframes["1m"].features[2].timestamp++;
  assert.equal(analyzeHistoricalEntryCandidates(historical, bad, control, fvg).status,
    "BLOCKED");
});
