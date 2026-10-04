import type { Candle, DataStatus, HistoricalResult } from "../data/types.ts";
import type { CandlePsychologyFeature, CandlePsychologyResult } from "./candle-psychology.ts";
import type { DisplacementEvent, DisplacementResult } from "./displacement-engine.ts";
import { BinaryHeap } from "./price-approach.ts";
import type { StructuralConfirmationEvent, StructuralConfirmationResult } from
  "./structural-confirmation.ts";

export type FvgDirection = "BULLISH" | "BEARISH";
export type FvgStatus = "OPEN" | "PARTIAL" | "FILLED";
export type FvgRejection = "GAP_TOO_SMALL" | "NO_DISPLACEMENT_LINEAGE" |
  "DIRECTION_MISMATCH" | "NO_STRUCTURAL_CONFIRMATION" |
  "DISPLACEMENT_WINDOW_MISMATCH" | "QUALIFICATION_WINDOW_EXPIRED" |
  "FILLED_BEFORE_QUALIFICATION";
export type FvgConfig = { minRawGapAtr: number; maxQualificationLagBars: number };
export const DEFAULT_FVG_CONFIG: Readonly<FvgConfig> = Object.freeze({
  minRawGapAtr: 0.1, maxQualificationLagBars: 12,
});
export type FvgZone = {
  id: string;
  direction: FvgDirection;
  timeframe: "1m";
  lower: number;
  upper: number;
  midpoint: number;
  size: number;
  sizeAtr: number | null;
  referenceAtr: number | null;
  formationAt: number;
  rawAvailableAt: number;
  qualifiedAt: number | null;
  status: FvgStatus;
  locationStatus: "AVAILABLE" | "UNAVAILABLE";
  displacementEventId: string | null;
  displacementClassification: DisplacementEvent["classification"] | null;
  structuralConfirmationId: string | null;
  structuralConfirmationType: StructuralConfirmationEvent["type"] | null;
  controlTransferId: string | null;
  interactionId: string | null;
  liquidityId: string | null;
  firstRetraceAt: number | null;
  filledAt: number | null;
  maxFillFraction: number;
};
export type FvgLifecycleEvent = {
  id: string; zoneId: string; type: "RAW_FVG_CREATED" | "FVG_QUALIFIED" |
    "FVG_PARTIALLY_FILLED" | "FVG_FILL_DEPTH_UPDATED" | "FVG_FILLED" |
    "FVG_QUALIFICATION_EXPIRED";
  availableAt: number;
  status: FvgStatus;
  maxFillFraction: number;
  locationStatus: FvgZone["locationStatus"];
};
export type FvgDiagnostics = {
  processedCandles: number;
  displacementsConsumed: number;
  structuralConfirmationsConsumed: number;
  rawBullishFvg: number;
  rawBearishFvg: number;
  tooSmall: number;
  pendingQualification: number;
  qualifiedBullish: number;
  qualifiedBearish: number;
  qualifiedFromMss: number;
  qualifiedFromBos: number;
  partial: number;
  filled: number;
  filledBeforeQualification: number;
  expiredUnqualified: number;
  currentlyOpenQualifiedZones: number;
  confirmationsWithoutMatchingFvg: number;
  rejectedByReason: Record<FvgRejection, number>;
  errorCode?: string;
  errorIndex?: number;
};
export type FvgTimings = { rawDetectionMs: number; pendingLifecycleMs: number;
  eventCorrelationMs: number; qualificationMs: number; activeZoneUpdateMs: number;
  totalMs: number; sampledEvery: number };
export type FvgResult = { status: DataStatus; symbol: "XAUUSD";
  config: Readonly<FvgConfig>; zones: FvgZone[]; events: FvgLifecycleEvent[];
  diagnostics: FvgDiagnostics; timings: FvgTimings };

type Pending = { zone: FvgZone; bornIndex: number; active: boolean;
  sawSameDirection: boolean; sawOppositeDirection: boolean;
  sawMatchingWindow: boolean };
type RecentDisplacement = { event: DisplacementEvent; seenIndex: number };
type RecentConfirmation = { event: StructuralConfirmationEvent;
  displacement: DisplacementEvent; seenIndex: number; matched: number };
type HeapItem = { zone: FvgZone; trigger: number };

export class FvgInputError extends Error {
  constructor(readonly code: "INPUT_ALIGNMENT" | "INPUT_ORDER" | "INVALID_INPUT" |
    "DISPLACEMENT_ORDER" | "CONFIRMATION_ORDER" | "LATE_EVENT" |
    "MISSING_DISPLACEMENT_LINEAGE") { super(code); }
}
function configOf(overrides: Partial<FvgConfig>): Readonly<FvgConfig> {
  const config = { ...DEFAULT_FVG_CONFIG, ...overrides };
  if (!Number.isFinite(config.minRawGapAtr) || config.minRawGapAtr < 0 ||
      config.minRawGapAtr > 10 || !Number.isSafeInteger(config.maxQualificationLagBars) ||
      config.maxQualificationLagBars < 1 || config.maxQualificationLagBars > 128) {
    throw new RangeError("Invalid FVG configuration");
  }
  return Object.freeze(config);
}
function diagnostics(): FvgDiagnostics {
  return { processedCandles: 0, displacementsConsumed: 0,
    structuralConfirmationsConsumed: 0, rawBullishFvg: 0, rawBearishFvg: 0,
    tooSmall: 0, pendingQualification: 0, qualifiedBullish: 0,
    qualifiedBearish: 0, qualifiedFromMss: 0, qualifiedFromBos: 0,
    partial: 0, filled: 0, filledBeforeQualification: 0,
    expiredUnqualified: 0, currentlyOpenQualifiedZones: 0,
    confirmationsWithoutMatchingFvg: 0,
    rejectedByReason: { GAP_TOO_SMALL: 0, NO_DISPLACEMENT_LINEAGE: 0,
      DIRECTION_MISMATCH: 0, NO_STRUCTURAL_CONFIRMATION: 0,
      DISPLACEMENT_WINDOW_MISMATCH: 0, QUALIFICATION_WINDOW_EXPIRED: 0,
      FILLED_BEFORE_QUALIFICATION: 0 } };
}
function timings(): FvgTimings {
  return { rawDetectionMs: 0, pendingLifecycleMs: 0, eventCorrelationMs: 0,
    qualificationMs: 0, activeZoneUpdateMs: 0, totalMs: 0, sampledEvery: 1 };
}
function overlaps(zone: FvgZone, displacement: DisplacementEvent): boolean {
  // The formation interval A..C overlaps the actual ignition..confirmation episode.
  return zone.formationAt <= displacement.confirmedAt &&
    zone.rawAvailableAt >= displacement.ignitionAt;
}
function validCandle(candle: Candle): boolean {
  return candle.symbol === "XAUUSD" && candle.timeframe === "1m" &&
    Number.isSafeInteger(candle.timestamp) && [candle.open, candle.high,
      candle.low, candle.close].every(Number.isFinite) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= Math.max(candle.open, candle.close);
}

export class FvgEngine {
  readonly config: Readonly<FvgConfig>;
  readonly zones: FvgZone[] = [];
  readonly events: FvgLifecycleEvent[] = [];
  readonly diagnostics = diagnostics();
  readonly timings = timings();
  private previous: Candle | null = null;
  private twoBack: Candle | null = null;
  private pending: Pending[] = [];
  private pendingHead = 0;
  private readonly recentDisplacements = new Map<string, RecentDisplacement>();
  private readonly recentConfirmations = new Map<string, RecentConfirmation>();
  private readonly seenDisplacements = new Set<string>();
  private readonly seenConfirmations = new Set<string>();
  private emittedThisPush: FvgLifecycleEvent[] = [];
  private lastDisplacementAt = -Infinity;
  private lastConfirmationAt = -Infinity;
  private readonly bullish = new BinaryHeap<HeapItem>((a, b) =>
    b.trigger - a.trigger || a.zone.id.localeCompare(b.zone.id));
  private readonly bearish = new BinaryHeap<HeapItem>((a, b) =>
    a.trigger - b.trigger || a.zone.id.localeCompare(b.zone.id));

  constructor(config: Partial<FvgConfig> = {}) { this.config = configOf(config); }

  push(input: { candle: Candle; psychology: CandlePsychologyFeature;
    displacementEvents: readonly DisplacementEvent[];
    structuralConfirmations: readonly StructuralConfirmationEvent[] }):
    readonly FvgLifecycleEvent[] {
    const { candle, psychology, displacementEvents, structuralConfirmations } = input;
    if (!validCandle(candle) || !psychology ||
        psychology.timestamp !== candle.timestamp ||
        psychology.timeframe !== "1m" || !psychology.sourceComplete) {
      throw new FvgInputError("INPUT_ALIGNMENT");
    }
    if (this.previous && candle.timestamp <= this.previous.timestamp) {
      throw new FvgInputError("INPUT_ORDER");
    }
    const index = this.diagnostics.processedCandles;
    this.emittedThisPush = [];
    let stage = performance.now();
    this.updatePending(candle, index);
    this.timings.pendingLifecycleMs += performance.now() - stage;
    stage = performance.now();
    this.updateQualified(candle);
    this.timings.activeZoneUpdateMs += performance.now() - stage;
    stage = performance.now();
    if (this.twoBack) this.detect(this.twoBack, candle, psychology, index);
    this.timings.rawDetectionMs += performance.now() - stage;
    stage = performance.now();
    this.consumeDisplacements(displacementEvents, candle.timestamp, index);
    this.timings.eventCorrelationMs += performance.now() - stage;
    stage = performance.now();
    this.consumeConfirmations(structuralConfirmations, candle.timestamp, index);
    this.timings.qualificationMs += performance.now() - stage;
    this.evictRecent(index);
    this.twoBack = this.previous;
    this.previous = candle;
    this.diagnostics.processedCandles++;
    return this.emittedThisPush;
  }

  private emit(zone: FvgZone, type: FvgLifecycleEvent["type"], at: number): void {
    const event = { id: `${zone.id}:${type}:${at}`, zoneId: zone.id,
      type, availableAt: at, status: zone.status,
      maxFillFraction: zone.maxFillFraction, locationStatus: zone.locationStatus };
    this.events.push(event);
    this.emittedThisPush.push(event);
  }
  private detect(a: Candle, c: Candle, psychology: CandlePsychologyFeature,
    index: number): void {
    const direction: FvgDirection | null = a.high < c.low ? "BULLISH" :
      a.low > c.high ? "BEARISH" : null;
    if (!direction) return;
    const lower = direction === "BULLISH" ? a.high : c.high;
    const upper = direction === "BULLISH" ? c.low : a.low;
    const size = upper - lower;
    const referenceAtr = psychology.atrReady && psychology.atr !== null &&
      Number.isFinite(psychology.atr) && psychology.atr > 0 ? psychology.atr : null;
    const sizeAtr = referenceAtr === null ? null : size / referenceAtr;
    const zone: FvgZone = { id: `XAUUSD:1m:FVG:${direction}:${a.timestamp}:${c.timestamp}:${lower}:${upper}`,
      direction, timeframe: "1m", lower, upper, midpoint: (lower + upper) / 2,
      size, sizeAtr, referenceAtr, formationAt: a.timestamp,
      rawAvailableAt: c.timestamp, qualifiedAt: null, status: "OPEN",
      locationStatus: "UNAVAILABLE", displacementEventId: null,
      displacementClassification: null, structuralConfirmationId: null,
      structuralConfirmationType: null, controlTransferId: null,
      interactionId: null, liquidityId: null, firstRetraceAt: null,
      filledAt: null, maxFillFraction: 0 };
    this.zones.push(zone);
    this.emit(zone, "RAW_FVG_CREATED", c.timestamp);
    if (direction === "BULLISH") this.diagnostics.rawBullishFvg++;
    else this.diagnostics.rawBearishFvg++;
    if (sizeAtr === null || sizeAtr < this.config.minRawGapAtr) {
      this.diagnostics.tooSmall++;
      this.diagnostics.rejectedByReason.GAP_TOO_SMALL++;
      return;
    }
    const pending: Pending = { zone, bornIndex: index, active: true,
      sawSameDirection: false, sawOppositeDirection: false,
      sawMatchingWindow: false };
    this.pending.push(pending);
    this.diagnostics.pendingQualification++;
    for (const { event } of this.recentDisplacements.values()) {
      this.observe(pending, event);
    }
    for (const confirmation of this.recentConfirmations.values()) {
      if (this.tryQualify(pending, confirmation, c.timestamp, index)) break;
    }
  }
  private updateFill(zone: FvgZone, price: number, at: number): void {
    if (zone.status === "FILLED") return;
    const fraction = zone.direction === "BULLISH" ?
      (zone.upper - price) / zone.size : (price - zone.lower) / zone.size;
    if (fraction <= zone.maxFillFraction) return;
    zone.maxFillFraction = Math.max(0, Math.min(1, fraction));
    if (zone.maxFillFraction > 0 && zone.firstRetraceAt === null) {
      zone.firstRetraceAt = at;
    }
    if (zone.maxFillFraction === 1) {
      zone.status = "FILLED";
      zone.filledAt = at;
      zone.locationStatus = "UNAVAILABLE";
      this.diagnostics.filled++;
      if (zone.qualifiedAt !== null) this.diagnostics.currentlyOpenQualifiedZones--;
      this.emit(zone, "FVG_FILLED", at);
    } else if (zone.status === "OPEN") {
      zone.status = "PARTIAL";
      this.diagnostics.partial++;
      this.emit(zone, "FVG_PARTIALLY_FILLED", at);
    } else {
      this.emit(zone, "FVG_FILL_DEPTH_UPDATED", at);
    }
  }
  private updatePending(candle: Candle, index: number): void {
    for (let i = this.pendingHead; i < this.pending.length; i++) {
      const item = this.pending[i];
      if (!item.active) continue;
      if (item.zone.rawAvailableAt < candle.timestamp) {
        this.updateFill(item.zone, item.zone.direction === "BULLISH" ?
          candle.low : candle.high, candle.timestamp);
      }
      if (index - item.bornIndex > this.config.maxQualificationLagBars) {
        item.active = false;
        this.diagnostics.pendingQualification--;
        this.diagnostics.expiredUnqualified++;
        this.diagnostics.rejectedByReason.QUALIFICATION_WINDOW_EXPIRED++;
        const reason: FvgRejection = item.sawMatchingWindow ?
          "NO_STRUCTURAL_CONFIRMATION" : item.sawSameDirection ?
            "DISPLACEMENT_WINDOW_MISMATCH" : item.sawOppositeDirection ?
              "DIRECTION_MISMATCH" : "NO_DISPLACEMENT_LINEAGE";
        this.diagnostics.rejectedByReason[reason]++;
        this.emit(item.zone, "FVG_QUALIFICATION_EXPIRED", candle.timestamp);
      }
    }
    while (this.pendingHead < this.pending.length && !this.pending[this.pendingHead].active) {
      this.pendingHead++;
    }
    if (this.pendingHead > 256 && this.pendingHead * 2 > this.pending.length) {
      this.pending.splice(0, this.pendingHead);
      this.pendingHead = 0;
    }
  }
  private updateQualified(candle: Candle): void {
    const touchedBullish: HeapItem[] = [];
    while (this.bullish.size && candle.low < this.bullish.peek()!.trigger) {
      const item = this.bullish.pop()!;
      this.updateFill(item.zone, candle.low, candle.timestamp);
      if (item.zone.status !== "FILLED") {
        item.trigger = candle.low;
        touchedBullish.push(item);
      }
    }
    for (const item of touchedBullish) this.bullish.push(item);
    const touchedBearish: HeapItem[] = [];
    while (this.bearish.size && candle.high > this.bearish.peek()!.trigger) {
      const item = this.bearish.pop()!;
      this.updateFill(item.zone, candle.high, candle.timestamp);
      if (item.zone.status !== "FILLED") {
        item.trigger = candle.high;
        touchedBearish.push(item);
      }
    }
    for (const item of touchedBearish) this.bearish.push(item);
  }
  private consumeDisplacements(events: readonly DisplacementEvent[], now: number,
    index: number): void {
    for (const event of events) {
      if (this.seenDisplacements.has(event.id)) continue;
      if (!event.id || !Number.isSafeInteger(event.availableAt) ||
          !Number.isSafeInteger(event.ignitionAt) ||
          !Number.isSafeInteger(event.confirmedAt) ||
          event.ignitionAt > event.confirmedAt ||
          event.confirmedAt > event.availableAt) throw new FvgInputError("INVALID_INPUT");
      if (event.availableAt > now || (this.previous &&
          event.availableAt <= this.previous.timestamp)) throw new FvgInputError("LATE_EVENT");
      if (event.availableAt < this.lastDisplacementAt) {
        throw new FvgInputError("DISPLACEMENT_ORDER");
      }
      this.seenDisplacements.add(event.id);
      this.lastDisplacementAt = event.availableAt;
      this.recentDisplacements.set(event.id, { event, seenIndex: index });
      this.diagnostics.displacementsConsumed++;
      for (let i = this.pendingHead; i < this.pending.length; i++) {
        if (this.pending[i].active) this.observe(this.pending[i], event);
      }
    }
  }
  private consumeConfirmations(events: readonly StructuralConfirmationEvent[], now: number,
    index: number): void {
    for (const event of events) {
      if (this.seenConfirmations.has(event.id)) continue;
      if (!event.id || !Number.isSafeInteger(event.availableAt) ||
          event.availableAt > now || (this.previous &&
          event.availableAt <= this.previous.timestamp)) throw new FvgInputError("LATE_EVENT");
      if (event.availableAt < this.lastConfirmationAt) {
        throw new FvgInputError("CONFIRMATION_ORDER");
      }
      const displacement = this.recentDisplacements.get(event.displacementEventId)?.event;
      if (!displacement || displacement.direction !== event.direction ||
          displacement.classification !== event.displacementClassification ||
          !event.type.startsWith(event.direction)) {
        throw new FvgInputError("MISSING_DISPLACEMENT_LINEAGE");
      }
      this.seenConfirmations.add(event.id);
      this.lastConfirmationAt = event.availableAt;
      this.recentConfirmations.set(event.id,
        { event, displacement, seenIndex: index, matched: 0 });
      this.diagnostics.structuralConfirmationsConsumed++;
      this.diagnostics.confirmationsWithoutMatchingFvg++;
      const recent = this.recentConfirmations.get(event.id)!;
      for (let i = this.pendingHead; i < this.pending.length; i++) {
        this.tryQualify(this.pending[i], recent, now, index);
      }
    }
  }
  private observe(item: Pending, event: DisplacementEvent): void {
    if (event.direction !== item.zone.direction) {
      if (overlaps(item.zone, event)) item.sawOppositeDirection = true;
    } else {
      item.sawSameDirection = true;
      if (overlaps(item.zone, event)) item.sawMatchingWindow = true;
    }
  }
  private tryQualify(item: Pending, confirmation: RecentConfirmation,
    now: number, index: number): boolean {
    if (!item.active) return false;
    const zone = item.zone;
    const { event, displacement } = confirmation;
    if (event.direction !== zone.direction || !overlaps(zone, displacement) ||
        now < zone.rawAvailableAt ||
        index - item.bornIndex > this.config.maxQualificationLagBars) return false;
    zone.qualifiedAt = Math.max(zone.rawAvailableAt, displacement.availableAt,
      event.availableAt);
    zone.displacementEventId = displacement.id;
    zone.displacementClassification = displacement.classification;
    zone.structuralConfirmationId = event.id;
    zone.structuralConfirmationType = event.type;
    zone.controlTransferId = event.controlTransferId;
    zone.interactionId = event.interactionId;
    zone.liquidityId = event.liquidityId;
    zone.locationStatus = zone.status === "FILLED" ? "UNAVAILABLE" : "AVAILABLE";
    item.active = false;
    this.diagnostics.pendingQualification--;
    if (confirmation.matched++ === 0) {
      this.diagnostics.confirmationsWithoutMatchingFvg--;
    }
    if (zone.direction === "BULLISH") this.diagnostics.qualifiedBullish++;
    else this.diagnostics.qualifiedBearish++;
    if (event.type.endsWith("MSS")) this.diagnostics.qualifiedFromMss++;
    else this.diagnostics.qualifiedFromBos++;
    if (zone.status === "FILLED") {
      this.diagnostics.filledBeforeQualification++;
      this.diagnostics.rejectedByReason.FILLED_BEFORE_QUALIFICATION++;
    } else {
      this.diagnostics.currentlyOpenQualifiedZones++;
      const trigger = zone.direction === "BULLISH" ?
        zone.upper - zone.size * zone.maxFillFraction :
        zone.lower + zone.size * zone.maxFillFraction;
      (zone.direction === "BULLISH" ? this.bullish : this.bearish)
        .push({ zone, trigger });
    }
    this.emit(zone, "FVG_QUALIFIED", zone.qualifiedAt);
    return true;
  }
  private evictRecent(index: number): void {
    const lag = this.config.maxQualificationLagBars + 2;
    for (const [id, item] of this.recentDisplacements) {
      if (index - item.seenIndex > lag) this.recentDisplacements.delete(id);
    }
    for (const [id, item] of this.recentConfirmations) {
      if (index - item.seenIndex > lag) {
        this.recentConfirmations.delete(id);
      }
    }
  }
}
export function createFvgEngine(config: Partial<FvgConfig> = {}): FvgEngine {
  return new FvgEngine(config);
}
export function analyzeHistoricalFvgs(historical: HistoricalResult,
  psychology: CandlePsychologyResult, displacement: DisplacementResult,
  confirmation: StructuralConfirmationResult,
  overrides: Partial<FvgConfig> = {}): FvgResult {
  const engine = createFvgEngine(overrides);
  const started = performance.now();
  const blocked = (code: string, index?: number): FvgResult => {
    const counts = diagnostics();
    counts.errorCode = code;
    if (index !== undefined) counts.errorIndex = index;
    return { status: "BLOCKED", symbol: "XAUUSD", config: engine.config,
      zones: [], events: [], diagnostics: counts, timings: timings() };
  };
  if ([historical.status, psychology.status, displacement.status,
    confirmation.status].some((status) => status === "BLOCKED" || status === "FAILED")) {
    return blocked("UPSTREAM_DATA_STATUS");
  }
  const candles = historical.candles1m;
  const features = psychology.timeframes["1m"].features;
  if (candles.length !== features.length) return blocked("INPUT_ALIGNMENT");
  let d = 0;
  let c = 0;
  try {
    for (let i = 0; i < candles.length; i++) {
      const now = candles[i].timestamp;
      const newD: DisplacementEvent[] = [];
      const newC: StructuralConfirmationEvent[] = [];
      while (d < displacement.confirmed.length &&
          displacement.confirmed[d].availableAt <= now) newD.push(displacement.confirmed[d++]);
      while (c < confirmation.confirmations.length &&
          confirmation.confirmations[c].availableAt <= now) {
        newC.push(confirmation.confirmations[c++]);
      }
      engine.push({ candle: candles[i], psychology: features[i],
        displacementEvents: newD, structuralConfirmations: newC });
    }
    if (d !== displacement.confirmed.length || c !== confirmation.confirmations.length) {
      return blocked("EVENT_STREAM_INCOMPLETE");
    }
    engine.timings.totalMs = performance.now() - started;
    return { status: historical.status === "WARN" || psychology.status === "WARN" ||
      displacement.status === "WARN" || confirmation.status === "WARN" ? "WARN" : "READY",
      symbol: "XAUUSD", config: engine.config, zones: engine.zones,
      events: engine.events, diagnostics: engine.diagnostics, timings: engine.timings };
  } catch (error) {
    if (error instanceof FvgInputError) return blocked(error.code,
      engine.diagnostics.processedCandles);
    throw error;
  }
}
