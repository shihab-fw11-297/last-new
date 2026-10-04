import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHistoricalSignalLedger, createSignalLedger } from
  "../lib/traderbrain/analysis/signal-ledger.ts";

const t = (minute) => Date.parse("2026-03-02T10:00:00Z") + minute * 60_000;
const candle = (minute, high = 101, low = 99) => ({ timestamp: t(minute),
  open: 100, high, low, close: 100, volume: null,
  symbol: "XAUUSD", timeframe: "1m" });
function signal(id, minute = 20, direction = "BUY", family = "CONTINUATION") {
  return { id, symbol: "XAUUSD", timeframe: "1m", direction,
    setupFamily: family, setupSubtype: "BOS_CONTINUATION",
    createdAt: t(minute), availableAt: t(minute),
    entryPrice: 100, stopLoss: direction === "BUY" ? 98 : 102,
    takeProfit: direction === "BUY" ? 104 : 96,
    rr: 2, rawRR: 2, executionAdjustedRR: null,
    executionCostStatus: "NOT_AVAILABLE", status: "ACTIVE",
    reasons: ["ENTRY_VALID", "RR_VALID"],
    lineage: { liquidityId: null, interactionId: null,
      controlTransferId: null, displacementEventId: `${id}:displacement`,
      structuralConfirmationId: `${id}:confirmation`, fvgId: `${id}:fvg`,
      entryCandidateId: `${id}:candidate`, riskValidationId: `${id}:risk` } };
}
function batch(candles, signals) {
  return analyzeHistoricalSignalLedger({ status: "READY", candles1m: candles },
    { status: "READY", signals });
}

test("one immutable signal is activated at trigger close; duplicate insertion is idempotent", () => {
  const ledger = createSignalLedger();
  const source = signal("same");
  ledger.push({ candle: candle(20, 105, 97), newSignals: [source, source] });
  assert.equal(ledger.signalCount, 1);
  assert.equal(ledger.diagnostics.signalsReceived, 2);
  assert.equal(ledger.diagnostics.duplicateInsertions, 1);
  assert.equal(ledger.getById("same").lifecycle.status, "ACTIVE");
  source.entryPrice = 999;
  source.reasons.push("CHANGED");
  source.lineage.fvgId = "changed";
  const frozen = ledger.getById("same").signal;
  assert.equal(frozen.entryPrice, 100);
  assert.deepEqual(frozen.reasons, ["ENTRY_VALID", "RR_VALID"]);
  assert.equal(frozen.lineage.fvgId, "same:fvg");
  assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.lineage));
  assert.equal(ledger.getById("same").events[0].type, "ACTIVATED");
  ledger.push({ candle: candle(21), newSignals: [signal("same")] });
  assert.equal(ledger.signalCount, 1);
  assert.equal(ledger.diagnostics.duplicateInsertions, 2);
});

test("BUY and SELL TP and SL use only later closed candles", () => {
  for (const [direction, high, low, expected, expectedPrice] of [
    ["BUY", 104.5, 100, "TP_HIT", 104],
    ["BUY", 101, 97.9, "SL_HIT", 98],
    ["SELL", 101, 95.8, "TP_HIT", 96],
    ["SELL", 102.2, 99, "SL_HIT", 102],
  ]) {
    const id = `${direction}:${expected}`;
    const ledger = createSignalLedger();
    ledger.push({ candle: candle(20), newSignals: [signal(id, 20, direction)] });
    ledger.push({ candle: candle(21, high, low) });
    const record = ledger.getById(id);
    assert.equal(record.lifecycle.status, expected);
    assert.equal(record.lifecycle.exitPrice, expectedPrice);
    assert.equal(record.events[1].availableAt, t(21));
    assert.equal(ledger.diagnostics.active, 0);
    ledger.push({ candle: candle(22, 105, 95) });
    assert.equal(ledger.getById(id).events.length, 2);
  }
});

test("same-candle TP and SL yields ambiguous exit for both directions", () => {
  for (const direction of ["BUY", "SELL"]) {
    const ledger = createSignalLedger();
    ledger.push({ candle: candle(20), newSignals: [signal(direction, 20, direction)] });
    ledger.push({ candle: candle(21, 104.5, 95.5) });
    const outcome = ledger.getById(direction);
    assert.equal(outcome.lifecycle.status, "AMBIGUOUS_EXIT");
    assert.equal(outcome.lifecycle.exitPrice, null);
    assert.equal(outcome.events[1].tpTouched, true);
    assert.equal(outcome.events[1].slTouched, true);
    assert.equal(outcome.events[1].reason, "OHLC_SEQUENCE_UNKNOWN");
  }
});

test("pre-signal and signal-candle extremes do not cause hindsight exit", () => {
  const ledger = createSignalLedger();
  ledger.push({ candle: candle(19, 105, 97) });
  ledger.push({ candle: candle(20, 105, 97), newSignals: [signal("later")] });
  assert.equal(ledger.getById("later").lifecycle.status, "ACTIVE");
  ledger.push({ candle: candle(21, 103, 99) });
  assert.equal(ledger.getById("later").lifecycle.status, "ACTIVE");
  ledger.push({ candle: candle(22, 104.1, 99) });
  assert.equal(ledger.getById("later").lifecycle.status, "TP_HIT");
});

test("as-of query hides future outcome while preserving original decision", () => {
  const ledger = createSignalLedger();
  ledger.push({ candle: candle(20), newSignals: [signal("as-of")] });
  ledger.push({ candle: candle(30) });
  ledger.push({ candle: candle(50, 104.5, 99) });
  const earlier = ledger.getById("as-of", t(30));
  const later = ledger.getById("as-of", t(55));
  assert.equal(earlier.lifecycle.status, "ACTIVE");
  assert.equal(earlier.events.length, 1);
  assert.equal(later.lifecycle.status, "TP_HIT");
  assert.equal(ledger.getById("as-of", t(19)), null);
  assert.equal(earlier.signal.entryPrice, later.signal.entryPrice);
  assert.equal(earlier.signal.stopLoss, later.signal.stopLoss);
  assert.equal(earlier.signal.takeProfit, later.signal.takeProfit);
  assert.equal(earlier.signal.rr, later.signal.rr);
  assert.equal(ledger.getSignalsInRange(t(20), t(60), t(30))[0]
    .lifecycle.status, "ACTIVE");
  assert.deepEqual(ledger.getLifecycleEventsThrough(t(30)).map((item) => item.type),
    ["ACTIVATED"]);
  assert.deepEqual(ledger.getLifecycleEventsThrough(t(55)).map((item) => item.type),
    ["ACTIVATED", "TP_HIT"]);
});

test("range is half-open; latest, previous and chart DTO use ordered lookup", () => {
  const ledger = createSignalLedger();
  for (const minute of [0, 60, 120, 180]) {
    ledger.push({ candle: candle(minute), newSignals: [signal(`s${minute}`, minute)] });
  }
  assert.deepEqual(ledger.getSignalsInRange(t(60), t(180)).map((item) =>
    item.signal.id), ["s60", "s120"]);
  assert.equal(ledger.getLatestSignal(t(150)).signal.id, "s120");
  assert.equal(ledger.getPreviousSignal("s120").signal.id, "s60");
  assert.equal(ledger.getPreviousSignal("s120", t(60)), null);
  assert.equal(ledger.getLatestSignal(t(-1)), null);
  assert.deepEqual(ledger.getSignalEventsThrough(t(60)).map((item) => item.id),
    ["s0", "s60"]);
  const dto = ledger.getHistoryItemsInRange(t(60), t(180), t(90));
  assert.deepEqual(dto.map((item) => item.signalId), ["s60"]);
  assert.equal(dto[0].lifecycleStatus, "ACTIVE");
  const chart = ledger.getChartItemsInRange(t(60), t(180), t(90));
  assert.equal(chart[0].timestamp, t(60));
  assert.equal(chart[0].stopLoss, 98);
  assert.equal("color" in chart[0], false);
});

test("same-time independent signals are sorted by ID and multiple daily signals remain", () => {
  const ledger = createSignalLedger();
  ledger.push({ candle: candle(20), newSignals: [signal("z"), signal("a")] });
  ledger.push({ candle: candle(25), newSignals: [signal("next", 25)] });
  assert.deepEqual(ledger.getSignalEventsThrough(t(25)).map((item) => item.id),
    ["a", "z", "next"]);
  assert.equal(ledger.getLatestSignal(t(20)).signal.id, "z");
  assert.equal(ledger.getPreviousSignal("z").signal.id, "a");
  assert.equal(ledger.diagnostics.maxSimultaneousActive, 3);
});

test("unordered batch signals match incremental replay and preserve prefix", () => {
  const candles = [candle(20), candle(21, 104.2, 99), candle(25),
    candle(26, 101, 97.5), candle(30)];
  const first = signal("first", 20);
  const second = signal("second", 25);
  const historical = batch(candles, [second, first]);
  assert.equal(historical.status, "READY");
  const live = createSignalLedger();
  live.push({ candle: candles[0], newSignals: [first] });
  const prefixSignal = structuredClone(live.getById("first").signal);
  const prefixEvents = structuredClone(live.getLifecycleEventsThrough(t(20)));
  live.push({ candle: candles[1] });
  live.push({ candle: candles[2], newSignals: [second] });
  live.push({ candle: candles[3] });
  live.push({ candle: candles[4] });
  assert.deepEqual(live.getSignalEventsThrough(Infinity),
    historical.ledger.getSignalEventsThrough(Infinity));
  assert.deepEqual(live.getLifecycleEventsThrough(Infinity),
    historical.ledger.getLifecycleEventsThrough(Infinity));
  assert.deepEqual(live.diagnostics, historical.diagnostics);
  assert.deepEqual(live.getById("first").signal, prefixSignal);
  assert.deepEqual(live.getLifecycleEventsThrough(t(20)), prefixEvents);
  assert.equal(live.getById("first", t(20)).lifecycle.status, "ACTIVE");
  assert.equal(live.getById("first").lifecycle.status, "TP_HIT");
  assert.equal(live.getById("second").lifecycle.status, "SL_HIT");
});

test("out-of-order candles, late signals and conflicting duplicate IDs reject", () => {
  const ledger = createSignalLedger();
  ledger.push({ candle: candle(20), newSignals: [signal("order")] });
  assert.throws(() => ledger.push({ candle: candle(19) }), { code: "INPUT_ORDER" });
  assert.throws(() => ledger.push({ candle: candle(21),
    newSignals: [signal("late", 19)] }), { code: "LATE_SIGNAL" });
  assert.throws(() => ledger.push({ candle: candle(21),
    newSignals: [{ ...signal("order"), takeProfit: 105 }] }),
  { code: "DUPLICATE_CONFLICT" });
  assert.equal(ledger.signalCount, 1);
});

test("historical batch blocks a first-time signal without its source candle", () => {
  const result = batch([candle(20), candle(22)], [signal("missing", 21)]);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.diagnostics.errorCode, "SIGNAL_WITHOUT_CANDLE");
});
