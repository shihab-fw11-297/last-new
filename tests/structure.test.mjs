import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCandleSeries, analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import {
  analyzeHistoricalMarketStructure, analyzeMarketStructure, createMarketStructureEngine,
} from "../lib/traderbrain/analysis/market-structure.ts";

const duration = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000 };
const bullish = [0, 1, 2, 3, 4, 3, 2, 3, 4, 5, 4, 3, 4];
const bearish = bullish.map((close) => -close);
const psychologyConfig = { atrPeriod: 3, shortWindow: 2, mediumWindow: 2, baselineWindow: 4 };

function candles(closes, timeframe = "1m", halfRange = 1) {
  return closes.map((close, i) => {
    const timestamp = i * duration[timeframe];
    const base = { timestamp, open: close, high: close + halfRange, low: close - halfRange,
      close, volume: null, symbol: "XAUUSD", timeframe };
    return timeframe === "1m" ? base : { ...base, bucketStart: timestamp,
      bucketEnd: timestamp + duration[timeframe], sourceCount: duration[timeframe] / 60_000,
      isComplete: true };
  });
}

function evaluate(closes, timeframe = "1m", halfRange = 1, options = {}) {
  const source = candles(closes, timeframe, halfRange);
  const features = analyzeCandleSeries(source, timeframe, options.psychology ?? psychologyConfig);
  return { source, features, result: analyzeMarketStructure(source, features, timeframe, options.structure ?? {}) };
}

function facts(result) {
  return { swings: result.swings, legs: result.legs, events: result.events,
    current: result.current, diagnostics: result.diagnostics };
}

test("clean bullish structure confirms HH and HL with a protected low", () => {
  const { result } = evaluate(bullish);
  assert.equal(result.status, "READY");
  assert.deepEqual(result.swings.map((s) => s.type), ["SWING_HIGH", "SWING_LOW", "SWING_HIGH", "SWING_LOW"]);
  assert.deepEqual(result.swings.map((s) => s.classification), ["UNCLASSIFIED", "UNCLASSIFIED", "HH", "HL"]);
  assert.equal(result.current.state, "BULLISH");
  assert.equal(result.current.protectedLowId, result.swings[3].id);
  assert.equal(result.current.protectedHighId, null);
  assert.equal(result.legs.length, 3);
});

test("clean bearish structure confirms LH and LL with a protected high", () => {
  const { result } = evaluate(bearish);
  assert.deepEqual(result.swings.map((s) => s.classification), ["UNCLASSIFIED", "UNCLASSIFIED", "LL", "LH"]);
  assert.equal(result.current.state, "BEARISH");
  assert.equal(result.current.protectedHighId, result.swings[3].id);
  assert.equal(result.current.protectedLowId, null);
});

test("bullish continuation close break emits once and references the high", () => {
  const { result } = evaluate([...bullish, 7, 7, 7]);
  const events = result.events.filter((e) => e.type === "BULLISH_CONTINUATION_BREAK");
  assert.equal(events.length, 1);
  assert.equal(events[0].breakKind, "CLOSE_BREAK");
  assert.equal(events[0].brokenSwingId, result.swings[2].id);
  assert.equal(events[0].availableAt, 13 * duration["1m"]);
});

test("bearish continuation close break emits once and references the low", () => {
  const { result } = evaluate([...bearish, -7, -7]);
  const events = result.events.filter((e) => e.type === "BEARISH_CONTINUATION_BREAK");
  assert.equal(events.length, 1);
  assert.equal(events[0].brokenSwingId, result.swings[2].id);
});

test("raw bearish shift breaks prior protected low by close", () => {
  const { result } = evaluate([...bullish, 0]);
  const events = result.events.filter((e) => e.type === "RAW_BEARISH_STRUCTURE_SHIFT");
  assert.equal(events.length, 1);
  assert.equal(events[0].brokenSwingId, result.swings[3].id);
  assert.equal(result.current.state, "TRANSITION");
  assert.equal(result.current.protectedLowId, null);
});

test("raw bullish shift breaks prior protected high by close", () => {
  const { result } = evaluate([...bearish, 0]);
  const events = result.events.filter((e) => e.type === "RAW_BULLISH_STRUCTURE_SHIFT");
  assert.equal(events.length, 1);
  assert.equal(events[0].brokenSwingId, result.swings[3].id);
  assert.equal(result.current.state, "TRANSITION");
  assert.equal(result.current.protectedHighId, null);
});

test("wick through high records penetration without close break", () => {
  const { source } = evaluate(bullish);
  source.push({ ...candles([5.5])[0], timestamp: 13 * duration["1m"], high: 7, low: 4.5 });
  source.push({ ...candles([5.6])[0], timestamp: 14 * duration["1m"], high: 7.2, low: 4.6 });
  const features = analyzeCandleSeries(source, "1m", psychologyConfig);
  const result = analyzeMarketStructure(source, features, "1m");
  assert.equal(result.events.filter((e) => e.type === "LEVEL_PENETRATION" && e.side === "HIGH").length, 1);
  assert.equal(result.events.filter((e) => e.type === "BULLISH_CONTINUATION_BREAK").length, 0);
});

test("wick through protected low records penetration without raw shift", () => {
  const { source } = evaluate(bullish);
  source.push({ ...candles([3.2])[0], timestamp: 13 * duration["1m"], high: 4.2, low: 1 });
  const features = analyzeCandleSeries(source, "1m", psychologyConfig);
  const result = analyzeMarketStructure(source, features, "1m");
  assert.equal(result.events.filter((e) => e.type === "LEVEL_PENETRATION" && e.side === "LOW").length, 1);
  assert.equal(result.events.filter((e) => e.type === "RAW_BEARISH_STRUCTURE_SHIFT").length, 0);
});

test("a later confirmed HL updates the protected low", () => {
  const { result } = evaluate([...bullish, 7, 6, 5, 6]);
  const lows = result.swings.filter((s) => s.type === "SWING_LOW");
  assert.equal(lows.at(-1).classification, "HL");
  assert.equal(result.current.protectedLowId, lows.at(-1).id);
  assert.notEqual(result.current.protectedLowId, lows.at(-2).id);
});

test("a later confirmed LH updates the protected high", () => {
  const { result } = evaluate([...bearish, -7, -6, -5, -6]);
  const highs = result.swings.filter((s) => s.type === "SWING_HIGH");
  assert.equal(highs.at(-1).classification, "LH");
  assert.equal(result.current.protectedHighId, highs.at(-1).id);
  assert.notEqual(result.current.protectedHighId, highs.at(-2).id);
});

test("small choppy closes remain structurally unclear", () => {
  const { result } = evaluate([0, 0.1, -0.1, 0.2, -0.2, 0.1, 0]);
  assert.equal(result.swings.length, 0);
  assert.equal(result.current.state, "RANGE_OR_UNCLEAR");
});

test("same reversal is meaningful in low ATR and insufficient in high ATR", () => {
  const closes = [0, 2, 4, 6, 4];
  const low = evaluate(closes, "1m", 0.5, { psychology: { ...psychologyConfig, atrPeriod: 1 } });
  const high = evaluate(closes, "1m", 3, { psychology: { ...psychologyConfig, atrPeriod: 1 } });
  assert.equal(low.result.swings.some((s) => s.type === "SWING_HIGH"), true);
  assert.equal(high.result.swings.some((s) => s.type === "SWING_HIGH"), false);
});

test("candidate high at index 10 is unavailable until reversal confirms at 13", () => {
  const closes = Array.from({ length: 11 }, (_, i) => i).concat([9.8, 9.4, 8.5]);
  const { source, features } = evaluate(closes);
  const engine = createMarketStructureEngine("1m");
  for (let i = 0; i <= 12; i++) {
    engine.push(source[i], features[i]);
    assert.equal(engine.swings.filter((s) => s.type === "SWING_HIGH").length, 0);
  }
  engine.push(source[13], features[13]);
  const high = engine.swings.find((s) => s.type === "SWING_HIGH");
  assert.ok(high);
  assert.equal(high.sourceIndex, 10);
  assert.equal(high.createdAt, source[10].timestamp);
  assert.equal(high.availableAt, source[13].timestamp);
});

test("equal same-type prices remain unclassified, never liquidity labels", () => {
  const closes = [0, 1, 2, 3, 4, 3, 2, 3, 4, 4, 3];
  const { result } = evaluate(closes);
  const highs = result.swings.filter((s) => s.type === "SWING_HIGH");
  assert.equal(highs.length >= 2, true);
  assert.equal(highs[1].classification, "UNCLASSIFIED");
  assert.equal(result.swings.every((s) => !["EQH", "EQL"].includes(s.classification)), true);
});

test("alignment mismatch and count mismatch block deterministically", () => {
  const { source, features } = evaluate(bullish);
  const wrong = features.map((f) => ({ ...f }));
  wrong[5].timestamp++;
  const mismatch = analyzeMarketStructure(source, wrong, "1m");
  assert.equal(mismatch.status, "BLOCKED");
  assert.equal(mismatch.diagnostics.errorCode, "INPUT_ALIGNMENT");
  assert.equal(mismatch.diagnostics.errorIndex, 5);
  assert.equal(mismatch.swings.length, 0);
  const count = analyzeMarketStructure(source, features.slice(1), "1m");
  assert.equal(count.status, "BLOCKED");
  assert.equal(count.diagnostics.errorCode, "INPUT_ALIGNMENT");
});

test("batch and incremental facts are identical and deterministic", () => {
  const { source, features, result } = evaluate([...bullish, 7, 6, 5, 6, 8, 7, 6]);
  const engine = createMarketStructureEngine("1m");
  for (let i = 0; i < source.length; i++) engine.push(source[i], features[i]);
  assert.deepEqual(facts(result), { swings: engine.swings, legs: engine.legs, events: engine.events,
    current: engine.current, diagnostics: engine.diagnostics });
  assert.deepEqual(facts(evaluate([...bullish, 7, 6, 5, 6, 8, 7, 6]).result), facts(result));
});

test("prefix facts remain unchanged across a 1001-to-2001 candle extension", () => {
  const closes = Array.from({ length: 2001 }, (_, i) => 100 + Math.sin(i / 6) * 5 + i * 0.002);
  const source = candles(closes);
  const features = analyzeCandleSeries(source, "1m", psychologyConfig);
  const cutoff = source[1000].timestamp;
  const prefix = analyzeMarketStructure(source.slice(0, 1001), features.slice(0, 1001), "1m");
  const full = analyzeMarketStructure(source, features, "1m");
  assert.deepEqual(full.swings.filter((s) => s.availableAt <= cutoff), prefix.swings);
  assert.deepEqual(full.legs.filter((s) => s.availableAt <= cutoff), prefix.legs);
  assert.deepEqual(full.events.filter((s) => s.availableAt <= cutoff), prefix.events);
});

test("incremental outputs never claim availability after the pushed candle", () => {
  const { source, features } = evaluate([...bullish, 7, 6, 5, 6]);
  const engine = createMarketStructureEngine("1m");
  for (let i = 0; i < source.length; i++) {
    engine.push(source[i], features[i]);
    assert.equal(engine.swings.every((s) => s.availableAt <= source[i].timestamp), true);
    assert.equal(engine.legs.every((s) => s.availableAt <= source[i].timestamp), true);
    assert.equal(engine.events.every((s) => s.availableAt <= source[i].timestamp), true);
  }
});

test("one implementation runs independently on all four timeframes", () => {
  for (const timeframe of ["1m", "5m", "15m", "1h"]) {
    const { result } = evaluate(bullish, timeframe);
    assert.equal(result.status, "READY");
    assert.equal(result.timeframe, timeframe);
    assert.equal(result.swings.length, 4);
    assert.equal(result.current.state, "BULLISH");
  }
});

test("higher timeframe facts become available only on the final source minute", () => {
  for (const timeframe of ["5m", "15m", "1h"]) {
    const { source, result } = evaluate([...bullish, 7, 6, 5, 6], timeframe);
    const lag = duration[timeframe] - 60_000;
    assert.ok(result.swings.length > 0);
    for (const swing of result.swings) {
      const confirmation = source.find((bar) => bar.timestamp === swing.availableAt - lag);
      assert.ok(confirmation?.isComplete);
      assert.equal(swing.availableAt, confirmation.bucketEnd - 60_000);
    }
    for (const event of result.events) {
      assert.equal(event.availableAt, source[event.sourceIndex].bucketEnd - 60_000);
      assert.ok(event.createdAt < event.availableAt);
    }
  }
});

test("incomplete higher timeframe bucket cannot emit structure facts", () => {
  const { source, features } = evaluate([...bullish, 7, 6, 5, 6], "5m");
  const last = source.length - 1;
  source[last] = { ...source[last], sourceCount: 2, isComplete: false };
  const partialFeatures = analyzeCandleSeries(source, "5m", psychologyConfig);
  const before = analyzeMarketStructure(source.slice(0, last), partialFeatures.slice(0, last), "5m");
  const after = analyzeMarketStructure(source, partialFeatures, "5m");
  assert.deepEqual(after.swings, before.swings);
  assert.deepEqual(after.events, before.events);
  assert.equal(features.length, source.length);
});

test("multi-timeframe wrapper preserves upstream status and never mutates inputs", () => {
  const one = candles(bullish, "1m");
  const historical = { status: "WARN", symbol: "XAUUSD", candles1m: one,
    timeframes: { "5m": candles(bullish, "5m"), "15m": candles(bullish, "15m"), "1h": candles(bullish, "1h") } };
  const psychology = analyzeHistoricalPsychology(historical, psychologyConfig);
  const before = structuredClone({ historical, psychology });
  const result = analyzeHistoricalMarketStructure(historical, psychology);
  assert.equal(result.status, "WARN");
  for (const tf of ["1m", "5m", "15m", "1h"]) assert.equal(result.timeframes[tf].swings.length, 4);
  assert.deepEqual({ historical, psychology }, before);
  historical.status = "BLOCKED";
  const blocked = analyzeHistoricalMarketStructure(historical, psychology);
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.timeframes["1m"].swings.length, 0);
});
