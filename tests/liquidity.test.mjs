import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistoricalLiquidity, analyzeLiquidity, createLiquidityEngine, LiquidityInputError } from
  "../lib/traderbrain/analysis/liquidity.ts";

const steps = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000 };
const start = 1_700_000_000_000;
const stamp = (index, timeframe = "1m") => start + index * steps[timeframe];

function swing(type, sourceIndex, confirmationIndex, price, classification = "UNCLASSIFIED", timeframe = "1m") {
  const createdAt = stamp(sourceIndex, timeframe);
  const availableAt = stamp(confirmationIndex, timeframe);
  return { id: `XAUUSD:${timeframe}:${type}:${sourceIndex}:${createdAt}:${availableAt}`,
    timeframe, type, timestamp: createdAt, price, sourceIndex, createdAt, availableAt,
    previousSameTypeSwingId: null, classification };
}

function features(count = 100, timeframe = "1m", atr = 10) {
  return Array.from({ length: count }, (_, i) => ({ timestamp: stamp(i, timeframe),
    timeframe, atr, atrReady: true }));
}

function structure(swings, timeframe = "1m", status = "READY") {
  return { status, timeframe, swings };
}

function facts(result) {
  return { levels: result.levels, latest: result.latest, diagnostics: result.diagnostics };
}

test("confirmed high and low create BSL and SSL with exact source times and lineage", () => {
  const high = swing("SWING_HIGH", 10, 13, 2650, "HH");
  const low = swing("SWING_LOW", 15, 18, 2640, "HL");
  const result = analyzeLiquidity(structure([high, low]), features());
  assert.equal(result.status, "READY");
  assert.deepEqual(result.levels.map((level) => [level.side, level.kind]),
    [["BSL", "SWING"], ["SSL", "SWING"]]);
  assert.deepEqual(result.levels[0].sourceSwingIds, [high.id]);
  assert.deepEqual(result.levels[1].sourceSwingIds, [low.id]);
  assert.equal(result.levels[0].createdAt, high.createdAt);
  assert.equal(result.levels[0].availableAt, high.availableAt);
  assert.equal(result.levels[1].createdAt, low.createdAt);
  assert.equal(result.levels[1].availableAt, low.availableAt);
  assert.equal(result.levels.filter((level) => level.availableAt <= stamp(12)).length, 0);
  assert.equal(result.levels.filter((level) => level.availableAt <= stamp(13)).length, 1);
});

test("HH, LH, HL, and LL classifications are copied from Phase 3", () => {
  const swings = [
    swing("SWING_HIGH", 1, 2, 2650, "HH"),
    swing("SWING_LOW", 3, 4, 2640, "HL"),
    swing("SWING_HIGH", 5, 6, 2647, "LH"),
    swing("SWING_LOW", 7, 8, 2637, "LL"),
  ];
  const result = analyzeLiquidity(structure(swings), features());
  assert.deepEqual(result.levels.map((level) => level.sourceClassifications),
    [["HH"], ["HL"], ["LH"], ["LL"]]);
});

test("equal highs use later swing's origin ATR and become available only at its confirmation", () => {
  const first = swing("SWING_HIGH", 18, 20, 2650);
  const second = swing("SWING_HIGH", 38, 40, 2650.8, "HH");
  const source = features(50);
  source[38].atr = 10;
  const engine = createLiquidityEngine("1m");
  assert.deepEqual(engine.pushSwing(first, source[first.sourceIndex]).map((level) => level.kind), ["SWING"]);
  assert.equal(engine.levels.filter((level) => level.availableAt <= stamp(39)).length, 1);
  assert.deepEqual(engine.pushSwing(second, source[second.sourceIndex]).map((level) => level.kind),
    ["SWING", "EQH"]);
  const equal = engine.levels.find((level) => level.kind === "EQH");
  assert.deepEqual(equal.sourceSwingIds, [first.id, second.id]);
  assert.deepEqual(equal.sourceClassifications, ["UNCLASSIFIED", "HH"]);
  assert.equal(equal.createdAt, second.createdAt);
  assert.equal(equal.availableAt, second.availableAt);
  assert.equal(equal.price, 2650.4);
  assert.equal(engine.levels.filter((level) => level.availableAt <= stamp(39)).length, 1);
  assert.equal(engine.levels.filter((level) => level.availableAt <= stamp(40)).length, 3);
  source[38].atr = 5;
  assert.equal(analyzeLiquidity(structure([first, second]), source).diagnostics.eqhCreated, 0);
});

test("equal lows are causal and highs or lows outside ATR tolerance do not match", () => {
  const firstLow = swing("SWING_LOW", 8, 10, 2640);
  const secondLow = swing("SWING_LOW", 28, 30, 2640.8, "HL");
  const farLow = swing("SWING_LOW", 38, 40, 2637, "LL");
  const farHighA = swing("SWING_HIGH", 48, 50, 2650);
  const farHighB = swing("SWING_HIGH", 58, 60, 2652, "HH");
  const result = analyzeLiquidity(structure([firstLow, secondLow, farLow, farHighA, farHighB]), features());
  const equal = result.levels.find((level) => level.kind === "EQL");
  assert.deepEqual(equal.sourceSwingIds, [firstLow.id, secondLow.id]);
  assert.equal(equal.availableAt, stamp(30));
  assert.equal(result.levels.filter((level) => level.availableAt <= stamp(29) && level.kind === "EQL").length, 0);
  assert.equal(result.diagnostics.eqlCreated, 1);
  assert.equal(result.diagnostics.eqhCreated, 0);
});

test("a future matching low cannot create EQL in an earlier prefix", () => {
  const first = swing("SWING_LOW", 18, 20, 2640);
  const second = swing("SWING_LOW", 38, 40, 2640.5);
  const source = features(50);
  const prefix = analyzeLiquidity(structure([first]), source.slice(0, 40));
  const full = analyzeLiquidity(structure([first, second]), source);
  assert.equal(prefix.diagnostics.eqlCreated, 0);
  assert.equal(full.diagnostics.eqlCreated, 1);
  assert.deepEqual(full.levels.filter((level) => level.availableAt <= stamp(39)), prefix.levels);
  assert.equal(full.levels.find((level) => level.kind === "EQL").availableAt, stamp(40));
});

test("third equal swing emits new pair facts without editing earlier liquidity", () => {
  const items = [swing("SWING_HIGH", 1, 2, 2650), swing("SWING_HIGH", 3, 4, 2650.2),
    swing("SWING_HIGH", 5, 6, 2650.4)];
  const engine = createLiquidityEngine("1m");
  const source = features();
  engine.pushSwing(items[0], source[1]);
  engine.pushSwing(items[1], source[3]);
  const before = structuredClone(engine.levels);
  engine.pushSwing(items[2], source[5]);
  assert.deepEqual(engine.levels.slice(0, before.length), before);
  assert.equal(engine.diagnostics.eqhCreated, 3);
  assert.equal(new Set(engine.levels.map((level) => level.id)).size, engine.levels.length);
});

test("duplicate swing combinations are skipped and conflicting duplicate IDs block", () => {
  const first = swing("SWING_HIGH", 1, 2, 2650);
  const second = swing("SWING_HIGH", 3, 4, 2650.2);
  const source = features();
  const engine = createLiquidityEngine("1m");
  engine.pushSwing(first, source[1]);
  engine.pushSwing(second, source[3]);
  assert.deepEqual(engine.pushSwing(second, source[3]), []);
  assert.equal(engine.diagnostics.duplicatesPrevented, 1);
  assert.equal(engine.diagnostics.eqhCreated, 1);
  assert.throws(() => engine.pushSwing({ ...second, price: 2700 }, source[3]),
    (error) => error instanceof LiquidityInputError && error.code === "DUPLICATE_SWING_ID");
  assert.equal(engine.diagnostics.invalidSources, 1);
});

test("candidate search is bounded, evicts oldest, and keeps sides independent", () => {
  const source = features();
  const engine = createLiquidityEngine("1m", { equalLevelCandidateLimit: 2 });
  for (const item of [swing("SWING_HIGH", 1, 2, 2650), swing("SWING_LOW", 3, 4, 2640),
    swing("SWING_HIGH", 5, 6, 2660), swing("SWING_HIGH", 7, 8, 2670)]) {
    engine.pushSwing(item, source[item.sourceIndex]);
  }
  assert.deepEqual(engine.candidateCounts, { highs: 2, lows: 1 });
  engine.pushSwing(swing("SWING_HIGH", 9, 10, 2650), source[9]);
  assert.equal(engine.diagnostics.eqhCreated, 0);
  engine.pushSwing(swing("SWING_LOW", 11, 12, 2640.5), source[11]);
  assert.equal(engine.diagnostics.eqlCreated, 1);
  assert.deepEqual(engine.candidateCounts, { highs: 2, lows: 2 });
});

test("invalid prices, source IDs, timestamps, order, and ATR alignment block trusted output", () => {
  const good = swing("SWING_HIGH", 1, 2, 2650);
  const source = features();
  const cases = [
    [{ ...good, price: Number.NaN }, source, "INVALID_SWING"],
    [{ ...good, id: "" }, source, "INVALID_SWING"],
    [{ ...good, availableAt: good.createdAt - 1 }, source, "INVALID_SWING"],
    [{ ...good, sourceIndex: 500 }, source, "INPUT_ALIGNMENT"],
    [{ ...good, availableAt: stamp(101) }, source, "INPUT_ALIGNMENT"],
    [good, source.map((f, i) => i === 1 ? { ...f, atrReady: false } : f), "INPUT_ALIGNMENT"],
    [good, source.map((f, i) => i === 1 ? { ...f, timestamp: f.timestamp + 1 } : f), "INPUT_ALIGNMENT"],
  ];
  for (const [item, input, code] of cases) {
    const result = analyzeLiquidity(structure([item]), input);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.diagnostics.errorCode, code);
    assert.equal(result.diagnostics.invalidSources, 1);
    assert.equal(result.levels.length, 0);
  }
  const reverse = analyzeLiquidity(structure([swing("SWING_HIGH", 3, 4, 2650), good]), source);
  assert.equal(reverse.status, "BLOCKED");
  assert.equal(reverse.diagnostics.errorCode, "INPUT_ORDER");
  assert.equal(reverse.levels.length, 0);
});

test("batch and incremental output, diagnostics, state, and IDs match exactly", () => {
  const swings = [swing("SWING_HIGH", 1, 2, 2650), swing("SWING_LOW", 3, 4, 2640),
    swing("SWING_HIGH", 5, 6, 2650.5, "HH"), swing("SWING_LOW", 7, 8, 2640.4, "HL")];
  const source = features();
  const batch = analyzeLiquidity(structure(swings), source);
  const engine = createLiquidityEngine("1m");
  for (const item of swings) engine.pushSwing(item, source[item.sourceIndex]);
  assert.deepEqual(facts(batch), { levels: engine.levels, latest: engine.latest,
    diagnostics: engine.diagnostics });
  assert.deepEqual(facts(analyzeLiquidity(structure(swings), source)), facts(batch));
  assert.equal(batch.diagnostics.eqhCreated, 1);
  assert.equal(batch.diagnostics.eqlCreated, 1);
});

test("prefix liquidity remains bit-for-bit stable after future swings", () => {
  const swings = Array.from({ length: 120 }, (_, i) => swing(
    i % 2 ? "SWING_LOW" : "SWING_HIGH", i * 2, i * 2 + 1,
    i % 2 ? 2640 + (i % 5) * 0.1 : 2650 + (i % 5) * 0.1));
  const source = features(242);
  const prefix = analyzeLiquidity(structure(swings.slice(0, 60)), source);
  const full = analyzeLiquidity(structure(swings), source);
  const cutoff = swings[59].availableAt;
  assert.deepEqual(full.levels.filter((level) => level.availableAt <= cutoff), prefix.levels);
  assert.equal(prefix.status, "READY");
  assert.equal(full.status, "READY");
});

test("all four timeframes use the same engine and remain grouped", () => {
  const timeframes = ["1m", "5m", "15m", "1h"];
  const structureResults = Object.fromEntries(timeframes.map((tf) => [tf, structure([
    swing("SWING_HIGH", 1, 2, 2650, "UNCLASSIFIED", tf),
    swing("SWING_HIGH", 3, 4, 2650.5, "HH", tf),
    swing("SWING_LOW", 5, 6, 2640, "UNCLASSIFIED", tf),
    swing("SWING_LOW", 7, 8, 2640.5, "HL", tf),
  ], tf)]));
  const psychology = { status: "WARN", timeframes: Object.fromEntries(timeframes.map((tf) =>
    [tf, { features: features(10, tf) }])) };
  const input = structuredClone({ structureResults, psychology });
  const result = analyzeHistoricalLiquidity({ status: "WARN", timeframes: structureResults }, psychology);
  assert.equal(result.status, "WARN");
  for (const tf of timeframes) {
    assert.equal(result.timeframes[tf].timeframe, tf);
    assert.deepEqual(result.timeframes[tf].diagnostics,
      { swingsProcessed: 4, bslCreated: 2, sslCreated: 2, eqhCreated: 1,
        eqlCreated: 1, duplicatesPrevented: 0, invalidSources: 0 });
    assert.equal(result.timeframes[tf].levels.length, 6);
    assert.equal(result.timeframes[tf].levels.every((level) => level.timeframe === tf), true);
  }
  assert.deepEqual({ structureResults, psychology }, input);
  assert.equal(analyzeHistoricalLiquidity({ status: "BLOCKED", timeframes: structureResults }, psychology).status,
    "BLOCKED");
  assert.equal(analyzeHistoricalLiquidity({ status: "READY", timeframes: structureResults },
    { ...psychology, status: "FAILED" }).status, "FAILED");
});

test("all emitted prices and times are finite", () => {
  const swings = [swing("SWING_HIGH", 1, 2, 2650), swing("SWING_HIGH", 3, 4, 2650.2),
    swing("SWING_LOW", 5, 6, 2640), swing("SWING_LOW", 7, 8, 2640.2)];
  const result = analyzeLiquidity(structure(swings), features());
  assert.equal(result.levels.every((level) => Number.isFinite(level.price) &&
    Number.isSafeInteger(level.createdAt) && Number.isSafeInteger(level.availableAt)), true);
});
