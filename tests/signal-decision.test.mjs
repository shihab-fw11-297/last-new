import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistoricalSignals, createSignalDecisionEngine } from
  "../lib/traderbrain/analysis/signal-decision.ts";

const t = (minute) => Date.parse("2026-03-02T10:00:00Z") + minute * 60_000;
function episode(id, direction = "BULLISH", family = "CONTINUATION", minute = 20) {
  const reversal = family === "LIQUIDITY_REVERSAL";
  const bullish = direction === "BULLISH";
  const confirmation = { id: `${id}:confirmation`, direction,
    type: `${direction}_${reversal ? "MSS" : "BOS"}`,
    availableAt: t(minute - 4), displacementEventId: `${id}:displacement`,
    brokenSwingId: `${id}:swing`,
    controlTransferId: reversal ? `${id}:transfer` : null,
    interactionId: reversal ? `${id}:interaction` : null,
    liquidityId: reversal ? `${id}:level` : null };
  const displacement = { id: `${id}:displacement`, direction,
    context: reversal ? "TRANSFER" : "CONTINUATION",
    controlTransferId: confirmation.controlTransferId,
    interactionId: confirmation.interactionId,
    liquidityId: confirmation.liquidityId,
    ignitionAt: t(minute - 10), availableAt: t(minute - 5) };
  const transfer = { id: `${id}:transfer`, availableAt: t(minute - 7),
    interactionId: `${id}:interaction`, liquidityId: `${id}:level`,
    newControl: bullish ? "BUYER_CONTROL" : "SELLER_CONTROL" };
  const interaction = { id: `${id}:interaction`, completedAt: t(minute - 6),
    liquidityId: `${id}:level`, liquiditySide: bullish ? "SSL" : "BSL",
    finalType: "SWEEP" };
  const zone = { id: `${id}:zone`, direction, qualifiedAt: t(minute - 3),
    structuralConfirmationId: confirmation.id,
    displacementEventId: displacement.id };
  const candidate = { id: `${id}:candidate`, type: "FVG_RETRACE", direction,
    status: "CANDIDATE", createdAt: t(minute), availableAt: t(minute),
    entryPrice: 100, fvgId: zone.id,
    structuralConfirmationId: confirmation.id,
    displacementEventId: displacement.id,
    controlTransferId: confirmation.controlTransferId,
    interactionId: confirmation.interactionId,
    liquidityId: confirmation.liquidityId,
    controlStateAtEntry: bullish ? "BUYER_CONTROL" : "SELLER_CONTROL" };
  const risk = { id: `${id}:risk`, entryCandidateId: candidate.id,
    direction, availableAt: t(minute), entryPrice: 100,
    stopPrice: bullish ? 98 : 102,
    destinationPrice: bullish ? 105 : 95,
    rawRR: 2.5, executionAdjustedRR: null,
    executionCostStatus: "NOT_AVAILABLE", status: "VALID",
    checks: { stopSide: true, minimumRisk: { pass: true },
      room: { pass: true }, obstacleRoom: null, rr: { pass: true } },
    lineage: { liquidityId: candidate.liquidityId,
      interactionId: candidate.interactionId,
      controlTransferId: candidate.controlTransferId,
      displacementEventId: candidate.displacementEventId,
      structuralConfirmationId: candidate.structuralConfirmationId,
      fvgId: candidate.fvgId, entryCandidateId: candidate.id } };
  const level = { id: `${id}:level`, timeframe: "1m",
    side: bullish ? "BSL" : "SSL", availableAt: t(minute - 12),
    sourceSwingIds: [confirmation.brokenSwingId] };
  const breakoutInteractionId = `${id}:breakout`;
  const events = ["BREAK_CONFIRMED", "ACCEPTANCE_CONFIRMED"].map((type, n) => ({
    id: `${id}:${type}`, type, interactionId: breakoutInteractionId,
    liquidityId: level.id, liquiditySide: level.side,
    availableAt: t(minute - 8 + n) }));
  const compression = { liquidityId: level.id, sourceTimeframe: "1m",
    timestamp: t(minute - 11), behaviorClass: "COMPRESSED" };
  return { candidate, risk, confirmation, displacement, transfer,
    interaction, zone, level, events, compression, family };
}
function sources(episodes, overrides = {}) {
  const active = (family) => episodes.filter((item) => item.family === family);
  return { entry: { status: "READY", candidates: episodes.map((item) => item.candidate) },
    risk: { status: "READY", validations: episodes.map((item) => item.risk) },
    confirmation: { status: "READY", confirmations: episodes.map((item) =>
      item.confirmation) },
    displacement: { status: "READY", confirmed: episodes.map((item) =>
      item.displacement) },
    control: { status: "READY", transfers: active("LIQUIDITY_REVERSAL")
      .map((item) => item.transfer) },
    interaction: { status: "READY", completed: active("LIQUIDITY_REVERSAL")
      .map((item) => item.interaction), events: active("BREAKOUT_RETEST")
        .flatMap((item) => item.events) },
    liquidity: { status: "READY", timeframes: Object.fromEntries(
      ["1m", "5m", "15m", "1h"].map((tf) => [tf,
        { levels: tf === "1m" ? episodes.map((item) => item.level) : [] }])) },
    fvg: { status: "READY", zones: episodes.map((item) => item.zone),
      events: episodes.map((item) => ({ type: "FVG_QUALIFIED",
        zoneId: item.zone.id, availableAt: item.zone.qualifiedAt })) },
    compressionEvidence: active("COMPRESSION_EXPANSION")
      .map((item) => item.compression), ...overrides };
}

test("liquidity reversal BUY and SELL require MSS, transfer and sweep lineage", () => {
  const bull = episode("rev-buy", "BULLISH", "LIQUIDITY_REVERSAL");
  const bear = episode("rev-sell", "BEARISH", "LIQUIDITY_REVERSAL", 25);
  const result = analyzeHistoricalSignals(sources([bull, bear]));
  assert.equal(result.status, "READY");
  assert.deepEqual(result.signals.map((signal) => [signal.direction, signal.setupFamily]),
    [["BUY", "LIQUIDITY_REVERSAL"], ["SELL", "LIQUIDITY_REVERSAL"]]);
  assert.equal(result.signals[0].entryPrice, bull.candidate.entryPrice);
  assert.equal(result.signals[0].stopLoss, bull.risk.stopPrice);
  assert.equal(result.signals[0].takeProfit, bull.risk.destinationPrice);
  assert.equal(result.signals[0].rr, bull.risk.rawRR);
  assert.equal(result.signals[0].lineage.riskValidationId, bull.risk.id);
  bear.transfer.newControl = "BUYER_CONTROL";
  const rejected = analyzeHistoricalSignals(sources([bear]));
  assert.equal(rejected.signals.length, 0);
  assert.equal(rejected.decisions[0].action, "NO_TRADE");
});

test("continuation BUY and SELL need neither sweep nor control transfer", () => {
  const bull = episode("cont-buy", "BULLISH");
  const bear = episode("cont-sell", "BEARISH", "CONTINUATION", 25);
  const result = analyzeHistoricalSignals(sources([bull, bear]));
  assert.deepEqual(result.signals.map((signal) => [signal.direction, signal.setupFamily]),
    [["BUY", "CONTINUATION"], ["SELL", "CONTINUATION"]]);
  assert.equal(result.diagnostics.families.CONTINUATION.signals, 2);
});

test("real Phase 5 compression evidence routes a release without recalculation", () => {
  const item = episode("compression", "BULLISH", "COMPRESSION_EXPANSION");
  const result = analyzeHistoricalSignals(sources([item]));
  assert.equal(result.signals[0].setupFamily, "COMPRESSION_EXPANSION");
  const absent = analyzeHistoricalSignals(sources([item], { compressionEvidence: [] }));
  assert.equal(absent.signals[0].setupFamily, "CONTINUATION");
  const future = analyzeHistoricalSignals(sources([item], { compressionEvidence: [
    { ...item.compression, timestamp: t(21) }] }));
  assert.equal(future.signals[0].setupFamily, "CONTINUATION");
});

test("breakout retest BUY and SELL require Phase 6 break plus acceptance", () => {
  const bull = episode("break-buy", "BULLISH", "BREAKOUT_RETEST");
  const bear = episode("break-sell", "BEARISH", "BREAKOUT_RETEST", 25);
  const result = analyzeHistoricalSignals(sources([bull, bear]));
  assert.deepEqual(result.signals.map((signal) => [signal.direction, signal.setupFamily]),
    [["BUY", "BREAKOUT_RETEST"], ["SELL", "BREAKOUT_RETEST"]]);
  const wickOnly = analyzeHistoricalSignals(sources([bull], {
    interaction: { status: "READY", completed: [], events: [bull.events[0]] } }));
  assert.equal(wickOnly.signals[0].setupFamily, "CONTINUATION");
  const acceptanceOnly = analyzeHistoricalSignals(sources([bull], {
    interaction: { status: "READY", completed: [], events: [bull.events[1]] } }));
  assert.equal(acceptanceOnly.signals[0].setupFamily, "CONTINUATION");
});

test("family overlap chooses breakout before compression and produces one signal", () => {
  const item = episode("overlap", "BULLISH", "BREAKOUT_RETEST");
  const result = analyzeHistoricalSignals(sources([item], {
    compressionEvidence: [item.compression] }));
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].setupFamily, "BREAKOUT_RETEST");
  assert.equal(result.diagnostics.families.COMPRESSION_EXPANSION.eligible, 1);
});

test("bad risk, no destination, wrong geometry, missed entry and orphan story never signal", () => {
  const badRr = episode("bad-rr");
  badRr.risk.status = "RR_TOO_LOW";
  assert.equal(analyzeHistoricalSignals(sources([badRr])).decisions[0].reasons[0],
    "UPSTREAM_RISK_INVALID");
  const noTarget = episode("no-target");
  noTarget.risk.status = "NO_DESTINATION";
  assert.equal(analyzeHistoricalSignals(sources([noTarget])).signals.length, 0);
  const wrongStop = episode("wrong-stop");
  wrongStop.risk.stopPrice = 101;
  assert.equal(analyzeHistoricalSignals(sources([wrongStop])).decisions[0].reasons[0],
    "PRICE_GEOMETRY_INVALID");
  const missed = episode("missed", "BEARISH", "LIQUIDITY_REVERSAL");
  missed.candidate.status = "MISSED";
  assert.equal(analyzeHistoricalSignals(sources([missed])).decisions[0].reasons[0],
    "UPSTREAM_ENTRY_INVALID");
  const orphan = episode("orphan");
  orphan.confirmation.displacementEventId = "missing";
  assert.equal(analyzeHistoricalSignals(sources([orphan])).decisions[0].reasons[0],
    "LINEAGE_MISSING");
  const stale = episode("stale");
  stale.risk.availableAt = t(21);
  const staleResult = analyzeHistoricalSignals(sources([stale]));
  assert.equal(staleResult.decisions[0].action, "WAIT");
  assert.equal(staleResult.decisions[1].reasons[0], "STALE_CANDIDATE");
  const mismatch = episode("mismatch");
  mismatch.risk.direction = "BEARISH";
  assert.equal(analyzeHistoricalSignals(sources([mismatch])).decisions[0].reasons[0],
    "DIRECTION_MISMATCH");
  const noTransfer = episode("no-transfer", "BEARISH", "LIQUIDITY_REVERSAL");
  const noTransferResult = analyzeHistoricalSignals(sources([noTransfer], {
    control: { status: "READY", transfers: [] } }));
  assert.equal(noTransferResult.signals.length, 0);
  assert.equal(noTransferResult.decisions[0].reasons[0], "NO_SETUP_FAMILY");
});

test("duplicate setup is rejected, while independent setups on one day all signal", () => {
  const first = episode("first");
  const second = episode("second", "BULLISH", "CONTINUATION", 25);
  const third = episode("third", "BULLISH", "CONTINUATION", 30);
  const multi = analyzeHistoricalSignals(sources([first, second, third]));
  assert.equal(multi.signals.length, 3);
  const duplicate = episode("duplicate", "BULLISH", "CONTINUATION", 25);
  duplicate.confirmation = { ...first.confirmation };
  duplicate.displacement = { ...first.displacement };
  duplicate.zone.structuralConfirmationId = first.confirmation.id;
  duplicate.zone.displacementEventId = first.displacement.id;
  duplicate.candidate.structuralConfirmationId = first.confirmation.id;
  duplicate.candidate.displacementEventId = first.displacement.id;
  duplicate.risk.lineage.structuralConfirmationId = first.confirmation.id;
  duplicate.risk.lineage.displacementEventId = first.displacement.id;
  const deduped = analyzeHistoricalSignals(sources([first, duplicate]));
  assert.equal(deduped.signals.length, 1);
  assert.equal(deduped.diagnostics.duplicatesRemoved, 1);
});

test("same-time opposite confirmations resolve by recency or suppress both on tie", () => {
  const bull = episode("bull", "BULLISH");
  const bear = episode("bear", "BEARISH");
  bear.confirmation.availableAt = t(17);
  const newer = analyzeHistoricalSignals(sources([bull, bear]));
  assert.deepEqual(newer.signals.map((signal) => signal.direction), ["SELL"]);
  assert.equal(newer.diagnostics.conflicts, 1);
  bear.confirmation.availableAt = bull.confirmation.availableAt;
  const tied = analyzeHistoricalSignals(sources([bull, bear]));
  assert.equal(tied.signals.length, 0);
  assert.equal(tied.diagnostics.conflicts, 2);
});

test("a later opposite candidate with older confirmation cannot contradict a signal", () => {
  const bull = episode("newer-bull", "BULLISH", "CONTINUATION", 20);
  const bear = episode("older-bear", "BEARISH", "CONTINUATION", 25);
  bear.confirmation.availableAt = t(15);
  const result = analyzeHistoricalSignals(sources([bull, bear]));
  assert.deepEqual(result.signals.map((item) => item.direction), ["BUY"]);
  assert.equal(result.decisions[1].reasons[0], "CONFLICTING_SETUP");
});

test("batch equals incremental and future events preserve earlier signal", () => {
  const first = episode("prefix");
  const second = episode("future", "BULLISH", "CONTINUATION", 30);
  const batch = analyzeHistoricalSignals(sources([first, second]));
  const repeat = analyzeHistoricalSignals(sources([first, second]));
  assert.deepEqual(batch.signals, repeat.signals);
  assert.deepEqual(batch.decisions, repeat.decisions);
  const engine = createSignalDecisionEngine();
  const push = (item) => engine.push({ at: item.candidate.availableAt,
    newCandidates: [item.candidate], newRisks: [item.risk],
    newConfirmations: [item.confirmation], newDisplacements: [item.displacement],
    newZones: [item.zone], newLiquidity: [item.level] });
  push(first);
  const frozen = structuredClone(engine.signals[0]);
  push(second);
  assert.deepEqual(engine.signals, batch.signals);
  assert.deepEqual(engine.decisions, batch.decisions);
  assert.deepEqual(engine.signals[0], frozen);
  assert.equal(frozen.availableAt, first.risk.availableAt);
  assert.equal(frozen.createdAt, first.candidate.createdAt);
});

test("all four family paths match incremental event-time replay", () => {
  const items = [episode("four-reversal", "BEARISH", "LIQUIDITY_REVERSAL", 20),
    episode("four-breakout", "BULLISH", "BREAKOUT_RETEST", 25),
    episode("four-compression", "BULLISH", "COMPRESSION_EXPANSION", 30),
    episode("four-continuation", "BEARISH", "CONTINUATION", 35)];
  const batch = analyzeHistoricalSignals(sources(items));
  const engine = createSignalDecisionEngine();
  for (const item of items) {
    engine.push({ at: item.candidate.availableAt,
      newCandidates: [item.candidate], newRisks: [item.risk],
      newConfirmations: [item.confirmation],
      newDisplacements: [item.displacement], newZones: [item.zone],
      newLiquidity: [item.level],
      newTransfers: item.family === "LIQUIDITY_REVERSAL" ? [item.transfer] : [],
      newInteractions: item.family === "LIQUIDITY_REVERSAL" ?
        [item.interaction] : [],
      newInteractionEvents: item.family === "BREAKOUT_RETEST" ? item.events : [],
      newCompression: item.family === "COMPRESSION_EXPANSION" ?
        [item.compression] : [] });
  }
  assert.deepEqual(engine.signals, batch.signals);
  assert.deepEqual(engine.decisions, batch.decisions);
  assert.deepEqual(engine.diagnostics, batch.diagnostics);
  assert.deepEqual(batch.signals.map((item) => item.setupFamily),
    ["LIQUIDITY_REVERSAL", "BREAKOUT_RETEST",
      "COMPRESSION_EXPANSION", "CONTINUATION"]);
});

test("WAIT represents an arrived candidate whose risk result is not yet available", () => {
  const item = episode("wait");
  const engine = createSignalDecisionEngine();
  const first = engine.push({ at: t(20), newCandidates: [item.candidate],
    newConfirmations: [item.confirmation],
    newDisplacements: [item.displacement], newZones: [item.zone] });
  assert.equal(first[0].action, "WAIT");
  const second = engine.push({ at: t(20), newRisks: [item.risk] });
  assert.equal(second[0].action, "BUY");
  assert.equal(engine.signals.length, 1);
  assert.throws(() => engine.push({ at: t(21),
    newRisks: [{ ...item.risk, id: "future", availableAt: t(22) }] }),
  { code: "FUTURE_CONTEXT" });
});
