import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../lib/traderbrain/data/candles.ts";
import { createSignalLedger } from "../lib/traderbrain/analysis/signal-ledger.ts";
import { runBacktest, runBacktestFromLedger, BacktestInputError } from
  "../lib/traderbrain/analysis/backtest-engine.ts";

const MINUTE = 60_000;
const origin = Date.parse("2026-03-02T10:00:00Z");
const at = (minute) => origin + minute * MINUTE;

function candle(minute, open = 100, high = open + 0.5,
  low = open - 0.5, close = open) {
  return { timestamp: at(minute), open, high, low, close, volume: null,
    symbol: "XAUUSD", timeframe: "1m" };
}
function dataset(candles) {
  return { status: "READY", symbol: "XAUUSD",
    requestedRange: { start: candles[0].timestamp,
      end: candles.at(-1).timestamp + MINUTE }, candles1m: candles,
    timeframes: { "5m": aggregate(candles, "5m"),
      "15m": aggregate(candles, "15m"), "1h": aggregate(candles, "1h") },
    coverage: { fetched: [], firstTimestamp: candles[0].timestamp,
      lastTimestamp: candles.at(-1).timestamp,
      startsAfterRequest: false, endsBeforeRequest: false },
    diagnostics: { requestId: "test", requestedCalendarMinutes: candles.length,
      estimatedInitialChunks: 1, plannedCalls: 0, actualApiCalls: 0,
      retryCount: 0, splitCount: 0, splits: [], providerRows: candles.length,
      returnedCandleCount: candles.length, firstTimestamp: candles[0].timestamp,
      lastTimestamp: candles.at(-1).timestamp, duplicateCount: 0,
      duplicateConflictCount: 0, conflicts: [], invalidCandleCount: 0,
      internalGapCount: 0, internalMissingMinuteCount: 0, largestGapMinutes: 0,
      gaps: [], providerTruncationDetected: false, executionMs: 0 },
    timings: { rangePlanningMs: 0, cacheLookupMs: 0, fetchMs: 0,
      normalizeMs: 0, mergeMs: 0, integrityMs: 0, aggregationMs: 0, totalMs: 0 } };
}
function signal(id, minute, direction = "BUY", family = "CONTINUATION",
  entry = 100, stop = direction === "BUY" ? 99 : 101,
  target = direction === "BUY" ? 102 : 98) {
  return { id, symbol: "XAUUSD", timeframe: "1m", direction,
    setupFamily: family, setupSubtype: "BOS_CONTINUATION",
    createdAt: at(minute), availableAt: at(minute), entryPrice: entry,
    stopLoss: stop, takeProfit: target,
    rr: Math.abs(target - entry) / Math.abs(entry - stop),
    rawRR: Math.abs(target - entry) / Math.abs(entry - stop),
    executionAdjustedRR: null, executionCostStatus: "NOT_AVAILABLE",
    status: "ACTIVE", reasons: ["ENTRY_VALID", "RR_VALID"],
    lineage: { liquidityId: null, interactionId: null, controlTransferId: null,
      displacementEventId: `${id}:d`, structuralConfirmationId: `${id}:c`,
      fvgId: `${id}:f`, entryCandidateId: `${id}:e`,
      riskValidationId: `${id}:r` } };
}
function run(candles, signals, executionConfig = {}, extra = {}) {
  return runBacktest({ dataset: dataset(candles), signals,
    evaluationStart: candles[0].timestamp,
    evaluationEnd: candles.at(-1).timestamp + MINUTE,
    strategyConfigHash: "strategy", strategyEngineVersion: "phase15-v1",
    executionConfig, ...extra });
}

test("same-close entry ignores pre-signal extremes and matches Phase 14 lifecycle", () => {
  const candles = [candle(0, 100, 105, 95, 100),
    candle(1, 100, 101, 99.2, 100), candle(2, 100, 102.2, 99.5, 102)];
  const source = signal("same-close", 0);
  const ledger = createSignalLedger();
  for (const item of candles) ledger.push({ candle: item,
    newSignals: item.timestamp === source.availableAt ? [source] : [] });
  const result = runBacktestFromLedger({ dataset: dataset(candles), phase14Ledger: ledger,
    evaluationStart: at(0), evaluationEnd: at(3), strategyConfigHash: "strategy",
    strategyEngineVersion: "phase15-v1" });
  assert.equal(result.trades[0].fillAt, at(0));
  assert.equal(result.trades[0].outcome, "WIN");
  assert.equal(result.trades[0].exitAt, at(2));
  assert.equal(result.diagnostics.phase14Matches, 1);
  assert.deepEqual(result.diagnostics.phase14Differences, []);
});

test("next-bar market uses actual open; active stop and target gaps use explicit policies", () => {
  const nextOpen = run([candle(0), candle(1, 100.5, 101, 99.5, 100.5)],
    [signal("next-open", 0)], { entryExecutionMode: "NEXT_BAR_OPEN" });
  assert.equal(nextOpen.trades[0].rawEntryPrice, 100.5);
  assert.equal(nextOpen.trades[0].outcome, "OPEN_AT_DATA_END");

  const stopGap = run([candle(0), candle(1, 97, 98, 96, 97)],
    [signal("stop-gap", 0)]);
  assert.equal(stopGap.trades[0].rawEntryPrice, 100);
  assert.equal(stopGap.trades[0].rawExitPrice, 97);
  assert.equal(stopGap.trades[0].outcome, "LOSS");

  const targetGap = run([candle(0), candle(1, 103, 104, 102.5, 103)],
    [signal("target-gap", 0)]);
  assert.equal(targetGap.trades[0].rawEntryPrice, 100);
  assert.equal(targetGap.trades[0].rawExitPrice, 102);
  assert.equal(targetGap.trades[0].outcome, "WIN");
});

test("BUY, SELL and both-boundary candles use directional causal exits", () => {
  for (const [direction, bar, outcome] of [
    ["BUY", candle(1, 100, 102.1, 99.2, 101), "WIN"],
    ["BUY", candle(1, 100, 100.5, 98.9, 99), "LOSS"],
    ["SELL", candle(1, 100, 100.8, 97.9, 98), "WIN"],
    ["SELL", candle(1, 100, 101.1, 99.5, 101), "LOSS"],
  ]) {
    const result = run([candle(0), bar], [signal(`${direction}-${outcome}`, 0, direction)]);
    assert.equal(result.trades[0].outcome, outcome);
  }
  const ambiguous = run([candle(0), candle(1, 100, 102.2, 98.8, 100)],
    [signal("both", 0)]);
  assert.equal(ambiguous.trades[0].outcome, "AMBIGUOUS_EXIT");
  assert.equal(ambiguous.trades[0].grossR, null);
  assert.equal(ambiguous.summary.resolvedWinRateDenominator, 0);
});

test("limit entry starts after availability, uses conservative trade-through and marks same-bar ambiguity", () => {
  const source = signal("limit", 1);
  const result = run([candle(0, 100, 101, 99, 100),
    candle(1, 100, 101, 99, 100), candle(2, 101, 102.2, 99.5, 101)],
  [source], { entryExecutionMode: "LIMIT_AFTER_SIGNAL" });
  assert.equal(result.trades[0].fillAt, at(2));
  assert.equal(result.trades[0].outcome, "AMBIGUOUS_ENTRY_EXIT");

  const unfilled = run([candle(0), candle(1, 101, 101.5, 100, 101),
    candle(2, 101, 102, 100, 101)],
    [signal("unfilled", 0)], { entryExecutionMode: "LIMIT_AFTER_SIGNAL" });
  assert.equal(unfilled.trades[0].outcome, "UNFILLED");
  assert.equal(unfilled.summary.unfilledSignals, 1);
});

test("configured spread and slippage are deterministic, adverse and direction-aware", () => {
  const config = { costModel: "CONFIGURED_FIXED", configuredSpread: 0.2,
    configuredSlippage: 0.05 };
  const buy = run([candle(0), candle(1, 100, 102.1, 99.5, 102)],
    [signal("cost-buy", 0)], config);
  assert.equal(buy.trades[0].simulatedEntryPrice, 100.15);
  assert.equal(buy.trades[0].simulatedExitPrice, 101.85);
  assert.equal(buy.summary.adjusted.status, "AVAILABLE");
  assert.ok(buy.trades[0].netR < buy.trades[0].grossR);

  const sell = run([candle(0), candle(1, 100, 100.5, 97.9, 98)],
    [signal("cost-sell", 0, "SELL")], config);
  assert.equal(sell.trades[0].simulatedEntryPrice, 99.85);
  assert.equal(sell.trades[0].simulatedExitPrice, 98.15);
  assert.deepEqual(
    { ...buy, timingMs: 0 },
    { ...run([candle(0), candle(1, 100, 102.1, 99.5, 102)],
      [signal("cost-buy", 0)], config), timingMs: 0 });
});

test("MFE and MAE update online, normalize by fixed risk and ATR, and stop at exit", () => {
  const atr = new Map([["excursion:r", 2]]);
  const result = run([candle(0), candle(1, 100, 101, 99.5, 100),
    candle(2, 100, 102, 98.5, 100), candle(3, 100, 103.1, 99, 103),
    candle(4, 100, 150, 50, 100)],
  [signal("excursion", 0, "BUY", "CONTINUATION", 100, 98, 103)], {},
  { referenceAtrByRiskValidationId: atr });
  const trade = result.trades[0];
  assert.equal(trade.outcome, "WIN");
  assert.equal(trade.mfePrice, 3);
  assert.equal(trade.maePrice, 1.5);
  assert.equal(trade.mfeR, 1.5);
  assert.equal(trade.maeR, 0.75);
  assert.equal(trade.mfeAtr, 1.5);
  assert.equal(trade.maeAtr, 0.75);
  assert.equal(trade.timeToMfeBars, 3);
  assert.equal(trade.timeToMaeBars, 2);
});

test("SELL MFE and MAE use inverse extrema without post-exit movement", () => {
  const result = run([candle(0), candle(1, 100, 100.5, 99, 100),
    candle(2, 100, 101.5, 98, 100), candle(3, 100, 101, 96.9, 97),
    candle(4, 100, 150, 50, 100)],
  [signal("sell-excursion", 0, "SELL", "CONTINUATION", 100, 102, 97)]);
  const trade = result.trades[0];
  assert.equal(trade.outcome, "WIN");
  assert.equal(trade.mfePrice, 3);
  assert.equal(trade.maePrice, 1.5);
  assert.equal(trade.mfeR, 1.5);
  assert.equal(trade.maeR, 0.75);
});

test("strict range leaves active trades open and future candles cannot alter the report", () => {
  const prefix = [candle(0), candle(1, 100, 101, 99.5, 100)];
  const full = [...prefix, candle(2, 100, 103, 99.5, 102)];
  const source = signal("strict", 0);
  const first = runBacktest({ dataset: dataset(full), signals: [source],
    evaluationStart: at(0), evaluationEnd: at(2), strategyConfigHash: "strategy",
    strategyEngineVersion: "phase15-v1" });
  const second = run(prefix, [source]);
  assert.equal(first.trades[0].outcome, "OPEN_AT_DATA_END");
  assert.deepEqual({ ...first, timingMs: 0,
    metadata: { ...first.metadata, datasetFingerprint: "ignored",
      resultFingerprint: "ignored", runId: "ignored" } },
  { ...second, timingMs: 0,
    metadata: { ...second.metadata, datasetFingerprint: "ignored",
      resultFingerprint: "ignored", runId: "ignored" } });
});

test("known R sequence produces expectancy, profit factor, drawdown, streaks and family stats", () => {
  const candles = [candle(0), candle(1, 100, 102.1, 99.5, 102),
    candle(2), candle(3, 100, 100.5, 98.9, 99),
    candle(4), candle(5, 100, 100.5, 98.9, 99),
    candle(6), candle(7, 100, 100.5, 98.9, 99)];
  const signals = [
    signal("r1", 0, "BUY", "LIQUIDITY_REVERSAL", 100, 99, 102),
    signal("r2", 2, "BUY", "CONTINUATION", 100, 99, 102),
    signal("r3", 4, "SELL", "COMPRESSION_EXPANSION", 100, 101, 99),
    signal("r4", 6, "BUY", "BREAKOUT_RETEST", 100, 99, 102),
  ];
  const result = run(candles, signals);
  assert.equal(result.summary.raw.expectancyR, 0.25);
  assert.equal(result.summary.raw.profitFactor, 1.5);
  assert.equal(result.summary.maxTradeSequenceDrawdownR, 1);
  assert.equal(result.summary.maxConsecutiveWins, 1);
  assert.equal(result.summary.maxConsecutiveLosses, 1);
  for (const family of ["LIQUIDITY_REVERSAL", "CONTINUATION",
    "COMPRESSION_EXPANSION", "BREAKOUT_RETEST"]) {
    assert.equal(result.setupFamilies[family].signals, 1);
  }
  assert.equal(result.directions.BUY.signals, 3);
  assert.equal(result.directions.SELL.signals, 1);
});

test("duplicates are idempotent, conflicts reject, and no-loss profit factor is explicit", () => {
  const source = signal("same", 0);
  const result = run([candle(0), candle(1, 100, 102.1, 99.5, 102)],
    [source, source]);
  assert.equal(result.trades.length, 1);
  assert.equal(result.diagnostics.duplicateSignals, 1);
  assert.equal(result.summary.raw.profitFactor, null);
  assert.equal(result.summary.raw.profitFactorStatus, "NO_NEGATIVE_TRADES");
  assert.throws(() => run([candle(0), candle(1)],
    [source, { ...source, entryPrice: 100.1 }]), BacktestInputError);
});

test("independent simultaneous signals retain separate active state", () => {
  const signals = [signal("parallel-buy", 0),
    signal("parallel-sell", 0, "SELL")];
  const result = run([candle(0), candle(1, 100, 100.5, 99.5, 100)], signals);
  assert.equal(result.trades.length, 2);
  assert.equal(result.trades.every((trade) => trade.outcome === "OPEN_AT_DATA_END"), true);
  assert.equal(result.diagnostics.maxSimultaneousActiveTrades, 2);
});
