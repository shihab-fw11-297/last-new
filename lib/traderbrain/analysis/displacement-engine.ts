import type { Candle, DataStatus, HistoricalResult } from "../data/types.ts";
import type { CandlePsychologyFeature, CandlePsychologyResult } from "./candle-psychology.ts";
import { analyzeHistoricalControl, type ControlSnapshot, type ControlTransferEvent } from
  "./control-engine.ts";
import type { LiquidityInteractionResult } from "./liquidity-interaction.ts";
import type { MultiTimeframeStructureResult } from "./market-structure.ts";

export type DisplacementDirection = "BULLISH" | "BEARISH";
export type DisplacementContext = "TRANSFER" | "CONTINUATION";
export type DisplacementClass = "VALID" | "STRONG" | "EXTREME";
export type DisplacementReason =
  "CONTROL_ALIGNED" | "OPPOSITE_CONTROL_IGNITION" | "EXPANSION_PRESENT" |
  "STRONG_RANGE_ATR" | "STRONG_BODY_ATR" | "CLOSE_NEAR_HIGH" | "CLOSE_NEAR_LOW" |
  "LOW_OVERLAP" | "MOMENTUM_INCREASING" | "FOLLOW_THROUGH" |
  "DIRECTIONAL_TRAVEL_CONFIRMED" | "CONTROL_INVALIDATED" |
  "EXCESSIVE_RETRACE" | "FOLLOW_THROUGH_FAILED" | "TRAVEL_TOO_SMALL" |
  "TIMEOUT" | "IGNITION_RANGE_TOO_SMALL" | "BODY_TOO_WEAK" |
  "POOR_CLOSE" | "OVERLAP_TOO_HIGH" | "CONTROL_UNCLEAR";

export type DisplacementConfig = {
  minIgnitionRangeAtr: number;
  minIgnitionBodyAtr: number;
  minBodyToRangeRatio: number;
  minDirectionalClosePosition: number;
  maxOverlapRatio: number;
  minDirectionalEfficiency: number;
  minTravelAtrForValid: number;
  minTravelAtrForStrong: number;
  minTravelAtrForExtreme: number;
  minFollowThroughBars: number;
  maxAdverseRetracementAtr: number;
  maxCandidateBars: number;
};

// All price distances are normalized to the ATR captured on the ignition candle.
export const DEFAULT_DISPLACEMENT_CONFIG: Readonly<DisplacementConfig> = Object.freeze({
  minIgnitionRangeAtr: 1.1,
  minIgnitionBodyAtr: 0.65,
  minBodyToRangeRatio: 0.5,
  minDirectionalClosePosition: 0.75,
  maxOverlapRatio: 0.6,
  minDirectionalEfficiency: 0.35,
  minTravelAtrForValid: 1.3,
  minTravelAtrForStrong: 2,
  minTravelAtrForExtreme: 3,
  minFollowThroughBars: 2,
  maxAdverseRetracementAtr: 0.9,
  maxCandidateBars: 6,
});

type Lineage = {
  controlTransferId: string | null;
  interactionId: string | null;
  liquidityId: string | null;
};
export type IgnitionEvent = Lineage & {
  id: string;
  timestamp: number;
  createdAt: number;
  availableAt: number;
  direction: DisplacementDirection;
  context: DisplacementContext;
  controlState: ControlSnapshot["state"];
  reasons: DisplacementReason[];
};
export type DisplacementEvent = Lineage & {
  id: string;
  direction: DisplacementDirection;
  context: DisplacementContext;
  createdAt: number;
  availableAt: number;
  ignitionAt: number;
  confirmedAt: number;
  classification: DisplacementClass;
  referenceAtr: number;
  totalTravel: number;
  totalTravelAtr: number;
  maxAdverseRetracement: number;
  maxAdverseRetracementAtr: number;
  barsToConfirm: number;
  controlState: ControlSnapshot["state"];
  reasons: DisplacementReason[];
};
export type FailedDisplacementEvent = Lineage & {
  id: string;
  direction: DisplacementDirection;
  context: DisplacementContext;
  createdAt: number;
  availableAt: number;
  ignitionAt: number;
  failedAt: number;
  referenceAtr: number;
  totalTravelAtr: number;
  maxAdverseRetracementAtr: number;
  bars: number;
  reasons: DisplacementReason[];
};
export type ActiveDisplacement = Lineage & {
  ignitionId: string;
  direction: DisplacementDirection;
  context: DisplacementContext;
  status: "CANDIDATE" | "CONFIRMED";
  startedAt: number;
  bars: number;
  followThroughBars: number;
  referenceAtr: number;
  totalTravel: number;
  totalTravelAtr: number;
  maxAdverseRetracement: number;
  maxAdverseRetracementAtr: number;
  bestExtreme: number;
};
export type DisplacementDiagnostics = {
  processedCandles: number;
  controlTransfersConsumed: number;
  ignitions: number;
  candidates: number;
  valid: number;
  strong: number;
  extreme: number;
  failed: number;
  transferContext: number;
  continuationContext: number;
  totalBarsToConfirm: number;
  failureReasons: Record<string, number>;
  ignitionRejections: Record<string, number>;
  errorCode?: string;
  errorIndex?: number;
};
export type DisplacementTimings = {
  eventConsumptionMs: number;
  ignitionEvaluationMs: number;
  candidateUpdateMs: number;
  totalMs: number;
  sampledEvery: number;
};
export type DisplacementResult = {
  status: DataStatus;
  symbol: "XAUUSD";
  config: Readonly<DisplacementConfig>;
  ignitions: IgnitionEvent[];
  confirmed: DisplacementEvent[];
  failed: FailedDisplacementEvent[];
  active: ActiveDisplacement | null;
  diagnostics: DisplacementDiagnostics;
  timings: DisplacementTimings;
};

type Candidate = ActiveDisplacement & {
  startPrice: number;
  lastClose: number;
  stalledBars: number;
};
export class DisplacementInputError extends Error {
  constructor(readonly code: "INPUT_ALIGNMENT" | "INPUT_ORDER" | "INVALID_PSYCHOLOGY" |
    "CONTROL_TRANSFER_ORDER" | "CONTROL_TRANSFER_ALIGNMENT" | "TRANSFER_STREAM_SHRANK") {
    super(code);
  }
}
function resolveConfig(overrides: Partial<DisplacementConfig>): Readonly<DisplacementConfig> {
  const c = { ...DEFAULT_DISPLACEMENT_CONFIG, ...overrides };
  if (![c.minIgnitionRangeAtr, c.minIgnitionBodyAtr, c.minBodyToRangeRatio,
    c.minDirectionalClosePosition, c.maxOverlapRatio, c.minDirectionalEfficiency,
    c.minTravelAtrForValid, c.minTravelAtrForStrong, c.minTravelAtrForExtreme,
    c.maxAdverseRetracementAtr].every(Number.isFinite) ||
      c.minIgnitionRangeAtr <= 0 || c.minIgnitionBodyAtr <= 0 ||
      c.minBodyToRangeRatio <= 0 || c.minBodyToRangeRatio > 1 ||
      c.minDirectionalClosePosition <= 0.5 || c.minDirectionalClosePosition > 1 ||
      c.maxOverlapRatio < 0 || c.maxOverlapRatio > 1 ||
      c.minDirectionalEfficiency < 0 || c.minDirectionalEfficiency > 1 ||
      c.minTravelAtrForValid <= 0 ||
      c.minTravelAtrForStrong <= c.minTravelAtrForValid ||
      c.minTravelAtrForExtreme <= c.minTravelAtrForStrong ||
      c.maxAdverseRetracementAtr <= 0 ||
      !Number.isSafeInteger(c.minFollowThroughBars) || c.minFollowThroughBars < 1 ||
      !Number.isSafeInteger(c.maxCandidateBars) ||
      c.maxCandidateBars < c.minFollowThroughBars || c.maxCandidateBars > 60) {
    throw new RangeError("Invalid displacement configuration");
  }
  return Object.freeze(c);
}
function emptyDiagnostics(): DisplacementDiagnostics {
  return { processedCandles: 0, controlTransfersConsumed: 0, ignitions: 0,
    candidates: 0, valid: 0, strong: 0, extreme: 0, failed: 0,
    transferContext: 0, continuationContext: 0, totalBarsToConfirm: 0,
    failureReasons: {}, ignitionRejections: {} };
}
function directionOf(feature: CandlePsychologyFeature): DisplacementDirection | null {
  return feature.direction === "BULLISH" || feature.direction === "BEARISH" ?
    feature.direction : null;
}
function transferDirection(event: ControlTransferEvent): DisplacementDirection {
  return event.direction === "SELLER_TO_BUYER" ? "BULLISH" : "BEARISH";
}
function aligned(direction: DisplacementDirection, control: ControlSnapshot): boolean {
  return direction === "BULLISH" ? control.state === "BUYER_CONTROL" :
    control.state === "SELLER_CONTROL";
}
function closeQuality(direction: DisplacementDirection, feature: CandlePsychologyFeature,
  threshold: number): boolean {
  return feature.closePosition !== null && (direction === "BULLISH" ?
    feature.closePosition >= threshold : feature.closePosition <= 1 - threshold);
}
function firstIgnitionFailure(direction: DisplacementDirection | null,
  feature: CandlePsychologyFeature, control: ControlSnapshot,
  config: Readonly<DisplacementConfig>): DisplacementReason | null {
  if (!direction || !feature.atrReady || feature.atr === null || feature.atr <= 0 ||
      feature.rangeToATR === null || feature.bodyToATR === null ||
      feature.bodyToRangeRatio === null || feature.closePosition === null ||
      feature.overlapRatio === null || feature.directionalEfficiency === null) {
    return "IGNITION_RANGE_TOO_SMALL";
  }
  if (control.state === "UNCLEAR" || control.state === "BALANCED" ||
      (control.state === "TRANSITION" &&
        control.transitionDirection !== (direction === "BULLISH" ?
          "BUYER_CONTROL" : "SELLER_CONTROL"))) return "CONTROL_UNCLEAR";
  if (!feature.evidence.expansion && feature.rangeToATR < config.minIgnitionRangeAtr) {
    return "IGNITION_RANGE_TOO_SMALL";
  }
  if (feature.bodyToATR < config.minIgnitionBodyAtr ||
      feature.bodyToRangeRatio < config.minBodyToRangeRatio) return "BODY_TOO_WEAK";
  if (!closeQuality(direction, feature, config.minDirectionalClosePosition)) return "POOR_CLOSE";
  if (feature.overlapRatio > config.maxOverlapRatio) return "OVERLAP_TOO_HIGH";
  if (feature.directionalEfficiency < config.minDirectionalEfficiency) {
    return "FOLLOW_THROUGH_FAILED";
  }
  return null;
}
function lineage(candidate: Candidate): Lineage {
  return { controlTransferId: candidate.controlTransferId,
    interactionId: candidate.interactionId, liquidityId: candidate.liquidityId };
}
function activeSnapshot(candidate: Candidate): ActiveDisplacement {
  return { ...lineage(candidate), ignitionId: candidate.ignitionId,
    direction: candidate.direction, context: candidate.context,
    status: candidate.status, startedAt: candidate.startedAt,
    bars: candidate.bars, followThroughBars: candidate.followThroughBars,
    referenceAtr: candidate.referenceAtr, totalTravel: candidate.totalTravel,
    totalTravelAtr: candidate.totalTravelAtr,
    maxAdverseRetracement: candidate.maxAdverseRetracement,
    maxAdverseRetracementAtr: candidate.maxAdverseRetracementAtr,
    bestExtreme: candidate.bestExtreme };
}

export class DisplacementEngine {
  readonly config: Readonly<DisplacementConfig>;
  readonly ignitions: IgnitionEvent[] = [];
  readonly confirmed: DisplacementEvent[] = [];
  readonly failed: FailedDisplacementEvent[] = [];
  private readonly counts = emptyDiagnostics();
  private readonly stage = { eventConsumptionMs: 0, ignitionEvaluationMs: 0, candidateUpdateMs: 0 };
  private candidate: Candidate | null = null;
  private previousTimestamp: number | null = null;
  private transferCursor = 0;
  private lastTransferAt = -Infinity;
  private lastTransfer: ControlTransferEvent | null = null;
  private lastTransferIndex = -Infinity;

  constructor(overrides: Partial<DisplacementConfig> = {}) {
    this.config = resolveConfig(overrides);
  }
  get active(): ActiveDisplacement | null {
    return this.candidate ? activeSnapshot(this.candidate) : null;
  }
  get diagnostics(): DisplacementDiagnostics {
    return { ...this.counts, failureReasons: { ...this.counts.failureReasons },
      ignitionRejections: { ...this.counts.ignitionRejections } };
  }
  get timings(): DisplacementTimings {
    const eventConsumptionMs = this.stage.eventConsumptionMs * 32;
    const ignitionEvaluationMs = this.stage.ignitionEvaluationMs * 32;
    const candidateUpdateMs = this.stage.candidateUpdateMs * 32;
    return { eventConsumptionMs, ignitionEvaluationMs, candidateUpdateMs,
      totalMs: eventConsumptionMs + ignitionEvaluationMs + candidateUpdateMs,
      sampledEvery: 32 };
  }
  push(input: { candle: Candle; psychology: CandlePsychologyFeature;
    control: ControlSnapshot; controlTransferEvents: readonly ControlTransferEvent[] }): ActiveDisplacement | null {
    const { candle, psychology, control, controlTransferEvents } = input;
    if (!candle || candle.symbol !== "XAUUSD" || candle.timeframe !== "1m" ||
        !Number.isSafeInteger(candle.timestamp) || !psychology ||
        psychology.timestamp !== candle.timestamp || psychology.timeframe !== "1m" ||
        !psychology.sourceComplete || !control || control.timestamp !== candle.timestamp) {
      throw new DisplacementInputError("INPUT_ALIGNMENT");
    }
    if (this.previousTimestamp !== null && candle.timestamp <= this.previousTimestamp) {
      throw new DisplacementInputError("INPUT_ORDER");
    }
    if (!psychology.evidence ||
        [psychology.atr, psychology.rangeToATR, psychology.bodyToATR,
          psychology.bodyToRangeRatio, psychology.closePosition,
          psychology.overlapRatio, psychology.directionalEfficiency]
          .some((value) => value !== null && !Number.isFinite(value)) ||
        (psychology.atrReady && (psychology.atr === null || psychology.atr < 0))) {
      throw new DisplacementInputError("INVALID_PSYCHOLOGY");
    }
    if (controlTransferEvents.length < this.transferCursor) {
      throw new DisplacementInputError("TRANSFER_STREAM_SHRANK");
    }
    const sample = (this.counts.processedCandles & 31) === 0;
    let clock = sample ? performance.now() : 0;
    let newestTransfer: ControlTransferEvent | null = null;
    while (this.transferCursor < controlTransferEvents.length &&
        controlTransferEvents[this.transferCursor].availableAt <= candle.timestamp) {
      const event = controlTransferEvents[this.transferCursor++];
      if (event.availableAt < this.lastTransferAt ||
          event.availableAt < event.createdAt) {
        throw new DisplacementInputError("CONTROL_TRANSFER_ORDER");
      }
      this.lastTransferAt = event.availableAt;
      this.lastTransfer = event;
      this.lastTransferIndex = this.counts.processedCandles;
      newestTransfer = event;
      this.counts.controlTransfersConsumed++;
    }
    if (control.lastTransferId !== (this.lastTransfer?.id ?? null)) {
      throw new DisplacementInputError("CONTROL_TRANSFER_ALIGNMENT");
    }
    if (sample) {
      const now = performance.now(); this.stage.eventConsumptionMs += now - clock; clock = now;
    }
    if (this.candidate) {
      if (newestTransfer && transferDirection(newestTransfer) === this.candidate.direction) {
        this.candidate.context = "TRANSFER";
        this.candidate.controlTransferId = newestTransfer.id;
        this.candidate.interactionId = newestTransfer.interactionId;
        this.candidate.liquidityId = newestTransfer.liquidityId;
      }
      if (newestTransfer && transferDirection(newestTransfer) !== this.candidate.direction &&
          this.candidate.status === "CANDIDATE") {
        this.fail(candle.timestamp, "CONTROL_INVALIDATED");
      } else {
        this.updateCandidate(candle, psychology, control);
      }
      if (sample) this.stage.candidateUpdateMs += performance.now() - clock;
    } else {
      const direction = directionOf(psychology);
      const rejection = firstIgnitionFailure(direction, psychology, control, this.config);
      if (rejection) {
        this.counts.ignitionRejections[rejection] =
          (this.counts.ignitionRejections[rejection] ?? 0) + 1;
      } else if (direction) {
        this.ignite(candle, psychology, control, direction);
      }
      if (sample) this.stage.ignitionEvaluationMs += performance.now() - clock;
    }
    this.previousTimestamp = candle.timestamp;
    this.counts.processedCandles++;
    return this.active;
  }

  private ignite(candle: Candle, feature: CandlePsychologyFeature,
    control: ControlSnapshot, direction: DisplacementDirection): void {
    const transfer = this.lastTransfer &&
      transferDirection(this.lastTransfer) === direction &&
      this.counts.processedCandles - this.lastTransferIndex <= this.config.maxCandidateBars ?
      this.lastTransfer : null;
    const context: DisplacementContext = transfer ? "TRANSFER" : "CONTINUATION";
    const ignitionId = `XAUUSD:1m:IGNITION:${direction}:${candle.timestamp}`;
    const startPrice = candle.open;
    const bestExtreme = direction === "BULLISH" ? candle.high : candle.low;
    const totalTravel = Math.max(0, direction === "BULLISH" ?
      bestExtreme - startPrice : startPrice - bestExtreme);
    // Closing retracement avoids assuming an unknown intrabar high/low order.
    const adverse = Math.max(0, direction === "BULLISH" ?
      bestExtreme - candle.close : candle.close - bestExtreme);
    const referenceAtr = feature.atr!;
    const reasons: DisplacementReason[] = [aligned(direction, control) ?
      "CONTROL_ALIGNED" : "OPPOSITE_CONTROL_IGNITION"];
    reasons.push(feature.evidence.expansion ? "EXPANSION_PRESENT" : "STRONG_RANGE_ATR");
    reasons.push("STRONG_BODY_ATR", direction === "BULLISH" ?
      "CLOSE_NEAR_HIGH" : "CLOSE_NEAR_LOW", "LOW_OVERLAP");
    if (feature.evidence.momentumIncreasing) reasons.push("MOMENTUM_INCREASING");
    this.candidate = { ignitionId, direction, context, status: "CANDIDATE",
      startedAt: candle.timestamp, bars: 0, followThroughBars: 0,
      referenceAtr, startPrice, bestExtreme, lastClose: candle.close,
      totalTravel, totalTravelAtr: totalTravel / referenceAtr,
      maxAdverseRetracement: adverse, maxAdverseRetracementAtr: adverse / referenceAtr,
      stalledBars: 0, controlTransferId: transfer?.id ?? null,
      interactionId: transfer?.interactionId ?? null,
      liquidityId: transfer?.liquidityId ?? null };
    this.ignitions.push({ id: ignitionId, timestamp: candle.timestamp,
      createdAt: candle.timestamp, availableAt: candle.timestamp,
      direction, context, controlState: control.state, ...lineage(this.candidate),
      reasons });
    this.counts.ignitions++;
    this.counts.candidates++;
  }

  private updateCandidate(candle: Candle, feature: CandlePsychologyFeature,
    control: ControlSnapshot): void {
    const candidate = this.candidate!;
    candidate.bars++;
    const priorExtreme = candidate.bestExtreme;
    candidate.bestExtreme = candidate.direction === "BULLISH" ?
      Math.max(candidate.bestExtreme, candle.high) :
      Math.min(candidate.bestExtreme, candle.low);
    candidate.totalTravel = Math.max(0, candidate.direction === "BULLISH" ?
      candidate.bestExtreme - candidate.startPrice : candidate.startPrice - candidate.bestExtreme);
    candidate.totalTravelAtr = candidate.totalTravel / candidate.referenceAtr;
    const adverse = Math.max(0, candidate.direction === "BULLISH" ?
      candidate.bestExtreme - candle.close : candle.close - candidate.bestExtreme);
    candidate.maxAdverseRetracement = Math.max(candidate.maxAdverseRetracement, adverse);
    candidate.maxAdverseRetracementAtr =
      candidate.maxAdverseRetracement / candidate.referenceAtr;
    const progressed = candidate.direction === "BULLISH" ?
      candle.close > candidate.lastClose && candidate.bestExtreme > priorExtreme :
      candle.close < candidate.lastClose && candidate.bestExtreme < priorExtreme;
    const goodBar = feature.direction === candidate.direction && progressed &&
      closeQuality(candidate.direction, feature, this.config.minDirectionalClosePosition) &&
      feature.bodyToRangeRatio !== null &&
      feature.bodyToRangeRatio >= this.config.minBodyToRangeRatio &&
      feature.overlapRatio !== null &&
      feature.overlapRatio <= this.config.maxOverlapRatio &&
      feature.directionalEfficiency !== null &&
      feature.directionalEfficiency >= this.config.minDirectionalEfficiency;
    candidate.followThroughBars = goodBar ? candidate.followThroughBars + 1 : 0;
    candidate.stalledBars = goodBar ? 0 : candidate.stalledBars + 1;
    candidate.lastClose = candle.close;
    if (candidate.status === "CONFIRMED") {
      if (!aligned(candidate.direction, control) ||
          candidate.maxAdverseRetracementAtr > this.config.maxAdverseRetracementAtr ||
          candidate.stalledBars >= 2 || candidate.bars >= this.config.maxCandidateBars) {
        this.candidate = null;
      }
      return;
    }
    if (control.state === (candidate.direction === "BULLISH" ?
        "SELLER_CONTROL" : "BUYER_CONTROL")) {
      this.fail(candle.timestamp, "CONTROL_INVALIDATED");
    } else if (candidate.maxAdverseRetracementAtr >
        this.config.maxAdverseRetracementAtr) {
      this.fail(candle.timestamp, "EXCESSIVE_RETRACE");
    } else if (aligned(candidate.direction, control) &&
        candidate.followThroughBars >= this.config.minFollowThroughBars &&
        candidate.totalTravelAtr >= this.config.minTravelAtrForValid) {
      this.confirm(candle.timestamp, control.state);
    } else if (candidate.bars >= this.config.maxCandidateBars) {
      this.fail(candle.timestamp, candidate.totalTravelAtr <
        this.config.minTravelAtrForValid ? "TRAVEL_TOO_SMALL" : "FOLLOW_THROUGH_FAILED");
    }
  }
  private confirm(timestamp: number, controlState: ControlSnapshot["state"]): void {
    const candidate = this.candidate!;
    const classification: DisplacementClass =
      candidate.totalTravelAtr >= this.config.minTravelAtrForExtreme ? "EXTREME" :
      candidate.totalTravelAtr >= this.config.minTravelAtrForStrong ? "STRONG" : "VALID";
    const reasons: DisplacementReason[] = ["CONTROL_ALIGNED", "FOLLOW_THROUGH",
      "DIRECTIONAL_TRAVEL_CONFIRMED"];
    this.confirmed.push({ id: `XAUUSD:1m:DISPLACEMENT:${candidate.direction}:${candidate.startedAt}:${timestamp}`,
      direction: candidate.direction, context: candidate.context,
      createdAt: candidate.startedAt, availableAt: timestamp,
      ignitionAt: candidate.startedAt, confirmedAt: timestamp,
      classification, referenceAtr: candidate.referenceAtr,
      totalTravel: candidate.totalTravel, totalTravelAtr: candidate.totalTravelAtr,
      maxAdverseRetracement: candidate.maxAdverseRetracement,
      maxAdverseRetracementAtr: candidate.maxAdverseRetracementAtr,
      barsToConfirm: candidate.bars, controlState, ...lineage(candidate), reasons });
    this.counts[classification.toLowerCase() as "valid" | "strong" | "extreme"]++;
    this.counts[candidate.context === "TRANSFER" ? "transferContext" : "continuationContext"]++;
    this.counts.totalBarsToConfirm += candidate.bars;
    candidate.status = "CONFIRMED";
  }
  private fail(timestamp: number, reason: DisplacementReason): void {
    const candidate = this.candidate;
    if (!candidate || candidate.status === "CONFIRMED") return;
    this.failed.push({ id: `XAUUSD:1m:FAILED_DISPLACEMENT:${candidate.direction}:${candidate.startedAt}:${timestamp}`,
      direction: candidate.direction, context: candidate.context,
      createdAt: candidate.startedAt, availableAt: timestamp,
      ignitionAt: candidate.startedAt, failedAt: timestamp,
      referenceAtr: candidate.referenceAtr,
      totalTravelAtr: candidate.totalTravelAtr,
      maxAdverseRetracementAtr: candidate.maxAdverseRetracementAtr,
      bars: candidate.bars, ...lineage(candidate), reasons: [reason] });
    this.counts.failed++;
    this.counts.failureReasons[reason] = (this.counts.failureReasons[reason] ?? 0) + 1;
    this.candidate = null;
  }
}

export function createDisplacementEngine(
  config: Partial<DisplacementConfig> = {}): DisplacementEngine {
  return new DisplacementEngine(config);
}

export function analyzeHistoricalDisplacement(historical: HistoricalResult,
  psychology: CandlePsychologyResult, structure: MultiTimeframeStructureResult,
  interaction: LiquidityInteractionResult,
  overrides: Partial<DisplacementConfig> = {},
  onCandle?: (timestamp: number, control: ControlSnapshot,
    transfers: readonly ControlTransferEvent[],
    confirmed: readonly DisplacementEvent[]) => void): DisplacementResult {
  const config = resolveConfig(overrides);
  const engine = createDisplacementEngine(config);
  const empty = (status: DataStatus, errorCode: string, errorIndex?: number): DisplacementResult => {
    const diagnostics = emptyDiagnostics();
    diagnostics.errorCode = errorCode;
    if (errorIndex !== undefined) diagnostics.errorIndex = errorIndex;
    return { status, symbol: "XAUUSD", config, ignitions: [], confirmed: [],
      failed: [], active: null, diagnostics, timings: engine.timings };
  };
  let index = 0;
  try {
    // Phase 7 runs once and streams its aligned per-candle snapshot into Phase 8.
    const control = analyzeHistoricalControl(historical, psychology, structure, interaction, {},
      (candle, feature, snapshot, transfers) => {
        engine.push({ candle, psychology: feature, control: snapshot,
          controlTransferEvents: transfers });
        onCandle?.(candle.timestamp, snapshot, transfers, engine.confirmed);
        index++;
      });
    if (control.status === "BLOCKED" || control.status === "FAILED") {
      return empty(control.status, control.diagnostics.errorCode ?? "UPSTREAM_DATA_STATUS",
        control.diagnostics.errorIndex);
    }
    if (engine.diagnostics.controlTransfersConsumed !== control.transfers.length) {
      return empty("BLOCKED", "CONTROL_TRANSFER_ALIGNMENT");
    }
    return { status: control.status, symbol: "XAUUSD", config,
      ignitions: engine.ignitions, confirmed: engine.confirmed,
      failed: engine.failed, active: engine.active,
      diagnostics: engine.diagnostics, timings: engine.timings };
  } catch (error) {
    if (error instanceof DisplacementInputError) {
      return empty("BLOCKED", error.code, index);
    }
    throw error;
  }
}
