import type { Candle, DataStatus, HistoricalResult, Timeframe } from "../data/types.ts";
import type { CandlePsychologyFeature, CandlePsychologyResult } from "./candle-psychology.ts";
import type { LiquidityKind, LiquidityLevel, LiquiditySide, MultiTimeframeLiquidityResult } from "./liquidity.ts";

const TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const;
export type ApproachState = "FAR" | "APPROACHING" | "NEAR" | "TOUCHING" | "MOVING_AWAY";
export type ApproachSpeed = "FAST" | "NORMAL" | "SLOW" | "UNKNOWN";
export type ApproachBehavior = "IMPULSIVE" | "COMPRESSED" | "CONTROLLED" | "EXHAUSTED" | "MESSY" | "UNKNOWN";
export type ApproachSide = "ABOVE" | "BELOW" | "AT_PRICE";

export type PriceApproachConfig = {
  nearDistanceAtr: number;
  minApproachBars: number;
  minMovingAwayBars: number;
  speedWindowBars: number;
  fastSpeedAtrPerBar: number;
  slowSpeedAtrPerBar: number;
  exhaustionMaxDirectionalEfficiency: number;
  controlledMinConsistency: number;
};

export const DEFAULT_PRICE_APPROACH_CONFIG: Readonly<PriceApproachConfig> = Object.freeze({
  nearDistanceAtr: 0.5,
  minApproachBars: 2,
  minMovingAwayBars: 2,
  speedWindowBars: 3,
  fastSpeedAtrPerBar: 0.25,
  slowSpeedAtrPerBar: 0.05,
  exhaustionMaxDirectionalEfficiency: 0.4,
  controlledMinConsistency: 0.75,
});

type ApproachPsychology = Pick<CandlePsychologyFeature,
  "timestamp" | "timeframe" | "sourceComplete" | "atr" | "atrReady" | "directionalEfficiency" | "evidence">;

export type ApproachSnapshot = {
  timestamp: number;
  liquidityId: string;
  liquidityType: LiquidityKind;
  liquiditySide: LiquiditySide;
  sourceTimeframe: Timeframe;
  liquidityPrice: number;
  currentPrice: number;
  side: ApproachSide;
  absoluteDistance: number;
  signedDistance: number;
  distanceAtr: number | null;
  distanceChange: number | null;
  distanceChangeAtr: number | null;
  approachBars: number;
  movingAwayBars: number;
  approachConsistency: number | null;
  speedAtrPerBar: number | null;
  state: ApproachState;
  speedClass: ApproachSpeed;
  behaviorClass: ApproachBehavior;
  psychologyEvidence: {
    compression: boolean;
    expansion: boolean;
    momentumIncreasing: boolean;
    momentumDecaying: boolean;
  };
};

export type ApproachCurrent = Record<Timeframe, {
  above: ApproachSnapshot | null;
  below: ApproachSnapshot | null;
}>;

export type ApproachTransition = {
  id: string;
  liquidityId: string;
  sourceTimeframe: Timeframe;
  timestamp: number;
  availableAt: number;
  previousState: ApproachState | null;
  nextState: ApproachState;
  distanceAtr: number | null;
};

export type PriceApproachDiagnostics = {
  processedCandles: number;
  activatedByTimeframe: Record<Timeframe, number>;
  heapPushes: number;
  heapPops: number;
  heapPeeks: number;
  partitionCrossings: number;
  transitions: number;
  stateObservations: Record<ApproachState, number>;
  speedObservations: Record<ApproachSpeed, number>;
  behaviorObservations: Record<ApproachBehavior, number>;
  invalidSources: number;
  errorCode?: string;
  errorIndex?: number;
};

export type PriceApproachTimings = {
  activationMs: number;
  heapUpdateMs: number;
  approachMetricMs: number;
  totalMs: number;
  sampledEvery: number;
};

export type PriceApproachResult = {
  status: DataStatus;
  symbol: "XAUUSD";
  config: Readonly<PriceApproachConfig>;
  current: ApproachCurrent;
  transitions: ApproachTransition[];
  diagnostics: PriceApproachDiagnostics;
  timings: PriceApproachTimings;
};

export class PriceApproachInputError extends Error {
  constructor(readonly code: "INPUT_ALIGNMENT" | "INPUT_ORDER" | "INVALID_CANDLE" |
    "INVALID_PSYCHOLOGY" | "INVALID_LIQUIDITY" | "FUTURE_LIQUIDITY" | "DUPLICATE_LIQUIDITY_ID") {
    super(code);
  }
}

function resolveConfig(overrides: Partial<PriceApproachConfig>): Readonly<PriceApproachConfig> {
  const config = { ...DEFAULT_PRICE_APPROACH_CONFIG, ...overrides };
  if (!Number.isFinite(config.nearDistanceAtr) || config.nearDistanceAtr < 0 ||
      !Number.isSafeInteger(config.minApproachBars) || config.minApproachBars < 1 ||
      !Number.isSafeInteger(config.minMovingAwayBars) || config.minMovingAwayBars < 1 ||
      !Number.isSafeInteger(config.speedWindowBars) || config.speedWindowBars < 1 || config.speedWindowBars > 30 ||
      !Number.isFinite(config.fastSpeedAtrPerBar) || !Number.isFinite(config.slowSpeedAtrPerBar) ||
      config.slowSpeedAtrPerBar < 0 || config.fastSpeedAtrPerBar <= config.slowSpeedAtrPerBar ||
      !Number.isFinite(config.exhaustionMaxDirectionalEfficiency) ||
      config.exhaustionMaxDirectionalEfficiency < 0 || config.exhaustionMaxDirectionalEfficiency > 1 ||
      !Number.isFinite(config.controlledMinConsistency) ||
      config.controlledMinConsistency < 0 || config.controlledMinConsistency > 1) {
    throw new RangeError("Invalid price approach configuration");
  }
  return Object.freeze(config);
}

function emptyCurrent(): ApproachCurrent {
  return { "1m": { above: null, below: null }, "5m": { above: null, below: null },
    "15m": { above: null, below: null }, "1h": { above: null, below: null } };
}

function emptyCounts(): PriceApproachDiagnostics {
  return {
    processedCandles: 0,
    activatedByTimeframe: { "1m": 0, "5m": 0, "15m": 0, "1h": 0 },
    heapPushes: 0, heapPops: 0, heapPeeks: 0, partitionCrossings: 0, transitions: 0,
    stateObservations: { FAR: 0, APPROACHING: 0, NEAR: 0, TOUCHING: 0, MOVING_AWAY: 0 },
    speedObservations: { FAST: 0, NORMAL: 0, SLOW: 0, UNKNOWN: 0 },
    behaviorObservations: { IMPULSIVE: 0, COMPRESSED: 0, CONTROLLED: 0,
      EXHAUSTED: 0, MESSY: 0, UNKNOWN: 0 },
    invalidSources: 0,
  };
}

function emptyResult(status: DataStatus, config: Readonly<PriceApproachConfig>,
  errorCode?: string, errorIndex?: number, elapsed = 0): PriceApproachResult {
  const diagnostics = emptyCounts();
  if (errorCode) diagnostics.errorCode = errorCode;
  if (errorIndex !== undefined) diagnostics.errorIndex = errorIndex;
  if (errorCode && errorCode !== "UPSTREAM_DATA_STATUS") diagnostics.invalidSources = 1;
  return { status, symbol: "XAUUSD", config, current: emptyCurrent(), transitions: [],
    diagnostics, timings: { activationMs: 0, heapUpdateMs: 0, approachMetricMs: 0,
      totalMs: elapsed, sampledEvery: 32 } };
}

function tieCompare(a: LiquidityLevel, b: LiquidityLevel): number {
  return (a.availableAt < b.availableAt ? -1 : a.availableAt > b.availableAt ? 1 : 0) ||
    (a.timeframe < b.timeframe ? -1 : a.timeframe > b.timeframe ? 1 : 0) ||
    (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export class BinaryHeap<T> {
  private readonly values: T[] = [];
  constructor(private readonly compare: (a: T, b: T) => number) {}
  get size(): number { return this.values.length; }
  peek(): T | undefined { return this.values[0]; }
  push(value: T): void {
    const values = this.values;
    let index = values.length;
    values.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(values[index], values[parent]) >= 0) break;
      [values[index], values[parent]] = [values[parent], values[index]];
      index = parent;
    }
  }
  pop(): T | undefined {
    const values = this.values;
    if (!values.length) return undefined;
    const root = values[0];
    const last = values.pop()!;
    if (values.length) {
      values[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= values.length) break;
        const right = left + 1;
        const child = right < values.length && this.compare(values[right], values[left]) < 0 ? right : left;
        if (this.compare(values[index], values[child]) <= 0) break;
        [values[index], values[child]] = [values[child], values[index]];
        index = child;
      }
    }
    return root;
  }
}

type PriceIndex = { above: BinaryHeap<LiquidityLevel>; below: BinaryHeap<LiquidityLevel> };
function priceIndex(): PriceIndex {
  return {
    above: new BinaryHeap((a, b) =>
      (a.price < b.price ? -1 : a.price > b.price ? 1 : 0) || tieCompare(a, b)),
    below: new BinaryHeap((a, b) =>
      (a.price > b.price ? -1 : a.price < b.price ? 1 : 0) || tieCompare(a, b)),
  };
}

type Tracker = {
  lastDistance: number;
  lastSeenIndex: number;
  approachBars: number;
  movingAwayBars: number;
  directionBits: number;
  directionCount: number;
  towardCount: number;
  hadEngagement: boolean;
  state: ApproachState | null;
};

type PreviousClose = { close: number; timestamp: number };
class CloseRing {
  private readonly values: PreviousClose[];
  private cursor = 0;
  private count = 0;
  constructor(private readonly bars: number) { this.values = new Array(bars + 1); }
  push(value: PreviousClose): void {
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.values.length;
    if (this.count < this.values.length) this.count++;
  }
  barsAgo(): PreviousClose | null {
    if (this.count <= this.bars) return null;
    return this.values[this.cursor];
  }
}

function validLevel(level: LiquidityLevel): boolean {
  return !!level && typeof level.id === "string" && level.id.length > 0 &&
    TIMEFRAMES.includes(level.timeframe) && level.sourceTimeframe === level.timeframe &&
    Number.isFinite(level.price) && level.price > 0 &&
    Number.isSafeInteger(level.createdAt) && Number.isSafeInteger(level.availableAt) &&
    level.createdAt <= level.availableAt &&
    (level.kind === "SWING" || level.kind === "EQH" || level.kind === "EQL") &&
    (level.side === "BSL" || level.side === "SSL") &&
    (level.kind !== "EQH" || level.side === "BSL") &&
    (level.kind !== "EQL" || level.side === "SSL") &&
    Array.isArray(level.sourceSwingIds) && level.sourceSwingIds.length > 0 &&
    level.sourceSwingIds.every((id) => typeof id === "string" && id.length > 0);
}

export class PriceApproachEngine {
  readonly config: Readonly<PriceApproachConfig>;
  readonly transitions: ApproachTransition[] = [];
  private readonly indexes: Record<Timeframe, PriceIndex> = {
    "1m": priceIndex(), "5m": priceIndex(), "15m": priceIndex(), "1h": priceIndex(),
  };
  private readonly trackers = new Map<string, Tracker>();
  private readonly seenLiquidity = new Set<string>();
  private readonly lastLiquidityAvailable: Record<Timeframe, number | null> = {
    "1m": null, "5m": null, "15m": null, "1h": null,
  };
  private readonly closes: CloseRing;
  private readonly counts = emptyCounts();
  private readonly stageTimes = { activationMs: 0, heapUpdateMs: 0, approachMetricMs: 0 };
  private latest = emptyCurrent();
  private previousTimestamp: number | null = null;

  constructor(config: Partial<PriceApproachConfig> = {}) {
    this.config = resolveConfig(config);
    this.closes = new CloseRing(this.config.speedWindowBars);
  }

  get current(): ApproachCurrent { return this.latest; }
  get diagnostics(): PriceApproachDiagnostics {
    return { ...this.counts,
      activatedByTimeframe: { ...this.counts.activatedByTimeframe },
      stateObservations: { ...this.counts.stateObservations },
      speedObservations: { ...this.counts.speedObservations },
      behaviorObservations: { ...this.counts.behaviorObservations } };
  }
  get timings(): PriceApproachTimings {
    return { activationMs: this.stageTimes.activationMs * 32,
      heapUpdateMs: this.stageTimes.heapUpdateMs * 32,
      approachMetricMs: this.stageTimes.approachMetricMs * 32,
      totalMs: 0, sampledEvery: 32 };
  }

  push(input: { candle: Candle; psychology: ApproachPsychology;
    newLiquidity?: readonly LiquidityLevel[] }): ApproachCurrent {
    const { candle, psychology, newLiquidity = [] } = input;
    if (!candle || candle.timeframe !== "1m" || candle.symbol !== "XAUUSD" ||
        !Number.isSafeInteger(candle.timestamp) ||
        ![candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0) ||
        candle.low > candle.high || candle.open < candle.low || candle.open > candle.high ||
        candle.close < candle.low || candle.close > candle.high) return this.invalid("INVALID_CANDLE");
    if (!psychology || psychology.timeframe !== "1m" ||
        psychology.timestamp !== candle.timestamp || !psychology.sourceComplete) {
      return this.invalid("INPUT_ALIGNMENT");
    }
    if (this.previousTimestamp !== null && candle.timestamp <= this.previousTimestamp) {
      return this.invalid("INPUT_ORDER");
    }
    if ((psychology.atrReady && (psychology.atr === null ||
        !Number.isFinite(psychology.atr) || psychology.atr < 0)) ||
        (psychology.directionalEfficiency !== null &&
          (!Number.isFinite(psychology.directionalEfficiency) ||
            psychology.directionalEfficiency < 0 || psychology.directionalEfficiency > 1)) ||
        !psychology.evidence ||
        ![psychology.evidence.compression, psychology.evidence.expansion,
          psychology.evidence.momentumIncreasing, psychology.evidence.momentumDecaying]
          .every((value) => typeof value === "boolean")) return this.invalid("INVALID_PSYCHOLOGY");
    const batchIds = new Set<string>();
    const batchLast = { ...this.lastLiquidityAvailable };
    for (const level of newLiquidity) {
      if (!validLevel(level)) return this.invalid("INVALID_LIQUIDITY");
      if (level.availableAt > candle.timestamp) return this.invalid("FUTURE_LIQUIDITY");
      if (batchLast[level.timeframe] !== null && level.availableAt < batchLast[level.timeframe]!) {
        return this.invalid("INPUT_ORDER");
      }
      if (batchIds.has(level.id) || this.seenLiquidity.has(level.id)) {
        return this.invalid("DUPLICATE_LIQUIDITY_ID");
      }
      batchIds.add(level.id);
      batchLast[level.timeframe] = level.availableAt;
    }

    const sample = (this.counts.processedCandles & 31) === 0;
    let stage = sample ? performance.now() : 0;
    this.previousTimestamp = candle.timestamp;
    this.counts.processedCandles++;
    for (const level of newLiquidity) {
      this.seenLiquidity.add(level.id);
      this.lastLiquidityAvailable[level.timeframe] = level.availableAt;
      const index = this.indexes[level.timeframe];
      this.heapPush(level.price > candle.close ? index.above : index.below, level);
      this.counts.activatedByTimeframe[level.timeframe]++;
    }
    if (sample) {
      const now = performance.now();
      this.stageTimes.activationMs += now - stage;
      stage = now;
    }

    for (const timeframe of TIMEFRAMES) this.rebalance(this.indexes[timeframe], candle.close);
    if (sample) {
      const now = performance.now();
      this.stageTimes.heapUpdateMs += now - stage;
      stage = now;
    }

    this.closes.push({ close: candle.close, timestamp: candle.timestamp });
    const current = emptyCurrent();
    for (const timeframe of TIMEFRAMES) {
      const index = this.indexes[timeframe];
      const above = this.heapPeek(index.above);
      const below = this.heapPeek(index.below);
      if (above) current[timeframe].above = this.snapshot(above, candle, psychology);
      if (below) current[timeframe].below = this.snapshot(below, candle, psychology);
    }
    this.latest = current;
    if (sample) this.stageTimes.approachMetricMs += performance.now() - stage;
    return current;
  }

  private invalid(code: PriceApproachInputError["code"]): never {
    this.counts.invalidSources++;
    throw new PriceApproachInputError(code);
  }

  private heapPush(heap: BinaryHeap<LiquidityLevel>, level: LiquidityLevel): void {
    heap.push(level);
    this.counts.heapPushes++;
  }
  private heapPeek(heap: BinaryHeap<LiquidityLevel>): LiquidityLevel | undefined {
    this.counts.heapPeeks++;
    return heap.peek();
  }
  private heapPop(heap: BinaryHeap<LiquidityLevel>): LiquidityLevel | undefined {
    this.counts.heapPops++;
    return heap.pop();
  }

  private rebalance(index: PriceIndex, close: number): void {
    let level = this.heapPeek(index.above);
    while (level && level.price <= close) {
      this.heapPush(index.below, this.heapPop(index.above)!);
      this.counts.partitionCrossings++;
      level = this.heapPeek(index.above);
    }
    level = this.heapPeek(index.below);
    while (level && level.price > close) {
      this.heapPush(index.above, this.heapPop(index.below)!);
      this.counts.partitionCrossings++;
      level = this.heapPeek(index.below);
    }
  }

  private snapshot(level: LiquidityLevel, candle: Candle,
    psychology: ApproachPsychology): ApproachSnapshot {
    const signedDistance = level.price - candle.close;
    const absoluteDistance = Math.abs(signedDistance);
    const atr = psychology.atrReady && psychology.atr !== null && psychology.atr > 0 ? psychology.atr : null;
    const normalizedDistance = atr === null ? null : absoluteDistance / atr;
    const distanceAtr = normalizedDistance !== null && Number.isFinite(normalizedDistance) ?
      normalizedDistance : null;
    const index = this.counts.processedCandles - 1;
    let tracker = this.trackers.get(level.id);
    if (!tracker) {
      tracker = { lastDistance: absoluteDistance, lastSeenIndex: index, approachBars: 0,
        movingAwayBars: 0, directionBits: 0, directionCount: 0, towardCount: 0,
        hadEngagement: false, state: null };
      this.trackers.set(level.id, tracker);
    }
    const adjacent = tracker.lastSeenIndex === index - 1;
    if (!adjacent) {
      tracker.approachBars = 0;
      tracker.movingAwayBars = 0;
      tracker.directionBits = 0;
      tracker.directionCount = 0;
      tracker.towardCount = 0;
      tracker.hadEngagement = false;
      tracker.state = null;
    }
    const distanceChange = adjacent ? tracker.lastDistance - absoluteDistance : null;
    if (distanceChange !== null) {
      const toward = distanceChange > 0 ? 1 : 0;
      const old = tracker.directionCount === this.config.speedWindowBars ?
        (tracker.directionBits >> (this.config.speedWindowBars - 1)) & 1 : 0;
      tracker.directionBits = ((tracker.directionBits << 1) | toward) &
        ((1 << this.config.speedWindowBars) - 1);
      tracker.directionCount = Math.min(tracker.directionCount + 1, this.config.speedWindowBars);
      tracker.towardCount += toward - old;
      tracker.approachBars = distanceChange > 0 ? tracker.approachBars + 1 : 0;
      tracker.movingAwayBars = distanceChange < 0 ? tracker.movingAwayBars + 1 : 0;
    }
    const approachConsistency = tracker.directionCount ? tracker.towardCount / tracker.directionCount : null;
    const oldClose = this.closes.barsAgo();
    const rawSpeed = atr !== null && oldClose && oldClose.timestamp >= level.availableAt ?
      (Math.abs(level.price - oldClose.close) - absoluteDistance) /
        (atr * this.config.speedWindowBars) : null;
    const speedAtrPerBar = rawSpeed !== null && Number.isFinite(rawSpeed) ? rawSpeed : null;
    const speedClass: ApproachSpeed = speedAtrPerBar === null || speedAtrPerBar <= 0 ? "UNKNOWN" :
      speedAtrPerBar >= this.config.fastSpeedAtrPerBar ? "FAST" :
      speedAtrPerBar <= this.config.slowSpeedAtrPerBar ? "SLOW" : "NORMAL";
    const touching = candle.low <= level.price && candle.high >= level.price;
    const state: ApproachState = touching ? "TOUCHING" :
      tracker.hadEngagement && tracker.movingAwayBars >= this.config.minMovingAwayBars ? "MOVING_AWAY" :
      distanceAtr !== null && distanceAtr <= this.config.nearDistanceAtr ? "NEAR" :
      tracker.approachBars >= this.config.minApproachBars ? "APPROACHING" : "FAR";
    const evidence = psychology.evidence;
    const toward = distanceChange !== null && distanceChange > 0;
    const behaviorClass: ApproachBehavior = !toward ?
      (tracker.directionCount >= this.config.speedWindowBars &&
        approachConsistency !== null && approachConsistency > 0 && approachConsistency < 1 ? "MESSY" : "UNKNOWN") :
      evidence.compression ? "COMPRESSED" :
      evidence.expansion && evidence.momentumIncreasing && speedClass === "FAST" ? "IMPULSIVE" :
      evidence.momentumDecaying &&
        (speedClass === "SLOW" || (psychology.directionalEfficiency !== null &&
          psychology.directionalEfficiency < this.config.exhaustionMaxDirectionalEfficiency)) ? "EXHAUSTED" :
      tracker.approachBars >= this.config.minApproachBars &&
        approachConsistency !== null &&
        approachConsistency >= this.config.controlledMinConsistency ? "CONTROLLED" :
      tracker.directionCount >= this.config.speedWindowBars ? "MESSY" : "UNKNOWN";
    const previousState = tracker.state;
    if (previousState !== state && (previousState !== null || state !== "FAR")) {
      this.transitions.push({
        id: `XAUUSD:APPROACH:${level.id}:${candle.timestamp}:${previousState ?? "NEW"}:${state}`,
        liquidityId: level.id, sourceTimeframe: level.timeframe,
        timestamp: candle.timestamp, availableAt: candle.timestamp,
        previousState, nextState: state, distanceAtr,
      });
      this.counts.transitions++;
    }
    if (state === "NEAR" || state === "APPROACHING" || state === "TOUCHING") {
      tracker.hadEngagement = true;
    }
    tracker.state = state;
    tracker.lastDistance = absoluteDistance;
    tracker.lastSeenIndex = index;
    this.counts.stateObservations[state]++;
    this.counts.speedObservations[speedClass]++;
    this.counts.behaviorObservations[behaviorClass]++;
    return {
      timestamp: candle.timestamp, liquidityId: level.id, liquidityType: level.kind,
      liquiditySide: level.side,
      sourceTimeframe: level.timeframe, liquidityPrice: level.price,
      currentPrice: candle.close,
      side: signedDistance > 0 ? "ABOVE" : signedDistance < 0 ? "BELOW" : "AT_PRICE",
      absoluteDistance, signedDistance, distanceAtr, distanceChange,
      distanceChangeAtr: atr === null || distanceChange === null ||
        !Number.isFinite(distanceChange / atr) ? null : distanceChange / atr,
      approachBars: tracker.approachBars, movingAwayBars: tracker.movingAwayBars,
      approachConsistency, speedAtrPerBar, state, speedClass, behaviorClass,
      psychologyEvidence: { compression: evidence.compression, expansion: evidence.expansion,
        momentumIncreasing: evidence.momentumIncreasing, momentumDecaying: evidence.momentumDecaying },
    };
  }
}

export function createPriceApproachEngine(config: Partial<PriceApproachConfig> = {}): PriceApproachEngine {
  return new PriceApproachEngine(config);
}

export function analyzePriceApproach(historical: HistoricalResult,
  psychology: CandlePsychologyResult, liquidity: MultiTimeframeLiquidityResult,
  overrides: Partial<PriceApproachConfig> = {},
  onCandle?: (candle: Candle, psychology: CandlePsychologyFeature, current: ApproachCurrent) => void
): PriceApproachResult {
  const started = performance.now();
  const config = resolveConfig(overrides);
  if ([historical.status, psychology.status, liquidity.status].some((status) =>
    status === "BLOCKED" || status === "FAILED")) {
    const status = [historical.status, psychology.status, liquidity.status].includes("FAILED") ? "FAILED" : "BLOCKED";
    return emptyResult(status, config, "UPSTREAM_DATA_STATUS", undefined, performance.now() - started);
  }
  const candles = historical.candles1m;
  const features = psychology.timeframes["1m"].features;
  if (candles.length !== features.length) {
    return emptyResult("BLOCKED", config, "INPUT_ALIGNMENT", undefined, performance.now() - started);
  }
  const streams = {} as Record<Timeframe, readonly LiquidityLevel[]>;
  for (const timeframe of TIMEFRAMES) {
    const result = liquidity.timeframes[timeframe];
    if (result.status !== "READY" || result.timeframe !== timeframe) {
      return emptyResult("BLOCKED", config, "UPSTREAM_LIQUIDITY_STATUS", undefined, performance.now() - started);
    }
    streams[timeframe] = result.levels;
    let previous = -Infinity;
    for (const level of result.levels) {
      if (!validLevel(level) || level.timeframe !== timeframe) {
        return emptyResult("BLOCKED", config, "INVALID_LIQUIDITY", undefined, performance.now() - started);
      }
      if (level.availableAt < previous) {
        return emptyResult("BLOCKED", config, "INPUT_ORDER", undefined, performance.now() - started);
      }
      previous = level.availableAt;
    }
  }
  const cursors: Record<Timeframe, number> = { "1m": 0, "5m": 0, "15m": 0, "1h": 0 };
  const engine = createPriceApproachEngine(config);
  for (let i = 0; i < candles.length; i++) {
    const newlyAvailable: LiquidityLevel[] = [];
    for (const timeframe of TIMEFRAMES) {
      const stream = streams[timeframe];
      while (cursors[timeframe] < stream.length &&
          stream[cursors[timeframe]].availableAt <= candles[i].timestamp) {
        newlyAvailable.push(stream[cursors[timeframe]++]);
      }
    }
    try {
      const current = engine.push({ candle: candles[i], psychology: features[i], newLiquidity: newlyAvailable });
      onCandle?.(candles[i], features[i], current);
    } catch (error) {
      if (error instanceof PriceApproachInputError) {
        return emptyResult("BLOCKED", config, error.code, i, performance.now() - started);
      }
      throw error;
    }
  }
  const timings = engine.timings;
  timings.totalMs = performance.now() - started;
  return { status: [historical.status, psychology.status, liquidity.status].includes("WARN") ? "WARN" : "READY",
    symbol: "XAUUSD", config, current: engine.current, transitions: engine.transitions,
    diagnostics: engine.diagnostics, timings };
}
