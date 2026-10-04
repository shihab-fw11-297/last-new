import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCandleSeries, analyzeHistoricalPsychology, createCandlePsychologyEngine,
} from "../lib/traderbrain/analysis/candle-psychology.ts";

const M = 60_000;
const config = { atrPeriod: 3, shortWindow: 2, mediumWindow: 2, baselineWindow: 4 };
function c(i, open, high, low, close, timeframe = "1m") {
  return { timestamp: i * M, open, high, low, close, volume: null, symbol: "XAUUSD", timeframe };
}
function run(candles, options = config) { return analyzeCandleSeries(candles, "1m", options); }

test("bullish, bearish, neutral, zero-range and position math", () => {
  const f = run([c(0, 2, 10, 0, 8), c(1, 8, 10, 0, 2), c(2, 5, 10, 0, 5), c(3, 7, 7, 7, 7)]);
  assert.equal(f[0].direction, "BULLISH");
  assert.equal(f[0].range, 10);
  assert.equal(f[0].body, 6);
  assert.equal(f[0].upperWick, 2);
  assert.equal(f[0].lowerWick, 2);
  assert.equal(f[0].bodyToRangeRatio, 0.6);
  assert.equal(f[0].openPosition, 0.2);
  assert.equal(f[0].closePosition, 0.8);
  assert.equal(f[1].direction, "BEARISH");
  assert.equal(f[1].body, 6);
  assert.equal(f[1].upperWick, 2);
  assert.equal(f[1].lowerWick, 2);
  assert.equal(f[2].direction, "NEUTRAL");
  assert.equal(f[3].range, 0);
  assert.equal(f[3].bodyToRangeRatio, null);
  assert.equal(f[3].openPosition, null);
  assert.equal(f[3].closePosition, null);
  assert.equal(f[3].overlapRatio, null);
});

test("true range uses previous close for upward and downward gaps", () => {
  const f = run([c(0, 4, 10, 0, 6), c(1, 12, 14, 11, 13), c(2, -2, 0, -4, -3)]);
  assert.equal(f[0].trueRange, 10);
  assert.equal(f[1].trueRange, 8);
  assert.equal(f[2].trueRange, 17);
  assert.equal(f[0].changeFromPreviousClose, null);
  assert.equal(f[1].changeFromPreviousClose, 7);
});

test("ATR simple rolling mean, warm-up and normalization", () => {
  const f = run([c(0, 1, 2, 0, 1), c(1, 1, 5, 1, 4), c(2, 4, 10, 4, 8), c(3, 8, 16, 8, 12)]);
  assert.equal(f[0].atrReady, false);
  assert.equal(f[1].atrReady, false);
  assert.equal(f[0].atr, null);
  assert.equal(f[1].rangeToATR, null);
  assert.equal(f[2].atr, 4);
  assert.equal(f[2].atrReady, true);
  assert.equal(f[2].rangeToATR, 1.5);
  assert.equal(f[2].bodyToATR, 1);
  assert.equal(f[2].changeToATR, 1);
  assert.equal(f[3].atr, 6);
  assert.equal(f[3].bodyToATR, 4 / 6);
});

test("zero ATR does not emit non-finite normalized values", () => {
  const f = run([c(0, 5, 5, 5, 5), c(1, 5, 5, 5, 5), c(2, 5, 5, 5, 5)]);
  assert.equal(f[2].atr, 0);
  assert.equal(f[2].atrReady, true);
  assert.equal(f[2].rangeToATR, null);
  assert.equal(f[2].bodyToATR, null);
  assert.equal(f[2].changeToATR, null);
});

test("full, partial and zero overlap; inside, outside and extensions", () => {
  const f = run([
    c(0, 4, 10, 0, 6),
    c(1, 4, 8, 2, 6),
    c(2, 1, 12, -2, 11),
    c(3, 21, 24, 20, 23),
    c(4, -7, -5, -10, -8),
  ]);
  assert.equal(f[0].overlapWithPreviousCandle, null);
  assert.equal(f[1].overlapWithPreviousCandle, 6);
  assert.equal(f[1].overlapRatio, 1);
  assert.equal(f[1].insidePreviousRange, true);
  assert.equal(f[2].overlapWithPreviousCandle, 6);
  assert.equal(f[2].overlapRatio, 6 / 14);
  assert.equal(f[2].outsidePreviousRange, true);
  assert.equal(f[2].highAbovePreviousHigh, true);
  assert.equal(f[2].lowBelowPreviousLow, true);
  assert.equal(f[2].closeAbovePreviousHigh, true);
  assert.equal(f[3].overlapWithPreviousCandle, 0);
  assert.equal(f[3].overlapRatio, 0);
  assert.equal(f[4].closeBelowPreviousLow, true);
});

test("direction changes reset consecutive sequences", () => {
  const f = run([c(0, 0, 2, 0, 1), c(1, 1, 3, 1, 2), c(2, 2, 2, 0, 1), c(3, 1, 1, 0, 0), c(4, 1, 2, 0, 1)]);
  assert.deepEqual(f.map((x) => x.consecutiveBullishCount), [1, 2, 0, 0, 0]);
  assert.deepEqual(f.map((x) => x.consecutiveBearishCount), [0, 0, 1, 2, 0]);
});

test("rolling range and body means expire old values", () => {
  const f = run([c(0, 1, 2, 0, 2), c(1, 1, 5, 0, 3), c(2, 1, 9, 0, 5), c(3, 1, 17, 0, 9)]);
  assert.equal(f[0].rollingAverageRange, null);
  assert.equal(f[1].rollingAverageRange, 3.5);
  assert.equal(f[2].rollingAverageRange, 7);
  assert.equal(f[3].rollingAverageRange, 13);
  assert.equal(f[3].rollingAverageBody, 6);
  assert.equal(f[3].baselineAverageRange, 8.25);
  assert.equal(f[2].rollingAverageRangeToATR, null);
  assert.equal(f[3].rollingAverageRangeToATR !== null, true);
});

test("directional efficiency is causal net movement over path movement", () => {
  const f = run([c(0, 0, 1, 0, 0), c(1, 0, 10, 0, 10), c(2, 10, 10, 0, 0), c(3, 0, 10, 0, 10)]);
  assert.equal(f[1].directionalEfficiency, null);
  assert.equal(f[2].rollingDirectionalMovement, 0);
  assert.equal(f[2].directionalEfficiency, 0);
  assert.equal(f[3].rollingDirectionalMovement, 0);
  assert.equal(f[3].directionalEfficiency, 0);
  const trend = run([c(0, 0, 1, 0, 0), c(1, 0, 1, 0, 1), c(2, 1, 2, 1, 2)]);
  assert.equal(trend[2].directionalEfficiency, 1);
});

test("strong bullish and bearish evidence needs ATR and strong body", () => {
  const f = run([c(0, 1, 10, 0, 9), c(1, 9, 10, 0, 1)], { ...config, atrPeriod: 1 });
  assert.equal(f[0].evidence.strongBullishClose, true);
  assert.equal(f[1].evidence.strongBearishClose, true);
  const warm = run([c(0, 1, 10, 0, 9)]);
  assert.equal(warm[0].evidence.strongBullishClose, false);
});

test("upper/lower rejection and indecision evidence", () => {
  const f = run([c(0, 3, 10, 0, 2), c(1, 7, 10, 0, 8), c(2, 5, 10, 0, 5)]);
  assert.equal(f[0].evidence.upperRejection, true);
  assert.equal(f[1].evidence.lowerRejection, true);
  assert.equal(f[2].evidence.indecision, true);
});

test("expansion evidence uses relative range, body, overlap and close", () => {
  const f = run([c(0, 11, 12, 10, 11), c(1, 11, 12, 10, 11), c(2, 12, 31, 11, 30)]);
  assert.equal(f[2].rangeToATR > 1.3, true);
  assert.equal(f[2].evidence.expansion, true);
});

test("compression evidence requires declining range, overlap and inefficient travel", () => {
  const f = run([c(0, 1, 10, 0, 1), c(1, 1, 10, 0, 1), c(2, 1, 2, 0, 2), c(3, 2, 2, 0, 1)]);
  assert.equal(f[3].rollingAverageRange, 2);
  assert.equal(f[3].baselineAverageRange, 6);
  assert.equal(f[3].rollingAverageOverlap, 1);
  assert.equal(f[3].directionalEfficiency, 0);
  assert.equal(f[3].evidence.compression, true);
});

test("momentum increase and decay evidence uses previous causal state", () => {
  const f = run([
    c(0, 5, 10, 0, 5), c(1, 5, 10, 0, 7), c(2, 7, 10, 0, 5),
    c(3, 5, 16, 4, 15), c(4, 7, 16, 6, 7),
  ], { ...config, atrPeriod: 1 });
  assert.equal(f[3].evidence.momentumIncreasing, true);
  assert.equal(f[4].evidence.momentumDecaying, true);
});

test("all emitted numeric values are finite or null", () => {
  const f = run([c(0, 5, 5, 5, 5), c(1, 5, 10, 0, 6), c(2, 6, 6, 6, 6), c(3, 7, 20, 0, 15)]);
  for (const feature of f) for (const value of Object.values(feature)) {
    if (typeof value === "number") assert.equal(Number.isFinite(value), true);
  }
});

test("batch and incremental output match; 1001-candle prefix is invariant", () => {
  const candles = Array.from({ length: 2001 }, (_, i) => {
    const open = 100 + i * 0.1;
    return c(i, open, open + 1, open - 1, open + (i % 2 ? 0.3 : -0.3));
  });
  const prefix = run(candles.slice(0, 1001));
  const full = run(candles);
  assert.deepEqual(full.slice(0, 1001), prefix);
  const engine = createCandlePsychologyEngine("1m", config);
  assert.deepEqual(candles.map((item) => engine.push(item)), full);
});

test("one engine works for 1m, 5m, 15m and 1h without changing inputs", () => {
  const one = [c(0, 1, 2, 0, 1), c(1, 1, 3, 1, 2)];
  const agg = (timeframe) => [{ ...c(0, 1, 2, 0, 1, timeframe), bucketStart: 0, bucketEnd: M, sourceCount: 1, isComplete: false }];
  const input = { status: "WARN", symbol: "XAUUSD", candles1m: one,
    timeframes: { "5m": agg("5m"), "15m": agg("15m"), "1h": agg("1h") } };
  const before = structuredClone(input);
  const result = analyzeHistoricalPsychology(input, config);
  assert.equal(result.status, "WARN");
  assert.equal(result.timeframes["1m"].features.length, 2);
  for (const tf of ["5m", "15m", "1h"]) {
    assert.equal(result.timeframes[tf].features.length, 1);
    assert.equal(result.timeframes[tf].features[0].timeframe, tf);
    assert.equal(result.timeframes[tf].features[0].timestamp, input.timeframes[tf][0].timestamp);
    assert.equal(result.timeframes[tf].features[0].sourceComplete, false);
  }
  assert.deepEqual(input, before);
  assert.equal(result.diagnostics.processedCandles, 5);
});

test("BLOCKED and FAILED Phase 1 data produce no analysis", () => {
  for (const status of ["BLOCKED", "FAILED"]) {
    const input = { status, symbol: "XAUUSD", candles1m: [c(0, 1, 2, 0, 1)],
      timeframes: { "5m": [], "15m": [], "1h": [] } };
    const result = analyzeHistoricalPsychology(input);
    assert.equal(result.status, status);
    assert.equal(result.diagnostics.processedCandles, 0);
    assert.equal(result.timeframes["1m"].features.length, 0);
  }
});

test("timeframe mismatch and non-ascending input are rejected", () => {
  const engine = createCandlePsychologyEngine("1m");
  engine.push(c(0, 1, 2, 0, 1));
  assert.throws(() => engine.push(c(0, 1, 2, 0, 1)), RangeError);
  assert.throws(() => engine.push(c(1, 1, 2, 0, 1, "5m")), RangeError);
});
