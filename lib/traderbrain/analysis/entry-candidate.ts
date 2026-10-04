import type { Candle, DataStatus, HistoricalResult } from "../data/types.ts";
import type { CandlePsychologyFeature, CandlePsychologyResult } from "./candle-psychology.ts";
import type { ControlResult, ControlSnapshot, ControlState } from "./control-engine.ts";
import type { FvgDirection, FvgLifecycleEvent, FvgResult, FvgZone } from
  "./fvg-entry-location.ts";

export type RetracementQuality = "CONTROLLED" | "AGGRESSIVE" | "DEEP" |
  "SHALLOW" | "MESSY" | "NO_RETRACE" | "INVALIDATING" | "UNKNOWN";
export type EntryState = "WAITING" | "RETRACING" | "RESPONDING" |
  "CANDIDATE" | "MISSED" | "INVALIDATED" | "EXPIRED";
export type EntryReason = "QUALIFIED_FVG" | "RETRACE_STARTED" |
  "RETRACE_ENTERED_ZONE" | "CONTROLLED_RETRACE" | "AGGRESSIVE_RETRACE" |
  "DEEP_RETRACE" | "SHALLOW_RETRACE" | "MESSY_RETRACE" |
  "ORIGINAL_CONTROL_VALID" | "ORIGINAL_CONTROL_INVALIDATED" |
  "BULLISH_RESPONSE" | "BEARISH_RESPONSE" | "ENTRY_TRIGGER_CONFIRMED" |
  "ENTRY_TOO_EXTENDED" | "RETRACE_TIMEOUT" | "ENTRY_TIMEOUT" |
  "ZONE_FILLED" | "DUPLICATE_SETUP_ENTRY";
export type EntryRejection = "NO_RETRACE" | "ZONE_FILLED" |
  "CONTROL_INVALIDATED" | "RETRACE_TOO_AGGRESSIVE" |
  "NO_DIRECTIONAL_RESPONSE" | "ENTRY_TOO_EXTENDED" |
  "RETRACE_TIMEOUT" | "ENTRY_TIMEOUT" | "DUPLICATE_SETUP_ENTRY" |
  "NO_REFERENCE_ATR";
export type EntryCandidateConfig = {
  maxBarsToRetrace: number;
  maxBarsToEntry: number;
  maxEntryExtensionAtr: number;
  minResponseBodyAtr: number;
  minResponseBodyToRange: number;
  aggressiveBodyAtr: number;
  minControlledOverlap: number;
  messyMaxEfficiency: number;
  deepRetracementFraction: number;
  shallowRetracementFraction: number;
};
export const DEFAULT_ENTRY_CANDIDATE_CONFIG: Readonly<EntryCandidateConfig> = Object.freeze({
  maxBarsToRetrace: 24,
  maxBarsToEntry: 12,
  maxEntryExtensionAtr: 0.8,
  minResponseBodyAtr: 0.25,
  minResponseBodyToRange: 0.5,
  aggressiveBodyAtr: 0.8,
  minControlledOverlap: 0.35,
  messyMaxEfficiency: 0.3,
  deepRetracementFraction: 0.75,
  shallowRetracementFraction: 0.25,
});
export type EntryCandidate = {
  id: string;
  type: "FVG_RETRACE";
  direction: FvgDirection;
  createdAt: number;
  availableAt: number;
  entryPrice: number;
  status: "CANDIDATE";
  fvgId: string;
  fillFractionAtEntry: number;
  retracementClass: RetracementQuality;
  structuralConfirmationId: string;
  displacementEventId: string;
  controlTransferId: string | null;
  interactionId: string | null;
  liquidityId: string | null;
  controlStateAtEntry: ControlState;
  referenceAtr: number;
  responseBodyAtr: number | null;
  responseClosePosition: number | null;
  barsFromQualifiedToRetrace: number;
  barsFromRetraceToCandidate: number;
  totalBarsToCandidate: number;
  distanceFromZoneAtCandidate: number;
  distanceFromZoneAtr: number;
  distanceTravelledSinceRetracementExtreme: number;
  distanceTravelledAtr: number;
  reasons: EntryReason[];
};
export type EntryEpisode = {
  fvgId: string;
  setupKey: string;
  direction: FvgDirection;
  qualifiedAt: number;
  startedAt: number | null;
  reachedAt: number | null;
  completedAt: number;
  state: "CANDIDATE" | "MISSED" | "INVALIDATED" | "EXPIRED";
  quality: RetracementQuality;
  maxFillFraction: number;
  candidateId: string | null;
  reasons: EntryReason[];
};
export type EntryStateEvent = { id: string; fvgId: string; availableAt: number;
  state: EntryState; quality: RetracementQuality; reason: EntryReason };
export type EntryDiagnostics = {
  processedCandles: number;
  qualifiedLocationsConsumed: number;
  zonesReachedAfterQualification: number;
  retracementsStarted: number;
  controlValidAtReach: number;
  responseTriggers: number;
  candidateAttempts: number;
  noChasePass: number;
  entryCandidates: number;
  missed: number;
  invalidated: number;
  expired: number;
  activeTrackers: number;
  qualityObserved: Record<RetracementQuality, number>;
  rejectedByReason: Record<EntryRejection, number>;
  sumBarsQualificationToRetrace: number;
  sumBarsRetraceToCandidate: number;
  sumEntryExtensionAtr: number;
  errorCode?: string;
  errorIndex?: number;
};
export type EntryTimings = { zoneActivationMs: number;
  retracementUpdateMs: number; responseEvaluationMs: number;
  noChaseMs: number; candidateEmissionMs: number; totalMs: number };
export type EntryCandidateResult = { status: DataStatus; symbol: "XAUUSD";
  config: Readonly<EntryCandidateConfig>; candidates: EntryCandidate[];
  episodes: EntryEpisode[]; events: EntryStateEvent[];
  diagnostics: EntryDiagnostics; timings: EntryTimings };

type ControlAtCandle = Pick<ControlSnapshot, "timestamp" | "state" | "lastTransferId">;
type Tracker = {
  fvgId: string; setupKey: string; direction: FvgDirection;
  lower: number; upper: number; midpoint: number;
  qualifiedAt: number; qualifiedIndex: number;
  referenceAtr: number | null; initialDistanceAtr: number | null;
  initialTransferId: string | null;
  structuralConfirmationId: string; displacementEventId: string;
  controlTransferId: string | null; interactionId: string | null;
  liquidityId: string | null;
  zoneStatus: FvgLifecycleEvent["status"];
  fillFraction: number;
  state: EntryState; quality: RetracementQuality;
  qualityMask: number;
  startedAt: number | null; startedIndex: number | null;
  reachedAt: number | null; reachedIndex: number | null;
  retracementExtreme: number | null;
  lastClose: number; lastDistanceAtr: number | null;
  retracementSpeedAtr: number | null;
  adverseMomentumBars: number; responseBars: number;
  everAggressive: boolean; responseCounted: boolean;
  reasons: EntryReason[];
};
type Ready = { tracker: Tracker; extension: number;
  distance: number; traveled: number; feature: CandlePsychologyFeature;
  control: ControlAtCandle; candle: Candle };

const QUALITY_BIT: Record<RetracementQuality, number> = {
  CONTROLLED: 1, AGGRESSIVE: 2, DEEP: 4, SHALLOW: 8,
  MESSY: 16, NO_RETRACE: 32, INVALIDATING: 64, UNKNOWN: 128,
};
function resolvedConfig(overrides: Partial<EntryCandidateConfig>):
  Readonly<EntryCandidateConfig> {
  const config = { ...DEFAULT_ENTRY_CANDIDATE_CONFIG, ...overrides };
  if (!Number.isSafeInteger(config.maxBarsToRetrace) ||
      config.maxBarsToRetrace < 1 || config.maxBarsToRetrace > 256 ||
      !Number.isSafeInteger(config.maxBarsToEntry) ||
      config.maxBarsToEntry < 1 || config.maxBarsToEntry > 256 ||
      !Number.isFinite(config.maxEntryExtensionAtr) ||
      config.maxEntryExtensionAtr <= 0 || config.maxEntryExtensionAtr > 10 ||
      !Number.isFinite(config.minResponseBodyAtr) ||
      config.minResponseBodyAtr < 0 || config.minResponseBodyAtr > 10 ||
      !Number.isFinite(config.aggressiveBodyAtr) ||
      config.aggressiveBodyAtr <= 0 || config.aggressiveBodyAtr > 10 ||
      !Number.isFinite(config.minResponseBodyToRange) ||
      config.minResponseBodyToRange < 0 || config.minResponseBodyToRange > 1 ||
      !Number.isFinite(config.minControlledOverlap) ||
      config.minControlledOverlap < 0 || config.minControlledOverlap > 1 ||
      !Number.isFinite(config.messyMaxEfficiency) ||
      config.messyMaxEfficiency < 0 || config.messyMaxEfficiency > 1 ||
      !Number.isFinite(config.deepRetracementFraction) ||
      !Number.isFinite(config.shallowRetracementFraction) ||
      config.shallowRetracementFraction < 0 ||
      config.deepRetracementFraction > 1 ||
      config.shallowRetracementFraction >= config.deepRetracementFraction) {
    throw new RangeError("Invalid entry candidate configuration");
  }
  return Object.freeze(config);
}
function emptyDiagnostics(): EntryDiagnostics {
  return { processedCandles: 0, qualifiedLocationsConsumed: 0,
    zonesReachedAfterQualification: 0, retracementsStarted: 0,
    controlValidAtReach: 0, responseTriggers: 0, candidateAttempts: 0,
    noChasePass: 0, entryCandidates: 0, missed: 0, invalidated: 0,
    expired: 0, activeTrackers: 0,
    qualityObserved: { CONTROLLED: 0, AGGRESSIVE: 0, DEEP: 0,
      SHALLOW: 0, MESSY: 0, NO_RETRACE: 0, INVALIDATING: 0, UNKNOWN: 0 },
    rejectedByReason: { NO_RETRACE: 0, ZONE_FILLED: 0,
      CONTROL_INVALIDATED: 0, RETRACE_TOO_AGGRESSIVE: 0,
      NO_DIRECTIONAL_RESPONSE: 0, ENTRY_TOO_EXTENDED: 0,
      RETRACE_TIMEOUT: 0, ENTRY_TIMEOUT: 0,
      DUPLICATE_SETUP_ENTRY: 0, NO_REFERENCE_ATR: 0 },
    sumBarsQualificationToRetrace: 0, sumBarsRetraceToCandidate: 0,
    sumEntryExtensionAtr: 0 };
}
function emptyTimings(): EntryTimings {
  return { zoneActivationMs: 0, retracementUpdateMs: 0,
    responseEvaluationMs: 0, noChaseMs: 0, candidateEmissionMs: 0,
    totalMs: 0 };
}
function distanceFromZone(direction: FvgDirection, close: number,
  lower: number, upper: number): number {
  return direction === "BULLISH" ? Math.max(0, close - upper) :
    Math.max(0, lower - close);
}
function response(direction: FvgDirection, feature: CandlePsychologyFeature,
  config: EntryCandidateConfig): boolean {
  if (feature.direction !== direction) return false;
  const evidence = feature.evidence;
  return direction === "BULLISH" ?
    evidence.strongBullishClose || evidence.lowerRejection ||
      ((feature.bodyToATR ?? 0) >= config.minResponseBodyAtr &&
       (feature.bodyToRangeRatio ?? 0) >= config.minResponseBodyToRange) :
    evidence.strongBearishClose || evidence.upperRejection ||
      ((feature.bodyToATR ?? 0) >= config.minResponseBodyAtr &&
       (feature.bodyToRangeRatio ?? 0) >= config.minResponseBodyToRange);
}
function isOppositeTransfer(tracker: Tracker, control: ControlAtCandle): boolean {
  const opposed = tracker.direction === "BULLISH" ?
    control.state === "SELLER_CONTROL" : control.state === "BUYER_CONTROL";
  return opposed && control.lastTransferId !== null &&
    control.lastTransferId !== tracker.initialTransferId;
}
function setupKey(zone: FvgZone): string {
  return `${zone.structuralConfirmationId}:${zone.displacementEventId}:${zone.direction}`;
}
export class EntryCandidateInputError extends Error {
  constructor(readonly code: "INPUT_ALIGNMENT" | "INPUT_ORDER" |
    "EVENT_ORDER" | "INVALID_ZONE" | "INVALID_EVENT" |
    "EVENT_STREAM_INCOMPLETE") { super(code); }
}

export class EntryCandidateEngine {
  readonly config: Readonly<EntryCandidateConfig>;
  readonly candidates: EntryCandidate[] = [];
  readonly episodes: EntryEpisode[] = [];
  readonly events: EntryStateEvent[] = [];
  readonly diagnostics = emptyDiagnostics();
  readonly timings = emptyTimings();
  private readonly active = new Map<string, Tracker>();
  private readonly enteredSetups = new Set<string>();
  private emittedThisPush: EntryStateEvent[] = [];
  private previousTimestamp: number | null = null;
  private lastEventAt = -Infinity;
  constructor(config: Partial<EntryCandidateConfig> = {}) {
    this.config = resolvedConfig(config);
  }
  push(input: { candle: Candle; psychology: CandlePsychologyFeature;
    control: ControlAtCandle; newZones: readonly FvgZone[];
    zoneUpdates: readonly FvgLifecycleEvent[] }): readonly EntryStateEvent[] {
    const { candle, psychology, control, newZones, zoneUpdates } = input;
    if (candle.symbol !== "XAUUSD" || candle.timeframe !== "1m" ||
        !Number.isSafeInteger(candle.timestamp) ||
        psychology.timestamp !== candle.timestamp ||
        psychology.timeframe !== "1m" || !psychology.sourceComplete ||
        control.timestamp !== candle.timestamp) {
      throw new EntryCandidateInputError("INPUT_ALIGNMENT");
    }
    if (this.previousTimestamp !== null &&
        candle.timestamp <= this.previousTimestamp) {
      throw new EntryCandidateInputError("INPUT_ORDER");
    }
    const index = this.diagnostics.processedCandles;
    this.emittedThisPush = [];
    let started = performance.now();
    const fresh = new Map<string, FvgZone>();
    for (const zone of newZones) fresh.set(zone.id, zone);
    const seenThisPush = new Set<string>();
    for (const event of zoneUpdates) {
      if (seenThisPush.has(event.id)) continue;
      if (!event.id || !event.zoneId ||
          !Number.isSafeInteger(event.availableAt) ||
          event.availableAt > candle.timestamp ||
          (this.previousTimestamp !== null &&
            event.availableAt <= this.previousTimestamp) ||
          event.availableAt < this.lastEventAt ||
          !Number.isFinite(event.maxFillFraction) ||
          event.maxFillFraction < 0 || event.maxFillFraction > 1) {
        throw new EntryCandidateInputError("EVENT_ORDER");
      }
      seenThisPush.add(event.id);
      this.lastEventAt = event.availableAt;
      if (event.type === "FVG_QUALIFIED") {
        const zone = fresh.get(event.zoneId);
        if (!zone) throw new EntryCandidateInputError("INVALID_ZONE");
        this.activate(zone, event, candle, psychology, control, index);
      } else {
        const tracker = this.active.get(event.zoneId);
        if (tracker && (event.type === "FVG_PARTIALLY_FILLED" ||
            event.type === "FVG_FILL_DEPTH_UPDATED" || event.type === "FVG_FILLED")) {
          tracker.fillFraction = event.maxFillFraction;
          tracker.zoneStatus = event.status;
        }
      }
    }
    this.timings.zoneActivationMs += performance.now() - started;
    started = performance.now();
    const ready: Ready[] = [];
    for (const tracker of this.active.values()) {
      this.update(tracker, candle, psychology, control, index, ready);
    }
    this.timings.retracementUpdateMs += performance.now() - started;
    started = performance.now();
    ready.sort((a, b) => a.extension - b.extension ||
      a.tracker.fvgId.localeCompare(b.tracker.fvgId));
    for (const item of ready) {
      const tracker = item.tracker;
      if (!this.active.has(tracker.fvgId)) continue;
      if (this.enteredSetups.has(tracker.setupKey)) {
        this.diagnostics.rejectedByReason.DUPLICATE_SETUP_ENTRY++;
        this.finish(tracker, "EXPIRED", candle.timestamp, "DUPLICATE_SETUP_ENTRY");
      } else {
        this.emitCandidate(item, index);
      }
    }
    this.timings.candidateEmissionMs += performance.now() - started;
    this.diagnostics.activeTrackers = this.active.size;
    this.diagnostics.processedCandles++;
    this.previousTimestamp = candle.timestamp;
    return this.emittedThisPush;
  }
  private activate(zone: FvgZone, event: FvgLifecycleEvent, candle: Candle,
    feature: CandlePsychologyFeature, control: ControlAtCandle, index: number): void {
    if (zone.qualifiedAt !== event.availableAt || !zone.structuralConfirmationId ||
        !zone.displacementEventId || zone.lower >= zone.upper ||
        zone.direction !== "BULLISH" && zone.direction !== "BEARISH") {
      throw new EntryCandidateInputError("INVALID_ZONE");
    }
    this.diagnostics.qualifiedLocationsConsumed++;
    if (event.status === "FILLED" || event.locationStatus !== "AVAILABLE") {
      this.diagnostics.rejectedByReason.ZONE_FILLED++;
      return;
    }
    if (this.active.has(zone.id)) return;
    const referenceAtr = feature.atrReady && feature.atr !== null &&
      feature.atr > 0 ? feature.atr : zone.referenceAtr;
    const distance = distanceFromZone(zone.direction, candle.close,
      zone.lower, zone.upper);
    const tracker: Tracker = { fvgId: zone.id, setupKey: setupKey(zone),
      direction: zone.direction, lower: zone.lower, upper: zone.upper,
      midpoint: zone.midpoint, qualifiedAt: event.availableAt,
      qualifiedIndex: index, referenceAtr,
      initialDistanceAtr: referenceAtr ? distance / referenceAtr : null,
      initialTransferId: control.lastTransferId,
      structuralConfirmationId: zone.structuralConfirmationId,
      displacementEventId: zone.displacementEventId,
      controlTransferId: zone.controlTransferId, interactionId: zone.interactionId,
      liquidityId: zone.liquidityId, zoneStatus: event.status,
      fillFraction: event.maxFillFraction, state: "WAITING", quality: "NO_RETRACE",
      qualityMask: QUALITY_BIT.NO_RETRACE, startedAt: null, startedIndex: null,
      reachedAt: null, reachedIndex: null, retracementExtreme: null,
      lastClose: candle.close, lastDistanceAtr: referenceAtr ?
        distance / referenceAtr : null, retracementSpeedAtr: null,
      adverseMomentumBars: 0, responseBars: 0, everAggressive: false,
      responseCounted: false, reasons: ["QUALIFIED_FVG"] };
    this.active.set(zone.id, tracker);
    this.diagnostics.qualityObserved.NO_RETRACE++;
    this.emitState(tracker, candle.timestamp, "QUALIFIED_FVG");
    if ((zone.direction === "BULLISH" && control.state === "SELLER_CONTROL" ||
         zone.direction === "BEARISH" && control.state === "BUYER_CONTROL") &&
        control.lastTransferId !== null) {
      this.diagnostics.rejectedByReason.CONTROL_INVALIDATED++;
      this.classify(tracker, "INVALIDATING", candle.timestamp,
        "ORIGINAL_CONTROL_INVALIDATED");
      this.finish(tracker, "INVALIDATED", candle.timestamp,
        "ORIGINAL_CONTROL_INVALIDATED");
    }
  }
  private emitState(tracker: Tracker, at: number, reason: EntryReason): void {
    const event = { id: `${tracker.fvgId}:${tracker.state}:${tracker.quality}:${at}:${reason}`,
      fvgId: tracker.fvgId, availableAt: at, state: tracker.state,
      quality: tracker.quality, reason };
    this.events.push(event);
    this.emittedThisPush.push(event);
  }
  private classify(tracker: Tracker, quality: RetracementQuality,
    at: number, reason: EntryReason): void {
    if (tracker.quality === quality) return;
    tracker.quality = quality;
    if (!(tracker.qualityMask & QUALITY_BIT[quality])) {
      tracker.qualityMask |= QUALITY_BIT[quality];
      this.diagnostics.qualityObserved[quality]++;
    }
    tracker.reasons.push(reason);
    this.emitState(tracker, at, reason);
  }
  private finish(tracker: Tracker, state: EntryEpisode["state"],
    at: number, reason: EntryReason, candidateId: string | null = null): void {
    tracker.state = state;
    tracker.reasons.push(reason);
    this.emitState(tracker, at, reason);
    this.episodes.push({ fvgId: tracker.fvgId, setupKey: tracker.setupKey,
      direction: tracker.direction, qualifiedAt: tracker.qualifiedAt,
      startedAt: tracker.startedAt, reachedAt: tracker.reachedAt,
      completedAt: at, state, quality: tracker.quality,
      maxFillFraction: tracker.fillFraction, candidateId,
      reasons: [...tracker.reasons] });
    this.active.delete(tracker.fvgId);
    if (state === "MISSED") this.diagnostics.missed++;
    if (state === "INVALIDATED") this.diagnostics.invalidated++;
    if (state === "EXPIRED") this.diagnostics.expired++;
  }
  private update(tracker: Tracker, candle: Candle,
    feature: CandlePsychologyFeature, control: ControlAtCandle,
    index: number, ready: Ready[]): void {
    const now = candle.timestamp;
    if (now <= tracker.qualifiedAt) return;
    if (tracker.zoneStatus === "FILLED") {
      this.diagnostics.rejectedByReason.ZONE_FILLED++;
      this.classify(tracker, "INVALIDATING", now, "ZONE_FILLED");
      this.finish(tracker, "INVALIDATED", now, "ZONE_FILLED");
      return;
    }
    if (isOppositeTransfer(tracker, control)) {
      this.diagnostics.rejectedByReason.CONTROL_INVALIDATED++;
      this.classify(tracker, "INVALIDATING", now, "ORIGINAL_CONTROL_INVALIDATED");
      this.finish(tracker, "INVALIDATED", now, "ORIGINAL_CONTROL_INVALIDATED");
      return;
    }
    const toward = tracker.direction === "BULLISH" ?
      candle.close < tracker.lastClose : candle.close > tracker.lastClose;
    const touched = tracker.direction === "BULLISH" ?
      candle.low <= tracker.upper : candle.high >= tracker.lower;
    if (tracker.startedAt === null && (toward || touched)) {
      tracker.startedAt = now;
      tracker.startedIndex = index;
      tracker.state = "RETRACING";
      tracker.reasons.push("RETRACE_STARTED");
      this.diagnostics.retracementsStarted++;
      this.emitState(tracker, now, "RETRACE_STARTED");
    }
    if (tracker.reachedAt === null && touched) {
      tracker.reachedAt = now;
      tracker.reachedIndex = index;
      tracker.retracementExtreme = tracker.direction === "BULLISH" ?
        candle.low : candle.high;
      this.diagnostics.zonesReachedAfterQualification++;
      this.diagnostics.controlValidAtReach++;
      this.diagnostics.sumBarsQualificationToRetrace +=
        index - tracker.qualifiedIndex;
      tracker.reasons.push("RETRACE_ENTERED_ZONE");
      this.emitState(tracker, now, "RETRACE_ENTERED_ZONE");
    }
    if (tracker.reachedAt === null) {
      if (index - tracker.qualifiedIndex > this.config.maxBarsToRetrace) {
        this.diagnostics.rejectedByReason.NO_RETRACE++;
        this.diagnostics.rejectedByReason.RETRACE_TIMEOUT++;
        this.finish(tracker, "EXPIRED", now, "RETRACE_TIMEOUT");
      }
      tracker.lastClose = candle.close;
      return;
    }
    tracker.retracementExtreme = tracker.direction === "BULLISH" ?
      Math.min(tracker.retracementExtreme!, candle.low) :
      Math.max(tracker.retracementExtreme!, candle.high);
    const currentDistance = tracker.referenceAtr ?
      distanceFromZone(tracker.direction, candle.close, tracker.lower,
        tracker.upper) / tracker.referenceAtr : null;
    tracker.retracementSpeedAtr = currentDistance !== null &&
      tracker.lastDistanceAtr !== null ?
        Math.max(0, tracker.lastDistanceAtr - currentDistance) : null;
    tracker.lastDistanceAtr = currentDistance;
    const opposing = feature.direction !== "NEUTRAL" &&
      feature.direction !== tracker.direction;
    const aggressive = opposing &&
      (feature.bodyToATR ?? 0) >= this.config.aggressiveBodyAtr &&
      feature.evidence.momentumIncreasing;
    if (aggressive) {
      tracker.everAggressive = true;
      tracker.adverseMomentumBars++;
    }
    const quality: RetracementQuality = aggressive ? "AGGRESSIVE" :
      tracker.fillFraction >= this.config.deepRetracementFraction ? "DEEP" :
      tracker.fillFraction <= this.config.shallowRetracementFraction ? "SHALLOW" :
      feature.evidence.indecision ||
        (feature.directionalEfficiency !== null &&
         feature.directionalEfficiency < this.config.messyMaxEfficiency) ? "MESSY" :
      feature.evidence.compression || feature.evidence.momentumDecaying ||
        (feature.overlapRatio ?? 0) >= this.config.minControlledOverlap ?
          "CONTROLLED" : "UNKNOWN";
    const reason: EntryReason = quality === "AGGRESSIVE" ? "AGGRESSIVE_RETRACE" :
      quality === "DEEP" ? "DEEP_RETRACE" :
      quality === "SHALLOW" ? "SHALLOW_RETRACE" :
      quality === "MESSY" ? "MESSY_RETRACE" : "CONTROLLED_RETRACE";
    this.classify(tracker, quality, now, reason);
    if (aggressive) this.diagnostics.rejectedByReason.RETRACE_TOO_AGGRESSIVE++;
    const extension = currentDistance;
    let clock = performance.now();
    if (extension !== null && extension > this.config.maxEntryExtensionAtr) {
      this.timings.noChaseMs += performance.now() - clock;
      this.diagnostics.rejectedByReason.ENTRY_TOO_EXTENDED++;
      this.finish(tracker, "MISSED", now, "ENTRY_TOO_EXTENDED");
      return;
    }
    this.timings.noChaseMs += performance.now() - clock;
    if (index - tracker.reachedIndex! > this.config.maxBarsToEntry) {
      this.diagnostics.rejectedByReason.ENTRY_TIMEOUT++;
      this.diagnostics.rejectedByReason.NO_DIRECTIONAL_RESPONSE++;
      this.finish(tracker, "EXPIRED", now, "ENTRY_TIMEOUT");
      return;
    }
    clock = performance.now();
    const hasResponse = now > tracker.reachedAt &&
      response(tracker.direction, feature, this.config);
    this.timings.responseEvaluationMs += performance.now() - clock;
    if (hasResponse) {
      tracker.responseBars++;
      if (!tracker.responseCounted) {
        tracker.responseCounted = true;
        this.diagnostics.responseTriggers++;
      }
      if (tracker.state !== "RESPONDING") {
        tracker.state = "RESPONDING";
        this.emitState(tracker, now,
          tracker.direction === "BULLISH" ? "BULLISH_RESPONSE" : "BEARISH_RESPONSE");
      }
      if (tracker.everAggressive && tracker.responseBars < 2 &&
          !feature.evidence.momentumDecaying) {
        tracker.lastClose = candle.close;
        return;
      }
      this.diagnostics.candidateAttempts++;
      if (extension === null) {
        this.diagnostics.rejectedByReason.NO_REFERENCE_ATR++;
      } else {
        this.diagnostics.noChasePass++;
        const distance = distanceFromZone(tracker.direction, candle.close,
          tracker.lower, tracker.upper);
        const traveled = tracker.direction === "BULLISH" ?
          Math.max(0, candle.close - tracker.retracementExtreme!) :
          Math.max(0, tracker.retracementExtreme! - candle.close);
        ready.push({ tracker, extension, distance, traveled,
          feature, control, candle });
      }
    } else if (feature.direction !== tracker.direction) {
      tracker.responseBars = 0;
    }
    tracker.lastClose = candle.close;
  }
  private emitCandidate(item: Ready, index: number): void {
    const { tracker, extension, distance, traveled, feature, control, candle } = item;
    const id = `XAUUSD:1m:ENTRY_CANDIDATE:${tracker.fvgId}:${candle.timestamp}`;
    const reasons: EntryReason[] = [...tracker.reasons,
      "ORIGINAL_CONTROL_VALID", tracker.direction === "BULLISH" ?
        "BULLISH_RESPONSE" : "BEARISH_RESPONSE", "ENTRY_TRIGGER_CONFIRMED"];
    const candidate: EntryCandidate = { id, type: "FVG_RETRACE",
      direction: tracker.direction, createdAt: candle.timestamp,
      availableAt: candle.timestamp, entryPrice: candle.close,
      status: "CANDIDATE", fvgId: tracker.fvgId,
      fillFractionAtEntry: tracker.fillFraction,
      retracementClass: tracker.quality,
      structuralConfirmationId: tracker.structuralConfirmationId,
      displacementEventId: tracker.displacementEventId,
      controlTransferId: tracker.controlTransferId,
      interactionId: tracker.interactionId,
      liquidityId: tracker.liquidityId,
      controlStateAtEntry: control.state,
      referenceAtr: tracker.referenceAtr!,
      responseBodyAtr: feature.bodyToATR,
      responseClosePosition: feature.closePosition,
      barsFromQualifiedToRetrace: tracker.reachedIndex! - tracker.qualifiedIndex,
      barsFromRetraceToCandidate: index - tracker.reachedIndex!,
      totalBarsToCandidate: index - tracker.qualifiedIndex,
      distanceFromZoneAtCandidate: distance,
      distanceFromZoneAtr: extension,
      distanceTravelledSinceRetracementExtreme: traveled,
      distanceTravelledAtr: traveled / tracker.referenceAtr!,
      reasons };
    this.candidates.push(candidate);
    this.enteredSetups.add(tracker.setupKey);
    this.diagnostics.entryCandidates++;
    this.diagnostics.sumBarsRetraceToCandidate +=
      candidate.barsFromRetraceToCandidate;
    this.diagnostics.sumEntryExtensionAtr += extension;
    this.finish(tracker, "CANDIDATE", candle.timestamp,
      "ENTRY_TRIGGER_CONFIRMED", id);
    for (const other of this.active.values()) {
      if (other.setupKey !== tracker.setupKey) continue;
      this.diagnostics.rejectedByReason.DUPLICATE_SETUP_ENTRY++;
      this.finish(other, "EXPIRED", candle.timestamp, "DUPLICATE_SETUP_ENTRY");
    }
  }
}
export function createEntryCandidateEngine(config: Partial<EntryCandidateConfig> = {}):
  EntryCandidateEngine { return new EntryCandidateEngine(config); }

export function analyzeHistoricalEntryCandidates(historical: HistoricalResult,
  psychology: CandlePsychologyResult, control: ControlResult, fvg: FvgResult,
  overrides: Partial<EntryCandidateConfig> = {}): EntryCandidateResult {
  const engine = createEntryCandidateEngine(overrides);
  const started = performance.now();
  const blocked = (code: string, index?: number): EntryCandidateResult => {
    const diagnostics = emptyDiagnostics();
    diagnostics.errorCode = code;
    if (index !== undefined) diagnostics.errorIndex = index;
    return { status: "BLOCKED", symbol: "XAUUSD", config: engine.config,
      candidates: [], episodes: [], events: [], diagnostics,
      timings: emptyTimings() };
  };
  if ([historical.status, psychology.status, control.status, fvg.status]
    .some((status) => status === "BLOCKED" || status === "FAILED")) {
    return blocked("UPSTREAM_DATA_STATUS");
  }
  const candles = historical.candles1m;
  const features = psychology.timeframes["1m"].features;
  if (candles.length !== features.length ||
      control.diagnostics.processedCandles !== candles.length ||
      fvg.diagnostics.processedCandles !== candles.length) {
    return blocked("INPUT_ALIGNMENT");
  }
  const zoneById = new Map(fvg.zones.map((zone) => [zone.id, zone]));
  let e = 0; let s = 0; let t = 0;
  let state: ControlState = "UNCLEAR";
  let lastTransferId: string | null = null;
  try {
    for (let i = 0; i < candles.length; i++) {
      const now = candles[i].timestamp;
      while (s < control.stateChanges.length &&
          control.stateChanges[s].availableAt <= now) {
        state = control.stateChanges[s++].state;
      }
      while (t < control.transfers.length && control.transfers[t].availableAt <= now) {
        lastTransferId = control.transfers[t++].id;
      }
      const updates: FvgLifecycleEvent[] = [];
      const newZones: FvgZone[] = [];
      while (e < fvg.events.length && fvg.events[e].availableAt <= now) {
        const event = fvg.events[e++];
        updates.push(event);
        if (event.type === "FVG_QUALIFIED") {
          const zone = zoneById.get(event.zoneId);
          if (!zone) throw new EntryCandidateInputError("INVALID_ZONE");
          newZones.push(zone);
        }
      }
      engine.push({ candle: candles[i], psychology: features[i],
        control: { timestamp: now, state, lastTransferId },
        newZones, zoneUpdates: updates });
    }
    if (e !== fvg.events.length || s !== control.stateChanges.length ||
        t !== control.transfers.length) {
      return blocked("EVENT_STREAM_INCOMPLETE");
    }
    if (candles.length && (control.current?.timestamp !== candles[candles.length - 1].timestamp ||
        control.current.state !== state ||
        control.current.lastTransferId !== lastTransferId)) {
      return blocked("CONTROL_STREAM_INCOMPLETE");
    }
    engine.timings.totalMs = performance.now() - started;
    return { status: [historical.status, psychology.status, control.status,
      fvg.status].includes("WARN") ? "WARN" : "READY",
      symbol: "XAUUSD", config: engine.config, candidates: engine.candidates,
      episodes: engine.episodes, events: engine.events,
      diagnostics: engine.diagnostics, timings: engine.timings };
  } catch (error) {
    if (error instanceof EntryCandidateInputError) {
      return blocked(error.code, engine.diagnostics.processedCandles);
    }
    throw error;
  }
}
