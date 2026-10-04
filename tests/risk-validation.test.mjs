import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistoricalRiskValidations, createRiskValidationEngine } from
  "../lib/traderbrain/analysis/risk-validation.ts";

const t = (minute) => Date.parse("2026-03-02T10:00:00Z") + minute * 60_000;
const level = (id, price, side = "BSL", minute = 0, timeframe = "1m",
  kind = "SWING", classifications = ["HH"]) => ({ id, price, side,
  availableAt: t(minute), timeframe, kind, sourceClassifications: classifications });
const swing = (id, price, type, minute = 0, classification = "HL") => ({
  id, price, type, timeframe: "1m", availableAt: t(minute), classification });
const confirmation = (direction = "BULLISH", type = "BULLISH_BOS") => ({
  id: "confirmation", direction, type, availableAt: t(0),
  displacementEventId: "displacement", controlTransferId: null,
  interactionId: null, liquidityId: null });
const zone = (direction = "BULLISH", lower = 99, upper = 101) => ({
  id: "zone", direction, lower, upper, qualifiedAt: t(0),
  structuralConfirmationId: "confirmation",
  displacementEventId: "displacement" });
const candidate = (direction = "BULLISH", minute = 20, price = 100,
  overrides = {}) => ({ id: `candidate:${minute}`, direction, availableAt: t(minute),
    entryPrice: price, referenceAtr: 10, status: "CANDIDATE",
    fvgId: "zone", structuralConfirmationId: "confirmation",
    displacementEventId: "displacement", controlTransferId: null,
    interactionId: null, liquidityId: null, ...overrides });
function evaluate({ direction = "BULLISH", type, price = 100, lower = 99,
  upper = 101, levels = [], swings = [], interactions = [],
  candidateOverrides = {}, config = {}, atr = 10 } = {}) {
  const engine = createRiskValidationEngine(config);
  engine.updateMarketContext({ at: t(20), newLiquidity: levels,
    newSwings: swings, newInteractions: interactions,
    newConfirmations: [{ ...confirmation(direction, type ??
      `${direction}_BOS`), interactionId: candidateOverrides.interactionId ?? null }],
    newFvgs: [zone(direction, lower, upper)] });
  return engine.evaluate(candidate(direction, 20, price, candidateOverrides), atr);
}

test("bullish and bearish plans use structural stops and actual liquidity targets", () => {
  const bull = evaluate({ swings: [swing("low", 98, "SWING_LOW")],
    levels: [level("target", 106)] });
  assert.equal(bull.status, "VALID");
  assert.equal(bull.stopSource, "STRUCTURAL_SWING");
  assert.equal(bull.structuralInvalidationPrice, 98);
  assert.equal(bull.stopPrice, 97.8);
  assert.equal(bull.riskDistance, 2.200000000000003);
  assert.equal(bull.rewardDistance, 6);
  assert.ok(Math.abs(bull.rawRR - 6 / 2.2) < 1e-12);
  assert.equal(bull.executionAdjustedRR, null);
  assert.equal(bull.executionCostStatus, "NOT_AVAILABLE");
  const bear = evaluate({ direction: "BEARISH", type: "BEARISH_BOS",
    swings: [swing("high", 102, "SWING_HIGH", 0, "LH")],
    levels: [level("target", 94, "SSL", 0, "1m", "SWING", ["LL"])] });
  assert.equal(bear.status, "VALID");
  assert.ok(bear.stopPrice > bear.entryPrice && bear.destinationPrice < bear.entryPrice);
  assert.ok(Math.abs(bear.rawRR - 6 / 2.2) < 1e-12);
});

test("wrong-side stop, missing destination, low RR and insufficient room remain distinct", () => {
  assert.equal(evaluate({ swings: [swing("low", 102, "SWING_LOW")],
    levels: [level("target", 106)] }).status, "INVALID_STOP");
  assert.equal(evaluate({ swings: [swing("low", 98, "SWING_LOW")] }).status,
    "NO_DESTINATION");
  const lowRr = evaluate({ swings: [swing("low", 95, "SWING_LOW")],
    levels: [level("target", 106)], config: { minRR: 1.8 } });
  assert.equal(lowRr.status, "RR_TOO_LOW");
  assert.ok(lowRr.rawRR > 1 && lowRr.rawRR < 1.8);
  const lowRoom = evaluate({ swings: [swing("low", 99.9, "SWING_LOW")],
    levels: [level("target", 102)], config: { minimumRiskAtr: 0.01 } });
  assert.equal(lowRoom.status, "INSUFFICIENT_ROOM");
  assert.ok(lowRoom.rawRR > 2);
  assert.equal(lowRoom.checks.room.pass, false);
});

test("a nearer nonprimary 1m level is reported as an obstacle", () => {
  const plan = evaluate({ swings: [swing("low", 98, "SWING_LOW")],
    levels: [level("near", 102, "BSL", 0, "1m", "SWING", ["UNCLASSIFIED"]),
      level("far", 110, "BSL", 0, "15m")],
    config: { minimumObstacleRoomAtr: 0.3 } });
  assert.equal(plan.destinationLiquidityId, "far");
  assert.equal(plan.nearestObstacleId, "near");
  assert.equal(plan.roomToObstacleAtr, 0.2);
  assert.equal(plan.status, "OBSTACLE_TOO_CLOSE");
});

test("nearer meaningful 1m target wins over farther 15m; otherwise 15m can win", () => {
  const common = { swings: [swing("low", 98, "SWING_LOW")] };
  const near = evaluate({ ...common, levels: [level("near", 106),
    level("far", 110, "BSL", 0, "15m")] });
  assert.equal(near.destinationLiquidityId, "near");
  const far = evaluate({ ...common, levels: [level("noise", 103, "BSL", 0,
    "1m", "SWING", ["UNCLASSIFIED"]), level("far", 110, "BSL", 0, "15m")] });
  assert.equal(far.destinationTimeframe, "15m");
  assert.equal(far.nearestObstacleId, "noise");
});

test("MSS uses the completed interaction extreme; BOS uses a structural swing", () => {
  const interaction = { id: "raid", completedAt: t(10),
    finalType: "RAID", liquiditySide: "BSL", liquidityPrice: 103,
    maxPenetration: 1 };
  const reversal = evaluate({ direction: "BEARISH", type: "BEARISH_MSS",
    candidateOverrides: { interactionId: "raid" }, interactions: [interaction],
    swings: [swing("high", 101, "SWING_HIGH", 0, "LH")],
    levels: [level("target", 90, "SSL", 0, "1m", "SWING", ["LL"])] });
  assert.equal(reversal.status, "VALID");
  assert.equal(reversal.stopSource, "INTERACTION_EXTREME");
  assert.equal(reversal.structuralInvalidationPrice, 104);
  const continuation = evaluate({ swings: [swing("protected", 98,
    "SWING_LOW", 0, "HL")], levels: [level("target", 108)] });
  assert.equal(continuation.stopSourceId, "protected");
});

test("future stop and destination facts cannot be fed to an earlier evaluation", () => {
  const engine = createRiskValidationEngine();
  assert.throws(() => engine.updateMarketContext({ at: t(20),
    newLiquidity: [level("future", 110, "BSL", 25)] }),
  { code: "FUTURE_CONTEXT" });
  const earlier = createRiskValidationEngine();
  assert.throws(() => earlier.updateMarketContext({ at: t(20),
    newSwings: [swing("future", 98, "SWING_LOW", 22)] }),
  { code: "FUTURE_CONTEXT" });
  const noOldSwing = sources(true);
  noOldSwing.structure.timeframes["1m"].swings = [
    swing("future-low", 98, "SWING_LOW", 25)];
  const risk = analyzeHistoricalRiskValidations(noOldSwing).validations[0];
  assert.equal(risk.stopSource, "ZONE_INVALIDATION");
  assert.equal(risk.stopSourceId, "zone");
  assert.equal(risk.destinationLiquidityId, "target");
});

test("price index finds the nearest active level after many insertions and acceptance events", () => {
  const engine = createRiskValidationEngine({ minRR: 0.01, minRoomAtr: 0.01 });
  const levels = Array.from({ length: 1000 }, (_, i) => level(`level:${i}`,
    101 + i / 10));
  const shuffled = [...levels].sort((a, b) =>
    ((Number(a.id.split(":")[1]) * 37) % 1009) -
    ((Number(b.id.split(":")[1]) * 37) % 1009));
  engine.updateMarketContext({ at: t(20), newLiquidity: shuffled,
    newSwings: [swing("low", 98, "SWING_LOW")],
    newConfirmations: [confirmation()], newFvgs: [zone()],
    newInteractionEvents: [200, 201, 202].map((i) => ({
      type: "ACCEPTANCE_CONFIRMED", availableAt: t(19),
      liquidityId: `level:${i}` })) });
  const price = 120.95;
  const plan = engine.evaluate(candidate("BULLISH", 20, price));
  assert.equal(plan.destinationLiquidityId, "level:203");
  assert.equal(plan.destinationPrice, 121.3);
});

test("accepted liquidity is excluded using only causal Phase 6 acceptance", () => {
  const engine = createRiskValidationEngine();
  engine.updateMarketContext({ at: t(20), newLiquidity: [level("old", 106),
    level("new", 108)], newSwings: [swing("low", 98, "SWING_LOW")],
    newConfirmations: [confirmation()], newFvgs: [zone()],
    newInteractionEvents: [{ type: "ACCEPTANCE_CONFIRMED",
      availableAt: t(19), liquidityId: "old" }] });
  assert.equal(engine.evaluate(candidate()).destinationLiquidityId, "new");
});

test("extreme ATR inputs reject without nonfinite risk fields", () => {
  const plan = evaluate({ swings: [swing("low", 98, "SWING_LOW")],
    levels: [level("target", 106)], atr: Number.MAX_VALUE });
  assert.equal(plan.status, "INVALID_STOP");
  assert.equal(plan.stopPrice, null);
  for (const value of [plan.stopPrice, plan.riskAtr, plan.rewardAtr, plan.rawRR]) {
    assert.ok(value === null || Number.isFinite(value));
  }
});

test("a stale or no-longer-candidate input is invalidated before risk selection", () => {
  const missed = evaluate({ candidateOverrides: { status: "MISSED" },
    swings: [swing("low", 98, "SWING_LOW")],
    levels: [level("target", 106)] });
  assert.equal(missed.status, "INVALIDATED");
  assert.equal(missed.stopPrice, null);
  const stale = evaluate({ candidateOverrides: { displacementEventId: "wrong" },
    swings: [swing("low", 98, "SWING_LOW")],
    levels: [level("target", 106)] });
  assert.equal(stale.status, "INVALIDATED");
});

function sources(extra = false) {
  const levels = [level("target", 106),
    ...(extra ? [level("future-target", 104, "BSL", 25)] : [])];
  return { psychology: { status: "READY", timeframes: { "1m": { features: [
    { timestamp: t(20), atrReady: true, atr: 10 },
    { timestamp: t(25), atrReady: true, atr: 100 }] } } },
    structure: { status: "READY", timeframes: { "1m": { swings: [
      swing("low", 98, "SWING_LOW"),
      ...(extra ? [swing("future-low", 99, "SWING_LOW", 25)] : [])] } } },
    liquidity: { status: "READY", timeframes: Object.fromEntries(
      ["1m", "5m", "15m", "1h"].map((tf) => [tf,
        { levels: tf === "1m" ? levels : [] }])) },
    interaction: { status: "READY", completed: [], events: [] },
    confirmation: { status: "READY", confirmations: [confirmation()] },
    fvg: { status: "READY", zones: [zone()], events: [
      { type: "FVG_QUALIFIED", zoneId: "zone", availableAt: t(0) }] },
    entry: { status: "READY", candidates: [candidate()] } };
}

test("batch and incremental plans match; future data preserves prefix, ATR and target", () => {
  const prefix = analyzeHistoricalRiskValidations(sources());
  const future = analyzeHistoricalRiskValidations(sources(true));
  assert.equal(prefix.status, "READY");
  assert.deepEqual(future.validations, prefix.validations);
  assert.deepEqual(analyzeHistoricalRiskValidations(sources()).validations,
    prefix.validations);
  const engine = createRiskValidationEngine();
  engine.updateMarketContext({ at: t(20), newLiquidity: [level("target", 106)],
    newSwings: [swing("low", 98, "SWING_LOW")],
    newConfirmations: [confirmation()], newFvgs: [zone()] });
  const incremental = engine.evaluate(candidate(), 10);
  assert.deepEqual(incremental, prefix.validations[0]);
  assert.equal(incremental.referenceAtr, 10);
  assert.equal(incremental.destinationLiquidityId, "target");
  engine.updateMarketContext({ at: t(25),
    newLiquidity: [level("future-target", 104, "BSL", 25)],
    newSwings: [swing("future-low", 99, "SWING_LOW", 25)] });
  assert.deepEqual(engine.validations[0], incremental);
});
