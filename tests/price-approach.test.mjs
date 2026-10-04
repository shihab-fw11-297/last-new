import test from "node:test";
import assert from "node:assert/strict";
import { analyzePriceApproach, createPriceApproachEngine, PriceApproachInputError } from
  "../lib/traderbrain/analysis/price-approach.ts";

const timeframes = ["1m", "5m", "15m", "1h"];
const start = 1_700_000_000_000;
const stamp = (index) => start + index * 60_000;
const noEvidence = { compression: false, expansion: false,
  momentumIncreasing: false, momentumDecaying: false };

function candle(close, index, high = close + 0.05, low = close - 0.05) {
  return { timestamp: stamp(index), open: close, high, low, close,
    volume: null, symbol: "XAUUSD", timeframe: "1m" };
}

function feature(source, changes = {}) {
  return { timestamp: source.timestamp, timeframe: "1m", sourceComplete: true,
    atr: 10, atrReady: true, directionalEfficiency: 0.8,
    evidence: { ...noEvidence }, ...changes };
}

function level(timeframe, price, availableIndex = 0, id = `${timeframe}:${price}:${availableIndex}`,
  kind = "SWING") {
  return { id, timeframe, sourceTimeframe: timeframe, kind,
    side: kind === "EQL" || (kind === "SWING" && price < 90) ? "SSL" : "BSL",
    price, createdAt: stamp(Math.max(0, availableIndex - 2)),
    availableAt: stamp(availableIndex), sourceSwingIds: [`swing:${id}`],
    sourceClassifications: ["UNCLASSIFIED"] };
}

function streams(items = []) {
  return Object.fromEntries(timeframes.map((tf) => [tf, items.filter((item) => item.timeframe === tf)]));
}

function inputs(closes, items = [], featureChanges = () => ({}), candleChanges = () => ({})) {
  const candles = closes.map((close, i) => {
    const changes = candleChanges(i, close);
    return candle(close, i, changes.high, changes.low);
  });
  const psychology = { status: "READY", timeframes: { "1m": { features:
    candles.map((source, i) => feature(source, featureChanges(i, source))) } } };
  const grouped = streams(items);
  const liquidity = { status: "READY", timeframes: Object.fromEntries(timeframes.map((tf) =>
    [tf, { status: "READY", timeframe: tf, levels: grouped[tf] }])) };
  return { historical: { status: "READY", candles1m: candles }, psychology, liquidity };
}

function analyze(closes, items = [], config = {}, featureChanges = () => ({}), candleChanges = () => ({})) {
  const input = inputs(closes, items, featureChanges, candleChanges);
  return analyzePriceApproach(input.historical, input.psychology, input.liquidity, config);
}

test("upstream BLOCKED or FAILED status and 1m timestamp misalignment block output", () => {
  const input = inputs([90, 91], [level("1m", 100)]);
  input.psychology.timeframes["1m"].features[1].timestamp++;
  let result = analyzePriceApproach(input.historical, input.psychology, input.liquidity);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.diagnostics.errorCode, "INPUT_ALIGNMENT");
  assert.equal(result.transitions.length, 0);
  input.psychology.status = "BLOCKED";
  result = analyzePriceApproach(input.historical, input.psychology, input.liquidity);
  assert.equal(result.status, "BLOCKED");
  input.psychology.status = "READY";
  input.liquidity.status = "FAILED";
  result = analyzePriceApproach(input.historical, input.psychology, input.liquidity);
  assert.equal(result.status, "FAILED");
});

test("1m, 5m, 15m, and 1h liquidity activate only at their available timestamps", () => {
  const items = timeframes.map((tf, i) => level(tf, 100 + i, i + 2));
  for (let cutoff = 0; cutoff <= 5; cutoff++) {
    const result = analyze(Array(cutoff + 1).fill(90), items);
    assert.equal(result.status, "READY");
    for (let i = 0; i < timeframes.length; i++) {
      const active = i + 2 <= cutoff;
      assert.equal(result.diagnostics.activatedByTimeframe[timeframes[i]], active ? 1 : 0);
      assert.equal(result.current[timeframes[i]].above?.liquidityId ?? null,
        active ? items[i].id : null);
    }
  }
});

test("15m level formed earlier stays absent through 10:29 and appears at 10:30", () => {
  const item = level("15m", 100, 30);
  item.createdAt = stamp(15);
  const earlier = analyze(Array(30).fill(90), [item]);
  const confirmed = analyze(Array(31).fill(90), [item]);
  assert.equal(earlier.current["15m"].above, null);
  assert.equal(earlier.diagnostics.activatedByTimeframe["15m"], 0);
  assert.equal(confirmed.current["15m"].above.liquidityId, item.id);
  assert.equal(confirmed.current["15m"].above.timestamp, stamp(30));
});

test("incremental input rejects future liquidity and malformed events", () => {
  const engine = createPriceApproachEngine();
  const source = candle(90, 0);
  assert.throws(() => engine.push({ candle: source, psychology: feature(source),
    newLiquidity: [level("1h", 100, 1)] }),
  (error) => error instanceof PriceApproachInputError && error.code === "FUTURE_LIQUIDITY");
  assert.throws(() => engine.push({ candle: source, psychology: feature(source),
    newLiquidity: [{ ...level("1h", 100, 0), price: Number.NaN }] }),
  (error) => error instanceof PriceApproachInputError && error.code === "INVALID_LIQUIDITY");
});

test("nearest above and below are retained independently for every timeframe", () => {
  const items = timeframes.flatMap((tf, i) => [level(tf, 98 - i, 0, `${tf}:below`),
    level(tf, 102 + i, 0, `${tf}:above`)]);
  const result = analyze([100], items);
  for (let i = 0; i < timeframes.length; i++) {
    const tf = timeframes[i];
    assert.equal(result.current[tf].above.liquidityPrice, 102 + i);
    assert.equal(result.current[tf].below.liquidityPrice, 98 - i);
  }
  assert.equal(result.diagnostics.activatedByTimeframe["1m"], 2);
});

test("heaps rebalance across rising, falling, and reversing prices", () => {
  const engine = createPriceApproachEngine();
  const levels = [level("1m", 3350, 0, "a"), level("1m", 3360, 0, "b")];
  const prices = [3348, 3355, 3345];
  const snapshots = prices.map((price, i) => {
    const source = candle(price, i);
    return engine.push({ candle: source, psychology: feature(source),
      newLiquidity: i === 0 ? levels : [] });
  });
  assert.equal(snapshots[0]["1m"].above.liquidityPrice, 3350);
  assert.equal(snapshots[1]["1m"].below.liquidityPrice, 3350);
  assert.equal(snapshots[1]["1m"].above.liquidityPrice, 3360);
  assert.equal(snapshots[2]["1m"].above.liquidityPrice, 3350);
  assert.equal(engine.diagnostics.partitionCrossings, 2);
});

test("identical prices use stable tie breaks and preserve both heap entries", () => {
  const a = level("1m", 100, 0, "A");
  const b = level("1m", 100, 0, "B");
  const engine = createPriceApproachEngine();
  for (const [i, close] of [90, 105, 90].entries()) {
    const source = candle(close, i);
    const current = engine.push({ candle: source, psychology: feature(source),
      newLiquidity: i === 0 ? [b, a] : [] });
    assert.equal((close < 100 ? current["1m"].above : current["1m"].below).liquidityId, "A");
  }
  assert.equal(engine.diagnostics.activatedByTimeframe["1m"], 2);
  assert.equal(engine.diagnostics.partitionCrossings, 4);
  assert.equal(engine.diagnostics.heapPops, 4);
});

test("exact close price is AT_PRICE and candle range geometry alone means TOUCHING", () => {
  const result = analyze([99, 100], [level("1m", 100)], {}, () => ({}),
    (i) => i === 0 ? { high: 100, low: 98 } : { high: 100.1, low: 99.9 });
  assert.equal(result.current["1m"].below.side, "AT_PRICE");
  assert.equal(result.current["1m"].below.state, "TOUCHING");
  assert.equal(result.transitions.every((event) => !["SWEEP", "REJECTION", "RAID"].includes(event.nextState)), true);
});

test("distance, ATR normalization, direction change, and counters use only prior observations", () => {
  const engine = createPriceApproachEngine();
  const snapshots = [88, 91, 94, 92, 90].map((close, i) => {
    const source = candle(close, i);
    return engine.push({ candle: source, psychology: feature(source),
      newLiquidity: i === 0 ? [level("1m", 100)] : [] })["1m"].above;
  });
  assert.equal(snapshots[0].signedDistance, 12);
  assert.equal(snapshots[0].absoluteDistance, 12);
  assert.equal(snapshots[0].distanceAtr, 1.2);
  assert.equal(snapshots[0].distanceChange, null);
  assert.equal(snapshots[1].distanceChange, 3);
  assert.equal(snapshots[1].distanceChangeAtr, 0.3);
  assert.equal(snapshots[2].approachBars, 2);
  assert.equal(snapshots[3].distanceChange, -2);
  assert.equal(snapshots[3].movingAwayBars, 1);
  assert.equal(snapshots[4].movingAwayBars, 2);
});

test("ATR warm-up and zero ATR yield null normalized metrics and no Infinity", () => {
  const result = analyze([90, 91], [level("1m", 100)], {},
    (i) => i === 0 ? { atrReady: false, atr: null } : { atrReady: true, atr: 0 });
  const latest = result.current["1m"].above;
  assert.equal(latest.distanceAtr, null);
  assert.equal(latest.distanceChangeAtr, null);
  assert.equal(latest.speedAtrPerBar, null);
  assert.equal(latest.speedClass, "UNKNOWN");
  assert.equal(result.status, "READY");
});

test("causal progression is FAR, APPROACHING, NEAR, then geometric TOUCHING", () => {
  const engine = createPriceApproachEngine();
  const states = [88, 91, 94, 97, 100].map((close, i) => {
    const source = candle(close, i);
    return engine.push({ candle: source, psychology: feature(source),
      newLiquidity: i === 0 ? [level("1m", 100)] : [] })["1m"].above?.state ??
      engine.current["1m"].below.state;
  });
  assert.deepEqual(states, ["FAR", "FAR", "APPROACHING", "NEAR", "TOUCHING"]);
  assert.deepEqual(engine.transitions.map((event) => event.nextState),
    ["APPROACHING", "NEAR", "TOUCHING"]);
  assert.equal(new Set(engine.transitions.map((event) => event.id)).size, engine.transitions.length);
});

test("consistent distance increase after NEAR becomes MOVING_AWAY without interpretation", () => {
  const result = analyze([96, 94, 92, 90], [level("1m", 100)]);
  assert.equal(result.current["1m"].above.state, "MOVING_AWAY");
  assert.equal(result.current["1m"].above.movingAwayBars, 3);
  assert.deepEqual(result.transitions.map((event) => event.nextState), ["NEAR", "FAR", "MOVING_AWAY"]);
});

test("ring buffer wraps and speed uses K-bar progress normalized by ATR", () => {
  const result = analyze([90, 91, 92, 93, 94], [level("1m", 100)], { speedWindowBars: 2 });
  const latest = result.current["1m"].above;
  assert.equal(latest.speedAtrPerBar, 0.1);
  assert.equal(latest.speedClass, "NORMAL");
  assert.equal(latest.approachConsistency, 1);
});

test("FAST, NORMAL, and SLOW are independent measured speed classes", () => {
  const fast = analyze([90, 93], [level("1m", 100)], { speedWindowBars: 1 });
  const normal = analyze([90, 91], [level("1m", 100)], { speedWindowBars: 1 });
  const slow = analyze([90, 90.2], [level("1m", 100)], { speedWindowBars: 1 });
  assert.equal(fast.current["1m"].above.speedClass, "FAST");
  assert.equal(normal.current["1m"].above.speedClass, "NORMAL");
  assert.equal(slow.current["1m"].above.speedClass, "SLOW");
});

test("compression and impulsive approach reuse Phase 2 evidence", () => {
  const compressed = analyze([90, 91], [level("1m", 100)], { speedWindowBars: 1 },
    (i) => i === 1 ? { evidence: { ...noEvidence, compression: true } } : {});
  const impulsive = analyze([90, 93.5], [level("1m", 100)], { speedWindowBars: 1 },
    (i) => i === 1 ? { evidence: { ...noEvidence, expansion: true, momentumIncreasing: true } } : {});
  assert.equal(compressed.current["1m"].above.behaviorClass, "COMPRESSED");
  assert.equal(impulsive.current["1m"].above.behaviorClass, "IMPULSIVE");
  assert.equal(impulsive.current["1m"].above.speedClass, "FAST");
});

test("controlled, exhausted, and messy behavior have deterministic precedence", () => {
  const controlled = analyze([90, 91, 92], [level("1m", 100)]);
  const exhausted = analyze([90, 90.2], [level("1m", 100)], { speedWindowBars: 1 },
    (i) => i === 1 ? { evidence: { ...noEvidence, momentumDecaying: true } } : {});
  const messy = analyze([90, 91, 90, 91, 90], [level("1m", 100)]);
  assert.equal(controlled.current["1m"].above.behaviorClass, "CONTROLLED");
  assert.equal(exhausted.current["1m"].above.behaviorClass, "EXHAUSTED");
  assert.equal(messy.current["1m"].above.behaviorClass, "MESSY");
  const priority = analyze([90, 93], [level("1m", 100)], { speedWindowBars: 1 },
    (i) => i === 1 ? { evidence: { compression: true, expansion: true,
      momentumIncreasing: true, momentumDecaying: true } } : {});
  assert.equal(priority.current["1m"].above.behaviorClass, "COMPRESSED");
});

test("state transition output omits repeated states", () => {
  const result = analyze([90, 90, 90, 96, 96, 96], [level("1m", 100)]);
  assert.deepEqual(result.transitions.map((event) => event.nextState), ["NEAR"]);
  assert.equal(result.diagnostics.transitions, 1);
});

test("batch and incremental activation, metrics, transitions, and state are identical", () => {
  const items = [level("1m", 100, 0), level("5m", 102, 2),
    level("15m", 97, 3), level("1h", 110, 4)];
  const input = inputs([90, 91, 93, 95, 97, 100, 98, 94], items);
  const batch = analyzePriceApproach(input.historical, input.psychology, input.liquidity);
  const engine = createPriceApproachEngine();
  const grouped = streams(items);
  const cursors = Object.fromEntries(timeframes.map((tf) => [tf, 0]));
  input.historical.candles1m.forEach((source, i) => {
    const newlyAvailable = [];
    for (const tf of timeframes) {
      while (cursors[tf] < grouped[tf].length && grouped[tf][cursors[tf]].availableAt <= source.timestamp) {
        newlyAvailable.push(grouped[tf][cursors[tf]++]);
      }
    }
    engine.push({ candle: source, psychology: input.psychology.timeframes["1m"].features[i],
      newLiquidity: newlyAvailable });
  });
  assert.deepEqual(batch.current, engine.current);
  assert.deepEqual(batch.transitions, engine.transitions);
  assert.deepEqual(batch.diagnostics, engine.diagnostics);
  assert.deepEqual(analyzePriceApproach(input.historical, input.psychology, input.liquidity).current,
    batch.current);
  assert.deepEqual(analyzePriceApproach(input.historical, input.psychology, input.liquidity).transitions,
    batch.transitions);
});

test("1001-candle prefix transitions remain unchanged after 1000 future candles", () => {
  const closes = Array.from({ length: 2001 }, (_, i) => 100 + Math.sin(i / 7) * 5);
  const items = [level("1m", 103, 0), level("5m", 98, 250),
    level("15m", 104, 750), level("1h", 101, 1500)];
  const prefixInput = inputs(closes.slice(0, 1001), items);
  const fullInput = inputs(closes, items);
  const prefix = analyzePriceApproach(prefixInput.historical, prefixInput.psychology, prefixInput.liquidity);
  const full = analyzePriceApproach(fullInput.historical, fullInput.psychology, fullInput.liquidity);
  assert.equal(prefix.status, "READY");
  assert.equal(full.status, "READY");
  assert.deepEqual(full.transitions.filter((event) => event.availableAt <= stamp(1000)),
    prefix.transitions);
  assert.equal(prefix.diagnostics.activatedByTimeframe["1h"], 0);
  assert.equal(full.diagnostics.activatedByTimeframe["1h"], 1);
});

test("no snapshot or transition contains NaN or Infinity, and inputs are unchanged", () => {
  const input = inputs([90, 91, 92, 93], [level("1m", 100), level("5m", 89)]);
  const before = structuredClone(input);
  const result = analyzePriceApproach(input.historical, input.psychology, input.liquidity);
  const numeric = ["absoluteDistance", "signedDistance", "distanceAtr", "distanceChange",
    "distanceChangeAtr", "approachConsistency", "speedAtrPerBar"];
  for (const tf of timeframes) for (const snapshot of Object.values(result.current[tf])) {
    if (snapshot) for (const key of numeric) {
      assert.equal(snapshot[key] === null || Number.isFinite(snapshot[key]), true);
    }
  }
  assert.equal(result.transitions.every((event) => event.distanceAtr === null ||
    Number.isFinite(event.distanceAtr)), true);
  assert.deepEqual(input, before);
});
