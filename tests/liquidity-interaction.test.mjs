import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLiquidityInteractions, createLiquidityInteractionEngine, InteractionInputError } from
  "../lib/traderbrain/analysis/liquidity-interaction.ts";
import { createPriceApproachEngine } from "../lib/traderbrain/analysis/price-approach.ts";

const timeframes = ["1m", "5m", "15m", "1h"];
const start = 1_700_000_000_000;
const stamp = (i) => start + i * 60_000;
const baseEvidence = { strongBullishClose: false, strongBearishClose: false,
  upperRejection: false, lowerRejection: false, indecision: false,
  expansion: false, compression: false, momentumIncreasing: false, momentumDecaying: false };

function candle(index, low, high, close, open = close) {
  return { timestamp: stamp(index), open, high, low, close,
    volume: null, symbol: "XAUUSD", timeframe: "1m" };
}

function feature(source, evidence = {}, atr = 10) {
  return { timestamp: source.timestamp, timeframe: "1m", sourceComplete: true,
    atrReady: atr !== null, atr, directionalEfficiency: 0.7,
    evidence: { ...baseEvidence, ...evidence } };
}

function level(timeframe = "1m", side = "BSL", price = 100, availableIndex = 0,
  id = `${timeframe}:${side}:${price}:${availableIndex}`) {
  return { id, timeframe, sourceTimeframe: timeframe, kind: "SWING", side, price,
    createdAt: stamp(availableIndex), availableAt: stamp(availableIndex),
    sourceSwingIds: [`swing:${id}`], sourceClassifications: ["UNCLASSIFIED"] };
}

function inputs(candles, levels, featureEvidence = () => ({}), atr = 10) {
  const psychology = { status: "READY", timeframes: { "1m": { features:
    candles.map((source, i) => feature(source, featureEvidence(i), atr)) } } };
  const liquidity = { status: "READY", timeframes: Object.fromEntries(timeframes.map((tf) =>
    [tf, { status: "READY", timeframe: tf,
      levels: levels.filter((item) => item.timeframe === tf) }])) };
  return { historical: { status: "READY", candles1m: candles }, psychology, liquidity };
}

function batch(candles, levels, featureEvidence = () => ({}), config = {}, atr = 10) {
  const input = inputs(candles, levels, featureEvidence, atr);
  return analyzeLiquidityInteractions(input.historical, input.psychology, input.liquidity, config);
}

function replay(candles, levels, featureEvidence = () => ({}), config = {}, atr = 10) {
  const approach = createPriceApproachEngine();
  const interaction = createLiquidityInteractionEngine(config);
  const activeAfter = [];
  for (let i = 0; i < candles.length; i++) {
    const current = approach.push({ candle: candles[i], psychology:
      feature(candles[i], featureEvidence(i), atr),
    newLiquidity: levels.filter((item) => item.availableAt === candles[i].timestamp) });
    interaction.push({ candle: candles[i], psychology: feature(candles[i], featureEvidence(i), atr),
      current });
    activeAfter.push(interaction.activeEpisodes);
  }
  return { interaction, activeAfter };
}

const types = (result) => result.events.map((event) => event.type);

test("simple geometric touch opens one episode without stronger labels", () => {
  const source = [candle(0, 98, 100, 99.8)];
  const result = batch(source, [level()]);
  assert.equal(result.status, "READY");
  assert.equal(result.diagnostics.episodesStarted, 1);
  assert.deepEqual(types(result), ["TOUCH_DETECTED"]);
  assert.equal(result.events[0].liquiditySide, "BSL");
  assert.equal(result.active[0].firstTouchAt, stamp(0));
  assert.equal(result.active[0].maxPenetration, 0);
  assert.equal(result.active[0].closeRelationship, "CLOSE_BEFORE_LEVEL");
  assert.equal(result.active[0].currentState, "TOUCHED");
});

test("completed touch records the exact failed penetration gate once", () => {
  const result = batch([candle(0, 98, 100, 99.8),
    candle(1, 94, 96, 95)], [level()]);
  assert.equal(result.completed.length, 1);
  assert.equal(result.completed[0].finalType, "TOUCH");
  assert.equal(result.diagnostics.rejectedByReason.NO_PENETRATION, 1);
  assert.equal(result.diagnostics.rejectedByReason.NO_ACCEPTANCE, 0);
});

test("penetration records depth and ATR ratio but a tiny wick is not a sweep", () => {
  const result = batch([candle(0, 99, 100.01, 99.5)], [level()]);
  assert.deepEqual(types(result), ["TOUCH_DETECTED", "PENETRATION_DETECTED", "RECLAIM_CONFIRMED"]);
  assert.equal(result.active[0].maxPenetrationAtr, 0.0010000000000005115);
  assert.equal(result.active[0].evidence.sweep, false);
  assert.equal(result.active[0].reclaimed, true);
  assert.equal(result.active[0].reclaimAt, stamp(0));
});

test("BSL sweep requires ATR-normalized depth and close back on original side", () => {
  const result = batch([candle(0, 98, 101.5, 99.5)], [level()]);
  assert.deepEqual(types(result), ["TOUCH_DETECTED", "PENETRATION_DETECTED",
    "RECLAIM_CONFIRMED", "SWEEP_CONFIRMED"]);
  assert.equal(result.active[0].maxPenetration, 1.5);
  assert.equal(result.active[0].maxPenetrationAtr, 0.15);
  assert.equal(result.active[0].evidence.break, false);
  assert.equal(result.active[0].evidence.raid, false);
});

test("deeper BSL penetration is RAID and does not claim reversal", () => {
  const result = batch([candle(0, 98, 108, 99.5)], [level()]);
  assert.equal(types(result).includes("RAID_CONFIRMED"), true);
  assert.equal(types(result).includes("SWEEP_CONFIRMED"), false);
  assert.equal(result.active[0].maxPenetrationAtr, 0.8);
  assert.equal(Object.keys(result.active[0]).some((key) => /control|signal|entry/i.test(key)), false);
});

test("two penetrative bars make a prolonged RAID on reclaim", () => {
  const sources = [candle(0, 99, 101.5, 99.5), candle(1, 99, 101.4, 99.4)];
  const result = batch(sources, [level()]);
  assert.equal(result.active[0].barsBeyond, 2);
  assert.equal(types(result).includes("RAID_CONFIRMED"), true);
  assert.equal(result.active[0].evidence.raid, true);
  // The later raid evidence is a new event; the first sweep event stays intact.
  assert.equal(types(result).includes("SWEEP_CONFIRMED"), true);
});

test("first closed candle beyond BSL confirms BREAK, never ACCEPTANCE", () => {
  const result = batch([candle(0, 99, 103, 102)], [level()]);
  assert.deepEqual(types(result), ["TOUCH_DETECTED", "PENETRATION_DETECTED", "BREAK_CONFIRMED"]);
  assert.equal(result.active[0].consecutiveClosesBeyond, 1);
  assert.equal(result.active[0].totalClosesBeyond, 1);
  assert.equal(result.active[0].closeRelationship, "CLOSE_BEYOND_LEVEL");
});

test("ACCEPTANCE appears only on second qualifying beyond close and is not backdated", () => {
  const sources = [candle(0, 99, 103, 102), candle(1, 101, 104, 102)];
  const first = batch(sources.slice(0, 1), [level()]);
  const full = batch(sources, [level()]);
  assert.equal(types(first).includes("ACCEPTANCE_CONFIRMED"), false);
  const event = full.events.find((item) => item.type === "ACCEPTANCE_CONFIRMED");
  assert.equal(event.availableAt, stamp(1));
  assert.equal(full.completed[0].finalType, "ACCEPTANCE");
  assert.equal(full.completed[0].evidence.failedBreak, false);
});

test("close break followed by reclaim produces causal FAILED_BREAK", () => {
  const sources = [candle(0, 99, 103, 102), candle(1, 98, 101, 99)];
  const first = batch(sources.slice(0, 1), [level()]);
  const full = batch(sources, [level()]);
  assert.equal(types(first).includes("RECLAIM_CONFIRMED"), false);
  assert.equal(types(first).includes("FAILED_BREAK_CONFIRMED"), false);
  assert.equal(full.events.find((item) => item.type === "RECLAIM_CONFIRMED").availableAt, stamp(1));
  assert.equal(full.events.find((item) => item.type === "FAILED_BREAK_CONFIRMED").availableAt, stamp(1));
  assert.equal(full.active[0].currentState, "FAILED_BREAK");
  assert.equal(full.active[0].evidence.acceptance, false);
});

test("Phase 2 wick evidence plus later measurable reaction confirms REJECTION", () => {
  const sources = [candle(0, 98, 101.5, 99.5), candle(1, 94, 96, 95)];
  const result = batch(sources, [level()], (i) => i === 0 ? { upperRejection: true } : {});
  const event = result.events.find((item) => item.type === "REJECTION_CONFIRMED");
  assert.equal(event.availableAt, stamp(1));
  assert.equal(result.completed[0].finalType, "REJECTION");
  assert.equal(result.completed[0].maximumReactionAway, 6);
  assert.equal(result.completed[0].maximumReactionAwayAtr, 0.6);
  assert.equal(result.completed[0].evidence.sweep, true);
});

test("wick evidence alone cannot confirm rejection without reaction", () => {
  const sources = [candle(0, 98, 101.5, 99.5), candle(1, 99, 99.5, 99.2)];
  const result = batch(sources, [level()], (i) => i === 0 ? { upperRejection: true } : {});
  assert.equal(types(result).includes("REJECTION_CONFIRMED"), false);
  assert.equal(result.active[0].maximumReactionAwayAtr, 0.1);
});

test("SSL uses inverse penetration, break, reclaim, and lower rejection evidence", () => {
  const ssl = level("1m", "SSL", 100);
  const sweep = batch([candle(0, 98, 102, 100.5)], [ssl]);
  assert.equal(sweep.active[0].maxPenetration, 2);
  assert.equal(sweep.active[0].maxPenetrationAtr, 0.2);
  assert.equal(types(sweep).includes("SWEEP_CONFIRMED"), true);
  const sources = [candle(0, 97, 101, 98), candle(1, 99, 104, 102)];
  const failed = batch(sources, [ssl]);
  assert.equal(types(failed).includes("BREAK_CONFIRMED"), true);
  assert.equal(types(failed).includes("FAILED_BREAK_CONFIRMED"), true);
  const rejected = batch([candle(0, 98, 102, 100.5), candle(1, 104, 106, 105)],
    [ssl], (i) => i === 0 ? { lowerRejection: true } : {});
  assert.equal(types(rejected).includes("REJECTION_CONFIRMED"), true);
});

test("same liquidity re-interacts after completion with a new stable episode ID", () => {
  const sources = [candle(0, 99, 100, 99.5), candle(1, 94, 96, 95),
    candle(2, 99, 100, 99.5)];
  const result = batch(sources, [level()]);
  assert.equal(result.completed.length, 1);
  assert.equal(result.active.length, 1);
  assert.notEqual(result.completed[0].id, result.active[0].id);
  assert.equal(result.completed[0].liquidityId, result.active[0].liquidityId);
  assert.equal(result.completed[0].firstTouchAt, stamp(0));
  assert.equal(result.active[0].firstTouchAt, stamp(2));
});

test("four timeframes and overlapping prices retain separate lineage", () => {
  const levels = timeframes.map((tf) => level(tf, "BSL", 100));
  const result = batch([candle(0, 99, 101.5, 99.5)], levels);
  assert.equal(result.diagnostics.episodesStarted, 4);
  assert.equal(result.active.length, 4);
  assert.equal(new Set(result.active.map((item) => item.id)).size, 4);
  assert.deepEqual(new Set(result.active.map((item) => item.sourceTimeframe)), new Set(timeframes));
});

test("future higher-timeframe liquidity cannot create historical interaction", () => {
  const item = level("15m", "BSL", 100, 5);
  const sources = Array.from({ length: 6 }, (_, i) => candle(i, 99, 101, 99.5));
  const before = batch(sources.slice(0, 5), [item]);
  const after = batch(sources, [item]);
  assert.equal(before.diagnostics.episodesStarted, 0);
  assert.equal(after.diagnostics.episodesStarted, 1);
  assert.equal(after.active[0].firstTouchAt, stamp(5));
});

test("Phase 5 TOUCHING without candle contact is rejected as an integration inconsistency", () => {
  const source = candle(0, 90, 91, 90.5);
  const approach = createPriceApproachEngine();
  const current = structuredClone(approach.push({ candle: source, psychology: feature(source),
    newLiquidity: [level()] }));
  current["1m"].above.state = "TOUCHING";
  const interaction = createLiquidityInteractionEngine();
  assert.throws(() => interaction.push({ candle: source, psychology: feature(source), current }),
    (error) => error instanceof InteractionInputError && error.code === "APPROACH_GEOMETRY_MISMATCH");
  assert.equal(interaction.diagnostics.integrationInconsistencies, 1);
  assert.equal(interaction.diagnostics.episodesStarted, 0);
});

test("completed trackers leave the active Map over a long repeated history", () => {
  const sources = Array.from({ length: 1000 }, (_, i) => i % 2 === 0 ?
    candle(i, 99, 100, 99.5) : candle(i, 94, 96, 95));
  const { interaction } = replay(sources, [level()]);
  assert.equal(interaction.completed.length, 500);
  assert.equal(interaction.activeCount, 0);
  assert.equal(interaction.diagnostics.maximumActiveMapSize, 1);
  assert.equal(interaction.diagnostics.episodesStarted, 500);
});

test("batch and incremental outputs match, with deterministic events and source immutability", () => {
  const sources = [candle(0, 99, 100, 99.5), candle(1, 98, 101.5, 99.5),
    candle(2, 94, 96, 95), candle(3, 99, 103, 102), candle(4, 101, 104, 102)];
  const levels = [level("1m", "BSL", 100), level("5m", "BSL", 100, 3)];
  const input = inputs(sources, levels, (i) => i === 1 ? { upperRejection: true } : {});
  const before = structuredClone(input);
  const batchResult = analyzeLiquidityInteractions(input.historical, input.psychology, input.liquidity);
  const incremental = replay(sources, levels, (i) => i === 1 ? { upperRejection: true } : {});
  assert.deepEqual(batchResult.completed, incremental.interaction.completed);
  assert.deepEqual(batchResult.active, incremental.interaction.activeEpisodes);
  assert.deepEqual(batchResult.events, incremental.interaction.events);
  assert.deepEqual(batchResult.diagnostics, incremental.interaction.diagnostics);
  assert.deepEqual(analyzeLiquidityInteractions(input.historical, input.psychology, input.liquidity).events,
    batchResult.events);
  assert.deepEqual(input, before);
  assert.equal(new Set(batchResult.events.map((event) => event.id)).size, batchResult.events.length);
});

test("1001-candle prefix facts stay unchanged through a 2001-candle extension", () => {
  const sources = Array.from({ length: 2001 }, (_, i) => i % 12 === 0 ?
    candle(i, 99, 101.5, 99.5) : candle(i, 94, 96, 95));
  const levels = [level("1m", "BSL", 100), level("15m", "BSL", 100, 1500)];
  const prefix = batch(sources.slice(0, 1001), levels);
  const full = batch(sources, levels);
  assert.equal(prefix.status, "READY");
  assert.equal(full.status, "READY");
  assert.deepEqual(full.events.filter((event) => event.availableAt <= stamp(1000)), prefix.events);
  assert.deepEqual(full.completed.filter((episode) => episode.availableAt <= stamp(1000)),
    prefix.completed);
});

test("malformed upstream status blocks trusted interactions", () => {
  const input = inputs([candle(0, 99, 100, 99.5)], [level()]);
  input.liquidity.status = "BLOCKED";
  const blocked = analyzeLiquidityInteractions(input.historical, input.psychology, input.liquidity);
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.events.length, 0);
  input.liquidity.status = "READY";
  input.historical.status = "FAILED";
  assert.equal(analyzeLiquidityInteractions(input.historical, input.psychology, input.liquidity).status,
    "FAILED");
});

test("all emitted numeric facts are finite or null", () => {
  const result = batch([candle(0, 99, 101.5, 99.5), candle(1, 94, 96, 95)],
    [level()], () => ({}), {}, null);
  assert.equal(result.status, "READY");
  assert.equal(result.events.every((event) => event.penetrationAtr === null ||
    Number.isFinite(event.penetrationAtr)), true);
  assert.equal(result.completed.every((item) => item.maxPenetrationAtr === null ||
    Number.isFinite(item.maxPenetrationAtr)), true);
  assert.equal(result.completed.every((item) => item.maximumReactionAwayAtr === null ||
    Number.isFinite(item.maximumReactionAwayAtr)), true);
});
