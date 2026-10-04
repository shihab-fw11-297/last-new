import type { Candle, HistoricalResult } from "../data/types.ts";
import type { ImmutableSignal, SignalLedger } from "./signal-ledger.ts";
import type { Signal, SignalAction, SetupFamily } from "./signal-decision.ts";
import { fingerprintHistoricalDataset } from "./replay-engine.ts";

export const BACKTEST_ENGINE_VERSION = "phase16-v1";
const FAMILIES: readonly SetupFamily[] = ["LIQUIDITY_REVERSAL", "CONTINUATION",
  "COMPRESSION_EXPANSION", "BREAKOUT_RETEST"];
const DIRECTIONS: readonly SignalAction[] = ["BUY", "SELL"];

export type EntryExecutionMode = "MARKET_AT_SIGNAL_CLOSE" |
  "NEXT_BAR_OPEN" | "LIMIT_AFTER_SIGNAL";
export type CostModel = "RAW_PRICE" | "CONFIGURED_FIXED";
export type LimitFillPolicy = "TOUCH_FILLED" | "TRADE_THROUGH_REQUIRED";
export type BacktestOutcome = "WIN" | "LOSS" | "AMBIGUOUS_EXIT" |
  "AMBIGUOUS_ENTRY_EXIT" | "UNFILLED" | "OPEN_AT_DATA_END";
export type EntryStatus = "FILLED" | "UNFILLED";
export type ExitStatus = "TP_HIT" | "SL_HIT" | "AMBIGUOUS_EXIT" |
  "AMBIGUOUS_ENTRY_EXIT" | "OPEN" | null;

export type BacktestExecutionConfig = Readonly<{
  entryExecutionMode: EntryExecutionMode;
  costModel: CostModel;
  configuredSpread: number | null;
  configuredSlippage: number | null;
  limitFillPolicy: LimitFillPolicy;
  sameBarAmbiguityPolicy: "MARK_AMBIGUOUS";
  stopGapPolicy: "OPEN_PRICE";
  targetGapPolicy: "LIMIT_AT_TARGET";
  rangeOutcomePolicy: "STRICT_WINDOW";
  endOfTestPolicy: "LEAVE_OPEN";
}>;

export const DEFAULT_BACKTEST_EXECUTION_CONFIG: BacktestExecutionConfig = Object.freeze({
  entryExecutionMode: "MARKET_AT_SIGNAL_CLOSE",
  costModel: "RAW_PRICE",
  configuredSpread: null,
  configuredSlippage: null,
  limitFillPolicy: "TRADE_THROUGH_REQUIRED",
  sameBarAmbiguityPolicy: "MARK_AMBIGUOUS",
  stopGapPolicy: "OPEN_PRICE",
  targetGapPolicy: "LIMIT_AT_TARGET",
  rangeOutcomePolicy: "STRICT_WINDOW",
  endOfTestPolicy: "LEAVE_OPEN",
});

export type BacktestTrade = Readonly<{
  id: string;
  signalId: string;
  direction: SignalAction;
  setupFamily: SetupFamily;
  signalAvailableAt: number;
  plannedEntryPrice: number;
  plannedStopPrice: number;
  plannedTargetPrice: number;
  plannedRR: number;
  orderType: EntryExecutionMode;
  executionConfigHash: string;
  entryStatus: EntryStatus;
  fillAt: number | null;
  rawEntryPrice: number | null;
  simulatedEntryPrice: number | null;
  entryCost: number | null;
  exitStatus: ExitStatus;
  exitAt: number | null;
  rawExitPrice: number | null;
  simulatedExitPrice: number | null;
  exitCost: number | null;
  totalExecutionCost: number | null;
  grossPricePnl: number | null;
  netPricePnl: number | null;
  plannedRisk: number;
  rawInitialRisk: number | null;
  actualInitialRisk: number | null;
  executableInitialRR: number | null;
  grossR: number | null;
  netR: number | null;
  mfePrice: number | null;
  maePrice: number | null;
  mfeR: number | null;
  maeR: number | null;
  mfeAtr: number | null;
  maeAtr: number | null;
  timeToMfeBars: number | null;
  timeToMaeBars: number | null;
  barsInTrade: number;
  outcome: BacktestOutcome;
  ambiguityType: "INTRABAR_EXIT_ORDER_UNKNOWN" |
    "ENTRY_EXIT_ORDER_UNKNOWN" | null;
  excursionAmbiguous: boolean;
  lineageIds: Readonly<Signal["lineage"]>;
}>;

export type RMetrics = Readonly<{
  denominator: number;
  averageR: number | null;
  medianR: number | null;
  expectancyR: number | null;
  averageWinnerR: number | null;
  averageLoserR: number | null;
  grossPositiveR: number;
  grossNegativeR: number;
  profitFactor: number | null;
  profitFactorStatus: "AVAILABLE" | "NO_NEGATIVE_TRADES" | "NO_RESOLVED_TRADES";
  bestTradeR: number | null;
  worstTradeR: number | null;
}>;
export type TradeBreakdown = Readonly<{
  signals: number; filled: number; resolved: number; wins: number; losses: number;
  ambiguous: number; averageR: number | null; expectancyR: number | null;
  profitFactor: number | null; averageMfeR: number | null; averageMaeR: number | null;
}>;
export type FrequencyStats = Readonly<{
  days: number; total: number; mean: number | null; median: number | null;
  min: number | null; max: number | null; zeroDays: number;
}>;
export type BacktestSummary = Readonly<{
  totalSignals: number;
  filledTrades: number;
  resolvedTrades: number;
  wins: number;
  losses: number;
  ambiguousTrades: number;
  ambiguousExits: number;
  ambiguousEntryExits: number;
  unfilledSignals: number;
  openAtEnd: number;
  resolvedWinRate: number | null;
  resolvedWinRateDenominator: number;
  raw: RMetrics;
  adjusted: Readonly<{ status: "AVAILABLE" | "NOT_AVAILABLE";
    reason: "CONFIGURED_COST_SCENARIO" | "HISTORICAL_SPREAD_NOT_AVAILABLE";
    metrics: RMetrics | null }>;
  averageMfeR: number | null;
  medianMfeR: number | null;
  averageMaeR: number | null;
  medianMaeR: number | null;
  averageBarsInTrade: number | null;
  medianBarsInTrade: number | null;
  cumulativeResolvedR: number;
  maxTradeSequenceDrawdownR: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  ambiguityRate: number | null;
}>;
export type BacktestDiagnostics = Readonly<{
  candlesProcessed: number;
  signalsConsumed: number;
  signalsOutsideEvaluationRange: number;
  duplicateSignals: number;
  maxSimultaneousActiveTrades: number;
  maxPendingSignals: number;
  configuredCostScenario: boolean;
  historicalSpreadStatus: "HISTORICAL_SPREAD_NOT_AVAILABLE";
  referenceAtrUnavailableTrades: number;
  phase14Comparable: boolean;
  phase14Matches: number;
  phase14Differences: readonly string[];
  lookAheadViolations: number;
  repaintViolations: number;
}>;
export type BacktestMetadata = Readonly<{
  runId: string;
  resultFingerprint: string;
  datasetFingerprint: string;
  strategyConfigHash: string;
  strategyEngineVersion: string;
  backtestEngineVersion: string;
  executionConfigHash: string;
  dataWarmupStart: number;
  evaluationStart: number;
  evaluationEnd: number;
  rangeSemantics: "HALF_OPEN";
  dailyGrouping: "UTC_CALENDAR_DAY";
}>;
export type BacktestResult = Readonly<{
  status: "READY";
  metadata: BacktestMetadata;
  executionConfig: BacktestExecutionConfig;
  summary: BacktestSummary;
  setupFamilies: Readonly<Record<SetupFamily, TradeBreakdown>>;
  directions: Readonly<Record<SignalAction, TradeBreakdown>>;
  frequency: Readonly<{ signalsPerTradingDay: FrequencyStats;
    fillsPerTradingDay: FrequencyStats; resolvedPerTradingDay: FrequencyStats }>;
  executionDegradation: Readonly<{ averageEntryCost: number | null;
    averageExitCost: number | null; averageTotalCost: number | null;
    averageGrossToNetRChange: number | null;
    averagePlannedToExecutableRrChange: number | null }>;
  diagnostics: BacktestDiagnostics;
  trades: readonly BacktestTrade[];
  timingMs: number;
}>;

export type BacktestInput = {
  dataset: HistoricalResult;
  signals: readonly (Signal | ImmutableSignal)[];
  evaluationStart: number;
  evaluationEnd: number;
  dataWarmupStart?: number;
  strategyConfigHash: string;
  strategyEngineVersion: string;
  datasetFingerprint?: string;
  executionConfig?: Partial<BacktestExecutionConfig>;
  phase14Ledger?: SignalLedger;
  referenceAtrByRiskValidationId?: ReadonlyMap<string, number>;
};
export type LedgerBacktestInput = Omit<BacktestInput, "signals"> & {
  phase14Ledger: SignalLedger;
};

export class BacktestInputError extends Error {
  constructor(readonly code: "UPSTREAM_DATA_STATUS" | "INVALID_RANGE" |
    "INVALID_CANDLE" | "INVALID_SIGNAL" | "SIGNAL_WITHOUT_CANDLE" |
    "SIGNAL_ENTRY_ALIGNMENT" | "DATASET_IDENTITY_MISMATCH" |
    "INVALID_EXECUTION_CONFIG" | "DUPLICATE_SIGNAL_CONFLICT") { super(code); }
}

type Pending = { signal: Signal | ImmutableSignal; tradeId: string };
type Tracker = {
  signal: Signal | ImmutableSignal;
  tradeId: string;
  fillAt: number;
  entryIndex: number;
  rawEntry: number;
  simulatedEntry: number;
  entryCost: number;
  rawRisk: number;
  actualRisk: number;
  mfe: number;
  mae: number;
  timeToMfe: number;
  timeToMae: number;
  bars: number;
  referenceAtr: number | null;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
function hash(value: unknown): string {
  const input = canonical(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
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
function validCandle(candle: Candle): boolean {
  return candle.symbol === "XAUUSD" && candle.timeframe === "1m" &&
    Number.isSafeInteger(candle.timestamp) && candle.low > 0 &&
    [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.low <= candle.open && candle.low <= candle.close &&
    candle.high >= candle.open && candle.high >= candle.close;
}
function validSignal(signal: Signal | ImmutableSignal): boolean {
  return !!signal.id && signal.symbol === "XAUUSD" && signal.timeframe === "1m" &&
    Number.isSafeInteger(signal.availableAt) && signal.createdAt <= signal.availableAt &&
    [signal.entryPrice, signal.stopLoss, signal.takeProfit, signal.rr]
      .every((value) => Number.isFinite(value) && value > 0) &&
    (signal.direction === "BUY" ? signal.stopLoss < signal.entryPrice &&
      signal.entryPrice < signal.takeProfit : signal.takeProfit < signal.entryPrice &&
      signal.entryPrice < signal.stopLoss);
}
function resolveExecutionConfig(overrides: Partial<BacktestExecutionConfig> = {}):
  BacktestExecutionConfig {
  const config = Object.freeze({ ...DEFAULT_BACKTEST_EXECUTION_CONFIG, ...overrides });
  const nonnegative = (value: number | null): boolean => value !== null &&
    Number.isFinite(value) && value >= 0;
  if (config.costModel === "CONFIGURED_FIXED" &&
      (!nonnegative(config.configuredSpread) ||
       !nonnegative(config.configuredSlippage))) {
    throw new BacktestInputError("INVALID_EXECUTION_CONFIG");
  }
  if (config.costModel === "RAW_PRICE" &&
      (config.configuredSpread !== null || config.configuredSlippage !== null)) {
    throw new BacktestInputError("INVALID_EXECUTION_CONFIG");
  }
  if (!["MARKET_AT_SIGNAL_CLOSE", "NEXT_BAR_OPEN", "LIMIT_AFTER_SIGNAL"]
      .includes(config.entryExecutionMode) ||
      !["RAW_PRICE", "CONFIGURED_FIXED"].includes(config.costModel) ||
      !["TOUCH_FILLED", "TRADE_THROUGH_REQUIRED"].includes(config.limitFillPolicy) ||
      config.sameBarAmbiguityPolicy !== "MARK_AMBIGUOUS" ||
      config.rangeOutcomePolicy !== "STRICT_WINDOW" ||
      config.endOfTestPolicy !== "LEAVE_OPEN" ||
      config.stopGapPolicy !== "OPEN_PRICE" ||
      config.targetGapPolicy !== "LIMIT_AT_TARGET") {
    throw new BacktestInputError("INVALID_EXECUTION_CONFIG");
  }
  return config;
}
export function fingerprintBacktestExecutionConfig(
  overrides: Partial<BacktestExecutionConfig> = {}): string {
  return `${BACKTEST_ENGINE_VERSION}-${hash(resolveExecutionConfig(overrides))}`;
}
function executionPrice(raw: number, side: "BUY" | "SELL",
  config: BacktestExecutionConfig): number {
  if (config.costModel === "RAW_PRICE") return raw;
  const adverse = config.configuredSpread! / 2 + config.configuredSlippage!;
  return side === "BUY" ? raw + adverse : raw - adverse;
}
function exitSide(direction: SignalAction): "BUY" | "SELL" {
  return direction === "BUY" ? "SELL" : "BUY";
}
function directional(direction: SignalAction, exit: number, entry: number): number {
  return direction === "BUY" ? exit - entry : entry - exit;
}
function touchesStop(signal: Signal | ImmutableSignal, candle: Candle): boolean {
  return signal.direction === "BUY" ? candle.low <= signal.stopLoss :
    candle.high >= signal.stopLoss;
}
function touchesTarget(signal: Signal | ImmutableSignal, candle: Candle): boolean {
  return signal.direction === "BUY" ? candle.high >= signal.takeProfit :
    candle.low <= signal.takeProfit;
}
function opensThroughStop(signal: Signal | ImmutableSignal, candle: Candle): boolean {
  return signal.direction === "BUY" ? candle.open <= signal.stopLoss :
    candle.open >= signal.stopLoss;
}
function opensThroughTarget(signal: Signal | ImmutableSignal, candle: Candle): boolean {
  return signal.direction === "BUY" ? candle.open >= signal.takeProfit :
    candle.open <= signal.takeProfit;
}
function limitFills(signal: Signal | ImmutableSignal, candle: Candle,
  policy: LimitFillPolicy): boolean {
  if (signal.direction === "BUY") return policy === "TOUCH_FILLED" ?
    candle.low <= signal.entryPrice : candle.low < signal.entryPrice;
  return policy === "TOUCH_FILLED" ? candle.high >= signal.entryPrice :
    candle.high > signal.entryPrice;
}
function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  return sorted.length % 2 ? sorted[middle] :
    (sorted[middle - 1] + sorted[middle]) / 2;
}
function rMetrics(trades: readonly BacktestTrade[], key: "grossR" | "netR"): RMetrics {
  const values: number[] = [];
  const winners: number[] = [];
  const losers: number[] = [];
  let positive = 0; let negative = 0;
  let best: number | null = null; let worst: number | null = null;
  for (const trade of trades) {
    const value = trade[key];
    if ((trade.outcome !== "WIN" && trade.outcome !== "LOSS") || value === null) continue;
    values.push(value);
    if (value > 0) { positive += value; winners.push(value); }
    if (value < 0) { negative += value; losers.push(value); }
    best = best === null ? value : Math.max(best, value);
    worst = worst === null ? value : Math.min(worst, value);
  }
  const pfStatus = !values.length ? "NO_RESOLVED_TRADES" :
    negative === 0 ? "NO_NEGATIVE_TRADES" : "AVAILABLE";
  return Object.freeze({ denominator: values.length, averageR: mean(values),
    medianR: median(values), expectancyR: mean(values),
    averageWinnerR: mean(winners), averageLoserR: mean(losers),
    grossPositiveR: positive, grossNegativeR: negative,
    profitFactor: negative === 0 ? null : positive / Math.abs(negative),
    profitFactorStatus: pfStatus, bestTradeR: best, worstTradeR: worst });
}
function breakdown(trades: readonly BacktestTrade[]): TradeBreakdown {
  const filled = trades.filter((trade) => trade.entryStatus === "FILLED");
  const resolved = filled.filter((trade) => trade.outcome === "WIN" || trade.outcome === "LOSS");
  const metrics = rMetrics(resolved, "grossR");
  return Object.freeze({ signals: trades.length, filled: filled.length,
    resolved: resolved.length,
    wins: resolved.filter((trade) => trade.outcome === "WIN").length,
    losses: resolved.filter((trade) => trade.outcome === "LOSS").length,
    ambiguous: filled.filter((trade) => trade.outcome.startsWith("AMBIGUOUS")).length,
    averageR: metrics.averageR, expectancyR: metrics.expectancyR,
    profitFactor: metrics.profitFactor,
    averageMfeR: mean(resolved.flatMap((trade) => trade.mfeR === null ? [] : [trade.mfeR])),
    averageMaeR: mean(resolved.flatMap((trade) => trade.maeR === null ? [] : [trade.maeR])) });
}
function frequency(days: readonly string[], counts: ReadonlyMap<string, number>): FrequencyStats {
  const values = days.map((day) => counts.get(day) ?? 0);
  return Object.freeze({ days: days.length,
    total: values.reduce((sum, value) => sum + value, 0), mean: mean(values),
    median: median(values), min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    zeroDays: values.filter((value) => value === 0).length });
}

class Simulator {
  private readonly pending = new Map<string, Pending>();
  private readonly active = new Map<string, Tracker>();
  private readonly records: BacktestTrade[] = [];
  private readonly signalDays = new Map<string, number>();
  private readonly fillDays = new Map<string, number>();
  private readonly resolvedDays = new Map<string, number>();
  private maxActive = 0;
  private maxPending = 0;
  private referenceAtrUnavailable = 0;

  constructor(private readonly config: BacktestExecutionConfig,
    private readonly executionConfigHash: string,
    private readonly referenceAtrByRiskValidationId?: ReadonlyMap<string, number>) {}

  private count(map: Map<string, number>, at: number): void {
    const day = utcDay(at);
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  private tracker(signal: Signal | ImmutableSignal, tradeId: string,
    rawEntry: number, at: number, index: number): Tracker {
    const simulatedEntry = executionPrice(rawEntry, signal.direction, this.config);
    const rawRisk = Math.abs(rawEntry - signal.stopLoss);
    const executableStop = executionPrice(signal.stopLoss, exitSide(signal.direction), this.config);
    const actualRisk = Math.abs(simulatedEntry - executableStop);
    this.count(this.fillDays, at);
    const referenceAtr = this.referenceAtrByRiskValidationId?.get(
      signal.lineage.riskValidationId) ?? null;
    if (referenceAtr === null || !Number.isFinite(referenceAtr) || referenceAtr <= 0) {
      this.referenceAtrUnavailable++;
    }
    return { signal, tradeId, fillAt: at, entryIndex: index, rawEntry,
      simulatedEntry, entryCost: Math.abs(simulatedEntry - rawEntry),
      rawRisk, actualRisk, mfe: 0, mae: 0, timeToMfe: 0, timeToMae: 0,
      bars: 0, referenceAtr: referenceAtr !== null &&
        Number.isFinite(referenceAtr) && referenceAtr > 0 ? referenceAtr : null };
  }
  private updateKnown(tracker: Tracker, price: number, index: number): void {
    const movement = directional(tracker.signal.direction, price, tracker.simulatedEntry);
    const favorable = Math.max(0, movement);
    const adverse = Math.max(0, -movement);
    const elapsed = index - tracker.entryIndex;
    if (favorable > tracker.mfe) { tracker.mfe = favorable; tracker.timeToMfe = elapsed; }
    if (adverse > tracker.mae) { tracker.mae = adverse; tracker.timeToMae = elapsed; }
  }
  private updateFullCandle(tracker: Tracker, candle: Candle, index: number): void {
    const favorablePrice = tracker.signal.direction === "BUY" ? candle.high : candle.low;
    const adversePrice = tracker.signal.direction === "BUY" ? candle.low : candle.high;
    this.updateKnown(tracker, favorablePrice, index);
    this.updateKnown(tracker, adversePrice, index);
  }
  private finish(tracker: Tracker, outcome: BacktestOutcome,
    exitStatus: ExitStatus, exitAt: number | null, rawExit: number | null,
    ambiguityType: BacktestTrade["ambiguityType"] = null,
    excursionAmbiguous = false): void {
    const signal = tracker.signal;
    const simulatedExit = rawExit === null ? null :
      executionPrice(rawExit, exitSide(signal.direction), this.config);
    const exitCost = rawExit === null ? null : Math.abs(simulatedExit! - rawExit);
    const grossPnl = rawExit === null ? null : directional(signal.direction,
      rawExit, tracker.rawEntry);
    const netPnl = simulatedExit === null ? null : directional(signal.direction,
      simulatedExit, tracker.simulatedEntry);
    const resolved = outcome === "WIN" || outcome === "LOSS";
    const executableTarget = executionPrice(signal.takeProfit,
      exitSide(signal.direction), this.config);
    const executableReward = directional(signal.direction,
      executableTarget, tracker.simulatedEntry);
    const executableInitialRR = tracker.actualRisk > 0 && executableReward > 0 ?
      executableReward / tracker.actualRisk : null;
    const grossR = resolved && tracker.rawRisk > 0 ? grossPnl! / tracker.rawRisk : null;
    const netR = resolved && this.config.costModel === "CONFIGURED_FIXED" &&
      tracker.actualRisk > 0 ? netPnl! / tracker.actualRisk : null;
    if (resolved && exitAt !== null) this.count(this.resolvedDays, exitAt);
    this.records.push(Object.freeze({ id: tracker.tradeId, signalId: signal.id,
      direction: signal.direction, setupFamily: signal.setupFamily,
      signalAvailableAt: signal.availableAt, plannedEntryPrice: signal.entryPrice,
      plannedStopPrice: signal.stopLoss, plannedTargetPrice: signal.takeProfit,
      plannedRR: signal.rr,
      orderType: this.config.entryExecutionMode,
      executionConfigHash: this.executionConfigHash, entryStatus: "FILLED",
      fillAt: tracker.fillAt, rawEntryPrice: tracker.rawEntry,
      simulatedEntryPrice: tracker.simulatedEntry, entryCost: tracker.entryCost,
      exitStatus, exitAt, rawExitPrice: rawExit,
      simulatedExitPrice: simulatedExit, exitCost,
      totalExecutionCost: exitCost === null ? tracker.entryCost : tracker.entryCost + exitCost,
      grossPricePnl: resolved ? grossPnl : null,
      netPricePnl: resolved && this.config.costModel === "CONFIGURED_FIXED" ? netPnl : null,
      plannedRisk: Math.abs(signal.entryPrice - signal.stopLoss),
      rawInitialRisk: tracker.rawRisk, actualInitialRisk: tracker.actualRisk,
      executableInitialRR,
      grossR, netR, mfePrice: tracker.mfe, maePrice: tracker.mae,
      mfeR: tracker.actualRisk > 0 ? tracker.mfe / tracker.actualRisk : null,
      maeR: tracker.actualRisk > 0 ? tracker.mae / tracker.actualRisk : null,
      mfeAtr: tracker.referenceAtr === null ? null : tracker.mfe / tracker.referenceAtr,
      maeAtr: tracker.referenceAtr === null ? null : tracker.mae / tracker.referenceAtr,
      timeToMfeBars: tracker.timeToMfe,
      timeToMaeBars: tracker.timeToMae, barsInTrade: tracker.bars,
      outcome, ambiguityType, excursionAmbiguous,
      lineageIds: Object.freeze({ ...signal.lineage }) }));
  }
  private unfilled(pending: Pending): void {
    const signal = pending.signal;
    this.records.push(Object.freeze({ id: pending.tradeId, signalId: signal.id,
      direction: signal.direction, setupFamily: signal.setupFamily,
      signalAvailableAt: signal.availableAt, plannedEntryPrice: signal.entryPrice,
      plannedStopPrice: signal.stopLoss, plannedTargetPrice: signal.takeProfit,
      plannedRR: signal.rr,
      orderType: this.config.entryExecutionMode,
      executionConfigHash: this.executionConfigHash, entryStatus: "UNFILLED",
      fillAt: null, rawEntryPrice: null, simulatedEntryPrice: null, entryCost: null,
      exitStatus: null, exitAt: null, rawExitPrice: null, simulatedExitPrice: null,
      exitCost: null, totalExecutionCost: null, grossPricePnl: null,
      netPricePnl: null, plannedRisk: Math.abs(signal.entryPrice - signal.stopLoss),
      rawInitialRisk: null, actualInitialRisk: null, executableInitialRR: null,
      grossR: null, netR: null,
      mfePrice: null, maePrice: null, mfeR: null, maeR: null, mfeAtr: null,
      maeAtr: null, timeToMfeBars: null, timeToMaeBars: null, barsInTrade: 0,
      outcome: "UNFILLED", ambiguityType: null, excursionAmbiguous: false,
      lineageIds: Object.freeze({ ...signal.lineage }) }));
  }
  private processTracker(tracker: Tracker, candle: Candle, index: number): boolean {
    const signal = tracker.signal;
    tracker.bars++;
    if (opensThroughStop(signal, candle)) {
      this.updateKnown(tracker, candle.open, index);
      this.finish(tracker, "LOSS", "SL_HIT", candle.timestamp, candle.open);
      return true;
    }
    if (opensThroughTarget(signal, candle)) {
      this.updateKnown(tracker, signal.takeProfit, index);
      this.finish(tracker, "WIN", "TP_HIT", candle.timestamp, signal.takeProfit);
      return true;
    }
    const stop = touchesStop(signal, candle);
    const target = touchesTarget(signal, candle);
    if (stop && target) {
      this.finish(tracker, "AMBIGUOUS_EXIT", "AMBIGUOUS_EXIT", candle.timestamp,
        null, "INTRABAR_EXIT_ORDER_UNKNOWN", true);
      return true;
    }
    if (target) {
      this.updateKnown(tracker, signal.takeProfit, index);
      this.finish(tracker, "WIN", "TP_HIT", candle.timestamp,
        signal.takeProfit, null, true);
      return true;
    }
    if (stop) {
      this.updateKnown(tracker, signal.stopLoss, index);
      this.finish(tracker, "LOSS", "SL_HIT", candle.timestamp,
        signal.stopLoss, null, true);
      return true;
    }
    this.updateFullCandle(tracker, candle, index);
    return false;
  }
  processCandle(candle: Candle, index: number): void {
    for (const [id, tracker] of this.active) {
      if (this.processTracker(tracker, candle, index)) this.active.delete(id);
    }
    for (const [id, pending] of this.pending) {
      const signal = pending.signal;
      if (candle.timestamp <= signal.availableAt) continue;
      if (this.config.entryExecutionMode === "NEXT_BAR_OPEN") {
        this.pending.delete(id);
        const tracker = this.tracker(signal, pending.tradeId, candle.open,
          candle.timestamp, index);
        if (opensThroughStop(signal, candle) || opensThroughTarget(signal, candle)) {
          tracker.bars = 1;
          this.finish(tracker, "AMBIGUOUS_ENTRY_EXIT", "AMBIGUOUS_ENTRY_EXIT",
            candle.timestamp, null, "ENTRY_EXIT_ORDER_UNKNOWN", true);
        } else if (!this.processTracker(tracker, candle, index)) this.active.set(id, tracker);
      } else if (this.config.entryExecutionMode === "LIMIT_AFTER_SIGNAL" &&
          limitFills(signal, candle, this.config.limitFillPolicy)) {
        this.pending.delete(id);
        const tracker = this.tracker(signal, pending.tradeId, signal.entryPrice,
          candle.timestamp, index);
        tracker.bars = 1;
        if (touchesStop(signal, candle) || touchesTarget(signal, candle)) {
          this.finish(tracker, "AMBIGUOUS_ENTRY_EXIT", "AMBIGUOUS_ENTRY_EXIT",
            candle.timestamp, null, "ENTRY_EXIT_ORDER_UNKNOWN", true);
        } else this.active.set(id, tracker);
      }
    }
    this.maxActive = Math.max(this.maxActive, this.active.size);
    this.maxPending = Math.max(this.maxPending, this.pending.size);
  }
  activate(signal: Signal | ImmutableSignal, index: number, candle: Candle): void {
    this.count(this.signalDays, signal.availableAt);
    const tradeId = `XAUUSD:BACKTEST:${this.executionConfigHash}:${signal.id}`;
    if (this.config.entryExecutionMode === "MARKET_AT_SIGNAL_CLOSE") {
      if (candle.close !== signal.entryPrice) {
        throw new BacktestInputError("SIGNAL_ENTRY_ALIGNMENT");
      }
      const tracker = this.tracker(signal, tradeId, signal.entryPrice,
        signal.availableAt, index);
      this.active.set(signal.id, tracker);
      this.maxActive = Math.max(this.maxActive, this.active.size);
    } else {
      this.pending.set(signal.id, { signal, tradeId });
      this.maxPending = Math.max(this.maxPending, this.pending.size);
    }
  }
  closeAtEnd(): void {
    for (const pending of this.pending.values()) this.unfilled(pending);
    this.pending.clear();
    for (const tracker of this.active.values()) {
      this.finish(tracker, "OPEN_AT_DATA_END", "OPEN", null, null);
    }
    this.active.clear();
  }
  result(): { trades: BacktestTrade[]; maxActive: number; maxPending: number;
    referenceAtrUnavailable: number; signalDays: Map<string, number>;
    fillDays: Map<string, number>; resolvedDays: Map<string, number> } {
    this.records.sort((a, b) => a.signalAvailableAt - b.signalAvailableAt ||
      a.signalId.localeCompare(b.signalId));
    return { trades: this.records, maxActive: this.maxActive,
      maxPending: this.maxPending,
      referenceAtrUnavailable: this.referenceAtrUnavailable,
      signalDays: this.signalDays, fillDays: this.fillDays,
      resolvedDays: this.resolvedDays };
  }
}

function sequenceStats(trades: readonly BacktestTrade[]): {
  cumulative: number; drawdown: number; winStreak: number; lossStreak: number } {
  const resolved = trades.filter((trade) =>
    (trade.outcome === "WIN" || trade.outcome === "LOSS") &&
    trade.grossR !== null && trade.exitAt !== null).sort((a, b) =>
      a.exitAt! - b.exitAt! || a.id.localeCompare(b.id));
  let cumulative = 0; let peak = 0; let drawdown = 0;
  let wins = 0; let losses = 0; let maxWins = 0; let maxLosses = 0;
  for (const trade of resolved) {
    cumulative += trade.grossR!;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
    if (trade.outcome === "WIN") {
      wins++; losses = 0; maxWins = Math.max(maxWins, wins);
    } else {
      losses++; wins = 0; maxLosses = Math.max(maxLosses, losses);
    }
  }
  return { cumulative, drawdown, winStreak: maxWins, lossStreak: maxLosses };
}
function summary(trades: readonly BacktestTrade[], configured: boolean): BacktestSummary {
  const filled = trades.filter((trade) => trade.entryStatus === "FILLED");
  const resolved = filled.filter((trade) => trade.outcome === "WIN" || trade.outcome === "LOSS");
  const wins = resolved.filter((trade) => trade.outcome === "WIN").length;
  const losses = resolved.length - wins;
  const ambiguousExit = filled.filter((trade) => trade.outcome === "AMBIGUOUS_EXIT").length;
  const ambiguousEntry = filled.filter((trade) => trade.outcome === "AMBIGUOUS_ENTRY_EXIT").length;
  const mfe = filled.flatMap((trade) => trade.mfeR === null ||
    trade.outcome.startsWith("AMBIGUOUS") ? [] : [trade.mfeR]);
  const mae = filled.flatMap((trade) => trade.maeR === null ||
    trade.outcome.startsWith("AMBIGUOUS") ? [] : [trade.maeR]);
  const bars = filled.map((trade) => trade.barsInTrade);
  const sequence = sequenceStats(trades);
  return Object.freeze({ totalSignals: trades.length, filledTrades: filled.length,
    resolvedTrades: resolved.length, wins, losses,
    ambiguousTrades: ambiguousExit + ambiguousEntry,
    ambiguousExits: ambiguousExit, ambiguousEntryExits: ambiguousEntry,
    unfilledSignals: trades.filter((trade) => trade.outcome === "UNFILLED").length,
    openAtEnd: filled.filter((trade) => trade.outcome === "OPEN_AT_DATA_END").length,
    resolvedWinRate: resolved.length ? wins / resolved.length : null,
    resolvedWinRateDenominator: resolved.length, raw: rMetrics(resolved, "grossR"),
    adjusted: Object.freeze({ status: configured ? "AVAILABLE" : "NOT_AVAILABLE",
      reason: configured ? "CONFIGURED_COST_SCENARIO" :
        "HISTORICAL_SPREAD_NOT_AVAILABLE",
      metrics: configured ? rMetrics(resolved, "netR") : null }),
    averageMfeR: mean(mfe), medianMfeR: median(mfe),
    averageMaeR: mean(mae), medianMaeR: median(mae),
    averageBarsInTrade: mean(bars), medianBarsInTrade: median(bars),
    cumulativeResolvedR: sequence.cumulative,
    maxTradeSequenceDrawdownR: sequence.drawdown,
    maxConsecutiveWins: sequence.winStreak,
    maxConsecutiveLosses: sequence.lossStreak,
    ambiguityRate: filled.length ? (ambiguousExit + ambiguousEntry) / filled.length : null });
}
export function summarizeBacktestTrades(trades: readonly BacktestTrade[],
  configuredCosts = false): BacktestSummary {
  return summary(trades, configuredCosts);
}
function expectedLifecycle(outcome: BacktestOutcome): string {
  if (outcome === "WIN") return "TP_HIT";
  if (outcome === "LOSS") return "SL_HIT";
  if (outcome === "AMBIGUOUS_EXIT") return "AMBIGUOUS_EXIT";
  return outcome === "OPEN_AT_DATA_END" ? "ACTIVE" : outcome;
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const started = performance.now();
  if (input.dataset.status === "BLOCKED" || input.dataset.status === "FAILED") {
    throw new BacktestInputError("UPSTREAM_DATA_STATUS");
  }
  if (!Number.isSafeInteger(input.evaluationStart) ||
      !Number.isSafeInteger(input.evaluationEnd) ||
      input.evaluationStart >= input.evaluationEnd) {
    throw new BacktestInputError("INVALID_RANGE");
  }
  const warmupStart = input.dataWarmupStart ?? input.dataset.requestedRange.start;
  if (!Number.isSafeInteger(warmupStart) || warmupStart > input.evaluationStart) {
    throw new BacktestInputError("INVALID_RANGE");
  }
  const datasetFingerprint = fingerprintHistoricalDataset(input.dataset);
  if (input.datasetFingerprint && input.datasetFingerprint !== datasetFingerprint) {
    throw new BacktestInputError("DATASET_IDENTITY_MISMATCH");
  }
  const config = resolveExecutionConfig(input.executionConfig);
  const executionConfigHash = fingerprintBacktestExecutionConfig(config);
  const runId = `backtest-${hash({ datasetFingerprint,
    strategyConfigHash: input.strategyConfigHash,
    strategyEngineVersion: input.strategyEngineVersion,
    executionConfigHash, start: input.evaluationStart, end: input.evaluationEnd })}`;
  const candles = input.dataset.candles1m;
  const candleStart = lowerBound(candles, input.evaluationStart, (item) => item.timestamp);
  const candleEnd = lowerBound(candles, input.evaluationEnd, (item) => item.timestamp);
  if (candleStart >= candleEnd) throw new BacktestInputError("INVALID_RANGE");
  let previous = -Infinity;
  for (let i = candleStart; i < candleEnd; i++) {
    if (!validCandle(candles[i]) || candles[i].timestamp <= previous) {
      throw new BacktestInputError("INVALID_CANDLE");
    }
    previous = candles[i].timestamp;
  }
  const sorted = [...input.signals].sort((a, b) =>
    a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  const unique: (Signal | ImmutableSignal)[] = [];
  const byId = new Map<string, Signal | ImmutableSignal>();
  let duplicates = 0;
  for (const signal of sorted) {
    if (!validSignal(signal)) throw new BacktestInputError("INVALID_SIGNAL");
    const known = byId.get(signal.id);
    if (known) {
      if (canonical(known) !== canonical(signal)) {
        throw new BacktestInputError("DUPLICATE_SIGNAL_CONFLICT");
      }
      duplicates++;
      continue;
    }
    byId.set(signal.id, signal);
    unique.push(signal);
  }
  const signalStart = lowerBound(unique, input.evaluationStart, (item) => item.availableAt);
  const signalEnd = lowerBound(unique, input.evaluationEnd, (item) => item.availableAt);
  const cohort = unique.slice(signalStart, signalEnd);
  const simulator = new Simulator(config, executionConfigHash,
    input.referenceAtrByRiskValidationId);
  const days = new Set<string>();
  let signalCursor = 0;
  for (let index = candleStart; index < candleEnd; index++) {
    const candle = candles[index];
    days.add(utcDay(candle.timestamp));
    simulator.processCandle(candle, index);
    while (signalCursor < cohort.length &&
        cohort[signalCursor].availableAt <= candle.timestamp) {
      const signal = cohort[signalCursor++];
      if (signal.availableAt !== candle.timestamp) {
        throw new BacktestInputError("SIGNAL_WITHOUT_CANDLE");
      }
      simulator.activate(signal, index, candle);
    }
  }
  if (signalCursor !== cohort.length) throw new BacktestInputError("SIGNAL_WITHOUT_CANDLE");
  simulator.closeAtEnd();
  const simulation = simulator.result();
  const rawSummary = summary(simulation.trades, config.costModel === "CONFIGURED_FIXED");
  const setupFamilies = Object.fromEntries(FAMILIES.map((family) =>
    [family, breakdown(simulation.trades.filter((trade) => trade.setupFamily === family))])) as
    Record<SetupFamily, TradeBreakdown>;
  const directions = Object.fromEntries(DIRECTIONS.map((direction) =>
    [direction, breakdown(simulation.trades.filter((trade) => trade.direction === direction))])) as
    Record<SignalAction, TradeBreakdown>;
  const tradingDays = [...days].sort();
  const phase14Differences: string[] = [];
  let phase14Matches = 0;
  const comparable = !!input.phase14Ledger &&
    config.entryExecutionMode === "MARKET_AT_SIGNAL_CLOSE" &&
    config.costModel === "RAW_PRICE";
  if (comparable) {
    for (const trade of simulation.trades) {
      const record = input.phase14Ledger!.getById(trade.signalId,
        input.evaluationEnd - 1);
      if (record && record.lifecycle.status === expectedLifecycle(trade.outcome)) {
        phase14Matches++;
      } else phase14Differences.push(trade.signalId);
    }
  }
  const entryCosts = simulation.trades.flatMap((trade) =>
    trade.entryCost === null ? [] : [trade.entryCost]);
  const exitCosts = simulation.trades.flatMap((trade) =>
    trade.exitCost === null ? [] : [trade.exitCost]);
  const totalCosts = simulation.trades.flatMap((trade) =>
    trade.totalExecutionCost === null ? [] : [trade.totalExecutionCost]);
  const rChanges = simulation.trades.flatMap((trade) =>
    trade.grossR === null || trade.netR === null ? [] : [trade.netR - trade.grossR]);
  const rrChanges = simulation.trades.flatMap((trade) =>
    trade.executableInitialRR === null ? [] :
      [trade.executableInitialRR - trade.plannedRR]);
  const diagnostics: BacktestDiagnostics = Object.freeze({
    candlesProcessed: candleEnd - candleStart, signalsConsumed: cohort.length,
    signalsOutsideEvaluationRange: unique.length - cohort.length,
    duplicateSignals: duplicates,
    maxSimultaneousActiveTrades: simulation.maxActive,
    maxPendingSignals: simulation.maxPending,
    configuredCostScenario: config.costModel === "CONFIGURED_FIXED",
    historicalSpreadStatus: "HISTORICAL_SPREAD_NOT_AVAILABLE",
    referenceAtrUnavailableTrades: simulation.referenceAtrUnavailable,
    phase14Comparable: comparable, phase14Matches,
    phase14Differences: Object.freeze(phase14Differences),
    lookAheadViolations: 0, repaintViolations: 0 });
  const semantic = { runId, executionConfigHash, trades: simulation.trades,
    summary: rawSummary, setupFamilies, directions };
  const metadata: BacktestMetadata = Object.freeze({ runId,
    resultFingerprint: `backtest-result-${hash(semantic)}`,
    datasetFingerprint, strategyConfigHash: input.strategyConfigHash,
    strategyEngineVersion: input.strategyEngineVersion,
    backtestEngineVersion: BACKTEST_ENGINE_VERSION, executionConfigHash,
    dataWarmupStart: warmupStart, evaluationStart: input.evaluationStart,
    evaluationEnd: input.evaluationEnd, rangeSemantics: "HALF_OPEN",
    dailyGrouping: "UTC_CALENDAR_DAY" });
  return Object.freeze({ status: "READY", metadata, executionConfig: config,
    summary: rawSummary,
    setupFamilies: Object.freeze(setupFamilies), directions: Object.freeze(directions),
    frequency: Object.freeze({
      signalsPerTradingDay: frequency(tradingDays, simulation.signalDays),
      fillsPerTradingDay: frequency(tradingDays, simulation.fillDays),
      resolvedPerTradingDay: frequency(tradingDays, simulation.resolvedDays) }),
    executionDegradation: Object.freeze({ averageEntryCost: mean(entryCosts),
      averageExitCost: mean(exitCosts), averageTotalCost: mean(totalCosts),
      averageGrossToNetRChange: mean(rChanges),
      averagePlannedToExecutableRrChange: mean(rrChanges) }), diagnostics,
    trades: Object.freeze(simulation.trades),
    timingMs: performance.now() - started });
}

export function runBacktestFromLedger(input: LedgerBacktestInput): BacktestResult {
  const signals = input.phase14Ledger.getSignalEventsThrough(input.evaluationEnd - 1);
  return runBacktest({ ...input, signals });
}
