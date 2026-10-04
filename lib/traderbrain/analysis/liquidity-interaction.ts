import type { Candle, DataStatus, HistoricalResult, Timeframe } from "../data/types.ts";
import type { CandlePsychologyFeature, CandlePsychologyResult } from "./candle-psychology.ts";
import type { LiquidityKind, LiquiditySide, MultiTimeframeLiquidityResult } from "./liquidity.ts";
import { analyzePriceApproach, type ApproachCurrent, type ApproachSnapshot } from "./price-approach.ts";

const TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const;
export type CloseRelationship = "CLOSE_BEFORE_LEVEL" | "CLOSE_AT_LEVEL" | "CLOSE_BEYOND_LEVEL";
export type InteractionState = "TOUCHED" | "PENETRATED" | "BROKEN" | "ACCEPTED" |
  "RECLAIMED" | "REJECTED" | "FAILED_BREAK" | "COMPLETED";
export type InteractionType = "TOUCH" | "PENETRATION" | "SWEEP" | "RAID" | "BREAK" |
  "ACCEPTANCE" | "REJECTION" | "FAILED_BREAK";
export type InteractionEventType = "TOUCH_DETECTED" | "PENETRATION_DETECTED" |
  "BREAK_CONFIRMED" | "RECLAIM_CONFIRMED" | "SWEEP_CONFIRMED" | "RAID_CONFIRMED" |
  "ACCEPTANCE_CONFIRMED" | "REJECTION_CONFIRMED" | "FAILED_BREAK_CONFIRMED" |
  "EPISODE_COMPLETED";

export type LiquidityInteractionConfig = {
  minimumPenetrationAtr: number;
  sweepMaxPenetrationAtr: number;
  raidMinPenetrationAtr: number;
  acceptanceConsecutiveCloses: number;
  acceptanceMinDistanceAtr: number;
  minimumReactionAtr: number;
  maxInteractionBars: number;
};

export const DEFAULT_LIQUIDITY_INTERACTION_CONFIG: Readonly<LiquidityInteractionConfig> = Object.freeze({
  minimumPenetrationAtr: 0.1,
  sweepMaxPenetrationAtr: 0.75,
  raidMinPenetrationAtr: 0.75,
  acceptanceConsecutiveCloses: 2,
  acceptanceMinDistanceAtr: 0.1,
  minimumReactionAtr: 0.3,
  maxInteractionBars: 12,
});

export type InteractionEvidence = {
  touch: boolean;
  penetration: boolean;
  sweep: boolean;
  raid: boolean;
  break: boolean;
  acceptance: boolean;
  reclaim: boolean;
  rejection: boolean;
  failedBreak: boolean;
};

export type InteractionSnapshot = {
  id: string;
  liquidityId: string;
  liquidityType: LiquidityKind;
  liquiditySide: LiquiditySide;
  sourceTimeframe: Timeframe;
  liquidityPrice: number;
  firstTouchAt: number;
  createdAt: number;
  availableAt: number;
  sideBeforeInteraction: CloseRelationship;
  closeRelationship: CloseRelationship;
  currentState: InteractionState;
  currentPenetration: number;
  currentPenetrationAtr: number | null;
  maxPenetration: number;
  maxPenetrationAtr: number | null;
  consecutiveClosesBeyond: number;
  totalClosesBeyond: number;
  barsBeyond: number;
  reclaimed: boolean;
  reclaimAt: number | null;
  maximumReactionAway: number;
  maximumReactionAwayAtr: number | null;
  durationBars: number;
  evidence: InteractionEvidence;
};

export type LiquidityInteraction = InteractionSnapshot & {
  finalType: InteractionType;
  completedAt: number;
};

export type InteractionEvent = {
  id: string;
  interactionId: string;
  liquidityId: string;
  liquiditySide: LiquiditySide;
  sourceTimeframe: Timeframe;
  type: InteractionEventType;
  timestamp: number;
  createdAt: number;
  availableAt: number;
  price: number;
  liquidityPrice: number;
  penetrationAtr: number | null;
  reactionAtr: number | null;
};

export type InteractionDiagnostics = {
  processedCandles: number;
  candidatesProcessed: number;
  episodesStarted: number;
  completedEpisodes: number;
  maximumActiveMapSize: number;
  events: Record<InteractionEventType, number>;
  rejectedByReason: Record<"NO_PENETRATION" | "NO_RECLAIM" |
    "INSUFFICIENT_PENETRATION" | "NO_ACCEPTANCE" | "INSUFFICIENT_REACTION", number>;
  integrationInconsistencies: number;
  invalidSources: number;
  errorCode?: string;
  errorIndex?: number;
};

export type InteractionTimings = {
  candidateProcessingMs: number;
  interactionUpdateMs: number;
  classificationMs: number;
  totalMs: number;
  pipelineTotalMs: number;
  sampledEvery: number;
};

export type LiquidityInteractionResult = {
  status: DataStatus;
  symbol: "XAUUSD";
  config: Readonly<LiquidityInteractionConfig>;
  completed: LiquidityInteraction[];
  active: InteractionSnapshot[];
  events: InteractionEvent[];
  diagnostics: InteractionDiagnostics;
  timings: InteractionTimings;
};

export class InteractionInputError extends Error {
  constructor(readonly code: "INPUT_ALIGNMENT" | "INPUT_ORDER" | "INVALID_CANDLE" |
    "INVALID_PSYCHOLOGY" | "INVALID_APPROACH" | "APPROACH_GEOMETRY_MISMATCH") {
    super(code);
  }
}

function resolveConfig(overrides: Partial<LiquidityInteractionConfig>): Readonly<LiquidityInteractionConfig> {
  const config = { ...DEFAULT_LIQUIDITY_INTERACTION_CONFIG, ...overrides };
  if (!Number.isFinite(config.minimumPenetrationAtr) || config.minimumPenetrationAtr <= 0 ||
      !Number.isFinite(config.sweepMaxPenetrationAtr) ||
      config.sweepMaxPenetrationAtr < config.minimumPenetrationAtr ||
      !Number.isFinite(config.raidMinPenetrationAtr) ||
      config.raidMinPenetrationAtr < config.sweepMaxPenetrationAtr ||
      !Number.isSafeInteger(config.acceptanceConsecutiveCloses) ||
      config.acceptanceConsecutiveCloses < 2 ||
      !Number.isFinite(config.acceptanceMinDistanceAtr) || config.acceptanceMinDistanceAtr < 0 ||
      !Number.isFinite(config.minimumReactionAtr) || config.minimumReactionAtr <= 0 ||
      !Number.isSafeInteger(config.maxInteractionBars) || config.maxInteractionBars < 2 ||
      config.maxInteractionBars > 512) throw new RangeError("Invalid liquidity interaction configuration");
  return Object.freeze(config);
}

function emptyEvidence(): InteractionEvidence {
  return { touch: false, penetration: false, sweep: false, raid: false, break: false,
    acceptance: false, reclaim: false, rejection: false, failedBreak: false };
}

function emptyDiagnostics(): InteractionDiagnostics {
  return { processedCandles: 0, candidatesProcessed: 0, episodesStarted: 0,
    completedEpisodes: 0, maximumActiveMapSize: 0,
    events: { TOUCH_DETECTED: 0, PENETRATION_DETECTED: 0, BREAK_CONFIRMED: 0,
      RECLAIM_CONFIRMED: 0, SWEEP_CONFIRMED: 0, RAID_CONFIRMED: 0,
      ACCEPTANCE_CONFIRMED: 0, REJECTION_CONFIRMED: 0,
      FAILED_BREAK_CONFIRMED: 0, EPISODE_COMPLETED: 0 },
    rejectedByReason: { NO_PENETRATION: 0, NO_RECLAIM: 0,
      INSUFFICIENT_PENETRATION: 0, NO_ACCEPTANCE: 0, INSUFFICIENT_REACTION: 0 },
    integrationInconsistencies: 0, invalidSources: 0 };
}

function emptyResult(status: DataStatus, config: Readonly<LiquidityInteractionConfig>,
  errorCode?: string, errorIndex?: number, elapsed = 0): LiquidityInteractionResult {
  const diagnostics = emptyDiagnostics();
  if (errorCode) diagnostics.errorCode = errorCode;
  if (errorIndex !== undefined) diagnostics.errorIndex = errorIndex;
  if (errorCode && errorCode !== "UPSTREAM_DATA_STATUS") diagnostics.invalidSources = 1;
  if (errorCode === "APPROACH_GEOMETRY_MISMATCH") diagnostics.integrationInconsistencies = 1;
  return { status, symbol: "XAUUSD", config, completed: [], active: [], events: [], diagnostics,
    timings: { candidateProcessingMs: 0, interactionUpdateMs: 0, classificationMs: 0,
      totalMs: 0, pipelineTotalMs: elapsed, sampledEvery: 32 } };
}

function closeRelationship(side: LiquiditySide, close: number, price: number): CloseRelationship {
  const signed = side === "BSL" ? close - price : price - close;
  return signed > 0 ? "CLOSE_BEYOND_LEVEL" : signed < 0 ? "CLOSE_BEFORE_LEVEL" : "CLOSE_AT_LEVEL";
}

function penetration(side: LiquiditySide, candle: Candle, price: number): number {
  return Math.max(0, side === "BSL" ? candle.high - price : price - candle.low);
}

function reactionAway(side: LiquiditySide, candle: Candle, price: number): number {
  return Math.max(0, side === "BSL" ? price - candle.low : candle.high - price);
}

function normalized(value: number, atr: number | null): number | null {
  if (atr === null || atr <= 0) return null;
  const ratio = value / atr;
  return Number.isFinite(ratio) ? ratio : null;
}

type Tracker = InteractionSnapshot & {
  startIndex: number;
  lastUpdatedAt: number;
  hadRejectionEvidence: boolean;
  terminal: boolean;
};

type Update = {
  tracker: Tracker;
  closeBeyondDistanceAtr: number | null;
};

function snapshot(tracker: Tracker): InteractionSnapshot {
  return {
    id: tracker.id, liquidityId: tracker.liquidityId, liquidityType: tracker.liquidityType,
    liquiditySide: tracker.liquiditySide, sourceTimeframe: tracker.sourceTimeframe,
    liquidityPrice: tracker.liquidityPrice, firstTouchAt: tracker.firstTouchAt,
    createdAt: tracker.createdAt, availableAt: tracker.availableAt,
    sideBeforeInteraction: tracker.sideBeforeInteraction,
    closeRelationship: tracker.closeRelationship, currentState: tracker.currentState,
    currentPenetration: tracker.currentPenetration,
    currentPenetrationAtr: tracker.currentPenetrationAtr,
    maxPenetration: tracker.maxPenetration, maxPenetrationAtr: tracker.maxPenetrationAtr,
    consecutiveClosesBeyond: tracker.consecutiveClosesBeyond,
    totalClosesBeyond: tracker.totalClosesBeyond, barsBeyond: tracker.barsBeyond,
    reclaimed: tracker.reclaimed, reclaimAt: tracker.reclaimAt,
    maximumReactionAway: tracker.maximumReactionAway,
    maximumReactionAwayAtr: tracker.maximumReactionAwayAtr,
    durationBars: tracker.durationBars, evidence: { ...tracker.evidence },
  };
}

function finalType(evidence: InteractionEvidence): InteractionType {
  return evidence.failedBreak ? "FAILED_BREAK" : evidence.acceptance ? "ACCEPTANCE" :
    evidence.rejection ? "REJECTION" : evidence.raid ? "RAID" :
    evidence.sweep ? "SWEEP" : evidence.break ? "BREAK" :
    evidence.penetration ? "PENETRATION" : "TOUCH";
}

export class LiquidityInteractionEngine {
  readonly config: Readonly<LiquidityInteractionConfig>;
  readonly completed: LiquidityInteraction[] = [];
  readonly events: InteractionEvent[] = [];
  private readonly active = new Map<string, Tracker>();
  private readonly activeIds: string[] = [];
  private readonly counts = emptyDiagnostics();
  private readonly stageTimes = { candidateProcessingMs: 0, interactionUpdateMs: 0, classificationMs: 0 };
  private previousTimestamp: number | null = null;
  private previousClose: number | null = null;

  constructor(overrides: Partial<LiquidityInteractionConfig> = {}) {
    this.config = resolveConfig(overrides);
  }

  get activeCount(): number { return this.active.size; }
  get activeEpisodes(): InteractionSnapshot[] {
    return this.activeIds.map((id) => snapshot(this.active.get(id)!));
  }
  get diagnostics(): InteractionDiagnostics {
    return { ...this.counts, events: { ...this.counts.events },
      rejectedByReason: { ...this.counts.rejectedByReason } };
  }
  get timings(): InteractionTimings {
    const candidateProcessingMs = this.stageTimes.candidateProcessingMs * 32;
    const interactionUpdateMs = this.stageTimes.interactionUpdateMs * 32;
    const classificationMs = this.stageTimes.classificationMs * 32;
    return { candidateProcessingMs, interactionUpdateMs, classificationMs,
      totalMs: candidateProcessingMs + interactionUpdateMs + classificationMs,
      pipelineTotalMs: 0, sampledEvery: 32 };
  }

  push(input: { candle: Candle; psychology: CandlePsychologyFeature;
    current: ApproachCurrent }): void {
    const { candle, psychology, current } = input;
    if (!candle || candle.timeframe !== "1m" || candle.symbol !== "XAUUSD" ||
        !Number.isSafeInteger(candle.timestamp) ||
        ![candle.open, candle.high, candle.low, candle.close]
          .every((price) => Number.isFinite(price) && price > 0) ||
        candle.low > candle.high || candle.open < candle.low || candle.open > candle.high ||
        candle.close < candle.low || candle.close > candle.high) return this.invalid("INVALID_CANDLE");
    if (!psychology || psychology.timeframe !== "1m" ||
        psychology.timestamp !== candle.timestamp || !psychology.sourceComplete) {
      return this.invalid("INPUT_ALIGNMENT");
    }
    if (this.previousTimestamp !== null && candle.timestamp <= this.previousTimestamp) {
      return this.invalid("INPUT_ORDER");
    }
    if (!psychology.evidence ||
        typeof psychology.evidence.upperRejection !== "boolean" ||
        typeof psychology.evidence.lowerRejection !== "boolean" ||
        (psychology.atrReady && (psychology.atr === null ||
          !Number.isFinite(psychology.atr) || psychology.atr < 0))) {
      return this.invalid("INVALID_PSYCHOLOGY");
    }
    if (!current) return this.invalid("INVALID_APPROACH");
    const candidates: ApproachSnapshot[] = [];
    for (const timeframe of TIMEFRAMES) {
      const pair = current[timeframe];
      if (!pair) return this.invalid("INVALID_APPROACH");
      for (const item of [pair.above, pair.below]) {
        if (!item) continue;
        if (item.timestamp !== candle.timestamp || item.sourceTimeframe !== timeframe ||
            item.currentPrice !== candle.close ||
            typeof item.liquidityId !== "string" || item.liquidityId.length === 0 ||
            !Number.isFinite(item.liquidityPrice) || item.liquidityPrice <= 0 ||
            (item.liquiditySide !== "BSL" && item.liquiditySide !== "SSL") ||
            (item.liquidityType !== "SWING" && item.liquidityType !== "EQH" &&
              item.liquidityType !== "EQL")) return this.invalid("INVALID_APPROACH");
        if (item.state === "TOUCHING" &&
            !(candle.low <= item.liquidityPrice && candle.high >= item.liquidityPrice)) {
          this.counts.integrationInconsistencies++;
          return this.invalid("APPROACH_GEOMETRY_MISMATCH");
        }
        candidates.push(item);
      }
    }

    const sample = (this.counts.processedCandles & 31) === 0;
    let stage = sample ? performance.now() : 0;
    const index = this.counts.processedCandles;
    this.counts.processedCandles++;
    this.counts.candidatesProcessed += candidates.length;
    const atr = psychology.atrReady && psychology.atr !== null && psychology.atr > 0 ?
      psychology.atr : null;
    for (const candidate of candidates) {
      const contact = candle.low <= candidate.liquidityPrice && candle.high >= candidate.liquidityPrice;
      if (!contact || this.active.has(candidate.liquidityId)) continue;
      const before = this.previousClose === null ? candle.close : this.previousClose;
      const tracker: Tracker = {
        id: `XAUUSD:INTERACTION:${candidate.liquidityId}:${candle.timestamp}`,
        liquidityId: candidate.liquidityId, liquidityType: candidate.liquidityType,
        liquiditySide: candidate.liquiditySide, sourceTimeframe: candidate.sourceTimeframe,
        liquidityPrice: candidate.liquidityPrice, firstTouchAt: candle.timestamp,
        createdAt: candle.timestamp, availableAt: candle.timestamp,
        sideBeforeInteraction: closeRelationship(candidate.liquiditySide, before,
          candidate.liquidityPrice),
        closeRelationship: closeRelationship(candidate.liquiditySide, candle.close,
          candidate.liquidityPrice),
        currentState: "TOUCHED", currentPenetration: 0, currentPenetrationAtr: null,
        maxPenetration: 0, maxPenetrationAtr: null,
        consecutiveClosesBeyond: 0, totalClosesBeyond: 0, barsBeyond: 0,
        reclaimed: false, reclaimAt: null,
        maximumReactionAway: 0, maximumReactionAwayAtr: null,
        durationBars: 0, evidence: emptyEvidence(), startIndex: index,
        lastUpdatedAt: candle.timestamp, hadRejectionEvidence: false, terminal: false,
      };
      this.active.set(candidate.liquidityId, tracker);
      this.activeIds.push(candidate.liquidityId);
      this.counts.episodesStarted++;
      this.counts.maximumActiveMapSize = Math.max(this.counts.maximumActiveMapSize, this.active.size);
    }
    if (sample) {
      const now = performance.now();
      this.stageTimes.candidateProcessingMs += now - stage;
      stage = now;
    }

    const updates: Update[] = [];
    for (const id of this.activeIds) {
      const tracker = this.active.get(id)!;
      const contact = candle.low <= tracker.liquidityPrice && candle.high >= tracker.liquidityPrice;
      const currentPenetration = penetration(tracker.liquiditySide, candle, tracker.liquidityPrice);
      const currentPenetrationAtr = normalized(currentPenetration, atr);
      tracker.currentPenetration = currentPenetration;
      tracker.currentPenetrationAtr = currentPenetrationAtr;
      tracker.maxPenetration = Math.max(tracker.maxPenetration, currentPenetration);
      if (currentPenetrationAtr !== null) {
        tracker.maxPenetrationAtr = Math.max(tracker.maxPenetrationAtr ?? 0, currentPenetrationAtr);
      }
      if (currentPenetration > 0) tracker.barsBeyond++;
      const relation = closeRelationship(tracker.liquiditySide, candle.close, tracker.liquidityPrice);
      tracker.closeRelationship = relation;
      if (relation === "CLOSE_BEYOND_LEVEL") {
        tracker.consecutiveClosesBeyond++;
        tracker.totalClosesBeyond++;
      } else tracker.consecutiveClosesBeyond = 0;
      if (index > tracker.startIndex) {
        const reaction = reactionAway(tracker.liquiditySide, candle, tracker.liquidityPrice);
        tracker.maximumReactionAway = Math.max(tracker.maximumReactionAway, reaction);
        const reactionAtr = normalized(reaction, atr);
        if (reactionAtr !== null) {
          tracker.maximumReactionAwayAtr = Math.max(tracker.maximumReactionAwayAtr ?? 0, reactionAtr);
        }
      }
      if (contact && (tracker.liquiditySide === "BSL" ?
          psychology.evidence.upperRejection : psychology.evidence.lowerRejection)) {
        tracker.hadRejectionEvidence = true;
      }
      tracker.durationBars++;
      tracker.lastUpdatedAt = candle.timestamp;
      tracker.availableAt = candle.timestamp;
      const beyondDistance = relation === "CLOSE_BEYOND_LEVEL" ?
        (tracker.liquiditySide === "BSL" ? candle.close - tracker.liquidityPrice :
          tracker.liquidityPrice - candle.close) : 0;
      updates.push({ tracker, closeBeyondDistanceAtr: normalized(beyondDistance, atr) });
    }
    if (sample) {
      const now = performance.now();
      this.stageTimes.interactionUpdateMs += now - stage;
      stage = now;
    }

    for (const { tracker, closeBeyondDistanceAtr } of updates) {
      this.classify(tracker, candle, closeBeyondDistanceAtr);
    }
    for (let i = 0; i < this.activeIds.length;) {
      const id = this.activeIds[i];
      const tracker = this.active.get(id)!;
      const contact = candle.low <= tracker.liquidityPrice && candle.high >= tracker.liquidityPrice;
      const reactionEnough = tracker.maximumReactionAwayAtr !== null &&
        tracker.maximumReactionAwayAtr >= this.config.minimumReactionAtr;
      const terminalDone = tracker.terminal && !contact;
      const returnedAway = !contact && reactionEnough &&
        (tracker.reclaimed || !tracker.evidence.penetration);
      const timedOut = tracker.durationBars >= this.config.maxInteractionBars;
      if (terminalDone || returnedAway || timedOut) {
        this.complete(tracker, candle);
        this.active.delete(id);
        this.activeIds.splice(i, 1);
      } else i++;
    }
    if (sample) this.stageTimes.classificationMs += performance.now() - stage;
    this.previousTimestamp = candle.timestamp;
    this.previousClose = candle.close;
  }

  private classify(tracker: Tracker, candle: Candle,
    closeBeyondDistanceAtr: number | null): void {
    if (!tracker.evidence.touch) {
      tracker.evidence.touch = true;
      tracker.currentState = "TOUCHED";
      this.emit(tracker, "TOUCH_DETECTED", candle);
    }
    if (tracker.terminal) return;
    if (tracker.currentPenetration > 0 && !tracker.evidence.penetration) {
      tracker.evidence.penetration = true;
      tracker.currentState = "PENETRATED";
      this.emit(tracker, "PENETRATION_DETECTED", candle);
    }
    if (tracker.closeRelationship === "CLOSE_BEYOND_LEVEL" && !tracker.evidence.break) {
      tracker.evidence.break = true;
      tracker.currentState = "BROKEN";
      this.emit(tracker, "BREAK_CONFIRMED", candle);
    }
    if (tracker.evidence.break && !tracker.evidence.acceptance &&
        tracker.consecutiveClosesBeyond >= this.config.acceptanceConsecutiveCloses &&
        closeBeyondDistanceAtr !== null &&
        closeBeyondDistanceAtr >= this.config.acceptanceMinDistanceAtr) {
      tracker.evidence.acceptance = true;
      tracker.currentState = "ACCEPTED";
      tracker.terminal = true;
      this.emit(tracker, "ACCEPTANCE_CONFIRMED", candle);
      return;
    }
    if (tracker.evidence.penetration && !tracker.reclaimed &&
        tracker.closeRelationship !== "CLOSE_BEYOND_LEVEL") {
      tracker.reclaimed = true;
      tracker.reclaimAt = candle.timestamp;
      tracker.evidence.reclaim = true;
      tracker.currentState = "RECLAIMED";
      this.emit(tracker, "RECLAIM_CONFIRMED", candle);
      if (tracker.evidence.break) {
        tracker.evidence.failedBreak = true;
        tracker.currentState = "FAILED_BREAK";
        tracker.terminal = true;
        this.emit(tracker, "FAILED_BREAK_CONFIRMED", candle);
        return;
      }
      const depth = tracker.maxPenetrationAtr;
      if (depth !== null && depth >= this.config.minimumPenetrationAtr) {
        if (depth >= this.config.raidMinPenetrationAtr || tracker.barsBeyond >= 2) {
          tracker.evidence.raid = true;
          this.emit(tracker, "RAID_CONFIRMED", candle);
        } else if (depth <= this.config.sweepMaxPenetrationAtr) {
          tracker.evidence.sweep = true;
          this.emit(tracker, "SWEEP_CONFIRMED", candle);
        }
      }
    }
    if (tracker.evidence.sweep && !tracker.evidence.raid && tracker.barsBeyond >= 2 &&
        tracker.currentPenetration > 0 &&
        tracker.closeRelationship !== "CLOSE_BEYOND_LEVEL") {
      tracker.evidence.raid = true;
      this.emit(tracker, "RAID_CONFIRMED", candle);
    }
    if (tracker.hadRejectionEvidence && tracker.maximumReactionAwayAtr !== null &&
        tracker.maximumReactionAwayAtr >= this.config.minimumReactionAtr &&
        tracker.closeRelationship !== "CLOSE_BEYOND_LEVEL" &&
        tracker.durationBars > 1 && !tracker.evidence.rejection) {
      tracker.evidence.rejection = true;
      tracker.currentState = "REJECTED";
      tracker.terminal = true;
      this.emit(tracker, "REJECTION_CONFIRMED", candle);
    }
  }

  private emit(tracker: Tracker, type: InteractionEventType, candle: Candle): void {
    this.events.push({
      id: `${tracker.id}:${type}:${candle.timestamp}`, interactionId: tracker.id,
      liquidityId: tracker.liquidityId, liquiditySide: tracker.liquiditySide,
      sourceTimeframe: tracker.sourceTimeframe,
      type, timestamp: candle.timestamp, createdAt: candle.timestamp,
      availableAt: candle.timestamp, price: candle.close,
      liquidityPrice: tracker.liquidityPrice,
      penetrationAtr: tracker.currentPenetrationAtr,
      reactionAtr: tracker.maximumReactionAwayAtr,
    });
    this.counts.events[type]++;
  }

  private complete(tracker: Tracker, candle: Candle): void {
    // Gate failures are counted once per completed episode. Several gates may
    // fail in one episode, so these counts are not mutually exclusive.
    const rejected = this.counts.rejectedByReason;
    if (!tracker.evidence.penetration) rejected.NO_PENETRATION++;
    if (tracker.evidence.penetration && !tracker.reclaimed &&
        !tracker.evidence.acceptance) rejected.NO_RECLAIM++;
    if (tracker.reclaimed && !tracker.evidence.break &&
        !tracker.evidence.sweep && !tracker.evidence.raid &&
        (tracker.maxPenetrationAtr === null ||
          tracker.maxPenetrationAtr < this.config.minimumPenetrationAtr)) {
      rejected.INSUFFICIENT_PENETRATION++;
    }
    if (tracker.evidence.break && !tracker.evidence.acceptance) rejected.NO_ACCEPTANCE++;
    if (tracker.hadRejectionEvidence && !tracker.evidence.rejection &&
        (tracker.maximumReactionAwayAtr === null ||
          tracker.maximumReactionAwayAtr < this.config.minimumReactionAtr)) {
      rejected.INSUFFICIENT_REACTION++;
    }
    const completed: LiquidityInteraction = {
      ...snapshot(tracker), currentState: "COMPLETED", availableAt: candle.timestamp,
      finalType: finalType(tracker.evidence), completedAt: candle.timestamp,
    };
    this.completed.push(completed);
    this.counts.completedEpisodes++;
    this.emit(tracker, "EPISODE_COMPLETED", candle);
  }

  private invalid(code: InteractionInputError["code"]): never {
    this.counts.invalidSources++;
    throw new InteractionInputError(code);
  }
}

export function createLiquidityInteractionEngine(
  config: Partial<LiquidityInteractionConfig> = {}): LiquidityInteractionEngine {
  return new LiquidityInteractionEngine(config);
}

export function analyzeLiquidityInteractions(historical: HistoricalResult,
  psychology: CandlePsychologyResult, liquidity: MultiTimeframeLiquidityResult,
  overrides: Partial<LiquidityInteractionConfig> = {}): LiquidityInteractionResult {
  const started = performance.now();
  const config = resolveConfig(overrides);
  if ([historical.status, psychology.status, liquidity.status].some((status) =>
    status === "BLOCKED" || status === "FAILED")) {
    const status = [historical.status, psychology.status, liquidity.status].includes("FAILED") ? "FAILED" : "BLOCKED";
    return emptyResult(status, config, "UPSTREAM_DATA_STATUS", undefined, performance.now() - started);
  }
  const engine = createLiquidityInteractionEngine(config);
  let index = 0;
  try {
    const approach = analyzePriceApproach(historical, psychology, liquidity, {},
      (candle, feature, current) => {
        engine.push({ candle, psychology: feature, current });
        index++;
      });
    if (approach.status === "BLOCKED" || approach.status === "FAILED") {
      return emptyResult(approach.status, config, approach.diagnostics.errorCode,
        approach.diagnostics.errorIndex, performance.now() - started);
    }
    const timings = engine.timings;
    timings.pipelineTotalMs = performance.now() - started;
    return { status: approach.status, symbol: "XAUUSD", config,
      completed: engine.completed, active: engine.activeEpisodes,
      events: engine.events, diagnostics: engine.diagnostics, timings };
  } catch (error) {
    if (error instanceof InteractionInputError) {
      return emptyResult("BLOCKED", config, error.code, index, performance.now() - started);
    }
    throw error;
  }
}
