import type { HistoricalResult, Interval } from "../data/types.ts";
import { BACKTEST_ENGINE_VERSION, DEFAULT_BACKTEST_EXECUTION_CONFIG,
  fingerprintBacktestExecutionConfig, runBacktest, summarizeBacktestTrades,
  type BacktestExecutionConfig, type BacktestResult, type BacktestSummary,
  type BacktestTrade } from "./backtest-engine.ts";
import { createReplaySession, deterministicValueHash, fingerprintHistoricalDataset,
  fingerprintReplayConfig, REPLAY_ENGINE_VERSION, type ReplayPipelineConfig } from
  "./replay-engine.ts";
import type { SignalAction, SetupFamily } from "./signal-decision.ts";
import { DEFAULT_CANDLE_PSYCHOLOGY_CONFIG } from "./candle-psychology.ts";
import { DEFAULT_MARKET_STRUCTURE_CONFIG } from "./market-structure.ts";
import { DEFAULT_LIQUIDITY_CONFIG } from "./liquidity.ts";
import { DEFAULT_PRICE_APPROACH_CONFIG } from "./price-approach.ts";
import { DEFAULT_LIQUIDITY_INTERACTION_CONFIG } from "./liquidity-interaction.ts";
import { DEFAULT_CONTROL_CONFIG } from "./control-engine.ts";
import { DEFAULT_DISPLACEMENT_CONFIG } from "./displacement-engine.ts";
import { DEFAULT_STRUCTURAL_CONFIRMATION_CONFIG } from "./structural-confirmation.ts";
import { DEFAULT_FVG_CONFIG } from "./fvg-entry-location.ts";
import { DEFAULT_ENTRY_CANDIDATE_CONFIG } from "./entry-candidate.ts";
import { DEFAULT_RISK_VALIDATION_CONFIG } from "./risk-validation.ts";

export const VALIDATION_ENGINE_VERSION = "phase17-v1";
const FAMILIES: readonly SetupFamily[] = ["LIQUIDITY_REVERSAL", "CONTINUATION",
  "COMPRESSION_EXPANSION", "BREAKOUT_RETEST"];
const DIRECTIONS: readonly SignalAction[] = ["BUY", "SELL"];
const MINUTE_MS = 60_000;
const CONFIG_FIELDS: Readonly<Record<keyof ReplayPipelineConfig, readonly string[]>> =
  Object.freeze({
    psychology: Object.keys(DEFAULT_CANDLE_PSYCHOLOGY_CONFIG),
    structure: Object.keys(DEFAULT_MARKET_STRUCTURE_CONFIG),
    liquidity: Object.keys(DEFAULT_LIQUIDITY_CONFIG),
    approach: Object.keys(DEFAULT_PRICE_APPROACH_CONFIG),
    interaction: Object.keys(DEFAULT_LIQUIDITY_INTERACTION_CONFIG),
    control: Object.keys(DEFAULT_CONTROL_CONFIG),
    displacement: Object.keys(DEFAULT_DISPLACEMENT_CONFIG),
    confirmation: Object.keys(DEFAULT_STRUCTURAL_CONFIRMATION_CONFIG),
    fvg: Object.keys(DEFAULT_FVG_CONFIG),
    entry: Object.keys(DEFAULT_ENTRY_CANDIDATE_CONFIG),
    risk: Object.keys(DEFAULT_RISK_VALIDATION_CONFIG),
  });

export type ValidationMode = "FIXED_CONFIG_OOS" | "WALK_FORWARD_SELECTION";
export type FoldType = "EXPANDING" | "ROLLING";
export type CertificationStatus = "ROBUST_PASS" | "CONDITIONAL" | "FAIL" |
  "INSUFFICIENT_DATA" | "BLOCKED" | "NOT_PROVEN";

export type TunableParameter = Readonly<{
  phaseOwner: keyof ReplayPipelineConfig;
  configPath: string;
  candidateValues: readonly (number | boolean | string)[];
  reason: string;
}>;
export type SelectionObjective = Readonly<{
  metric: "EXPECTANCY_R" | "PROFIT_FACTOR" | "MAX_DRAWDOWN_R";
  direction: "MAXIMIZE" | "MINIMIZE";
  minimumResolvedTrades?: number;
  maximumDrawdownR?: number;
}>;
export type SensitivityParameter = Readonly<{
  phaseOwner: keyof ReplayPipelineConfig;
  configPath: string;
  testedValues: readonly (number | boolean | string)[];
}>;
export type ExecutionScenario = Readonly<{
  name: string;
  executionConfig: Partial<BacktestExecutionConfig>;
}>;
export type RobustnessCriteria = Readonly<{
  minimumTotalOosResolvedTrades?: number;
  minimumValidFolds?: number;
  minimumOosExpectancyR?: number;
  maximumOosDrawdownR?: number;
  minimumActiveFamilies?: number;
  maximumFoldExpectancyStandardDeviation?: number;
  minimumFinalHoldoutResolvedTrades?: number;
}>;

export type ValidationConfig = Readonly<{
  mode: ValidationMode;
  developmentStart: number;
  developmentEnd: number;
  finalHoldoutStart: number;
  finalHoldoutEnd: number;
  foldType: FoldType;
  trainWindowBars: number;
  testWindowBars: number;
  stepBars: number;
  gapBars: number;
  warmupBars: number;
  overlapPolicy?: "FORBID" | "DEDUPLICATE";
  minimumTradesPerFold?: number;
  minimumHistoryBars?: number;
  minimumActiveTradingDays?: number;
  tunableParameters?: readonly TunableParameter[];
  objectiveDefinition?: SelectionObjective;
  maximumCandidateConfigurations?: number;
  sensitivityDefinition?: readonly SensitivityParameter[];
  executionScenarios?: readonly ExecutionScenario[];
  robustnessCriteria?: RobustnessCriteria;
}>;

export type IndexedRange = Readonly<Interval & { startIndex: number; endIndex: number }>;
export type ValidationFold = Readonly<{
  id: string;
  index: number;
  warmupRange: IndexedRange;
  trainRange: IndexedRange;
  gapRange: IndexedRange;
  testRange: IndexedRange;
  requestedWarmupBars: number;
  datasetFingerprint: string;
}>;

export type CompactMetrics = Readonly<{
  signals: number;
  filled: number;
  unfilled: number;
  resolved: number;
  wins: number;
  losses: number;
  ambiguous: number;
  fillRate: number | null;
  expectancyR: number | null;
  netExpectancyR: number | null;
  medianR: number | null;
  profitFactor: number | null;
  netProfitFactor: number | null;
  profitFactorStatus: BacktestSummary["raw"]["profitFactorStatus"];
  netProfitFactorStatus: BacktestSummary["raw"]["profitFactorStatus"] | null;
  maxDrawdownR: number;
  signalsPerDay: number | null;
  averageMfeR: number | null;
  medianMfeR: number | null;
  averageMaeR: number | null;
  medianMaeR: number | null;
  ambiguityRate: number | null;
}>;
export type FoldResult = Readonly<{
  foldId: string;
  foldIndex: number;
  trainRange: IndexedRange;
  gapRange: IndexedRange;
  testRange: IndexedRange;
  selectedConfigHash: string;
  selectedValues: Readonly<Record<string, number | boolean | string>>;
  trainObjectiveValue: number | null;
  metrics: CompactMetrics;
  familySignals: Readonly<Record<SetupFamily, number>>;
  directionSignals: Readonly<Record<SignalAction, number>>;
  backtestRunId: string;
  executionConfigHash: string;
  executionDiagnostics: Readonly<{ maxSimultaneousActiveTrades: number;
    maxPendingSignals: number; configuredCostScenario: boolean;
    historicalSpreadStatus: "HISTORICAL_SPREAD_NOT_AVAILABLE" }>;
  sampleStatus: "VALID" | "INSUFFICIENT_SAMPLE";
  dataQuality: Readonly<{ candleCount: number; dataStatus: HistoricalResult["status"];
    gapCount: number; criticalConflicts: number; warmupCandles: number;
    warmupSufficient: boolean }>;
}>;
export type Dispersion = Readonly<{ count: number; mean: number | null;
  median: number | null; min: number | null; max: number | null;
  standardDeviation: number | null }>;
export type RobustnessSlice = Readonly<{
  metrics: CompactMetrics;
  foldsActive: number;
  positiveFolds: number;
  negativeFolds: number;
  signalShare: number | null;
  totalRShare: number | null;
}>;
export type AggregateOos = Readonly<{
  metrics: CompactMetrics;
  summary: BacktestSummary;
  setupFamilies: Readonly<Record<SetupFamily, RobustnessSlice>>;
  directions: Readonly<Record<SignalAction, RobustnessSlice>>;
  positiveFolds: number;
  negativeFolds: number;
  insufficientFolds: number;
  duplicateTradesRemoved: number;
  signalFrequency: Readonly<{ days: number; total: number; mean: number | null;
    median: number | null; min: number | null; max: number | null;
    zeroSignalDays: number }>;
  foldDispersion: Readonly<{ expectancyR: Dispersion;
    signalsPerDay: Dispersion; maxDrawdownR: Dispersion }>;
}>;
export type SensitivityResult = Readonly<{
  status: "DISABLED" | "REPORT_ONLY";
  variants: readonly Readonly<{ parameter: string; baseValue: unknown;
    testedValue: unknown; configHash: string; metrics: CompactMetrics;
    expectancyChange: number | null; signalCountChange: number }>[];
  observations: readonly string[];
}>;
export type ExecutionRobustnessResult = Readonly<{
  name: string;
  kind: "BASELINE" | "SCENARIO";
  executionConfigHash: string;
  metrics: CompactMetrics;
  comparedExpectancyChange: number | null;
  comparisonMetric: "RAW_EXPECTANCY_R" | "SCENARIO_NET_VS_BASELINE_RAW";
  filledChange: number;
}>;
export type GateResult = Readonly<{ name: string; actual: number | null;
  operator: ">=" | "<="; required: number; passed: boolean; reason: string }>;
export type ValidationReport = Readonly<{
  status: CertificationStatus;
  metadata: Readonly<{ validationRunId: string; resultFingerprint: string;
    validationEngineVersion: string; datasetFingerprint: string;
    engineVersion: string; backtestEngineVersion: string;
    baseStrategyConfigHash: string; executionConfigHash: string;
    validationConfigHash: string; developmentRange: Interval;
    finalHoldoutRange: Interval; holdoutReuseGuard: "NOT_PERSISTENT" }>;
  historicalCoverage: Readonly<{ firstTimestamp: number; lastTimestamp: number;
    calendarSpanMs: number; activeTradingDays: number; candles1m: number;
    dataStatus: HistoricalResult["status"]; gapCount: number;
    criticalConflicts: number }>;
  validationMode: ValidationMode;
  foldType: FoldType;
  folds: readonly ValidationFold[];
  fixedConfigFoldResults: readonly FoldResult[];
  walkForwardFoldResults: readonly FoldResult[];
  fixedConfigOos: AggregateOos;
  walkForward: Readonly<{ mode: "FIXED_CONFIG_WALK_FORWARD" |
    "WALK_FORWARD_SELECTION"; aggregate: AggregateOos }>;
  finalHoldout: Readonly<{ metrics: CompactMetrics; summary: BacktestSummary;
    setupFamilies: BacktestResult["setupFamilies"];
    directions: BacktestResult["directions"]; executionDiagnostics:
    BacktestResult["diagnostics"]; signalFrequency: AggregateOos["signalFrequency"];
    sampleStatus: "VALID" | "INSUFFICIENT_SAMPLE" }>;
  parameterStability: Readonly<{ status: "STABLE" | "UNSTABLE" | "NOT_APPLICABLE";
    changes: number; changeRate: number | null;
    valuesByParameter: Readonly<Record<string, readonly unknown[]>> }>;
  sensitivity: SensitivityResult;
  executionRobustness: readonly ExecutionRobustnessResult[];
  firstCollapse: Readonly<{ foldId: string; previousFoldId: string;
    changes: Readonly<Record<string, number | null>> }> | null;
  gates: readonly GateResult[];
  diagnostics: Readonly<{ holdoutContamination: number; testToTrainLeakage: number;
    lookAheadViolations: number; repaintViolations: number;
    overlappingTestWindows: number; phase16BacktestRuns: number;
    configurationsEvaluated: number; candidateConfigurations: number;
    sensitivityVariants: number; executionScenarios: number;
    replayRuns: number; cacheHits: number; totalCandlesProcessed: number;
    globalConfigMutations: number; strategyLogicDuplicated: 0;
    backtestLogicDuplicated: 0; signalRegenerationImplementations: 0;
    finageProviderDuplications: 0 }>;
  timingsMs: Readonly<{ foldGeneration: number; signalGeneration: number;
    baselineOos: number; walkForwardTraining: number; walkForwardTests: number;
    sensitivity: number; executionScenarios: number; finalHoldout: number;
    total: number }>;
}>;

export type ValidationInput = Readonly<{
  dataset: HistoricalResult;
  baseStrategyConfig?: ReplayPipelineConfig;
  executionConfig?: Partial<BacktestExecutionConfig>;
  validationConfig: ValidationConfig;
}>;

export class ValidationInputError extends Error {
  constructor(readonly code: "PHASE_16_NOT_FROZEN" | "UPSTREAM_DATA_STATUS" |
    "INVALID_CONFIG" | "INVALID_RANGE" | "NO_FOLDS" | "HOLDOUT_OVERLAP" |
    "OVERLAPPING_TEST_WINDOWS" | "SELECTION_SPEC_REQUIRED" |
    "SEARCH_SPACE_TOO_LARGE" | "NO_ELIGIBLE_CANDIDATE" |
    "INVALID_PARAMETER_PATH" | "REPLAY_BLOCKED" |
    "INVALID_DATASET_QUALITY") { super(code); }
}

function lowerBound<T>(items: readonly T[], timestamp: number,
  select: (item: T) => number): number {
  let left = 0; let right = items.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (select(items[middle]) < timestamp) left = middle + 1;
    else right = middle;
  }
  return left;
}
function boundary(dataset: HistoricalResult, index: number): number {
  return dataset.candles1m[index]?.timestamp ?? dataset.requestedRange.end;
}
function indexedRange(dataset: HistoricalResult, startIndex: number,
  endIndex: number): IndexedRange {
  return Object.freeze({ startIndex, endIndex,
    start: boundary(dataset, startIndex), end: boundary(dataset, endIndex) });
}
function integer(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = ordered.length >>> 1;
  return ordered.length % 2 ? ordered[middle] :
    (ordered[middle - 1] + ordered[middle]) / 2;
}
function dispersion(values: readonly number[]): Dispersion {
  if (!values.length) return Object.freeze({ count: 0, mean: null, median: null,
    min: null, max: null, standardDeviation: null });
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Object.freeze({ count: values.length, mean, median: median(values),
    min: Math.min(...values), max: Math.max(...values),
    standardDeviation: Math.sqrt(variance) });
}
function day(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
function rangeDays(dataset: HistoricalResult, ranges: readonly IndexedRange[]): string[] {
  const days = new Set<string>();
  for (const range of ranges) {
    for (let index = range.startIndex; index < range.endIndex; index++) {
      days.add(day(dataset.candles1m[index].timestamp));
    }
  }
  return [...days].sort();
}
function compact(summary: BacktestSummary, days: number): CompactMetrics {
  return Object.freeze({ signals: summary.totalSignals, filled: summary.filledTrades,
    unfilled: summary.unfilledSignals, resolved: summary.resolvedTrades,
    wins: summary.wins, losses: summary.losses, ambiguous: summary.ambiguousTrades,
    fillRate: summary.totalSignals ? summary.filledTrades / summary.totalSignals : null,
    expectancyR: summary.raw.expectancyR, medianR: summary.raw.medianR,
    profitFactor: summary.raw.profitFactor,
    profitFactorStatus: summary.raw.profitFactorStatus,
    netExpectancyR: summary.adjusted.metrics?.expectancyR ?? null,
    netProfitFactor: summary.adjusted.metrics?.profitFactor ?? null,
    netProfitFactorStatus: summary.adjusted.metrics?.profitFactorStatus ?? null,
    maxDrawdownR: summary.maxTradeSequenceDrawdownR,
    signalsPerDay: days ? summary.totalSignals / days : null,
    averageMfeR: summary.averageMfeR, medianMfeR: summary.medianMfeR,
    averageMaeR: summary.averageMaeR, medianMaeR: summary.medianMaeR,
    ambiguityRate: summary.ambiguityRate });
}

export function generateValidationFolds(dataset: HistoricalResult,
  config: ValidationConfig, datasetFingerprint = fingerprintHistoricalDataset(dataset)):
  readonly ValidationFold[] {
  const candles = dataset.candles1m;
  if (!candles.length || !integer(config.trainWindowBars, 1) ||
      !integer(config.testWindowBars, 1) || !integer(config.stepBars, 1) ||
      !integer(config.gapBars, 0) || !integer(config.warmupBars, 0) ||
      config.developmentStart >= config.developmentEnd ||
      config.finalHoldoutStart >= config.finalHoldoutEnd) {
    throw new ValidationInputError("INVALID_CONFIG");
  }
  const dataStart = candles[0].timestamp;
  const dataEnd = candles.at(-1)!.timestamp + MINUTE_MS;
  if (config.developmentStart < dataStart || config.finalHoldoutEnd > dataEnd) {
    throw new ValidationInputError("INVALID_RANGE");
  }
  if (config.developmentEnd > config.finalHoldoutStart) {
    throw new ValidationInputError("HOLDOUT_OVERLAP");
  }
  if ((config.overlapPolicy ?? "FORBID") === "FORBID" &&
      config.stepBars < config.testWindowBars) {
    throw new ValidationInputError("OVERLAPPING_TEST_WINDOWS");
  }
  const developmentStart = lowerBound(candles, config.developmentStart,
    (item) => item.timestamp);
  const developmentEnd = lowerBound(candles, config.developmentEnd,
    (item) => item.timestamp);
  const holdoutStart = lowerBound(candles, config.finalHoldoutStart,
    (item) => item.timestamp);
  const holdoutEnd = lowerBound(candles, config.finalHoldoutEnd,
    (item) => item.timestamp);
  if (developmentStart >= developmentEnd || holdoutStart >= holdoutEnd ||
      developmentEnd > holdoutStart) throw new ValidationInputError("INVALID_RANGE");
  const folds: ValidationFold[] = [];
  const firstTest = developmentStart + config.trainWindowBars + config.gapBars;
  for (let testStart = firstTest; testStart + config.testWindowBars <= developmentEnd;
      testStart += config.stepBars) {
    const trainEnd = testStart - config.gapBars;
    const trainStart = config.foldType === "EXPANDING" ? developmentStart :
      trainEnd - config.trainWindowBars;
    if (trainStart < developmentStart || trainStart >= trainEnd) continue;
    const testEnd = testStart + config.testWindowBars;
    const warmupStart = Math.max(0, trainStart - config.warmupBars);
    const details = { index: folds.length, trainStart, trainEnd, testStart, testEnd,
      gapBars: config.gapBars, foldType: config.foldType, datasetFingerprint };
    folds.push(Object.freeze({ id: `fold-${deterministicValueHash(details)}`,
      index: folds.length,
      warmupRange: indexedRange(dataset, warmupStart, trainStart),
      trainRange: indexedRange(dataset, trainStart, trainEnd),
      gapRange: indexedRange(dataset, trainEnd, testStart),
      testRange: indexedRange(dataset, testStart, testEnd),
      requestedWarmupBars: config.warmupBars, datasetFingerprint }));
  }
  if (!folds.length) throw new ValidationInputError("NO_FOLDS");
  return Object.freeze(folds);
}

function cloneConfig(config: ReplayPipelineConfig): ReplayPipelineConfig {
  return Object.fromEntries(Object.entries(config).map(([key, value]) =>
    [key, value ? { ...value } : value])) as ReplayPipelineConfig;
}
function parameterKey(parameter: Pick<TunableParameter, "phaseOwner" | "configPath">): string {
  return `${parameter.phaseOwner}.${parameter.configPath}`;
}
function withParameter(config: ReplayPipelineConfig,
  parameter: Pick<TunableParameter, "phaseOwner" | "configPath">,
  value: number | boolean | string): ReplayPipelineConfig {
  const parts = parameter.configPath.split(".");
  const field = parts.length === 1 ? parts[0] :
    parts.length === 2 && parts[0] === parameter.phaseOwner ? parts[1] : null;
  if (!field || !/^[A-Za-z][A-Za-z0-9]*$/.test(field) ||
      !CONFIG_FIELDS[parameter.phaseOwner].includes(field) ||
      (typeof value === "number" && !Number.isFinite(value))) {
    throw new ValidationInputError("INVALID_PARAMETER_PATH");
  }
  const copy = cloneConfig(config) as Record<string, Record<string, unknown> | undefined>;
  copy[parameter.phaseOwner] = { ...(copy[parameter.phaseOwner] ?? {}), [field]: value };
  return copy as ReplayPipelineConfig;
}
function valueAt(config: ReplayPipelineConfig,
  parameter: Pick<TunableParameter, "phaseOwner" | "configPath">): unknown {
  const parts = parameter.configPath.split(".");
  const field = parts.length === 1 ? parts[0] : parts[1];
  return (config[parameter.phaseOwner] as Record<string, unknown> | undefined)?.[field];
}
type Candidate = { config: ReplayPipelineConfig; hash: string;
  values: Record<string, number | boolean | string> };

export function enumerateValidationCandidates(base: ReplayPipelineConfig,
  parameters: readonly TunableParameter[], maximum: number): readonly Candidate[] {
  if (!parameters.length || !integer(maximum, 1)) {
    throw new ValidationInputError("SELECTION_SPEC_REQUIRED");
  }
  let count = 1;
  const keys = new Set<string>();
  for (const parameter of parameters) {
    const key = parameterKey(parameter);
    if (keys.has(key) || !parameter.reason.trim() || !parameter.candidateValues.length) {
      throw new ValidationInputError("INVALID_CONFIG");
    }
    keys.add(key);
    count *= parameter.candidateValues.length;
    if (!Number.isSafeInteger(count) || count > maximum) {
      throw new ValidationInputError("SEARCH_SPACE_TOO_LARGE");
    }
  }
  let candidates: Candidate[] = [{ config: cloneConfig(base),
    hash: fingerprintReplayConfig(base), values: {} }];
  for (const parameter of parameters) {
    const next: Candidate[] = [];
    for (const candidate of candidates) {
      for (const value of parameter.candidateValues) {
        const config = withParameter(candidate.config, parameter, value);
        next.push({ config, hash: fingerprintReplayConfig(config),
          values: { ...candidate.values, [parameterKey(parameter)]: value } });
      }
    }
    candidates = next;
  }
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) if (!unique.has(candidate.hash)) {
    unique.set(candidate.hash, candidate);
  }
  return Object.freeze([...unique.values()].sort((a, b) => a.hash.localeCompare(b.hash)));
}

function gapCount(dataset: HistoricalResult, range: IndexedRange): number {
  let count = 0;
  for (let index = range.startIndex + 1; index < range.endIndex; index++) {
    if (dataset.candles1m[index].timestamp -
        dataset.candles1m[index - 1].timestamp > MINUTE_MS) count++;
  }
  return count;
}
function foldResult(fold: ValidationFold, result: BacktestResult,
  dataset: HistoricalResult, selectedConfigHash: string,
  selectedValues: Readonly<Record<string, number | boolean | string>>,
  trainObjectiveValue: number | null, minimumTrades?: number): FoldResult {
  const days = rangeDays(dataset, [fold.testRange]).length;
  const sufficient = minimumTrades === undefined ||
    result.summary.resolvedTrades >= minimumTrades;
  return Object.freeze({ foldId: fold.id, foldIndex: fold.index,
    trainRange: fold.trainRange, gapRange: fold.gapRange, testRange: fold.testRange,
    selectedConfigHash, selectedValues: Object.freeze({ ...selectedValues }),
    trainObjectiveValue, metrics: compact(result.summary, days),
    familySignals: Object.freeze(Object.fromEntries(FAMILIES.map((family) =>
      [family, result.setupFamilies[family].signals])) as Record<SetupFamily, number>),
    directionSignals: Object.freeze(Object.fromEntries(DIRECTIONS.map((direction) =>
      [direction, result.directions[direction].signals])) as Record<SignalAction, number>),
    backtestRunId: result.metadata.runId,
    executionConfigHash: result.metadata.executionConfigHash,
    executionDiagnostics: Object.freeze({
      maxSimultaneousActiveTrades: result.diagnostics.maxSimultaneousActiveTrades,
      maxPendingSignals: result.diagnostics.maxPendingSignals,
      configuredCostScenario: result.diagnostics.configuredCostScenario,
      historicalSpreadStatus: result.diagnostics.historicalSpreadStatus }),
    sampleStatus: sufficient ? "VALID" : "INSUFFICIENT_SAMPLE",
    dataQuality: Object.freeze({ candleCount: fold.testRange.endIndex -
      fold.testRange.startIndex, dataStatus: dataset.status,
      gapCount: gapCount(dataset, fold.testRange),
      criticalConflicts: dataset.diagnostics.duplicateConflictCount,
      warmupCandles: fold.warmupRange.endIndex - fold.warmupRange.startIndex,
      warmupSufficient: fold.warmupRange.endIndex - fold.warmupRange.startIndex >=
        fold.requestedWarmupBars }) });
}

type FoldExecution = { fold: ValidationFold; result: BacktestResult;
  report: FoldResult };
function deduplicatedTrades(executions: readonly FoldExecution[]):
  { trades: BacktestTrade[]; duplicates: number } {
  const trades: BacktestTrade[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const execution of executions) {
    for (const trade of execution.result.trades) {
      if (seen.has(trade.signalId)) { duplicates++; continue; }
      seen.add(trade.signalId);
      trades.push(trade);
    }
  }
  return { trades, duplicates };
}
function sliceRobustness(trades: readonly BacktestTrade[], executions: readonly FoldExecution[],
  totalSignals: number, totalR: number, predicate: (trade: BacktestTrade) => boolean,
  foldMetric: (result: BacktestResult) => { signals: number; expectancyR: number | null },
  days: number): RobustnessSlice {
  const selected = trades.filter(predicate);
  const summary = summarizeBacktestTrades(selected);
  let active = 0; let positive = 0; let negative = 0;
  for (const execution of executions) {
    const metric = foldMetric(execution.result);
    if (metric.signals) active++;
    if (metric.expectancyR !== null && metric.expectancyR > 0) positive++;
    if (metric.expectancyR !== null && metric.expectancyR < 0) negative++;
  }
  return Object.freeze({ metrics: compact(summary, days), foldsActive: active,
    positiveFolds: positive, negativeFolds: negative,
    signalShare: totalSignals ? selected.length / totalSignals : null,
    totalRShare: totalR ? summary.cumulativeResolvedR / totalR : null });
}
function signalFrequency(trades: readonly BacktestTrade[], dataset: HistoricalResult,
  ranges: readonly IndexedRange[]): AggregateOos["signalFrequency"] {
  const days = rangeDays(dataset, ranges);
  const counts = new Map<string, number>();
  for (const trade of trades) {
    const key = day(trade.signalAvailableAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = days.map((key) => counts.get(key) ?? 0);
  return Object.freeze({ days: days.length, total: trades.length,
    mean: values.length ? trades.length / values.length : null,
    median: median(values), min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    zeroSignalDays: values.filter((value) => value === 0).length });
}
function aggregate(executions: readonly FoldExecution[], dataset: HistoricalResult): AggregateOos {
  const { trades, duplicates } = deduplicatedTrades(executions);
  const summary = summarizeBacktestTrades(trades);
  const days = rangeDays(dataset, executions.map((item) => item.fold.testRange)).length;
  const families = Object.fromEntries(FAMILIES.map((family) => [family,
    sliceRobustness(trades, executions, trades.length, summary.cumulativeResolvedR,
      (trade) => trade.setupFamily === family,
      (result) => ({ signals: result.setupFamilies[family].signals,
        expectancyR: result.setupFamilies[family].expectancyR }), days)])) as
    Record<SetupFamily, RobustnessSlice>;
  const directions = Object.fromEntries(DIRECTIONS.map((direction) => [direction,
    sliceRobustness(trades, executions, trades.length, summary.cumulativeResolvedR,
      (trade) => trade.direction === direction,
      (result) => ({ signals: result.directions[direction].signals,
        expectancyR: result.directions[direction].expectancyR }), days)])) as
    Record<SignalAction, RobustnessSlice>;
  const reports = executions.map((item) => item.report);
  const validExpectancy = reports.flatMap((item) =>
    item.metrics.expectancyR === null ? [] : [item.metrics.expectancyR]);
  return Object.freeze({ metrics: compact(summary, days), summary,
    setupFamilies: Object.freeze(families), directions: Object.freeze(directions),
    positiveFolds: validExpectancy.filter((value) => value > 0).length,
    negativeFolds: validExpectancy.filter((value) => value < 0).length,
    insufficientFolds: reports.filter((item) =>
      item.sampleStatus === "INSUFFICIENT_SAMPLE").length,
    duplicateTradesRemoved: duplicates,
    signalFrequency: signalFrequency(trades, dataset,
      executions.map((item) => item.fold.testRange)),
    foldDispersion: Object.freeze({ expectancyR: dispersion(validExpectancy),
      signalsPerDay: dispersion(reports.flatMap((item) =>
        item.metrics.signalsPerDay === null ? [] : [item.metrics.signalsPerDay])),
      maxDrawdownR: dispersion(reports.map((item) => item.metrics.maxDrawdownR)) }) });
}

export function aggregateValidationBacktests(dataset: HistoricalResult,
  folds: readonly ValidationFold[], results: readonly BacktestResult[],
  minimumTradesPerFold?: number): AggregateOos {
  if (folds.length !== results.length || !folds.length) {
    throw new ValidationInputError("INVALID_CONFIG");
  }
  const executions = folds.map((fold, index) => ({ fold, result: results[index],
    report: foldResult(fold, results[index], dataset,
      results[index].metadata.strategyConfigHash, {}, null, minimumTradesPerFold) }));
  return aggregate(executions, dataset);
}

function objectiveValue(result: BacktestResult, objective: SelectionObjective): number | null {
  if (objective.minimumResolvedTrades !== undefined &&
      result.summary.resolvedTrades < objective.minimumResolvedTrades) return null;
  if (objective.maximumDrawdownR !== undefined &&
      result.summary.maxTradeSequenceDrawdownR > objective.maximumDrawdownR) return null;
  if (objective.metric === "EXPECTANCY_R") return result.summary.raw.expectancyR;
  if (objective.metric === "PROFIT_FACTOR") return result.summary.raw.profitFactor;
  return result.summary.maxTradeSequenceDrawdownR;
}
function better(left: { value: number; hash: string } | null,
  right: { value: number; hash: string }, direction: "MAXIMIZE" | "MINIMIZE"): boolean {
  if (!left) return true;
  if (right.value === left.value) return right.hash < left.hash;
  return direction === "MAXIMIZE" ? right.value > left.value : right.value < left.value;
}
function difference(value: number | null, baseline: number | null): number | null {
  return value === null || baseline === null ? null : value - baseline;
}
function firstCollapse(reports: readonly FoldResult[]): ValidationReport["firstCollapse"] {
  for (let index = 1; index < reports.length; index++) {
    const before = reports[index - 1].metrics;
    const current = reports[index].metrics;
    if ((before.expectancyR !== null && before.expectancyR >= 0 &&
         current.expectancyR !== null && current.expectancyR < 0) ||
        (before.signals > 0 && current.signals === 0)) {
      return Object.freeze({ foldId: reports[index].foldId,
        previousFoldId: reports[index - 1].foldId,
        changes: Object.freeze({ signalFrequency: difference(current.signalsPerDay,
          before.signalsPerDay), fillRate: difference(current.fillRate, before.fillRate),
          ambiguityRate: difference(current.ambiguityRate, before.ambiguityRate),
          averageMfeR: difference(current.averageMfeR, before.averageMfeR),
          averageMaeR: difference(current.averageMaeR, before.averageMaeR),
          resolvedExpectancyR: difference(current.expectancyR, before.expectancyR) }) });
    }
  }
  return null;
}

function gate(name: string, actual: number | null, operator: ">=" | "<=",
  required: number, reason: string): GateResult {
  const passed = actual !== null && (operator === ">=" ? actual >= required : actual <= required);
  return Object.freeze({ name, actual, operator, required, passed, reason });
}
function evaluateGates(criteria: RobustnessCriteria | undefined, aggregate: AggregateOos,
  holdout: BacktestResult): readonly GateResult[] {
  if (!criteria) return Object.freeze([]);
  const gates: GateResult[] = [];
  if (criteria.minimumTotalOosResolvedTrades !== undefined) gates.push(gate(
    "MINIMUM_TOTAL_OOS_RESOLVED_TRADES", aggregate.metrics.resolved, ">=",
    criteria.minimumTotalOosResolvedTrades, "aggregate OOS resolved trades"));
  if (criteria.minimumValidFolds !== undefined) gates.push(gate("MINIMUM_VALID_FOLDS",
    aggregate.foldDispersion.expectancyR.count, ">=", criteria.minimumValidFolds,
    "folds with a defined expectancy"));
  if (criteria.minimumOosExpectancyR !== undefined) gates.push(gate("OOS_EXPECTANCY",
    aggregate.metrics.expectancyR, ">=", criteria.minimumOosExpectancyR,
    "aggregate OOS expectancy R"));
  if (criteria.maximumOosDrawdownR !== undefined) gates.push(gate("OOS_DRAWDOWN",
    aggregate.metrics.maxDrawdownR, "<=", criteria.maximumOosDrawdownR,
    "aggregate OOS trade-sequence drawdown R"));
  if (criteria.minimumActiveFamilies !== undefined) gates.push(gate("ACTIVE_FAMILIES",
    Object.values(aggregate.setupFamilies).filter((item) => item.metrics.signals > 0).length,
    ">=", criteria.minimumActiveFamilies, "setup families with OOS signals"));
  if (criteria.maximumFoldExpectancyStandardDeviation !== undefined) gates.push(gate(
    "FOLD_EXPECTANCY_DISPERSION", aggregate.foldDispersion.expectancyR.standardDeviation,
    "<=", criteria.maximumFoldExpectancyStandardDeviation,
    "population standard deviation of fold expectancy"));
  if (criteria.minimumFinalHoldoutResolvedTrades !== undefined) gates.push(gate(
    "FINAL_HOLDOUT_RESOLVED_TRADES", holdout.summary.resolvedTrades, ">=",
    criteria.minimumFinalHoldoutResolvedTrades, "final holdout resolved trades"));
  return Object.freeze(gates);
}

export function runValidation(input: ValidationInput): ValidationReport {
  const totalStarted = performance.now();
  if (BACKTEST_ENGINE_VERSION !== "phase16-v1") {
    throw new ValidationInputError("PHASE_16_NOT_FROZEN");
  }
  const { dataset, validationConfig: config } = input;
  if (dataset.status === "BLOCKED" || dataset.status === "FAILED") {
    throw new ValidationInputError("UPSTREAM_DATA_STATUS");
  }
  if (dataset.diagnostics.duplicateConflictCount > 0 ||
      dataset.diagnostics.invalidCandleCount > 0) {
    throw new ValidationInputError("INVALID_DATASET_QUALITY");
  }
  const baseConfig = cloneConfig(input.baseStrategyConfig ?? {});
  const baseConfigSnapshot = deterministicValueHash(baseConfig);
  const datasetFingerprint = fingerprintHistoricalDataset(dataset);
  const validationConfigHash = `${VALIDATION_ENGINE_VERSION}-${deterministicValueHash(config)}`;
  const executionConfig = Object.freeze({ ...DEFAULT_BACKTEST_EXECUTION_CONFIG,
    ...(input.executionConfig ?? {}) });
  const executionConfigHash = fingerprintBacktestExecutionConfig(executionConfig);
  const timings = { foldGeneration: 0, signalGeneration: 0, baselineOos: 0,
    walkForwardTraining: 0, walkForwardTests: 0, sensitivity: 0,
    executionScenarios: 0, finalHoldout: 0, total: 0 };
  let stage = performance.now();
  const folds = generateValidationFolds(dataset, config, datasetFingerprint);
  timings.foldGeneration = performance.now() - stage;
  const holdoutStartIndex = lowerBound(dataset.candles1m, config.finalHoldoutStart,
    (item) => item.timestamp);
  const holdoutEndIndex = lowerBound(dataset.candles1m, config.finalHoldoutEnd,
    (item) => item.timestamp);
  const holdoutRange = indexedRange(dataset, holdoutStartIndex, holdoutEndIndex);
  if (holdoutStartIndex >= holdoutEndIndex) throw new ValidationInputError("INVALID_RANGE");

  type StrategyArtifacts = { hash: string; config: ReplayPipelineConfig;
    signals: ReturnType<ReturnType<typeof createReplaySession>["getArtifacts"]>["signals"];
    referenceAtr: ReadonlyMap<string, number> };
  const artifactCache = new Map<string, StrategyArtifacts>();
  let replayRuns = 0;
  let cacheHits = 0;
  const artifactsFor = (strategyConfig: ReplayPipelineConfig): StrategyArtifacts => {
    const hash = fingerprintReplayConfig(strategyConfig);
    const cached = artifactCache.get(hash);
    if (cached) { cacheHits++; return cached; }
    const started = performance.now();
    const session = createReplaySession({ dataset,
      start: dataset.candles1m[0].timestamp,
      end: dataset.requestedRange.end, config: strategyConfig,
      expectedDatasetFingerprint: datasetFingerprint, expectedConfigHash: hash });
    session.runToEnd();
    if (session.status === "BLOCKED") throw new ValidationInputError("REPLAY_BLOCKED");
    const replay = session.getArtifacts();
    const referenceAtr = new Map(replay.riskValidations.flatMap((item) =>
      item.referenceAtr !== null && item.referenceAtr > 0 ?
        [[item.id, item.referenceAtr] as const] : []));
    const result = Object.freeze({ hash, config: cloneConfig(strategyConfig),
      signals: replay.signals, referenceAtr });
    artifactCache.set(hash, result);
    replayRuns++;
    timings.signalGeneration += performance.now() - started;
    return result;
  };
  let phase16Runs = 0;
  let candlesProcessed = 0;
  const backtestCache = new Map<string, BacktestResult>();
  const execute = (artifacts: StrategyArtifacts, range: IndexedRange,
    scenario: Partial<BacktestExecutionConfig> = executionConfig): BacktestResult => {
    const scenarioHash = fingerprintBacktestExecutionConfig(scenario);
    const key = `${datasetFingerprint}|${artifacts.hash}|${REPLAY_ENGINE_VERSION}|` +
      `${scenarioHash}|${range.start}|${range.end}`;
    const cached = backtestCache.get(key);
    if (cached) { cacheHits++; return cached; }
    const result = runBacktest({ dataset, signals: artifacts.signals,
      evaluationStart: range.start, evaluationEnd: range.end,
      dataWarmupStart: dataset.requestedRange.start,
      strategyConfigHash: artifacts.hash, strategyEngineVersion: REPLAY_ENGINE_VERSION,
      datasetFingerprint, executionConfig: scenario,
      referenceAtrByRiskValidationId: artifacts.referenceAtr });
    backtestCache.set(key, result);
    phase16Runs++;
    candlesProcessed += result.diagnostics.candlesProcessed;
    return result;
  };

  stage = performance.now();
  const baseArtifacts = artifactsFor(baseConfig);
  const fixedExecutions: FoldExecution[] = folds.map((fold) => {
    const result = execute(baseArtifacts, fold.testRange);
    return { fold, result, report: foldResult(fold, result, dataset,
      baseArtifacts.hash, {}, null, config.minimumTradesPerFold) };
  });
  const fixedAggregate = aggregate(fixedExecutions, dataset);
  timings.baselineOos = performance.now() - stage;

  let candidateCount = 1;
  let walkExecutions = fixedExecutions;
  if (config.mode === "WALK_FORWARD_SELECTION") {
    if (!config.tunableParameters?.length || !config.objectiveDefinition ||
        config.maximumCandidateConfigurations === undefined) {
      throw new ValidationInputError("SELECTION_SPEC_REQUIRED");
    }
    const candidates = enumerateValidationCandidates(baseConfig,
      config.tunableParameters, config.maximumCandidateConfigurations);
    candidateCount = candidates.length;
    walkExecutions = [];
    for (const fold of folds) {
      stage = performance.now();
      let selected: { candidate: Candidate; artifacts: StrategyArtifacts;
        value: number; result: BacktestResult } | null = null;
      for (const candidate of candidates) {
        const artifacts = artifactsFor(candidate.config);
        const result = execute(artifacts, fold.trainRange);
        const value = objectiveValue(result, config.objectiveDefinition);
        if (value !== null && better(selected ? { value: selected.value,
          hash: selected.candidate.hash } : null,
        { value, hash: candidate.hash }, config.objectiveDefinition.direction)) {
          selected = { candidate, artifacts, value, result };
        }
      }
      timings.walkForwardTraining += performance.now() - stage;
      if (!selected) throw new ValidationInputError("NO_ELIGIBLE_CANDIDATE");
      stage = performance.now();
      const result = execute(selected.artifacts, fold.testRange);
      timings.walkForwardTests += performance.now() - stage;
      walkExecutions.push({ fold, result,
        report: foldResult(fold, result, dataset, selected.artifacts.hash,
          selected.candidate.values, selected.value, config.minimumTradesPerFold) });
    }
  }
  const walkAggregate = config.mode === "FIXED_CONFIG_OOS" ? fixedAggregate :
    aggregate(walkExecutions, dataset);

  stage = performance.now();
  const sensitivityVariants: SensitivityResult["variants"][number][] = [];
  const sensitivityObservations: string[] = [];
  if (config.sensitivityDefinition?.length) {
    const developmentRange = indexedRange(dataset,
      lowerBound(dataset.candles1m, config.developmentStart, (item) => item.timestamp),
      lowerBound(dataset.candles1m, config.developmentEnd, (item) => item.timestamp));
    const baseline = execute(baseArtifacts, developmentRange);
    const seen = new Set<string>([baseArtifacts.hash]);
    for (const parameter of config.sensitivityDefinition) {
      for (const testedValue of parameter.testedValues) {
        const variantConfig = withParameter(baseConfig, parameter, testedValue);
        const hash = fingerprintReplayConfig(variantConfig);
        if (seen.has(hash)) continue;
        seen.add(hash);
        const result = execute(artifactsFor(variantConfig), developmentRange);
        sensitivityVariants.push(Object.freeze({ parameter: parameterKey(parameter),
          baseValue: valueAt(baseConfig, parameter), testedValue, configHash: hash,
          metrics: compact(result.summary, rangeDays(dataset, [developmentRange]).length),
          expectancyChange: difference(result.summary.raw.expectancyR,
            baseline.summary.raw.expectancyR),
          signalCountChange: result.summary.totalSignals - baseline.summary.totalSignals }));
      }
    }
    if (sensitivityVariants.some((item) => item.metrics.signals === 0) &&
        baseline.summary.totalSignals > 0) sensitivityObservations.push("SIGNAL_STARVATION");
    if (sensitivityVariants.some((item) => item.metrics.expectancyR !== null &&
        baseline.summary.raw.expectancyR !== null &&
        item.metrics.expectancyR < 0 && baseline.summary.raw.expectancyR >= 0)) {
      sensitivityObservations.push("EXPECTANCY_SIGN_CHANGE");
    }
  }
  timings.sensitivity = performance.now() - stage;

  stage = performance.now();
  const executionRobustness: ExecutionRobustnessResult[] = [Object.freeze({
    name: "BASELINE", kind: "BASELINE", executionConfigHash,
    metrics: fixedAggregate.metrics, comparedExpectancyChange: 0,
    comparisonMetric: "RAW_EXPECTANCY_R", filledChange: 0 })];
  const scenarioNames = new Set<string>(["BASELINE"]);
  for (const scenario of config.executionScenarios ?? []) {
    if (!scenario.name.trim() || scenarioNames.has(scenario.name)) {
      throw new ValidationInputError("INVALID_CONFIG");
    }
    scenarioNames.add(scenario.name);
    const merged = Object.freeze({ ...executionConfig, ...scenario.executionConfig });
    const executions = folds.map((fold) => {
      const result = execute(baseArtifacts, fold.testRange, merged);
      return { fold, result, report: foldResult(fold, result, dataset,
        baseArtifacts.hash, {}, null, config.minimumTradesPerFold) };
    });
    const result = aggregate(executions, dataset);
    executionRobustness.push(Object.freeze({ name: scenario.name, kind: "SCENARIO",
      executionConfigHash: fingerprintBacktestExecutionConfig(merged),
      metrics: result.metrics,
      comparedExpectancyChange: difference(
        result.metrics.netExpectancyR ?? result.metrics.expectancyR,
        fixedAggregate.metrics.expectancyR),
      comparisonMetric: result.metrics.netExpectancyR === null ?
        "RAW_EXPECTANCY_R" : "SCENARIO_NET_VS_BASELINE_RAW",
      filledChange: result.metrics.filled - fixedAggregate.metrics.filled }));
  }
  timings.executionScenarios = performance.now() - stage;

  stage = performance.now();
  const holdoutResult = execute(baseArtifacts, holdoutRange);
  const holdoutDays = rangeDays(dataset, [holdoutRange]).length;
  const holdoutMinimum = config.robustnessCriteria?.minimumFinalHoldoutResolvedTrades;
  const holdoutSufficient = holdoutMinimum === undefined ||
    holdoutResult.summary.resolvedTrades >= holdoutMinimum;
  timings.finalHoldout = performance.now() - stage;

  const selectedReports = walkExecutions.map((item) => item.report);
  const stabilityValues: Record<string, unknown[]> = {};
  for (const parameter of config.tunableParameters ?? []) {
    const key = parameterKey(parameter);
    stabilityValues[key] = selectedReports.map((item) => item.selectedValues[key]);
  }
  let changes = 0;
  for (let index = 1; index < selectedReports.length; index++) {
    if (selectedReports[index].selectedConfigHash !==
        selectedReports[index - 1].selectedConfigHash) changes++;
  }
  const changeRate = selectedReports.length > 1 ? changes / (selectedReports.length - 1) : null;
  const parameterStability = config.mode === "FIXED_CONFIG_OOS" ?
    Object.freeze({ status: "NOT_APPLICABLE" as const, changes: 0,
      changeRate: null, valuesByParameter: Object.freeze({}) }) :
    Object.freeze({ status: (changes > 0 ?
      "UNSTABLE" : "STABLE") as "STABLE" | "UNSTABLE", changes, changeRate,
      valuesByParameter: Object.freeze(stabilityValues) });
  const gates = evaluateGates(config.robustnessCriteria, walkAggregate, holdoutResult);
  const activeDays = new Set(dataset.candles1m.map((item) => day(item.timestamp))).size;
  const configuredHistorySufficient =
    (config.minimumHistoryBars === undefined ||
      dataset.candles1m.length >= config.minimumHistoryBars) &&
    (config.minimumActiveTradingDays === undefined ||
      activeDays >= config.minimumActiveTradingDays);
  const sampleGateFailed = gates.some((item) => !item.passed &&
    (item.name === "MINIMUM_TOTAL_OOS_RESOLVED_TRADES" ||
     item.name === "FINAL_HOLDOUT_RESOLVED_TRADES" ||
     item.name === "MINIMUM_VALID_FOLDS"));
  const status: CertificationStatus = !configuredHistorySufficient || sampleGateFailed ?
    "INSUFFICIENT_DATA" : !config.robustnessCriteria ? "NOT_PROVEN" :
      gates.every((item) => item.passed) ? "ROBUST_PASS" : "FAIL";
  const validationRunId = `validation-${deterministicValueHash({ datasetFingerprint,
    engineVersion: REPLAY_ENGINE_VERSION, baseStrategyConfigHash: baseArtifacts.hash,
    executionConfigHash, validationConfigHash,
    developmentRange: [config.developmentStart, config.developmentEnd],
    finalHoldoutRange: [config.finalHoldoutStart, config.finalHoldoutEnd] })}`;
  const semantic = { validationRunId, status, folds,
    fixed: fixedExecutions.map((item) => item.report), selected: selectedReports,
    fixedAggregate, walkAggregate, holdout: holdoutResult.summary,
    sensitivityVariants, executionRobustness, gates };
  timings.total = performance.now() - totalStarted;
  if (deterministicValueHash(baseConfig) !== baseConfigSnapshot) {
    throw new ValidationInputError("INVALID_CONFIG");
  }
  let overlap = 0;
  for (let index = 1; index < folds.length; index++) {
    if (folds[index].testRange.start < folds[index - 1].testRange.end) overlap++;
  }
  return Object.freeze({ status,
    metadata: Object.freeze({ validationRunId,
      resultFingerprint: `validation-result-${deterministicValueHash(semantic)}`,
      validationEngineVersion: VALIDATION_ENGINE_VERSION,
      datasetFingerprint, engineVersion: REPLAY_ENGINE_VERSION,
      backtestEngineVersion: BACKTEST_ENGINE_VERSION,
      baseStrategyConfigHash: baseArtifacts.hash, executionConfigHash,
      validationConfigHash,
      developmentRange: Object.freeze({ start: config.developmentStart,
        end: config.developmentEnd }),
      finalHoldoutRange: Object.freeze({ start: config.finalHoldoutStart,
        end: config.finalHoldoutEnd }), holdoutReuseGuard: "NOT_PERSISTENT" }),
    historicalCoverage: Object.freeze({
      firstTimestamp: dataset.candles1m[0].timestamp,
      lastTimestamp: dataset.candles1m.at(-1)!.timestamp,
      calendarSpanMs: dataset.candles1m.at(-1)!.timestamp -
        dataset.candles1m[0].timestamp + MINUTE_MS,
      activeTradingDays: activeDays, candles1m: dataset.candles1m.length,
      dataStatus: dataset.status, gapCount: dataset.diagnostics.internalGapCount,
      criticalConflicts: dataset.diagnostics.duplicateConflictCount }),
    validationMode: config.mode, foldType: config.foldType, folds,
    fixedConfigFoldResults: Object.freeze(fixedExecutions.map((item) => item.report)),
    walkForwardFoldResults: Object.freeze(selectedReports),
    fixedConfigOos: fixedAggregate,
    walkForward: Object.freeze({ mode: config.mode === "FIXED_CONFIG_OOS" ?
      "FIXED_CONFIG_WALK_FORWARD" : "WALK_FORWARD_SELECTION",
      aggregate: walkAggregate }),
    finalHoldout: Object.freeze({ metrics: compact(holdoutResult.summary, holdoutDays),
      summary: holdoutResult.summary, setupFamilies: holdoutResult.setupFamilies,
      directions: holdoutResult.directions,
      executionDiagnostics: holdoutResult.diagnostics,
      signalFrequency: signalFrequency(holdoutResult.trades, dataset, [holdoutRange]),
      sampleStatus: holdoutSufficient ? "VALID" : "INSUFFICIENT_SAMPLE" }),
    parameterStability,
    sensitivity: Object.freeze({ status: sensitivityVariants.length ?
      "REPORT_ONLY" : "DISABLED", variants: Object.freeze(sensitivityVariants),
      observations: Object.freeze(sensitivityObservations) }),
    executionRobustness: Object.freeze(executionRobustness),
    firstCollapse: firstCollapse(selectedReports), gates,
    diagnostics: Object.freeze({ holdoutContamination: 0, testToTrainLeakage: 0,
      lookAheadViolations: fixedExecutions.reduce((sum, item) =>
        sum + item.result.diagnostics.lookAheadViolations, 0),
      repaintViolations: fixedExecutions.reduce((sum, item) =>
        sum + item.result.diagnostics.repaintViolations, 0),
      overlappingTestWindows: overlap, phase16BacktestRuns: phase16Runs,
      configurationsEvaluated: artifactCache.size,
      candidateConfigurations: candidateCount,
      sensitivityVariants: sensitivityVariants.length,
      executionScenarios: executionRobustness.length,
      replayRuns, cacheHits, totalCandlesProcessed: candlesProcessed,
      globalConfigMutations: 0, strategyLogicDuplicated: 0,
      backtestLogicDuplicated: 0, signalRegenerationImplementations: 0,
      finageProviderDuplications: 0 }),
    timingsMs: Object.freeze(timings) });
}
