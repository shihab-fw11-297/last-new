import type { AggregateCandle, Candle, DataStatus, HistoricalResult, Timeframe } from "../data/types.ts";
import type { CandlePsychologyFeature, CandlePsychologyResult } from "./candle-psychology.ts";

type SourceCandle = Candle | AggregateCandle;
type Extreme = { index: number; timestamp: number; price: number };
export type MarketLegDirection = "UNKNOWN" | "UP_LEG" | "DOWN_LEG";
export type StructureState = "BULLISH" | "BEARISH" | "TRANSITION" | "RANGE_OR_UNCLEAR";
export type SwingType = "SWING_HIGH" | "SWING_LOW";
export type SwingClassification = "HH" | "HL" | "LH" | "LL" | "UNCLASSIFIED";
export type StructureEventType =
  "LEVEL_PENETRATION" | "BULLISH_CONTINUATION_BREAK" | "BEARISH_CONTINUATION_BREAK" |
  "RAW_BULLISH_STRUCTURE_SHIFT" | "RAW_BEARISH_STRUCTURE_SHIFT";

export type MarketStructureConfig = {
  minLegAtrMultiple: number;
  reversalAtrMultiple: number;
  breakAtrMultiple: number;
  equalToleranceAtrMultiple: number;
};

export const DEFAULT_MARKET_STRUCTURE_CONFIG: Readonly<MarketStructureConfig> = Object.freeze({
  minLegAtrMultiple: 1,
  reversalAtrMultiple: 1,
  breakAtrMultiple: 0.1,
  equalToleranceAtrMultiple: 0.01,
});

export type MarketSwing = {
  id: string;
  timeframe: Timeframe;
  type: SwingType;
  timestamp: number;
  price: number;
  sourceIndex: number;
  createdAt: number;
  availableAt: number;
  previousSameTypeSwingId: string | null;
  classification: SwingClassification;
};

export type MarketLeg = {
  id: string;
  timeframe: Timeframe;
  direction: "UP_LEG" | "DOWN_LEG";
  fromSwingId: string;
  toSwingId: string;
  createdAt: number;
  availableAt: number;
  priceDistance: number;
};

export type StructureEvent = {
  id: string;
  timeframe: Timeframe;
  type: StructureEventType;
  breakKind: "LEVEL_PENETRATION" | "CLOSE_BREAK";
  direction: "BULLISH" | "BEARISH";
  side: "HIGH" | "LOW";
  timestamp: number;
  price: number;
  levelPrice: number;
  sourceIndex: number;
  createdAt: number;
  availableAt: number;
  brokenSwingId: string;
};

export type StructureCurrent = {
  state: StructureState;
  currentLeg: MarketLegDirection;
  latestSwingHighId: string | null;
  latestSwingLowId: string | null;
  protectedHighId: string | null;
  protectedLowId: string | null;
};

export type StructureDiagnostics = {
  processedCandles: number;
  analyzedCandles: number;
  swingHighs: number;
  swingLows: number;
  HH: number;
  HL: number;
  LH: number;
  LL: number;
  continuationBreaks: number;
  rawShifts: number;
  levelPenetrations: number;
  errorCode?: string;
  errorIndex?: number;
};

export type MarketStructureResult = {
  status: "READY" | "BLOCKED";
  timeframe: Timeframe;
  swings: MarketSwing[];
  legs: MarketLeg[];
  events: StructureEvent[];
  current: StructureCurrent;
  diagnostics: StructureDiagnostics;
  timingMs: number;
};

export type MultiTimeframeStructureResult = {
  status: DataStatus;
  symbol: "XAUUSD";
  config: Readonly<MarketStructureConfig>;
  timeframes: Record<Timeframe, MarketStructureResult>;
  timings: Record<Timeframe, number> & { totalMs: number };
  errorCode?: string;
};

class StructureInputError extends Error {
  constructor(readonly code: "INPUT_ALIGNMENT" | "INVALID_PSYCHOLOGY" | "INPUT_ORDER") { super(code); }
}

function resolveConfig(overrides: Partial<MarketStructureConfig>): Readonly<MarketStructureConfig> {
  const config = { ...DEFAULT_MARKET_STRUCTURE_CONFIG, ...overrides };
  if (!Number.isFinite(config.minLegAtrMultiple) || config.minLegAtrMultiple <= 0 ||
      !Number.isFinite(config.reversalAtrMultiple) || config.reversalAtrMultiple <= 0 ||
      !Number.isFinite(config.breakAtrMultiple) || config.breakAtrMultiple < 0 ||
      !Number.isFinite(config.equalToleranceAtrMultiple) || config.equalToleranceAtrMultiple < 0) {
    throw new RangeError("Invalid market structure configuration");
  }
  return Object.freeze(config);
}

function extreme(index: number, timestamp: number, price: number): Extreme {
  return { index, timestamp, price };
}

// Aggregate timestamps identify the UTC bucket start. Its final 1m source
// candle is the first time the completed aggregate can be known.
function candleAvailableAt(candle: SourceCandle): number {
  return "bucketEnd" in candle ? candle.bucketEnd - 60_000 : candle.timestamp;
}

type ActiveLevel = { swing: MarketSwing; penetrated: boolean; broken: boolean };

export class MarketStructureEngine {
  readonly config: Readonly<MarketStructureConfig>;
  readonly swings: MarketSwing[] = [];
  readonly legs: MarketLeg[] = [];
  readonly events: StructureEvent[] = [];

  private leg: MarketLegDirection = "UNKNOWN";
  private state: StructureState = "RANGE_OR_UNCLEAR";
  private previousTimestamp: number | null = null;
  private seedClose: number | null = null;
  private candidateHigh: Extreme | null = null;
  private candidateLow: Extreme | null = null;
  private postHighLow: Extreme | null = null;
  private postLowHigh: Extreme | null = null;
  private originLow: number | null = null;
  private originHigh: number | null = null;
  private lastHigh: MarketSwing | null = null;
  private lastLow: MarketSwing | null = null;
  private lastSwing: MarketSwing | null = null;
  private activeHigh: ActiveLevel | null = null;
  private activeLow: ActiveLevel | null = null;
  private counters: StructureDiagnostics = {
    processedCandles: 0, analyzedCandles: 0, swingHighs: 0, swingLows: 0,
    HH: 0, HL: 0, LH: 0, LL: 0, continuationBreaks: 0, rawShifts: 0, levelPenetrations: 0,
  };

  constructor(readonly timeframe: Timeframe, overrides: Partial<MarketStructureConfig> = {}) {
    this.config = resolveConfig(overrides);
  }

  get current(): StructureCurrent {
    return {
      state: this.state, currentLeg: this.leg,
      latestSwingHighId: this.lastHigh?.id ?? null,
      latestSwingLowId: this.lastLow?.id ?? null,
      protectedHighId: this.state === "BEARISH" ? this.lastHigh?.id ?? null : null,
      protectedLowId: this.state === "BULLISH" ? this.lastLow?.id ?? null : null,
    };
  }

  get diagnostics(): StructureDiagnostics { return { ...this.counters }; }

  push(candle: SourceCandle, psychology: CandlePsychologyFeature): void {
    if (candle.timeframe !== this.timeframe || psychology.timeframe !== this.timeframe ||
        candle.timestamp !== psychology.timestamp ||
        psychology.sourceComplete !== ("isComplete" in candle ? candle.isComplete : true)) {
      throw new StructureInputError("INPUT_ALIGNMENT");
    }
    if ("bucketEnd" in candle &&
        (!Number.isSafeInteger(candle.bucketEnd) || candle.bucketEnd <= candle.timestamp ||
          (candle.bucketEnd - candle.timestamp) % 60_000 !== 0)) {
      throw new StructureInputError("INPUT_ALIGNMENT");
    }
    if (!Number.isSafeInteger(candle.timestamp) ||
        (this.previousTimestamp !== null && candle.timestamp <= this.previousTimestamp)) {
      throw new StructureInputError("INPUT_ORDER");
    }
    if (psychology.atrReady &&
        (psychology.atr === null || !Number.isFinite(psychology.atr) || psychology.atr < 0)) {
      throw new StructureInputError("INVALID_PSYCHOLOGY");
    }
    const index = this.counters.processedCandles;
    this.counters.processedCandles++;
    this.previousTimestamp = candle.timestamp;
    if (!psychology.sourceComplete) return;
    const atr = psychology.atrReady ? psychology.atr : null;
    if (atr === null || atr <= 0) return;
    this.counters.analyzedCandles++;

    // Breaks use levels already confirmed before this candle. A swing confirmed by
    // this close cannot become a break target retroactively on the same close.
    const rawShift = this.evaluateBreaks(candle, index, atr);
    if (this.seedClose === null) {
      this.seedClose = candle.close;
      this.candidateHigh = extreme(index, candle.timestamp, candle.high);
      this.candidateLow = extreme(index, candle.timestamp, candle.low);
      this.postHighLow = this.candidateLow;
      this.postLowHigh = this.candidateHigh;
      return;
    }
    if (this.leg === "UNKNOWN") {
      if (candle.high > this.candidateHigh!.price) this.candidateHigh = extreme(index, candle.timestamp, candle.high);
      if (candle.low < this.candidateLow!.price) this.candidateLow = extreme(index, candle.timestamp, candle.low);
      const distance = this.config.minLegAtrMultiple * atr;
      if (candle.close - this.seedClose >= distance) {
        this.leg = "UP_LEG";
        this.originLow = this.candidateLow!.price;
        this.postHighLow = extreme(index, candle.timestamp, candle.low);
        this.postLowHigh = extreme(index, candle.timestamp, candle.high);
      } else if (this.seedClose - candle.close >= distance) {
        this.leg = "DOWN_LEG";
        this.originHigh = this.candidateHigh!.price;
        this.postLowHigh = extreme(index, candle.timestamp, candle.high);
        this.postHighLow = extreme(index, candle.timestamp, candle.low);
      }
      return;
    }
    if (this.leg === "UP_LEG") {
      if (candle.high > this.candidateHigh!.price) {
        this.candidateHigh = extreme(index, candle.timestamp, candle.high);
        this.postHighLow = extreme(index, candle.timestamp, candle.low);
        this.postLowHigh = extreme(index, candle.timestamp, candle.high);
      } else if (candle.low < this.postHighLow!.price) {
        this.postHighLow = extreme(index, candle.timestamp, candle.low);
        this.postLowHigh = extreme(index, candle.timestamp, candle.high);
      } else if (candle.high > this.postLowHigh!.price) {
        this.postLowHigh = extreme(index, candle.timestamp, candle.high);
      }
      if (this.candidateHigh!.index < index &&
          (!this.lastLow || this.candidateHigh!.index > this.lastLow.sourceIndex) &&
          this.candidateHigh!.price - this.originLow! >= this.config.minLegAtrMultiple * atr &&
          this.candidateHigh!.price - candle.close >= this.config.reversalAtrMultiple * atr) {
        this.confirmSwing("SWING_HIGH", this.candidateHigh!, candleAvailableAt(candle), atr);
        this.leg = "DOWN_LEG";
        this.originHigh = this.candidateHigh!.price;
        this.candidateLow = this.postHighLow;
        this.postHighLow = extreme(index, candle.timestamp, candle.low);
      }
    } else {
      if (candle.low < this.candidateLow!.price) {
        this.candidateLow = extreme(index, candle.timestamp, candle.low);
        this.postLowHigh = extreme(index, candle.timestamp, candle.high);
        this.postHighLow = extreme(index, candle.timestamp, candle.low);
      } else if (candle.high > this.postLowHigh!.price) {
        this.postLowHigh = extreme(index, candle.timestamp, candle.high);
        this.postHighLow = extreme(index, candle.timestamp, candle.low);
      } else if (candle.low < this.postHighLow!.price) {
        this.postHighLow = extreme(index, candle.timestamp, candle.low);
      }
      if (this.candidateLow!.index < index &&
          (!this.lastHigh || this.candidateLow!.index > this.lastHigh.sourceIndex) &&
          this.originHigh! - this.candidateLow!.price >= this.config.minLegAtrMultiple * atr &&
          candle.close - this.candidateLow!.price >= this.config.reversalAtrMultiple * atr) {
        this.confirmSwing("SWING_LOW", this.candidateLow!, candleAvailableAt(candle), atr);
        this.leg = "UP_LEG";
        this.originLow = this.candidateLow!.price;
        this.candidateHigh = this.postLowHigh;
        this.postLowHigh = extreme(index, candle.timestamp, candle.high);
      }
    }
    if (rawShift) this.state = "TRANSITION";
  }

  private confirmSwing(type: SwingType, origin: Extreme, availableAt: number, atr: number): void {
    const previousSame = type === "SWING_HIGH" ? this.lastHigh : this.lastLow;
    let classification: SwingClassification = "UNCLASSIFIED";
    if (previousSame) {
      const difference = origin.price - previousSame.price;
      const tolerance = atr * this.config.equalToleranceAtrMultiple;
      if (difference > tolerance) classification = type === "SWING_HIGH" ? "HH" : "HL";
      else if (difference < -tolerance) classification = type === "SWING_HIGH" ? "LH" : "LL";
    }
    const swing: MarketSwing = {
      id: `XAUUSD:${this.timeframe}:${type}:${origin.index}:${origin.timestamp}:${availableAt}`,
      timeframe: this.timeframe, type, timestamp: origin.timestamp, price: origin.price,
      sourceIndex: origin.index, createdAt: origin.timestamp, availableAt,
      previousSameTypeSwingId: previousSame?.id ?? null, classification,
    };
    this.swings.push(swing);
    if (type === "SWING_HIGH") {
      this.lastHigh = swing;
      this.activeHigh = { swing, penetrated: false, broken: false };
      this.counters.swingHighs++;
    } else {
      this.lastLow = swing;
      this.activeLow = { swing, penetrated: false, broken: false };
      this.counters.swingLows++;
    }
    if (classification !== "UNCLASSIFIED") this.counters[classification]++;
    if (this.lastSwing && this.lastSwing.type !== type && this.lastSwing.sourceIndex < origin.index) {
      const direction = type === "SWING_HIGH" ? "UP_LEG" : "DOWN_LEG";
      this.legs.push({
        id: `XAUUSD:${this.timeframe}:${direction}:${this.lastSwing.id}:${swing.id}`,
        timeframe: this.timeframe, direction,
        fromSwingId: this.lastSwing.id, toSwingId: swing.id,
        createdAt: this.lastSwing.createdAt, availableAt,
        priceDistance: Math.abs(swing.price - this.lastSwing.price),
      });
    }
    this.lastSwing = swing;
    const highTrend = this.lastHigh?.classification === "HH" ? 1 : this.lastHigh?.classification === "LH" ? -1 : 0;
    const lowTrend = this.lastLow?.classification === "HL" ? 1 : this.lastLow?.classification === "LL" ? -1 : 0;
    this.state = highTrend === 1 && lowTrend === 1 ? "BULLISH" :
      highTrend === -1 && lowTrend === -1 ? "BEARISH" :
      highTrend !== 0 && lowTrend !== 0 ? "TRANSITION" : "RANGE_OR_UNCLEAR";
  }

  private evaluateBreaks(candle: SourceCandle, index: number, atr: number): boolean {
    let rawShift = false;
    if (this.state === "BULLISH") {
      this.inspectLevel(this.activeHigh, "HIGH", "BULLISH_CONTINUATION_BREAK", candle, index, atr);
      rawShift = this.inspectLevel(this.activeLow, "LOW", "RAW_BEARISH_STRUCTURE_SHIFT", candle, index, atr);
    } else if (this.state === "BEARISH") {
      this.inspectLevel(this.activeLow, "LOW", "BEARISH_CONTINUATION_BREAK", candle, index, atr);
      rawShift = this.inspectLevel(this.activeHigh, "HIGH", "RAW_BULLISH_STRUCTURE_SHIFT", candle, index, atr);
    }
    return rawShift;
  }

  private inspectLevel(level: ActiveLevel | null, side: "HIGH" | "LOW",
    breakType: Exclude<StructureEventType, "LEVEL_PENETRATION">,
    candle: SourceCandle, index: number, atr: number): boolean {
    if (!level || level.broken) return false;
    const tolerance = atr * this.config.equalToleranceAtrMultiple;
    const breakDistance = atr * this.config.breakAtrMultiple;
    const closeBreak = side === "HIGH" ? candle.close > level.swing.price + breakDistance :
      candle.close < level.swing.price - breakDistance;
    if (closeBreak) {
      level.broken = true;
      this.emitEvent(breakType, "CLOSE_BREAK", side, level.swing, candle, index, candle.close);
      if (breakType.includes("CONTINUATION")) this.counters.continuationBreaks++;
      else this.counters.rawShifts++;
      return breakType.startsWith("RAW_");
    }
    const penetration = side === "HIGH" ? candle.high > level.swing.price + tolerance :
      candle.low < level.swing.price - tolerance;
    if (penetration && !level.penetrated) {
      level.penetrated = true;
      this.emitEvent("LEVEL_PENETRATION", "LEVEL_PENETRATION", side, level.swing,
        candle, index, side === "HIGH" ? candle.high : candle.low);
      this.counters.levelPenetrations++;
    }
    return false;
  }

  private emitEvent(type: StructureEventType, breakKind: StructureEvent["breakKind"],
    side: "HIGH" | "LOW", swing: MarketSwing, candle: SourceCandle,
    index: number, price: number): void {
    this.events.push({
      id: `XAUUSD:${this.timeframe}:${type}:${swing.id}:${candle.timestamp}`,
      timeframe: this.timeframe, type, breakKind,
      direction: side === "HIGH" ? "BULLISH" : "BEARISH", side,
      timestamp: candle.timestamp, price, levelPrice: swing.price,
      sourceIndex: index, createdAt: candle.timestamp, availableAt: candleAvailableAt(candle),
      brokenSwingId: swing.id,
    });
  }
}

export function createMarketStructureEngine(timeframe: Timeframe,
  config: Partial<MarketStructureConfig> = {}): MarketStructureEngine {
  return new MarketStructureEngine(timeframe, config);
}

function emptyResult(timeframe: Timeframe, errorCode?: string, errorIndex?: number): MarketStructureResult {
  const diagnostics: StructureDiagnostics = {
    processedCandles: 0, analyzedCandles: 0, swingHighs: 0, swingLows: 0,
    HH: 0, HL: 0, LH: 0, LL: 0, continuationBreaks: 0, rawShifts: 0, levelPenetrations: 0,
  };
  if (errorCode) diagnostics.errorCode = errorCode;
  if (errorIndex !== undefined) diagnostics.errorIndex = errorIndex;
  return { status: "BLOCKED", timeframe, swings: [], legs: [], events: [],
    current: { state: "RANGE_OR_UNCLEAR", currentLeg: "UNKNOWN", latestSwingHighId: null,
      latestSwingLowId: null, protectedHighId: null, protectedLowId: null },
    diagnostics, timingMs: 0 };
}

export function analyzeMarketStructure(candles: readonly SourceCandle[],
  psychology: readonly CandlePsychologyFeature[], timeframe: Timeframe,
  config: Partial<MarketStructureConfig> = {}): MarketStructureResult {
  const started = performance.now();
  if (candles.length !== psychology.length) return emptyResult(timeframe, "INPUT_ALIGNMENT");
  const engine = createMarketStructureEngine(timeframe, config);
  for (let i = 0; i < candles.length; i++) {
    try { engine.push(candles[i], psychology[i]); }
    catch (error) {
      if (error instanceof StructureInputError) return emptyResult(timeframe, error.code, i);
      throw error;
    }
  }
  return { status: "READY", timeframe, swings: engine.swings, legs: engine.legs,
    events: engine.events, current: engine.current, diagnostics: engine.diagnostics,
    timingMs: performance.now() - started };
}

export function analyzeHistoricalMarketStructure(historical: HistoricalResult,
  psychology: CandlePsychologyResult,
  overrides: Partial<MarketStructureConfig> = {}): MultiTimeframeStructureResult {
  const started = performance.now();
  const config = resolveConfig(overrides);
  const emptyTimeframes = (): Record<Timeframe, MarketStructureResult> => ({
    "1m": emptyResult("1m"), "5m": emptyResult("5m"),
    "15m": emptyResult("15m"), "1h": emptyResult("1h"),
  });
  const emptyTimings = () => ({ "1m": 0, "5m": 0, "15m": 0, "1h": 0, totalMs: performance.now() - started });
  if (historical.status === "BLOCKED" || historical.status === "FAILED" ||
      psychology.status === "BLOCKED" || psychology.status === "FAILED") {
    const status = historical.status === "FAILED" || psychology.status === "FAILED" ? "FAILED" : "BLOCKED";
    return { status, symbol: "XAUUSD", config, timeframes: emptyTimeframes(), timings: emptyTimings(),
      errorCode: "UPSTREAM_DATA_STATUS" };
  }
  const sources: Record<Timeframe, readonly SourceCandle[]> = {
    "1m": historical.candles1m, "5m": historical.timeframes["5m"],
    "15m": historical.timeframes["15m"], "1h": historical.timeframes["1h"],
  };
  const results = emptyTimeframes();
  for (const timeframe of ["1m", "5m", "15m", "1h"] as const) {
    const result = analyzeMarketStructure(sources[timeframe], psychology.timeframes[timeframe].features,
      timeframe, config);
    if (result.status === "BLOCKED") {
      const blocked = emptyTimeframes();
      blocked[timeframe] = result;
      return { status: "BLOCKED", symbol: "XAUUSD", config, timeframes: blocked,
        timings: emptyTimings(), errorCode: result.diagnostics.errorCode };
    }
    results[timeframe] = result;
  }
  const timings = { "1m": results["1m"].timingMs, "5m": results["5m"].timingMs,
    "15m": results["15m"].timingMs, "1h": results["1h"].timingMs,
    totalMs: performance.now() - started };
  const status = historical.status === "WARN" || psychology.status === "WARN" ? "WARN" : "READY";
  return { status, symbol: "XAUUSD", config, timeframes: results, timings };
}
