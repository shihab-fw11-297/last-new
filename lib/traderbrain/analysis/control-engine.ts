import type { Candle, DataStatus, HistoricalResult } from "../data/types.ts";
import type { CandlePsychologyFeature, CandlePsychologyResult } from "./candle-psychology.ts";
import type { InteractionEvent, LiquidityInteractionResult } from "./liquidity-interaction.ts";
import type { MultiTimeframeStructureResult, StructureEvent } from "./market-structure.ts";

export type ControlState = "UNCLEAR" | "BUYER_CONTROL" | "SELLER_CONTROL" | "BALANCED" | "TRANSITION";
export type PressureDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type TransferDirection = "BUYER_TO_SELLER" | "SELLER_TO_BUYER";
export type ControlReason =
  "INSUFFICIENT_PSYCHOLOGY" | "NO_DIRECTIONAL_EVIDENCE" | "TWO_SIDED_MARKET" |
  "BULLISH_PRESSURE" | "BEARISH_PRESSURE" | "BSL_RECLAIM" | "SSL_RECLAIM" |
  "BSL_SWEEP" | "SSL_SWEEP" | "BSL_REJECTION" | "SSL_REJECTION" |
  "FAILED_BREAK_ABOVE" | "FAILED_BREAK_BELOW" |
  "ACCEPTED_BREAK_UP" | "ACCEPTED_BREAK_DOWN" |
  "BULLISH_STRUCTURE_SUPPORT" | "BEARISH_STRUCTURE_SUPPORT" |
  "FOLLOW_THROUGH_CONFIRMED" | "FOLLOW_THROUGH_FAILED" | "TRANSITION_TIMEOUT";

export type ControlConfig = {
  minPressureBarsForControl: number;
  minPressureBarsForTransfer: number;
  maxTransitionBars: number;
  minimumDirectionalEfficiency: number;
};
export const DEFAULT_CONTROL_CONFIG: Readonly<ControlConfig> = Object.freeze({
  minPressureBarsForControl: 2,
  minPressureBarsForTransfer: 2,
  maxTransitionBars: 5,
  minimumDirectionalEfficiency: 0.3,
});

export type ControlStateChange = {
  id: string;
  timestamp: number;
  createdAt: number;
  availableAt: number;
  previousState: ControlState;
  state: ControlState;
  interactionId: string | null;
  liquidityId: string | null;
  supportingStructureEventId: string | null;
  reasons: ControlReason[];
};
export type ControlTransferEvent = {
  id: string;
  direction: TransferDirection;
  createdAt: number;
  availableAt: number;
  previousControl: "BUYER_CONTROL" | "SELLER_CONTROL";
  newControl: "BUYER_CONTROL" | "SELLER_CONTROL";
  interactionId: string;
  liquidityId: string;
  supportingStructureEventId: string | null;
  reasons: ControlReason[];
};
export type ControlSnapshot = {
  timestamp: number | null;
  state: ControlState;
  pressure: PressureDirection;
  previousConfirmedState: "BUYER_CONTROL" | "SELLER_CONTROL" | null;
  transitionDirection: "BUYER_CONTROL" | "SELLER_CONTROL" | null;
  transitionBars: number;
  lastTransferId: string | null;
  reasons: ControlReason[];
};
export type ControlDiagnostics = {
  processedCandles: number;
  interactionEventsConsumed: number;
  structureEventsConsumed: number;
  stateChanges: Record<ControlState, number>;
  transfers: Record<TransferDirection, number>;
  failedTransferCandidates: number;
  failedTransferByReason: Record<"FOLLOW_THROUGH_FAILED" | "TRANSITION_TIMEOUT", number>;
  errorCode?: string;
  errorIndex?: number;
};
export type ControlTimings = {
  eventConsumptionMs: number;
  pressureEvaluationMs: number;
  controlStateMs: number;
  totalMs: number;
  sampledEvery: number;
};
export type ControlResult = {
  status: DataStatus;
  symbol: "XAUUSD";
  config: Readonly<ControlConfig>;
  current: ControlSnapshot;
  stateChanges: ControlStateChange[];
  transfers: ControlTransferEvent[];
  diagnostics: ControlDiagnostics;
  timings: ControlTimings;
};

type Confirmed = "BUYER_CONTROL" | "SELLER_CONTROL";
type Candidate = {
  direction: Confirmed;
  previous: Confirmed;
  interactionId: string;
  liquidityId: string;
  reason: ControlReason;
  rank: number;
  structureEventId: string | null;
  bars: number;
  evidenceBars: number;
};
type DirectionalFact = {
  direction: Confirmed;
  interactionId: string;
  liquidityId: string;
  reason: ControlReason;
  rank: number;
};

export class ControlInputError extends Error {
  constructor(readonly code: "INPUT_ALIGNMENT" | "INPUT_ORDER" | "INVALID_PSYCHOLOGY" |
    "INTERACTION_ORDER" | "STRUCTURE_ORDER" | "FUTURE_EVENT_MISSING") { super(code); }
}

function resolveConfig(overrides: Partial<ControlConfig>): Readonly<ControlConfig> {
  const config = { ...DEFAULT_CONTROL_CONFIG, ...overrides };
  if (!Number.isSafeInteger(config.minPressureBarsForControl) ||
      config.minPressureBarsForControl < 2 || config.minPressureBarsForControl > 20 ||
      !Number.isSafeInteger(config.minPressureBarsForTransfer) ||
      config.minPressureBarsForTransfer < 2 || config.minPressureBarsForTransfer > 20 ||
      !Number.isSafeInteger(config.maxTransitionBars) ||
      config.maxTransitionBars < config.minPressureBarsForTransfer ||
      config.maxTransitionBars > 60 || !Number.isFinite(config.minimumDirectionalEfficiency) ||
      config.minimumDirectionalEfficiency < 0 || config.minimumDirectionalEfficiency > 1) {
    throw new RangeError("Invalid control configuration");
  }
  return Object.freeze(config);
}

function emptyDiagnostics(): ControlDiagnostics {
  return { processedCandles: 0, interactionEventsConsumed: 0, structureEventsConsumed: 0,
    stateChanges: { UNCLEAR: 0, BUYER_CONTROL: 0, SELLER_CONTROL: 0, BALANCED: 0, TRANSITION: 0 },
    transfers: { BUYER_TO_SELLER: 0, SELLER_TO_BUYER: 0 }, failedTransferCandidates: 0,
    failedTransferByReason: { FOLLOW_THROUGH_FAILED: 0, TRANSITION_TIMEOUT: 0 } };
}
function opposite(state: Confirmed): Confirmed {
  return state === "BUYER_CONTROL" ? "SELLER_CONTROL" : "BUYER_CONTROL";
}
function pressureOf(feature: CandlePsychologyFeature, threshold: number): PressureDirection {
  if (!feature.atrReady || feature.atr === null || feature.atr <= 0 ||
      feature.directionalEfficiency === null ||
      feature.directionalEfficiency < threshold || feature.evidence.indecision ||
      feature.evidence.compression) return "NEUTRAL";
  const bullish = feature.evidence.strongBullishClose ||
    (feature.direction === "BULLISH" &&
      (feature.closeAbovePreviousHigh === true || feature.consecutiveBullishCount >= 2));
  const bearish = feature.evidence.strongBearishClose ||
    (feature.direction === "BEARISH" &&
      (feature.closeBelowPreviousLow === true || feature.consecutiveBearishCount >= 2));
  return bullish === bearish ? "NEUTRAL" : bullish ? "BULLISH" : "BEARISH";
}
function interactionFact(event: InteractionEvent): DirectionalFact | null {
  const bsl = event.liquiditySide === "BSL";
  let rank = 0;
  let direction: Confirmed;
  let reason: ControlReason;
  switch (event.type) {
    case "ACCEPTANCE_CONFIRMED":
      rank = 5; direction = bsl ? "BUYER_CONTROL" : "SELLER_CONTROL";
      reason = bsl ? "ACCEPTED_BREAK_UP" : "ACCEPTED_BREAK_DOWN"; break;
    case "FAILED_BREAK_CONFIRMED":
      rank = 4; direction = bsl ? "SELLER_CONTROL" : "BUYER_CONTROL";
      reason = bsl ? "FAILED_BREAK_ABOVE" : "FAILED_BREAK_BELOW"; break;
    case "REJECTION_CONFIRMED":
      rank = 3; direction = bsl ? "SELLER_CONTROL" : "BUYER_CONTROL";
      reason = bsl ? "BSL_REJECTION" : "SSL_REJECTION"; break;
    case "RECLAIM_CONFIRMED":
      rank = 2; direction = bsl ? "SELLER_CONTROL" : "BUYER_CONTROL";
      reason = bsl ? "BSL_RECLAIM" : "SSL_RECLAIM"; break;
    case "SWEEP_CONFIRMED":
    case "RAID_CONFIRMED":
      rank = 1; direction = bsl ? "SELLER_CONTROL" : "BUYER_CONTROL";
      reason = bsl ? "BSL_SWEEP" : "SSL_SWEEP"; break;
    default: return null;
  }
  return { direction, interactionId: event.interactionId,
    liquidityId: event.liquidityId, reason, rank };
}
function structureDirection(event: StructureEvent): Confirmed | null {
  switch (event.type) {
    case "RAW_BULLISH_STRUCTURE_SHIFT":
    case "BULLISH_CONTINUATION_BREAK": return "BUYER_CONTROL";
    case "RAW_BEARISH_STRUCTURE_SHIFT":
    case "BEARISH_CONTINUATION_BREAK": return "SELLER_CONTROL";
    default: return null;
  }
}

export class ControlEngine {
  readonly config: Readonly<ControlConfig>;
  readonly stateChanges: ControlStateChange[] = [];
  readonly transfers: ControlTransferEvent[] = [];
  private readonly counts = emptyDiagnostics();
  private readonly stage = { eventConsumptionMs: 0, pressureEvaluationMs: 0, controlStateMs: 0 };
  private state: ControlState = "UNCLEAR";
  private confirmed: Confirmed | null = null;
  private candidate: Candidate | null = null;
  private previousTimestamp: number | null = null;
  private interactionCursor = 0;
  private structureCursor = 0;
  private lastInteractionAt = -Infinity;
  private lastStructureAt = -Infinity;
  private bullishBars = 0;
  private bearishBars = 0;
  private neutralBars = 0;
  private alternatingBars = 0;
  private previousPressure: PressureDirection = "NEUTRAL";
  private lastTransferId: string | null = null;
  private snapshotValue: ControlSnapshot = { timestamp: null, state: "UNCLEAR",
    pressure: "NEUTRAL", previousConfirmedState: null, transitionDirection: null,
    transitionBars: 0, lastTransferId: null, reasons: ["INSUFFICIENT_PSYCHOLOGY"] };

  constructor(overrides: Partial<ControlConfig> = {}) { this.config = resolveConfig(overrides); }
  get current(): ControlSnapshot { return { ...this.snapshotValue, reasons: [...this.snapshotValue.reasons] }; }
  get diagnostics(): ControlDiagnostics {
    return { ...this.counts, stateChanges: { ...this.counts.stateChanges },
      transfers: { ...this.counts.transfers },
      failedTransferByReason: { ...this.counts.failedTransferByReason } };
  }
  get timings(): ControlTimings {
    const eventConsumptionMs = this.stage.eventConsumptionMs * 32;
    const pressureEvaluationMs = this.stage.pressureEvaluationMs * 32;
    const controlStateMs = this.stage.controlStateMs * 32;
    return { eventConsumptionMs, pressureEvaluationMs, controlStateMs,
      totalMs: eventConsumptionMs + pressureEvaluationMs + controlStateMs, sampledEvery: 32 };
  }

  push(input: { candle: Candle; psychology: CandlePsychologyFeature;
    interactionEvents: readonly InteractionEvent[];
    structureEvents?: readonly StructureEvent[] }): ControlSnapshot {
    const { candle, psychology, interactionEvents } = input;
    const structureEvents = input.structureEvents ?? [];
    if (!candle || candle.timeframe !== "1m" || candle.symbol !== "XAUUSD" ||
        !Number.isSafeInteger(candle.timestamp) || !psychology ||
        psychology.timestamp !== candle.timestamp || psychology.timeframe !== "1m" ||
        !psychology.sourceComplete) throw new ControlInputError("INPUT_ALIGNMENT");
    if (this.previousTimestamp !== null && candle.timestamp <= this.previousTimestamp) {
      throw new ControlInputError("INPUT_ORDER");
    }
    if (!psychology.evidence || typeof psychology.evidence.strongBullishClose !== "boolean" ||
        typeof psychology.evidence.strongBearishClose !== "boolean" ||
        (psychology.atrReady && (psychology.atr === null ||
          !Number.isFinite(psychology.atr) || psychology.atr < 0))) {
      throw new ControlInputError("INVALID_PSYCHOLOGY");
    }
    if (interactionEvents.length < this.interactionCursor ||
        structureEvents.length < this.structureCursor) {
      throw new ControlInputError("FUTURE_EVENT_MISSING");
    }
    const sample = (this.counts.processedCandles & 31) === 0;
    let clock = sample ? performance.now() : 0;
    let best: DirectionalFact | null = null;
    let bestAt = -Infinity;
    let bestId = "";
    let conflicting: DirectionalFact | null = null;
    let conflictingId = "";
    while (this.interactionCursor < interactionEvents.length &&
        interactionEvents[this.interactionCursor].availableAt <= candle.timestamp) {
      const event = interactionEvents[this.interactionCursor++];
      if (event.availableAt < this.lastInteractionAt) throw new ControlInputError("INTERACTION_ORDER");
      this.lastInteractionAt = event.availableAt;
      this.counts.interactionEventsConsumed++;
      const fact = interactionFact(event);
      if (fact && (!best || fact.rank > best.rank ||
          (fact.rank === best.rank && event.availableAt > bestAt))) {
        best = fact; bestAt = event.availableAt; bestId = event.id;
        conflicting = null; conflictingId = "";
      } else if (fact && best && fact.rank === best.rank && event.availableAt === bestAt) {
        // Same-time opposing facts use current pressure, then stable ID order.
        if (fact.direction !== best.direction) {
          if (event.id > conflictingId) { conflicting = fact; conflictingId = event.id; }
        } else if (event.id > bestId) {
          best = fact; bestId = event.id;
        }
      }
    }
    let structureBuyer: string | null = null;
    let structureSeller: string | null = null;
    while (this.structureCursor < structureEvents.length &&
        structureEvents[this.structureCursor].availableAt <= candle.timestamp) {
      const event = structureEvents[this.structureCursor++];
      if (event.availableAt < this.lastStructureAt) throw new ControlInputError("STRUCTURE_ORDER");
      this.lastStructureAt = event.availableAt;
      this.counts.structureEventsConsumed++;
      const direction = structureDirection(event);
      if (direction === "BUYER_CONTROL") structureBuyer = event.id;
      if (direction === "SELLER_CONTROL") structureSeller = event.id;
    }
    if (sample) { const now = performance.now(); this.stage.eventConsumptionMs += now - clock; clock = now; }
    const pressure = pressureOf(psychology, this.config.minimumDirectionalEfficiency);
    if (best && conflicting) {
      const pressureControl = pressure === "BULLISH" ? "BUYER_CONTROL" :
        pressure === "BEARISH" ? "SELLER_CONTROL" : null;
      if (pressureControl === conflicting.direction ||
          (pressureControl === null && conflictingId > bestId)) best = conflicting;
    }
    this.bullishBars = pressure === "BULLISH" ? this.bullishBars + 1 : 0;
    this.bearishBars = pressure === "BEARISH" ? this.bearishBars + 1 : 0;
    this.neutralBars = pressure === "NEUTRAL" ? this.neutralBars + 1 : 0;
    this.alternatingBars = pressure !== "NEUTRAL" && this.previousPressure !== "NEUTRAL" &&
      pressure !== this.previousPressure ? this.alternatingBars + 1 : 0;
    this.previousPressure = pressure;
    if (sample) { const now = performance.now(); this.stage.pressureEvaluationMs += now - clock; clock = now; }
    const timestamp = candle.timestamp;
    let reasons: ControlReason[] = [];
    const ready = psychology.atrReady && psychology.atr !== null && psychology.atr > 0;
    if (!ready) {
      if (this.candidate) this.failCandidate(timestamp, "FOLLOW_THROUGH_FAILED");
      this.change("UNCLEAR", timestamp, ["INSUFFICIENT_PSYCHOLOGY"]);
      reasons = ["INSUFFICIENT_PSYCHOLOGY"];
    } else {
      if (this.candidate && best && best.direction === this.candidate.previous &&
          best.rank >= this.candidate.rank) {
        this.failCandidate(timestamp, "FOLLOW_THROUGH_FAILED");
      }
      if (this.candidate && best && best.direction === this.candidate.direction &&
          best.rank >= this.candidate.rank) {
        this.candidate.rank = best.rank;
        this.candidate.interactionId = best.interactionId;
        this.candidate.liquidityId = best.liquidityId;
        this.candidate.reason = best.reason;
      }
      let startedCandidate = false;
      if (!this.candidate && this.confirmed && this.state === this.confirmed && best &&
          best.direction === opposite(this.confirmed) && best.rank < 5) {
        const initialStructureId = best.direction === "BUYER_CONTROL" ?
          structureBuyer : structureSeller;
        this.candidate = { direction: best.direction, previous: this.confirmed,
          interactionId: best.interactionId, liquidityId: best.liquidityId,
          reason: best.reason, rank: best.rank, structureEventId: initialStructureId,
          bars: 0, evidenceBars: 0 };
        startedCandidate = true;
        const transitionReasons: ControlReason[] = [best.reason];
        if (initialStructureId) transitionReasons.push(best.direction === "BUYER_CONTROL" ?
          "BULLISH_STRUCTURE_SUPPORT" : "BEARISH_STRUCTURE_SUPPORT");
        this.change("TRANSITION", timestamp, transitionReasons, this.candidate);
      }
      if (this.candidate) {
        const candidate = this.candidate;
        // Evidence on the initiating candle cannot confirm a transfer.
        if (!startedCandidate) {
          candidate.bars++;
          candidate.evidenceBars = pressure === (candidate.direction === "BUYER_CONTROL" ?
            "BULLISH" : "BEARISH") ? candidate.evidenceBars + 1 : 0;
        }
        const structureId = candidate.direction === "BUYER_CONTROL" ?
          structureBuyer : structureSeller;
        if (structureId) candidate.structureEventId = structureId;
        if (candidate.evidenceBars >= this.config.minPressureBarsForTransfer) {
          reasons = [candidate.reason, candidate.direction === "BUYER_CONTROL" ?
            "BULLISH_PRESSURE" : "BEARISH_PRESSURE"];
          if (candidate.structureEventId) reasons.push(candidate.direction === "BUYER_CONTROL" ?
            "BULLISH_STRUCTURE_SUPPORT" : "BEARISH_STRUCTURE_SUPPORT");
          reasons.push("FOLLOW_THROUGH_CONFIRMED");
          const direction: TransferDirection = candidate.direction === "SELLER_CONTROL" ?
            "BUYER_TO_SELLER" : "SELLER_TO_BUYER";
          const id = `XAUUSD:CONTROL_TRANSFER:${direction}:${candidate.interactionId}:${timestamp}`;
          this.transfers.push({ id, direction, createdAt: timestamp, availableAt: timestamp,
            previousControl: candidate.previous, newControl: candidate.direction,
            interactionId: candidate.interactionId, liquidityId: candidate.liquidityId,
            supportingStructureEventId: candidate.structureEventId, reasons: [...reasons] });
          this.counts.transfers[direction]++;
          this.lastTransferId = id;
          this.confirmed = candidate.direction;
          this.candidate = null;
          this.change(this.confirmed, timestamp, reasons, candidate);
        } else if (!startedCandidate && pressure === (candidate.previous === "BUYER_CONTROL" ?
            "BULLISH" : "BEARISH") &&
            (candidate.previous === "BUYER_CONTROL" ? this.bullishBars : this.bearishBars) >=
              this.config.minPressureBarsForControl) {
          this.failCandidate(timestamp, "FOLLOW_THROUGH_FAILED");
        } else if (candidate.bars >= this.config.maxTransitionBars) {
          this.failCandidate(timestamp, "TRANSITION_TIMEOUT");
        } else {
          reasons = [candidate.reason];
          if (candidate.structureEventId) reasons.push(candidate.direction === "BUYER_CONTROL" ?
            "BULLISH_STRUCTURE_SUPPORT" : "BEARISH_STRUCTURE_SUPPORT");
        }
      } else if (this.state !== "TRANSITION") {
        const buyerReady = this.bullishBars >= this.config.minPressureBarsForControl;
        const sellerReady = this.bearishBars >= this.config.minPressureBarsForControl;
        const noisy = this.neutralBars >= this.config.minPressureBarsForControl + 1 ||
          this.alternatingBars >= this.config.minPressureBarsForControl;
        if (buyerReady && this.state !== "SELLER_CONTROL") {
          reasons = ["BULLISH_PRESSURE"];
          if (structureBuyer) reasons.push("BULLISH_STRUCTURE_SUPPORT");
          if (best?.direction === "BUYER_CONTROL") reasons.push(best.reason);
          this.confirmed = "BUYER_CONTROL";
          this.change("BUYER_CONTROL", timestamp, reasons);
        } else if (sellerReady && this.state !== "BUYER_CONTROL") {
          reasons = ["BEARISH_PRESSURE"];
          if (structureSeller) reasons.push("BEARISH_STRUCTURE_SUPPORT");
          if (best?.direction === "SELLER_CONTROL") reasons.push(best.reason);
          this.confirmed = "SELLER_CONTROL";
          this.change("SELLER_CONTROL", timestamp, reasons);
        } else if (noisy || (this.state === "BUYER_CONTROL" && sellerReady) ||
            (this.state === "SELLER_CONTROL" && buyerReady)) {
          reasons = ["TWO_SIDED_MARKET"];
          this.change("BALANCED", timestamp, reasons);
        } else {
          reasons = this.state === "UNCLEAR" ? ["NO_DIRECTIONAL_EVIDENCE"] :
            this.snapshotValue.reasons;
        }
      }
    }
    this.previousTimestamp = timestamp;
    this.counts.processedCandles++;
    this.snapshotValue = { timestamp, state: this.state, pressure,
      previousConfirmedState: this.confirmed,
      transitionDirection: this.candidate?.direction ?? null,
      transitionBars: this.candidate?.bars ?? 0,
      lastTransferId: this.lastTransferId, reasons: [...reasons] };
    if (sample) this.stage.controlStateMs += performance.now() - clock;
    return this.current;
  }

  private change(state: ControlState, timestamp: number, reasons: ControlReason[],
    candidate: Candidate | null = null): void {
    if (state === this.state) return;
    this.stateChanges.push({ id: `XAUUSD:CONTROL_STATE:${state}:${timestamp}`,
      timestamp, createdAt: timestamp, availableAt: timestamp, previousState: this.state,
      state, interactionId: candidate?.interactionId ?? null,
      liquidityId: candidate?.liquidityId ?? null,
      supportingStructureEventId: candidate?.structureEventId ?? null,
      reasons: [...reasons] });
    this.counts.stateChanges[state]++;
    this.state = state;
  }
  private failCandidate(timestamp: number, reason: ControlReason): void {
    const candidate = this.candidate;
    if (!candidate) return;
    this.counts.failedTransferCandidates++;
    if (reason === "FOLLOW_THROUGH_FAILED" || reason === "TRANSITION_TIMEOUT") {
      this.counts.failedTransferByReason[reason]++;
    }
    this.candidate = null;
    this.change(candidate.previous, timestamp, [candidate.reason, reason], candidate);
  }
}

export function createControlEngine(config: Partial<ControlConfig> = {}): ControlEngine {
  return new ControlEngine(config);
}

export function analyzeHistoricalControl(historical: HistoricalResult,
  psychology: CandlePsychologyResult, structure: MultiTimeframeStructureResult,
  interaction: LiquidityInteractionResult,
  overrides: Partial<ControlConfig> = {},
  onCandle?: (candle: Candle, feature: CandlePsychologyFeature,
    snapshot: ControlSnapshot, transfers: readonly ControlTransferEvent[]) => void): ControlResult {
  const config = resolveConfig(overrides);
  const statuses = [historical.status, psychology.status, structure.status, interaction.status];
  const blocked = statuses.includes("FAILED") ? "FAILED" : "BLOCKED";
  const empty = (status: DataStatus, errorCode: string, errorIndex?: number): ControlResult => {
    const diagnostics = emptyDiagnostics();
    diagnostics.errorCode = errorCode;
    if (errorIndex !== undefined) diagnostics.errorIndex = errorIndex;
    const engine = createControlEngine(config);
    return { status, symbol: "XAUUSD", config, current: engine.current,
      stateChanges: [], transfers: [], diagnostics, timings: engine.timings };
  };
  if (statuses.some((status) => status === "FAILED" || status === "BLOCKED")) {
    return empty(blocked, "UPSTREAM_DATA_STATUS");
  }
  const candles = historical.candles1m;
  const features = psychology.timeframes["1m"].features;
  if (candles.length !== features.length) return empty("BLOCKED", "INPUT_ALIGNMENT");
  const engine = createControlEngine(config);
  for (let i = 0; i < candles.length; i++) {
    try {
      const snapshot = engine.push({ candle: candles[i], psychology: features[i],
        interactionEvents: interaction.events, structureEvents: structure.timeframes["1m"].events });
      onCandle?.(candles[i], features[i], snapshot, engine.transfers);
    } catch (error) {
      if (error instanceof ControlInputError) return empty("BLOCKED", error.code, i);
      throw error;
    }
  }
  if (engine.diagnostics.interactionEventsConsumed !== interaction.events.length ||
      engine.diagnostics.structureEventsConsumed !== structure.timeframes["1m"].events.length) {
    return empty("BLOCKED", "FUTURE_EVENT_MISSING");
  }
  const status: DataStatus = statuses.includes("WARN") ? "WARN" : "READY";
  return { status, symbol: "XAUUSD", config, current: engine.current,
    stateChanges: engine.stateChanges, transfers: engine.transfers,
    diagnostics: engine.diagnostics, timings: engine.timings };
}
