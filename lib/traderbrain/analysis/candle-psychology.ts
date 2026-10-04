import type { AggregateCandle, Candle, DataStatus, HistoricalResult, Timeframe } from "../data/types.ts";

type SourceCandle = Candle | AggregateCandle;
export type CandleDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type CandlePsychologyConfig = {
  atrPeriod: number;
  shortWindow: number;
  mediumWindow: number;
  baselineWindow: number;
  strongBodyRatio: number;
  strongClosePosition: number;
  strongBodyToAtr: number;
  rejectionWickRatio: number;
  rejectionMaxBodyRatio: number;
  rejectionClosePosition: number;
  indecisionMaxBodyRatio: number;
  indecisionMinWickRatio: number;
  expansionRangeToAtr: number;
  expansionMaxOverlap: number;
  compressionRangeFactor: number;
  compressionMinOverlap: number;
  compressionMaxEfficiency: number;
  momentumIncreaseFactor: number;
  momentumDecayFactor: number;
};

export const DEFAULT_CANDLE_PSYCHOLOGY_CONFIG: Readonly<CandlePsychologyConfig> = Object.freeze({
  atrPeriod: 14,
  shortWindow: 3,
  mediumWindow: 5,
  baselineWindow: 20,
  strongBodyRatio: 0.6,
  strongClosePosition: 0.8,
  strongBodyToAtr: 0.8,
  rejectionWickRatio: 0.5,
  rejectionMaxBodyRatio: 0.4,
  rejectionClosePosition: 0.4,
  indecisionMaxBodyRatio: 0.2,
  indecisionMinWickRatio: 0.2,
  expansionRangeToAtr: 1.3,
  expansionMaxOverlap: 0.4,
  compressionRangeFactor: 0.8,
  compressionMinOverlap: 0.5,
  compressionMaxEfficiency: 0.4,
  momentumIncreaseFactor: 1.2,
  momentumDecayFactor: 0.8,
});

export type CandleEvidence = {
  strongBullishClose: boolean;
  strongBearishClose: boolean;
  upperRejection: boolean;
  lowerRejection: boolean;
  indecision: boolean;
  expansion: boolean;
  compression: boolean;
  momentumIncreasing: boolean;
  momentumDecaying: boolean;
};

export type CandlePsychologyFeature = {
  timestamp: number;
  timeframe: Timeframe;
  sourceComplete: boolean;
  direction: CandleDirection;
  range: number;
  body: number;
  upperWick: number;
  lowerWick: number;
  bodyToRangeRatio: number | null;
  upperWickToRangeRatio: number | null;
  lowerWickToRangeRatio: number | null;
  openPosition: number | null;
  closePosition: number | null;
  changeFromPreviousClose: number | null;
  trueRange: number;
  atr: number | null;
  atrReady: boolean;
  rangeToATR: number | null;
  bodyToATR: number | null;
  changeToATR: number | null;
  overlapWithPreviousCandle: number | null;
  overlapRatio: number | null;
  closeAbovePreviousHigh: boolean | null;
  closeBelowPreviousLow: boolean | null;
  highAbovePreviousHigh: boolean | null;
  lowBelowPreviousLow: boolean | null;
  insidePreviousRange: boolean | null;
  outsidePreviousRange: boolean | null;
  consecutiveBullishCount: number;
  consecutiveBearishCount: number;
  rollingAverageRange: number | null;
  baselineAverageRange: number | null;
  rollingAverageBody: number | null;
  rollingAverageRangeToATR: number | null;
  rollingAverageBodyToATR: number | null;
  rollingAverageOverlap: number | null;
  rollingDirectionalMovement: number | null;
  directionalEfficiency: number | null;
  evidence: CandleEvidence;
};

class RollingMean {
  private readonly values: Float64Array;
  private readonly valid: Uint8Array;
  private cursor = 0;
  private count = 0;
  private validCount = 0;
  private sum = 0;

  constructor(private readonly size: number) {
    this.values = new Float64Array(size);
    this.valid = new Uint8Array(size);
  }

  push(value: number | null): number | null {
    if (this.count === this.size) {
      if (this.valid[this.cursor]) {
        this.sum -= this.values[this.cursor];
        this.validCount--;
      }
    } else this.count++;
    if (value === null) {
      this.values[this.cursor] = 0;
      this.valid[this.cursor] = 0;
    } else {
      this.values[this.cursor] = value;
      this.valid[this.cursor] = 1;
      this.sum += value;
      this.validCount++;
    }
    if (!Number.isFinite(this.sum)) throw new RangeError("Non-finite rolling candle psychology value");
    this.cursor = (this.cursor + 1) % this.size;
    return this.count === this.size && this.validCount === this.size ? this.sum / this.size : null;
  }
}

class CloseWindow {
  private readonly values: Float64Array;
  private cursor = 0;
  private count = 0;

  constructor(size: number) { this.values = new Float64Array(size + 1); }

  push(close: number): number | null {
    this.values[this.cursor] = close;
    this.cursor = (this.cursor + 1) % this.values.length;
    if (this.count < this.values.length) this.count++;
    return this.count === this.values.length ? this.values[this.cursor] : null;
  }
}

function ratio(numerator: number, denominator: number | null): number | null {
  if (denominator === null || denominator <= 0) return null;
  const value = numerator / denominator;
  if (!Number.isFinite(value)) throw new RangeError("Non-finite candle psychology ratio");
  return value;
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Non-finite candle psychology value");
  return value;
}

function resolvedConfig(overrides: Partial<CandlePsychologyConfig>): Readonly<CandlePsychologyConfig> {
  const config = { ...DEFAULT_CANDLE_PSYCHOLOGY_CONFIG, ...overrides };
  for (const key of ["atrPeriod", "shortWindow", "mediumWindow", "baselineWindow"] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new RangeError(`Invalid ${key}`);
  }
  if (config.shortWindow > config.baselineWindow) throw new RangeError("shortWindow exceeds baselineWindow");
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new RangeError(`Invalid ${key}`);
  }
  for (const key of ["strongBodyRatio", "strongClosePosition", "rejectionWickRatio",
    "rejectionMaxBodyRatio", "rejectionClosePosition", "indecisionMaxBodyRatio",
    "indecisionMinWickRatio", "expansionMaxOverlap", "compressionRangeFactor",
    "compressionMinOverlap", "compressionMaxEfficiency", "momentumDecayFactor"] as const) {
    if (config[key] < 0 || config[key] > 1) throw new RangeError(`Invalid ${key}`);
  }
  for (const key of ["strongBodyToAtr", "expansionRangeToAtr", "momentumIncreaseFactor"] as const) {
    if (config[key] <= 0) throw new RangeError(`Invalid ${key}`);
  }
  return Object.freeze(config);
}

export class CandlePsychologyEngine {
  readonly config: Readonly<CandlePsychologyConfig>;
  private readonly atrWindow: RollingMean;
  private readonly rangeWindow: RollingMean;
  private readonly baselineRangeWindow: RollingMean;
  private readonly bodyWindow: RollingMean;
  private readonly rangeAtrWindow: RollingMean;
  private readonly bodyAtrWindow: RollingMean;
  private readonly overlapWindow: RollingMean;
  private readonly pathWindow: RollingMean;
  private readonly closes: CloseWindow;
  private previous: SourceCandle | null = null;
  private previousEfficiency: number | null = null;
  private bullishRun = 0;
  private bearishRun = 0;
  private processed = 0;

  constructor(readonly timeframe: Timeframe, overrides: Partial<CandlePsychologyConfig> = {}) {
    this.config = resolvedConfig(overrides);
    this.atrWindow = new RollingMean(this.config.atrPeriod);
    this.rangeWindow = new RollingMean(this.config.shortWindow);
    this.baselineRangeWindow = new RollingMean(this.config.baselineWindow);
    this.bodyWindow = new RollingMean(this.config.shortWindow);
    this.rangeAtrWindow = new RollingMean(this.config.shortWindow);
    this.bodyAtrWindow = new RollingMean(this.config.shortWindow);
    this.overlapWindow = new RollingMean(this.config.shortWindow);
    this.pathWindow = new RollingMean(this.config.mediumWindow);
    this.closes = new CloseWindow(this.config.mediumWindow);
  }

  push(candle: SourceCandle): CandlePsychologyFeature {
    if (candle.timeframe !== this.timeframe) throw new RangeError("Candle timeframe mismatch");
    if (!Number.isSafeInteger(candle.timestamp)) throw new RangeError("Invalid source timestamp");
    if (this.previous && candle.timestamp <= this.previous.timestamp) throw new RangeError("Candles must be strictly ascending");
    const previous = this.previous;
    const { open, high, low, close } = candle;
    const range = finite(high - low);
    const body = finite(Math.abs(close - open));
    const upperWick = finite(high - Math.max(open, close));
    const lowerWick = finite(Math.min(open, close) - low);
    if (range < 0 || upperWick < 0 || lowerWick < 0) throw new RangeError("Invalid source OHLC");
    const direction: CandleDirection = close > open ? "BULLISH" : close < open ? "BEARISH" : "NEUTRAL";
    const bodyToRangeRatio = ratio(body, range);
    const upperWickToRangeRatio = ratio(upperWick, range);
    const lowerWickToRangeRatio = ratio(lowerWick, range);
    const openPosition = ratio(open - low, range);
    const closePosition = ratio(close - low, range);
    const changeFromPreviousClose = previous ? finite(close - previous.close) : null;
    const trueRange = previous ? finite(Math.max(range, Math.abs(high - previous.close), Math.abs(low - previous.close))) : range;
    const atr = this.atrWindow.push(trueRange);
    const atrReady = atr !== null;
    const rangeToATR = ratio(range, atr);
    const bodyToATR = ratio(body, atr);
    const changeToATR = changeFromPreviousClose === null ? null : ratio(Math.abs(changeFromPreviousClose), atr);
    const overlapWithPreviousCandle = previous ? finite(Math.max(0, Math.min(high, previous.high) - Math.max(low, previous.low))) : null;
    const overlapRatio = overlapWithPreviousCandle === null ? null : ratio(overlapWithPreviousCandle, range);
    const closeAbovePreviousHigh = previous ? close > previous.high : null;
    const closeBelowPreviousLow = previous ? close < previous.low : null;
    const highAbovePreviousHigh = previous ? high > previous.high : null;
    const lowBelowPreviousLow = previous ? low < previous.low : null;
    const insidePreviousRange = previous ? high <= previous.high && low >= previous.low : null;
    const outsidePreviousRange = previous ? high > previous.high && low < previous.low : null;
    this.bullishRun = direction === "BULLISH" ? this.bullishRun + 1 : 0;
    this.bearishRun = direction === "BEARISH" ? this.bearishRun + 1 : 0;
    const rollingAverageRange = this.rangeWindow.push(range);
    const baselineAverageRange = this.baselineRangeWindow.push(range);
    const rollingAverageBody = this.bodyWindow.push(body);
    const previousBodyAtrAverage = this.processed >= this.config.shortWindow ? this.lastBodyAtrAverage : null;
    const rollingAverageRangeToATR = this.rangeAtrWindow.push(rangeToATR);
    const rollingAverageBodyToATR = this.bodyAtrWindow.push(bodyToATR);
    this.lastBodyAtrAverage = rollingAverageBodyToATR;
    const rollingAverageOverlap = this.overlapWindow.push(overlapRatio);
    const pathAverage = this.pathWindow.push(changeFromPreviousClose === null ? null : Math.abs(changeFromPreviousClose));
    const windowStartClose = this.closes.push(close);
    const rollingDirectionalMovement = windowStartClose === null ? null : finite(close - windowStartClose);
    const pathMovement = pathAverage === null ? null : finite(pathAverage * this.config.mediumWindow);
    const directionalEfficiency = rollingDirectionalMovement === null || pathMovement === null ? null :
      ratio(Math.abs(rollingDirectionalMovement), pathMovement);
    const c = this.config;
    const strongClose = closePosition !== null && bodyToRangeRatio !== null && bodyToATR !== null &&
      bodyToRangeRatio >= c.strongBodyRatio && bodyToATR >= c.strongBodyToAtr;
    const evidence: CandleEvidence = {
      strongBullishClose: direction === "BULLISH" && strongClose && closePosition! >= c.strongClosePosition,
      strongBearishClose: direction === "BEARISH" && strongClose && closePosition! <= 1 - c.strongClosePosition,
      upperRejection: upperWickToRangeRatio !== null && bodyToRangeRatio !== null && closePosition !== null &&
        upperWickToRangeRatio >= c.rejectionWickRatio && bodyToRangeRatio <= c.rejectionMaxBodyRatio &&
        closePosition <= c.rejectionClosePosition,
      lowerRejection: lowerWickToRangeRatio !== null && bodyToRangeRatio !== null && closePosition !== null &&
        lowerWickToRangeRatio >= c.rejectionWickRatio && bodyToRangeRatio <= c.rejectionMaxBodyRatio &&
        closePosition >= 1 - c.rejectionClosePosition,
      indecision: bodyToRangeRatio !== null && upperWickToRangeRatio !== null && lowerWickToRangeRatio !== null &&
        bodyToRangeRatio <= c.indecisionMaxBodyRatio && upperWickToRangeRatio >= c.indecisionMinWickRatio &&
        lowerWickToRangeRatio >= c.indecisionMinWickRatio,
      expansion: rangeToATR !== null && bodyToRangeRatio !== null && overlapRatio !== null && closePosition !== null &&
        rangeToATR >= c.expansionRangeToAtr && bodyToRangeRatio >= c.strongBodyRatio &&
        overlapRatio <= c.expansionMaxOverlap &&
        ((direction === "BULLISH" && closePosition >= c.strongClosePosition) ||
         (direction === "BEARISH" && closePosition <= 1 - c.strongClosePosition)),
      compression: rollingAverageRange !== null && baselineAverageRange !== null &&
        rollingAverageOverlap !== null && directionalEfficiency !== null &&
        rollingAverageRange <= baselineAverageRange * c.compressionRangeFactor &&
        rollingAverageOverlap >= c.compressionMinOverlap &&
        directionalEfficiency <= c.compressionMaxEfficiency,
      momentumIncreasing: bodyToATR !== null && previousBodyAtrAverage !== null &&
        directionalEfficiency !== null && this.previousEfficiency !== null &&
        bodyToATR >= previousBodyAtrAverage * c.momentumIncreaseFactor &&
        directionalEfficiency > this.previousEfficiency,
      momentumDecaying: bodyToATR !== null && previousBodyAtrAverage !== null &&
        directionalEfficiency !== null && this.previousEfficiency !== null &&
        bodyToATR <= previousBodyAtrAverage * c.momentumDecayFactor &&
        directionalEfficiency < this.previousEfficiency,
    };
    const feature: CandlePsychologyFeature = {
      timestamp: candle.timestamp, timeframe: this.timeframe,
      sourceComplete: "isComplete" in candle ? candle.isComplete : true,
      direction, range, body, upperWick, lowerWick,
      bodyToRangeRatio, upperWickToRangeRatio, lowerWickToRangeRatio, openPosition, closePosition,
      changeFromPreviousClose, trueRange, atr, atrReady, rangeToATR, bodyToATR, changeToATR,
      overlapWithPreviousCandle, overlapRatio, closeAbovePreviousHigh, closeBelowPreviousLow,
      highAbovePreviousHigh, lowBelowPreviousLow, insidePreviousRange, outsidePreviousRange,
      consecutiveBullishCount: this.bullishRun, consecutiveBearishCount: this.bearishRun,
      rollingAverageRange, baselineAverageRange, rollingAverageBody,
      rollingAverageRangeToATR, rollingAverageBodyToATR, rollingAverageOverlap,
      rollingDirectionalMovement, directionalEfficiency, evidence,
    };
    this.previous = candle;
    this.previousEfficiency = directionalEfficiency;
    this.processed++;
    return feature;
  }

  private lastBodyAtrAverage: number | null = null;
}

export function createCandlePsychologyEngine(timeframe: Timeframe,
  config: Partial<CandlePsychologyConfig> = {}): CandlePsychologyEngine {
  return new CandlePsychologyEngine(timeframe, config);
}

export function analyzeCandleSeries(candles: readonly SourceCandle[], timeframe: Timeframe,
  config: Partial<CandlePsychologyConfig> = {}): CandlePsychologyFeature[] {
  const engine = createCandlePsychologyEngine(timeframe, config);
  const features = new Array<CandlePsychologyFeature>(candles.length);
  for (let i = 0; i < candles.length; i++) features[i] = engine.push(candles[i]);
  return features;
}

type TimeframeFeatures = { features: CandlePsychologyFeature[]; latest: CandlePsychologyFeature | null };
export type CandlePsychologyResult = {
  status: DataStatus;
  symbol: "XAUUSD";
  config: Readonly<CandlePsychologyConfig>;
  timeframes: Record<Timeframe, TimeframeFeatures>;
  diagnostics: { processedCandles: number; warmupCandles: number; invalidDerivedValues: number; errorCode?: string };
  timings: { "1m": number; "5m": number; "15m": number; "1h": number; totalMs: number };
};

export function analyzeHistoricalPsychology(input: HistoricalResult,
  overrides: Partial<CandlePsychologyConfig> = {}): CandlePsychologyResult {
  const started = performance.now();
  const config = resolvedConfig(overrides);
  const empty = (): TimeframeFeatures => ({ features: [], latest: null });
  const timeframes: Record<Timeframe, TimeframeFeatures> = {
    "1m": empty(), "5m": empty(), "15m": empty(), "1h": empty(),
  };
  const timings = { "1m": 0, "5m": 0, "15m": 0, "1h": 0, totalMs: 0 };
  const diagnostics: CandlePsychologyResult["diagnostics"] = {
    processedCandles: 0, warmupCandles: 0, invalidDerivedValues: 0,
  };
  if (input.status === "BLOCKED" || input.status === "FAILED") {
    timings.totalMs = performance.now() - started;
    return { status: input.status, symbol: "XAUUSD", config, timeframes, diagnostics, timings };
  }
  const sources: Record<Timeframe, readonly SourceCandle[]> = {
    "1m": input.candles1m, "5m": input.timeframes["5m"],
    "15m": input.timeframes["15m"], "1h": input.timeframes["1h"],
  };
  try {
    for (const timeframe of ["1m", "5m", "15m", "1h"] as const) {
      const stage = performance.now();
      const features = analyzeCandleSeries(sources[timeframe], timeframe, config);
      timings[timeframe] = performance.now() - stage;
      timeframes[timeframe] = { features, latest: features[features.length - 1] ?? null };
      diagnostics.processedCandles += features.length;
      for (const feature of features) if (!feature.atrReady) diagnostics.warmupCandles++;
    }
  } catch {
    diagnostics.invalidDerivedValues++;
    diagnostics.errorCode = "INVALID_DERIVED_VALUE";
    for (const timeframe of ["1m", "5m", "15m", "1h"] as const) timeframes[timeframe] = empty();
    diagnostics.processedCandles = 0;
    diagnostics.warmupCandles = 0;
    timings.totalMs = performance.now() - started;
    return { status: "BLOCKED", symbol: "XAUUSD", config, timeframes, diagnostics, timings };
  }
  timings.totalMs = performance.now() - started;
  return { status: input.status, symbol: "XAUUSD", config, timeframes, diagnostics, timings };
}
