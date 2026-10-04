import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../lib/traderbrain/data/candles.ts";
import { runBacktest } from "../lib/traderbrain/analysis/backtest-engine.ts";
import { aggregateValidationBacktests, enumerateValidationCandidates,
  generateValidationFolds, runValidation, ValidationInputError } from
  "../lib/traderbrain/analysis/validation-engine.ts";

const MINUTE = 60_000;
const origin = Date.parse("2026-01-05T00:00:00Z");
const at = (minute) => origin + minute * MINUTE;

function candles(count, changes = new Map()) {
  return Array.from({ length: count }, (_, minute) => {
    const change = changes.get(minute) ?? {};
    const open = change.open ?? 100;
    return { timestamp: at(minute), open, high: change.high ?? open + 0.4,
      low: change.low ?? open - 0.4, close: change.close ?? open,
      volume: null, symbol: "XAUUSD", timeframe: "1m" };
  });
}
function dataset(source) {
  return { status: "READY", symbol: "XAUUSD",
    requestedRange: { start: source[0].timestamp,
      end: source.at(-1).timestamp + MINUTE }, candles1m: source,
    timeframes: { "5m": aggregate(source, "5m"),
      "15m": aggregate(source, "15m"), "1h": aggregate(source, "1h") },
    coverage: { fetched: [], firstTimestamp: source[0].timestamp,
      lastTimestamp: source.at(-1).timestamp,
      startsAfterRequest: false, endsBeforeRequest: false },
    diagnostics: { requestId: "validation-test",
      requestedCalendarMinutes: source.length, estimatedInitialChunks: 1,
      plannedCalls: 0, actualApiCalls: 0, retryCount: 0, splitCount: 0,
      splits: [], providerRows: source.length, returnedCandleCount: source.length,
      firstTimestamp: source[0].timestamp, lastTimestamp: source.at(-1).timestamp,
      duplicateCount: 0, duplicateConflictCount: 0, conflicts: [],
      invalidCandleCount: 0, internalGapCount: 0,
      internalMissingMinuteCount: 0, largestGapMinutes: 0, gaps: [],
      providerTruncationDetected: false, executionMs: 0 },
    timings: { rangePlanningMs: 0, cacheLookupMs: 0, fetchMs: 0,
      normalizeMs: 0, mergeMs: 0, integrityMs: 0, aggregationMs: 0,
      totalMs: 0 } };
}
function config(overrides = {}) {
  return { mode: "FIXED_CONFIG_OOS", developmentStart: at(10),
    developmentEnd: at(70), finalHoldoutStart: at(70),
    finalHoldoutEnd: at(90), foldType: "EXPANDING", trainWindowBars: 20,
    testWindowBars: 10, stepBars: 10, gapBars: 0, warmupBars: 5,
    ...overrides };
}
function signal(id, minute, direction = "BUY", family = "CONTINUATION") {
  return { id, symbol: "XAUUSD", timeframe: "1m", direction,
    setupFamily: family, setupSubtype: "BOS_CONTINUATION",
    createdAt: at(minute), availableAt: at(minute), entryPrice: 100,
    stopLoss: direction === "BUY" ? 99 : 101,
    takeProfit: direction === "BUY" ? 102 : 98, rr: 2, rawRR: 2,
    executionAdjustedRR: null, executionCostStatus: "NOT_AVAILABLE",
    status: "ACTIVE", reasons: ["ENTRY_VALID", "RR_VALID"],
    lineage: { liquidityId: null, interactionId: null, controlTransferId: null,
      displacementEventId: `${id}:d`, structuralConfirmationId: `${id}:c`,
      fvgId: `${id}:f`, entryCandidateId: `${id}:e`,
      riskValidationId: `${id}:r` } };
}
function backtest(source, signals, range) {
  return runBacktest({ dataset: source, signals, evaluationStart: range.start,
    evaluationEnd: range.end, strategyConfigHash: "fixed",
    strategyEngineVersion: "phase15-v1" });
}
function semantic(report) {
  return { ...report, timingsMs: Object.fromEntries(
    Object.keys(report.timingsMs).map((key) => [key, 0])) };
}

test("fold generation preserves chronology, actual-bar gaps, expanding and rolling windows", () => {
  const source = dataset(candles(100));
  const expanding = generateValidationFolds(source,
    config({ gapBars: 2, developmentEnd: at(72),
      finalHoldoutStart: at(72), finalHoldoutEnd: at(92) }));
  assert.equal(expanding.length, 4);
  assert.equal(expanding[0].trainRange.startIndex, 10);
  assert.equal(expanding[0].trainRange.endIndex, 30);
  assert.equal(expanding[0].gapRange.endIndex - expanding[0].gapRange.startIndex, 2);
  assert.equal(expanding[0].testRange.startIndex, 32);
  assert.equal(expanding[1].trainRange.startIndex, 10);
  assert.equal(expanding[1].trainRange.endIndex, 40);
  assert.equal(expanding[0].warmupRange.startIndex, 5);
  const rolling = generateValidationFolds(source,
    config({ foldType: "ROLLING", gapBars: 2, developmentEnd: at(72),
      finalHoldoutStart: at(72), finalHoldoutEnd: at(92) }));
  assert.equal(rolling[1].trainRange.startIndex, 20);
  assert.equal(rolling[1].trainRange.endIndex, 40);
  for (const fold of rolling) {
    assert.ok(fold.trainRange.end <= fold.testRange.start);
    assert.ok(fold.testRange.end <= at(72));
  }
});

test("invalid chronology, holdout overlap and accidental overlapping tests reject", () => {
  const source = dataset(candles(100));
  assert.throws(() => generateValidationFolds(source,
    config({ developmentEnd: at(75), finalHoldoutStart: at(70) })),
  (error) => error instanceof ValidationInputError && error.code === "HOLDOUT_OVERLAP");
  assert.throws(() => generateValidationFolds(source,
    config({ stepBars: 5, testWindowBars: 10 })),
  (error) => error instanceof ValidationInputError &&
    error.code === "OVERLAPPING_TEST_WINDOWS");
});

test("candidate enumeration is deterministic, deduplicated and budget bounded", () => {
  const parameters = [{ phaseOwner: "psychology", configPath: "atrPeriod",
    candidateValues: [10, 10, 14], reason: "declared research range" }];
  const first = enumerateValidationCandidates({}, parameters, 3);
  const second = enumerateValidationCandidates({}, parameters, 3);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((item) => item.hash), second.map((item) => item.hash));
  assert.throws(() => enumerateValidationCandidates({}, [{ ...parameters[0],
    candidateValues: [10, 12, 14, 16] }], 3),
  (error) => error instanceof ValidationInputError &&
    error.code === "SEARCH_SPACE_TOO_LARGE");
});

test("fixed-config validation keeps warmup/train outside metrics and holdout separate", () => {
  const report = runValidation({ dataset: dataset(candles(100)),
    validationConfig: config() });
  assert.equal(report.status, "NOT_PROVEN");
  assert.equal(report.walkForward.mode, "FIXED_CONFIG_WALK_FORWARD");
  assert.equal(report.fixedConfigFoldResults.length, 4);
  assert.equal(report.fixedConfigOos.metrics.signals, 0);
  assert.equal(report.finalHoldout.metrics.signals, 0);
  assert.equal(report.diagnostics.holdoutContamination, 0);
  assert.equal(report.diagnostics.testToTrainLeakage, 0);
  assert.equal(report.diagnostics.lookAheadViolations, 0);
  assert.equal(report.metadata.holdoutReuseGuard, "NOT_PERSISTENT");
});

test("train-only selection, sensitivity and execution scenarios remain explicit", () => {
  const report = runValidation({ dataset: dataset(candles(100)),
    validationConfig: config({ mode: "WALK_FORWARD_SELECTION",
      tunableParameters: [{ phaseOwner: "psychology", configPath: "atrPeriod",
        candidateValues: [10, 14], reason: "explicit test whitelist" }],
      objectiveDefinition: { metric: "MAX_DRAWDOWN_R", direction: "MINIMIZE" },
      maximumCandidateConfigurations: 4,
      sensitivityDefinition: [{ phaseOwner: "psychology",
        configPath: "atrPeriod", testedValues: [10, 14] }],
      executionScenarios: [{ name: "FIXED_COST_SCENARIO",
        executionConfig: { costModel: "CONFIGURED_FIXED",
          configuredSpread: 0.2, configuredSlippage: 0.05 } }] }) });
  assert.equal(report.walkForward.mode, "WALK_FORWARD_SELECTION");
  assert.equal(report.diagnostics.candidateConfigurations, 2);
  assert.equal(report.walkForwardFoldResults.every((fold) =>
    fold.trainObjectiveValue === 0), true);
  assert.equal(report.sensitivity.status, "REPORT_ONLY");
  assert.equal(report.executionRobustness.length, 2);
  assert.equal(report.executionRobustness[1].kind, "SCENARIO");
  assert.equal(report.diagnostics.holdoutContamination, 0);
});

test("OOS aggregation preserves Phase 16 metrics, family and direction slices", () => {
  const source = dataset(candles(100, new Map([
    [31, { high: 102.2, low: 99.5, close: 102 }],
    [41, { high: 101.2, low: 99.5, close: 101 }],
  ])));
  const folds = generateValidationFolds(source, config());
  const signals = [signal("winner", 30, "BUY", "LIQUIDITY_REVERSAL"),
    signal("loser", 40, "SELL", "CONTINUATION")];
  const results = folds.map((fold) => backtest(source, signals, fold.testRange));
  const result = aggregateValidationBacktests(source, folds, results);
  assert.equal(result.metrics.signals, 2);
  assert.equal(result.metrics.resolved, 2);
  assert.equal(result.metrics.expectancyR, 0.5);
  assert.equal(result.metrics.profitFactor, 2);
  assert.equal(result.setupFamilies.LIQUIDITY_REVERSAL.metrics.signals, 1);
  assert.equal(result.setupFamilies.CONTINUATION.metrics.signals, 1);
  assert.equal(result.directions.BUY.metrics.signals, 1);
  assert.equal(result.directions.SELL.metrics.signals, 1);
});

test("intentionally overlapping test windows deduplicate signals in OOS aggregate", () => {
  const source = dataset(candles(100, new Map([
    [36, { high: 102.2, low: 99.5, close: 102 }],
  ])));
  const overlapConfig = config({ overlapPolicy: "DEDUPLICATE",
    stepBars: 5, testWindowBars: 10, developmentEnd: at(50) });
  const folds = generateValidationFolds(source, overlapConfig);
  const signals = [signal("overlap", 35, "BUY", "BREAKOUT_RETEST")];
  const results = folds.map((fold) => backtest(source, signals, fold.testRange));
  const result = aggregateValidationBacktests(source, folds, results);
  assert.equal(result.metrics.signals, 1);
  assert.equal(result.duplicateTradesRemoved, 1);
});

test("configured sample gates return insufficient data without retuning holdout", () => {
  const report = runValidation({ dataset: dataset(candles(100)),
    validationConfig: config({ robustnessCriteria: {
      minimumTotalOosResolvedTrades: 1,
      minimumFinalHoldoutResolvedTrades: 1 } }) });
  assert.equal(report.status, "INSUFFICIENT_DATA");
  assert.equal(report.gates.length, 2);
  assert.equal(report.gates.every((item) => item.passed === false), true);
  assert.equal(report.diagnostics.configurationsEvaluated, 1);
});

test("Phase 1 blocked or conflicted data cannot enter validation", () => {
  const source = dataset(candles(100));
  source.status = "BLOCKED";
  source.diagnostics.duplicateConflictCount = 1;
  assert.throws(() => runValidation({ dataset: source,
    validationConfig: config() }),
  (error) => error instanceof ValidationInputError &&
    error.code === "UPSTREAM_DATA_STATUS");
  source.status = "READY";
  assert.throws(() => runValidation({ dataset: source,
    validationConfig: config() }),
  (error) => error instanceof ValidationInputError &&
    error.code === "INVALID_DATASET_QUALITY");
});

test("validation is deterministic and candles after holdout cannot alter cohort metrics", () => {
  const base = dataset(candles(100));
  const first = runValidation({ dataset: base, validationConfig: config() });
  const repeat = runValidation({ dataset: base, validationConfig: config() });
  assert.deepEqual(semantic(first), semantic(repeat));
  const extended = dataset(candles(110, new Map([
    [105, { high: 150, low: 50, close: 120 }],
  ])));
  const future = runValidation({ dataset: extended, validationConfig: config() });
  assert.deepEqual(first.fixedConfigOos.metrics, future.fixedConfigOos.metrics);
  assert.deepEqual(first.finalHoldout.metrics, future.finalHoldout.metrics);
  assert.equal(first.metadata.baseStrategyConfigHash,
    future.metadata.baseStrategyConfigHash);
});
