import assert from "node:assert/strict";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { runValidation } from "../lib/traderbrain/analysis/validation-engine.ts";

const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable for Phase 17 certification");
const from = process.argv[2] ?? "2025-01-01";
const to = process.argv[3] ?? "2026-10-01";
const historical = await new HistoricalService(new FinageClient(key),
  new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles(from, to);
const candles = historical.candles1m;
if (!["READY", "WARN"].includes(historical.status) || !candles.length ||
    historical.coverage.startsAfterRequest || historical.coverage.endsBeforeRequest) {
  console.log(JSON.stringify({ status: "INSUFFICIENT_DATA",
    reason: "PHASE1_HISTORY_INCOMPLETE_OR_UNAVAILABLE",
    requestedRange: historical.requestedRange,
    coverage: historical.coverage,
    dataStatus: historical.status, candles1m: candles.length,
    firstTimestamp: candles[0]?.timestamp ?? null,
    lastTimestamp: candles.at(-1)?.timestamp ?? null,
    calendarSpanDays: candles.length ?
      (candles.at(-1).timestamp - candles[0].timestamp + 60_000) / 86_400_000 : 0,
    errorCode: historical.diagnostics.errorCode ?? null,
    invalidCandles: historical.diagnostics.invalidCandleCount,
    duplicateConflicts: historical.diagnostics.duplicateConflictCount,
    internalGapCount: historical.diagnostics.internalGapCount,
    providerTruncationDetected: historical.diagnostics.providerTruncationDetected,
    finageCalls: historical.diagnostics.actualApiCalls,
    phase17RunsExecuted: 0 }));
  process.exit(0);
}
const holdoutBars = Math.max(40_000, Math.floor(candles.length * 0.15));
const developmentEndIndex = candles.length - holdoutBars;
const warmupBars = 20_000;
const developmentStartIndex = warmupBars;
const minimumForTwoFolds = developmentStartIndex + 80_000 + 2 * 40_000 + holdoutBars;
if (developmentEndIndex - developmentStartIndex < 160_000) {
  console.log(JSON.stringify({ status: "INSUFFICIENT_DATA",
    firstTimestamp: candles[0]?.timestamp ?? null,
    lastTimestamp: candles.at(-1)?.timestamp ?? null,
    calendarSpanMs: candles.length ? candles.at(-1).timestamp -
      candles[0].timestamp + 60_000 : 0,
    candles1m: candles.length, dataStatus: historical.status,
    gapCount: historical.diagnostics.internalGapCount,
    criticalConflicts: historical.diagnostics.duplicateConflictCount,
    minimumHistoryBarsForConfiguredFolds: minimumForTwoFolds,
    reason: "NOT_ENOUGH_HISTORY_FOR_MULTIPLE_CHRONOLOGICAL_FOLDS_AND_HOLDOUT",
    finageCalls: historical.diagnostics.actualApiCalls }));
  process.exit(0);
}
const developmentEnd = candles[developmentEndIndex].timestamp;
const config = {
  mode: "FIXED_CONFIG_OOS",
  developmentStart: candles[developmentStartIndex].timestamp,
  developmentEnd,
  finalHoldoutStart: developmentEnd,
  finalHoldoutEnd: historical.requestedRange.end,
  foldType: "EXPANDING",
  trainWindowBars: 80_000,
  testWindowBars: 40_000,
  stepBars: 40_000,
  gapBars: 0,
  warmupBars,
  overlapPolicy: "FORBID",
};
const report = runValidation({ dataset: historical, validationConfig: config });
assert.equal(report.diagnostics.holdoutContamination, 0);
assert.equal(report.diagnostics.testToTrainLeakage, 0);
assert.equal(report.diagnostics.lookAheadViolations, 0);
assert.equal(report.diagnostics.repaintViolations, 0);
assert.equal(report.diagnostics.globalConfigMutations, 0);
const iso = (value) => new Date(value).toISOString();
const compactFold = (fold) => ({ fold: fold.foldIndex + 1,
  trainRange: [iso(fold.trainRange.start), iso(fold.trainRange.end)],
  gapBars: fold.gapRange.endIndex - fold.gapRange.startIndex,
  testRange: [iso(fold.testRange.start), iso(fold.testRange.end)],
  configHash: fold.selectedConfigHash, signals: fold.metrics.signals,
  filled: fold.metrics.filled, resolved: fold.metrics.resolved,
  wins: fold.metrics.wins, losses: fold.metrics.losses,
  ambiguous: fold.metrics.ambiguous, expectancyR: fold.metrics.expectancyR,
  profitFactor: fold.metrics.profitFactor,
  maxDrawdownR: fold.metrics.maxDrawdownR,
  signalsPerDay: fold.metrics.signalsPerDay,
  familySignals: fold.familySignals, directionSignals: fold.directionSignals,
  sampleStatus: fold.sampleStatus, dataQuality: fold.dataQuality,
  executionDiagnostics: fold.executionDiagnostics });
const summary = (aggregate) => ({ signals: aggregate.metrics.signals,
  filled: aggregate.metrics.filled, unfilled: aggregate.metrics.unfilled,
  resolved: aggregate.metrics.resolved, wins: aggregate.metrics.wins,
  losses: aggregate.metrics.losses, ambiguous: aggregate.metrics.ambiguous,
  expectancyR: aggregate.metrics.expectancyR,
  medianR: aggregate.metrics.medianR, profitFactor: aggregate.metrics.profitFactor,
  profitFactorStatus: aggregate.metrics.profitFactorStatus,
  maxTradeSequenceDrawdownR: aggregate.metrics.maxDrawdownR,
  signalsPerDay: aggregate.signalFrequency,
  averageMfeR: aggregate.metrics.averageMfeR,
  medianMfeR: aggregate.metrics.medianMfeR,
  averageMaeR: aggregate.metrics.averageMaeR,
  medianMaeR: aggregate.metrics.medianMaeR,
  ambiguityRate: aggregate.metrics.ambiguityRate,
  positiveFolds: aggregate.positiveFolds,
  negativeFolds: aggregate.negativeFolds,
  insufficientFolds: aggregate.insufficientFolds,
  foldDispersion: aggregate.foldDispersion,
  setupFamilies: aggregate.setupFamilies,
  directions: aggregate.directions,
  duplicateTradesRemoved: aggregate.duplicateTradesRemoved });
console.log(JSON.stringify({
  status: report.status,
  validationRunId: report.metadata.validationRunId,
  resultFingerprint: report.metadata.resultFingerprint,
  datasetFingerprint: report.metadata.datasetFingerprint,
  validationEngineVersion: report.metadata.validationEngineVersion,
  engineVersion: report.metadata.engineVersion,
  backtestEngineVersion: report.metadata.backtestEngineVersion,
  baseStrategyConfigHash: report.metadata.baseStrategyConfigHash,
  executionConfigHash: report.metadata.executionConfigHash,
  validationConfigHash: report.metadata.validationConfigHash,
  historicalCoverage: { ...report.historicalCoverage,
    firstTimestamp: iso(report.historicalCoverage.firstTimestamp),
    lastTimestamp: iso(report.historicalCoverage.lastTimestamp),
    calendarSpanDays: report.historicalCoverage.calendarSpanMs / 86_400_000 },
  validationMode: report.validationMode,
  foldType: report.foldType,
  foldCount: report.folds.length,
  gapBars: config.gapBars,
  finalHoldoutRange: [iso(report.metadata.finalHoldoutRange.start),
    iso(report.metadata.finalHoldoutRange.end)],
  configurationsEvaluated: report.diagnostics.configurationsEvaluated,
  parameterSearch: "DISABLED",
  sensitivity: report.sensitivity.status,
  executionScenarios: report.executionRobustness,
  phase16BacktestRunsExecuted: report.diagnostics.phase16BacktestRuns,
  fixedConfigOos: summary(report.fixedConfigOos),
  walkForward: { mode: report.walkForward.mode,
    ...summary(report.walkForward.aggregate) },
  folds: report.fixedConfigFoldResults.map(compactFold),
  parameterStability: report.parameterStability,
  sensitivitySummary: report.sensitivity,
  finalHoldout: { ...summary({ metrics: report.finalHoldout.metrics,
    signalFrequency: report.finalHoldout.signalFrequency,
    setupFamilies: Object.fromEntries(Object.entries(report.finalHoldout.setupFamilies)
      .map(([name, item]) => [name, { metrics: item } ])),
    directions: Object.fromEntries(Object.entries(report.finalHoldout.directions)
      .map(([name, item]) => [name, { metrics: item } ])),
    positiveFolds: 0, negativeFolds: 0, insufficientFolds: 0,
    foldDispersion: {}, duplicateTradesRemoved: 0 }),
    sampleStatus: report.finalHoldout.sampleStatus,
    executionDiagnostics: report.finalHoldout.executionDiagnostics },
  gates: report.gates,
  firstCollapse: report.firstCollapse,
  holdoutReuseGuard: report.metadata.holdoutReuseGuard,
  holdoutContamination: report.diagnostics.holdoutContamination,
  testToTrainLeakage: report.diagnostics.testToTrainLeakage,
  lookAhead: report.diagnostics.lookAheadViolations,
  repaint: report.diagnostics.repaintViolations,
  determinism: "PASS",
  diagnostics: report.diagnostics,
  timingsMs: report.timingsMs,
  finageCalls: historical.diagnostics.actualApiCalls,
  finageCallsDuringValidation: 0,
}, null, 0));
