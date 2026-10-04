import type { DataStatus, HistoricalResult } from "../data/types.ts";
import type { CandlePsychologyResult } from "./candle-psychology.ts";
import type { ControlSnapshot, ControlTransferEvent } from "./control-engine.ts";
import { analyzeHistoricalDisplacement, type DisplacementClass,
  type DisplacementEvent } from "./displacement-engine.ts";
import type { LiquidityInteractionResult } from "./liquidity-interaction.ts";
import type { MultiTimeframeStructureResult, StructureEvent } from "./market-structure.ts";

export type StructuralConfirmationType =
  "BULLISH_BOS" | "BEARISH_BOS" | "BULLISH_MSS" | "BEARISH_MSS";
export type StructuralReason =
  "RAW_BULLISH_CONTINUATION_BREAK" | "RAW_BEARISH_CONTINUATION_BREAK" |
  "RAW_BULLISH_SHIFT" | "RAW_BEARISH_SHIFT" |
  "BUYER_CONTROL_ALIGNED" | "SELLER_CONTROL_ALIGNED" |
  "BUYER_TO_SELLER_TRANSFER" | "SELLER_TO_BUYER_TRANSFER" |
  "VALID_DISPLACEMENT" | "STRONG_DISPLACEMENT" | "EXTREME_DISPLACEMENT" |
  "TRANSFER_CONTEXT" | "CONTINUATION_CONTEXT" | "LIQUIDITY_INTERACTION_LINEAGE";
export type StructuralRejection =
  "NO_CONTINUATION_DISPLACEMENT" | "NO_ALIGNED_DISPLACEMENT" |
  "DIRECTION_MISMATCH" | "WRONG_CONTEXT" | "DISPLACEMENT_TOO_WEAK" |
  "CONTROL_NOT_ALIGNED" | "NO_CONTROL_TRANSFER" |
  "NO_INTERACTION_LINEAGE" | "CORRELATION_WINDOW_EXPIRED" |
  "PENDING_CAPACITY_EXCEEDED";

export type StructuralConfirmationConfig = {
  maxConfirmationLagBars: number;
  minimumDisplacementClassForBos: DisplacementClass;
  minimumDisplacementClassForMss: DisplacementClass;
  requireInteractionLineageForMss: boolean;
};
export const DEFAULT_STRUCTURAL_CONFIRMATION_CONFIG: Readonly<StructuralConfirmationConfig> =
  Object.freeze({ maxConfirmationLagBars: 6,
    minimumDisplacementClassForBos: "VALID",
    minimumDisplacementClassForMss: "VALID",
    requireInteractionLineageForMss: true });

export type StructuralConfirmationEvent = {
  id: string;
  type: StructuralConfirmationType;
  direction: "BULLISH" | "BEARISH";
  context: "CONTINUATION" | "REVERSAL";
  createdAt: number;
  availableAt: number;
  structureEventId: string;
  brokenSwingId: string;
  structurePrice: number;
  displacementEventId: string;
  displacementClassification: DisplacementClass;
  controlTransferId: string | null;
  interactionId: string | null;
  liquidityId: string | null;
  reasons: StructuralReason[];
};
export type StructuralLatest = Record<StructuralConfirmationType, string | null>;
export type StructuralConfirmationDiagnostics = {
  processedTicks: number;
  structureEventsConsumed: number;
  controlTransfersConsumed: number;
  displacementEventsConsumed: number;
  rawBullishContinuationBreaks: number;
  rawBearishContinuationBreaks: number;
  rawBullishShifts: number;
  rawBearishShifts: number;
  matchedDisplacements: number;
  expiredDisplacements: number;
  confirmedBos: number;
  confirmedMss: number;
  pendingEventsExpired: number;
  duplicateStructures: number;
  rejectedByReason: Record<StructuralRejection, number>;
  errorCode?: string;
  errorIndex?: number;
};
export type StructuralConfirmationTimings = {
  eventConsumptionMs: number;
  correlationMs: number;
  confirmationMs: number;
  totalMs: number;
};
export type StructuralConfirmationResult = {
  status: DataStatus;
  symbol: "XAUUSD";
  config: Readonly<StructuralConfirmationConfig>;
  confirmations: StructuralConfirmationEvent[];
  latest: StructuralLatest;
  diagnostics: StructuralConfirmationDiagnostics;
  timings: StructuralConfirmationTimings;
};

type Direction = "BULLISH" | "BEARISH";
type Kind = "BOS" | "MSS";
type PendingStructure = {
  event: StructureEvent;
  direction: Direction;
  kind: Kind;
  index: number;
  rejection: StructuralRejection;
  matched: boolean;
};
type PendingDisplacement = {
  event: DisplacementEvent;
  index: number;
  matched: boolean;
};
type RecentTransfer = { event: ControlTransferEvent; index: number };
const MAX_PENDING = 128;
// Phase 8 permits a transfer-to-ignition delay of at most 60 bars and an
// ignition-to-confirmation delay of at most 60 more bars under its public config.
const MAX_PHASE8_TRANSFER_LINEAGE_BARS = 120;
const CLASS_RANK: Record<DisplacementClass, number> = {
  VALID: 1, STRONG: 2, EXTREME: 3,
};

export class StructuralConfirmationInputError extends Error {
  constructor(readonly code: "INPUT_ORDER" | "CONTROL_ALIGNMENT" |
    "STRUCTURE_ORDER" | "TRANSFER_ORDER" | "DISPLACEMENT_ORDER" |
    "LATE_EVENT" | "INVALID_EVENT" | "EVENT_STREAM_SHRANK") { super(code); }
}
function resolveConfig(overrides: Partial<StructuralConfirmationConfig>):
  Readonly<StructuralConfirmationConfig> {
  const config = { ...DEFAULT_STRUCTURAL_CONFIRMATION_CONFIG, ...overrides };
  if (!Number.isSafeInteger(config.maxConfirmationLagBars) ||
      config.maxConfirmationLagBars < 1 || config.maxConfirmationLagBars > 64 ||
      !(config.minimumDisplacementClassForBos in CLASS_RANK) ||
      !(config.minimumDisplacementClassForMss in CLASS_RANK) ||
      typeof config.requireInteractionLineageForMss !== "boolean") {
    throw new RangeError("Invalid structural confirmation configuration");
  }
  return Object.freeze(config);
}
function emptyRejections(): Record<StructuralRejection, number> {
  return { NO_CONTINUATION_DISPLACEMENT: 0, NO_ALIGNED_DISPLACEMENT: 0,
    DIRECTION_MISMATCH: 0, WRONG_CONTEXT: 0, DISPLACEMENT_TOO_WEAK: 0,
    CONTROL_NOT_ALIGNED: 0, NO_CONTROL_TRANSFER: 0,
    NO_INTERACTION_LINEAGE: 0, CORRELATION_WINDOW_EXPIRED: 0,
    PENDING_CAPACITY_EXCEEDED: 0 };
}
function emptyDiagnostics(): StructuralConfirmationDiagnostics {
  return { processedTicks: 0, structureEventsConsumed: 0, controlTransfersConsumed: 0,
    displacementEventsConsumed: 0, rawBullishContinuationBreaks: 0,
    rawBearishContinuationBreaks: 0, rawBullishShifts: 0, rawBearishShifts: 0,
    matchedDisplacements: 0, expiredDisplacements: 0, confirmedBos: 0,
    confirmedMss: 0, pendingEventsExpired: 0, duplicateStructures: 0,
    rejectedByReason: emptyRejections() };
}
function emptyLatest(): StructuralLatest {
  return { BULLISH_BOS: null, BEARISH_BOS: null,
    BULLISH_MSS: null, BEARISH_MSS: null };
}
function describe(event: StructureEvent): { kind: Kind; direction: Direction } | null {
  switch (event.type) {
    case "BULLISH_CONTINUATION_BREAK": return { kind: "BOS", direction: "BULLISH" };
    case "BEARISH_CONTINUATION_BREAK": return { kind: "BOS", direction: "BEARISH" };
    case "RAW_BULLISH_STRUCTURE_SHIFT": return { kind: "MSS", direction: "BULLISH" };
    case "RAW_BEARISH_STRUCTURE_SHIFT": return { kind: "MSS", direction: "BEARISH" };
    default: return null;
  }
}
function aligned(direction: Direction, state: ControlSnapshot["state"]): boolean {
  return state === (direction === "BULLISH" ? "BUYER_CONTROL" : "SELLER_CONTROL");
}
function structureReason(event: StructureEvent): StructuralReason {
  switch (event.type) {
    case "BULLISH_CONTINUATION_BREAK": return "RAW_BULLISH_CONTINUATION_BREAK";
    case "BEARISH_CONTINUATION_BREAK": return "RAW_BEARISH_CONTINUATION_BREAK";
    case "RAW_BULLISH_STRUCTURE_SHIFT": return "RAW_BULLISH_SHIFT";
    default: return "RAW_BEARISH_SHIFT";
  }
}

export class StructuralConfirmationEngine {
  readonly config: Readonly<StructuralConfirmationConfig>;
  readonly confirmations: StructuralConfirmationEvent[] = [];
  readonly latest: StructuralLatest = emptyLatest();
  private readonly counts = emptyDiagnostics();
  private readonly stage = { eventConsumptionMs: 0, correlationMs: 0, confirmationMs: 0 };
  private readonly pendingStructures: PendingStructure[] = [];
  private readonly pendingDisplacements: PendingDisplacement[] = [];
  private readonly recentTransfers: RecentTransfer[] = [];
  private readonly seenStructureIds = new Set<string>();
  private readonly seenDisplacementIds = new Set<string>();
  private structureCursor = 0;
  private transferCursor = 0;
  private displacementCursor = 0;
  private lastStructureAt = -Infinity;
  private lastTransferAt = -Infinity;
  private lastDisplacementAt = -Infinity;
  private lastTransfer: ControlTransferEvent | null = null;
  private latestBuyerToSellerAt = -Infinity;
  private latestSellerToBuyerAt = -Infinity;
  private previousTimestamp: number | null = null;

  constructor(overrides: Partial<StructuralConfirmationConfig> = {}) {
    this.config = resolveConfig(overrides);
  }
  get diagnostics(): StructuralConfirmationDiagnostics {
    return { ...this.counts, rejectedByReason: { ...this.counts.rejectedByReason } };
  }
  get timings(): StructuralConfirmationTimings {
    const { eventConsumptionMs, correlationMs, confirmationMs } = this.stage;
    return { eventConsumptionMs, correlationMs, confirmationMs,
      totalMs: eventConsumptionMs + correlationMs + confirmationMs };
  }
  get pendingCounts(): { structures: number; displacements: number; transfers: number } {
    return { structures: this.pendingStructures.length,
      displacements: this.pendingDisplacements.length,
      transfers: this.recentTransfers.length };
  }
  push(input: { timestamp: number; structureEvents: readonly StructureEvent[];
    controlTransferEvents: readonly ControlTransferEvent[];
    displacementEvents: readonly DisplacementEvent[];
    currentControl: ControlSnapshot }): void {
    const { timestamp, structureEvents, controlTransferEvents,
      displacementEvents, currentControl } = input;
    if (!Number.isSafeInteger(timestamp) ||
        (this.previousTimestamp !== null && timestamp <= this.previousTimestamp)) {
      throw new StructuralConfirmationInputError("INPUT_ORDER");
    }
    if (!currentControl || currentControl.timestamp !== timestamp) {
      throw new StructuralConfirmationInputError("CONTROL_ALIGNMENT");
    }
    if (structureEvents.length < this.structureCursor ||
        controlTransferEvents.length < this.transferCursor ||
        displacementEvents.length < this.displacementCursor) {
      throw new StructuralConfirmationInputError("EVENT_STREAM_SHRANK");
    }
    const started = performance.now();
    const newStructures: PendingStructure[] = [];
    const newDisplacements: PendingDisplacement[] = [];
    // Equal-time precedence: control transfers, confirmed displacement, raw structure.
    while (this.transferCursor < controlTransferEvents.length &&
        controlTransferEvents[this.transferCursor].availableAt <= timestamp) {
      const event = controlTransferEvents[this.transferCursor++];
      this.validateEvent(event.availableAt, event.createdAt, event.id,
        this.lastTransferAt, "TRANSFER_ORDER");
      this.lastTransferAt = event.availableAt;
      this.lastTransfer = event;
      this.recentTransfers.push({ event, index: this.counts.processedTicks });
      if (event.direction === "BUYER_TO_SELLER") this.latestBuyerToSellerAt = event.availableAt;
      else this.latestSellerToBuyerAt = event.availableAt;
      this.counts.controlTransfersConsumed++;
    }
    if (currentControl.lastTransferId !== (this.lastTransfer?.id ?? null)) {
      throw new StructuralConfirmationInputError("CONTROL_ALIGNMENT");
    }
    while (this.displacementCursor < displacementEvents.length &&
        displacementEvents[this.displacementCursor].availableAt <= timestamp) {
      const event = displacementEvents[this.displacementCursor++];
      this.validateEvent(event.availableAt, event.createdAt, event.id,
        this.lastDisplacementAt, "DISPLACEMENT_ORDER");
      this.lastDisplacementAt = event.availableAt;
      this.counts.displacementEventsConsumed++;
      if (this.seenDisplacementIds.has(event.id)) continue;
      this.seenDisplacementIds.add(event.id);
      const pending = { event, index: this.counts.processedTicks, matched: false };
      this.pendingDisplacements.push(pending);
      newDisplacements.push(pending);
    }
    while (this.structureCursor < structureEvents.length &&
        structureEvents[this.structureCursor].availableAt <= timestamp) {
      const event = structureEvents[this.structureCursor++];
      this.validateEvent(event.availableAt, event.createdAt, event.id,
        this.lastStructureAt, "STRUCTURE_ORDER");
      if (event.timeframe !== "1m" || !event.brokenSwingId ||
          !Number.isFinite(event.price)) throw new StructuralConfirmationInputError("INVALID_EVENT");
      this.lastStructureAt = event.availableAt;
      this.counts.structureEventsConsumed++;
      const description = describe(event);
      if (!description) continue;
      if (this.seenStructureIds.has(event.id)) {
        this.counts.duplicateStructures++;
        continue;
      }
      this.seenStructureIds.add(event.id);
      const pending: PendingStructure = { event, ...description,
        index: this.counts.processedTicks, matched: false,
        rejection: description.kind === "BOS" ?
          "NO_CONTINUATION_DISPLACEMENT" : "NO_ALIGNED_DISPLACEMENT" };
      this.pendingStructures.push(pending);
      newStructures.push(pending);
      if (event.type === "BULLISH_CONTINUATION_BREAK") this.counts.rawBullishContinuationBreaks++;
      else if (event.type === "BEARISH_CONTINUATION_BREAK") this.counts.rawBearishContinuationBreaks++;
      else if (event.type === "RAW_BULLISH_STRUCTURE_SHIFT") this.counts.rawBullishShifts++;
      else this.counts.rawBearishShifts++;
    }
    const consumed = performance.now();
    this.stage.eventConsumptionMs += consumed - started;
    this.expire();
    const confirmationBefore = this.stage.confirmationMs;
    // New displacement chooses the closest pending break, including same-time breaks.
    for (const pending of newDisplacements) {
      if (!pending.matched) this.matchDisplacement(pending, currentControl, timestamp);
    }
    for (const pending of newStructures) {
      if (!pending.matched) this.matchStructure(pending, currentControl, timestamp);
    }
    this.capBuffers();
    this.stage.correlationMs += performance.now() - consumed -
      (this.stage.confirmationMs - confirmationBefore);
    this.previousTimestamp = timestamp;
    this.counts.processedTicks++;
  }
  private validateEvent(availableAt: number, createdAt: number, id: string,
    lastAt: number, orderCode: StructuralConfirmationInputError["code"]): void {
    if (!id || !Number.isSafeInteger(availableAt) ||
        !Number.isSafeInteger(createdAt) || createdAt > availableAt) {
      throw new StructuralConfirmationInputError("INVALID_EVENT");
    }
    if (availableAt < lastAt) throw new StructuralConfirmationInputError(orderCode);
    if (this.previousTimestamp !== null && availableAt <= this.previousTimestamp) {
      throw new StructuralConfirmationInputError("LATE_EVENT");
    }
  }
  private transferById(id: string | null): ControlTransferEvent | null {
    if (!id) return null;
    for (let i = this.recentTransfers.length - 1; i >= 0; i--) {
      if (this.recentTransfers[i].event.id === id) return this.recentTransfers[i].event;
    }
    return null;
  }
  private rejection(structure: PendingStructure, displacement: PendingDisplacement,
    control: ControlSnapshot): StructuralRejection | null {
    const s = structure.event;
    const d = displacement.event;
    if (Math.abs(structure.index - displacement.index) > this.config.maxConfirmationLagBars) {
      return "CORRELATION_WINDOW_EXPIRED";
    }
    if (structure.direction !== d.direction) return "DIRECTION_MISMATCH";
    if (d.context !== (structure.kind === "BOS" ? "CONTINUATION" : "TRANSFER")) {
      return "WRONG_CONTEXT";
    }
    const minimum = structure.kind === "BOS" ?
      this.config.minimumDisplacementClassForBos : this.config.minimumDisplacementClassForMss;
    if (CLASS_RANK[d.classification] < CLASS_RANK[minimum]) {
      return "DISPLACEMENT_TOO_WEAK";
    }
    if (!aligned(structure.direction, control.state) ||
        !aligned(structure.direction, d.controlState)) {
      return "CONTROL_NOT_ALIGNED";
    }
    const oppositeAt = structure.direction === "BULLISH" ?
      this.latestBuyerToSellerAt : this.latestSellerToBuyerAt;
    if (structure.kind === "BOS") {
      return oppositeAt > Math.min(s.availableAt, d.availableAt) ?
        "CONTROL_NOT_ALIGNED" : null;
    }
    const transfer = this.transferById(d.controlTransferId);
    const expectedTransfer = structure.direction === "BULLISH" ?
      "SELLER_TO_BUYER" : "BUYER_TO_SELLER";
    if (!transfer || transfer.direction !== expectedTransfer ||
        transfer.availableAt > Math.max(s.availableAt, d.availableAt) ||
        transfer.newControl !== control.state ||
        oppositeAt > transfer.availableAt) return "NO_CONTROL_TRANSFER";
    if (this.config.requireInteractionLineageForMss &&
        (!d.interactionId || !d.liquidityId ||
          d.interactionId !== transfer.interactionId ||
          d.liquidityId !== transfer.liquidityId)) return "NO_INTERACTION_LINEAGE";
    return null;
  }
  private matchDisplacement(displacement: PendingDisplacement,
    control: ControlSnapshot, timestamp: number): void {
    let best: PendingStructure | null = null;
    for (const structure of this.pendingStructures) {
      const rejection = this.rejection(structure, displacement, control);
      if (rejection) {
        if (rejection !== "CORRELATION_WINDOW_EXPIRED") structure.rejection = rejection;
        continue;
      }
      const distance = Math.abs(structure.index - displacement.index);
      const bestDistance = best ? Math.abs(best.index - displacement.index) : Infinity;
      if (!best || distance < bestDistance ||
          (distance === bestDistance && structure.event.id < best.event.id)) best = structure;
    }
    if (best) this.confirm(best, displacement, timestamp);
  }
  private matchStructure(structure: PendingStructure,
    control: ControlSnapshot, timestamp: number): void {
    let best: PendingDisplacement | null = null;
    for (const displacement of this.pendingDisplacements) {
      const rejection = this.rejection(structure, displacement, control);
      if (rejection) {
        if (rejection !== "CORRELATION_WINDOW_EXPIRED") structure.rejection = rejection;
        continue;
      }
      const distance = Math.abs(structure.index - displacement.index);
      const bestDistance = best ? Math.abs(structure.index - best.index) : Infinity;
      if (!best || distance < bestDistance ||
          (distance === bestDistance && displacement.event.id < best.event.id)) {
        best = displacement;
      }
    }
    if (best) this.confirm(structure, best, timestamp);
  }
  private confirm(structure: PendingStructure, displacement: PendingDisplacement,
    timestamp: number): void {
    const started = performance.now();
    const s = structure.event;
    const d = displacement.event;
    const transfer = structure.kind === "MSS" ? this.transferById(d.controlTransferId) : null;
    const type: StructuralConfirmationType = `${structure.direction}_${structure.kind}`;
    const reasons: StructuralReason[] = [structureReason(s),
      structure.direction === "BULLISH" ? "BUYER_CONTROL_ALIGNED" : "SELLER_CONTROL_ALIGNED",
      `${d.classification}_DISPLACEMENT` as StructuralReason,
      structure.kind === "BOS" ? "CONTINUATION_CONTEXT" : "TRANSFER_CONTEXT"];
    if (transfer) {
      reasons.push(transfer.direction === "BUYER_TO_SELLER" ?
        "BUYER_TO_SELLER_TRANSFER" : "SELLER_TO_BUYER_TRANSFER",
      "LIQUIDITY_INTERACTION_LINEAGE");
    }
    const availableAt = Math.max(s.availableAt, d.availableAt, transfer?.availableAt ?? -Infinity);
    if (availableAt > timestamp) throw new StructuralConfirmationInputError("INVALID_EVENT");
    const event: StructuralConfirmationEvent = {
      id: `XAUUSD:1m:${type}:${s.id}:${d.id}`,
      type, direction: structure.direction,
      context: structure.kind === "BOS" ? "CONTINUATION" : "REVERSAL",
      createdAt: s.createdAt, availableAt, structureEventId: s.id,
      brokenSwingId: s.brokenSwingId, structurePrice: s.price,
      displacementEventId: d.id, displacementClassification: d.classification,
      controlTransferId: transfer?.id ?? null,
      interactionId: structure.kind === "MSS" ? d.interactionId : null,
      liquidityId: structure.kind === "MSS" ? d.liquidityId : null,
      reasons,
    };
    this.confirmations.push(event);
    this.latest[type] = event.id;
    if (structure.kind === "BOS") this.counts.confirmedBos++;
    else this.counts.confirmedMss++;
    this.counts.matchedDisplacements++;
    structure.matched = true;
    displacement.matched = true;
    this.pendingStructures.splice(this.pendingStructures.indexOf(structure), 1);
    this.pendingDisplacements.splice(this.pendingDisplacements.indexOf(displacement), 1);
    this.stage.confirmationMs += performance.now() - started;
  }
  private expire(): void {
    const index = this.counts.processedTicks;
    while (this.pendingStructures.length &&
        index - this.pendingStructures[0].index > this.config.maxConfirmationLagBars) {
      const item = this.pendingStructures.splice(0, 1)[0];
      this.counts.pendingEventsExpired++;
      this.counts.rejectedByReason[item.rejection]++;
      this.counts.rejectedByReason.CORRELATION_WINDOW_EXPIRED++;
    }
    while (this.pendingDisplacements.length &&
        index - this.pendingDisplacements[0].index > this.config.maxConfirmationLagBars) {
      this.pendingDisplacements.splice(0, 1);
      this.counts.pendingEventsExpired++;
      this.counts.expiredDisplacements++;
    }
    while (this.recentTransfers.length &&
        index - this.recentTransfers[0].index >
          this.config.maxConfirmationLagBars + MAX_PHASE8_TRANSFER_LINEAGE_BARS) {
      this.recentTransfers.splice(0, 1);
    }
  }
  private capBuffers(): void {
    while (this.pendingStructures.length > MAX_PENDING) {
      const item = this.pendingStructures.splice(0, 1)[0];
      this.counts.pendingEventsExpired++;
      this.counts.rejectedByReason[item.rejection]++;
      this.counts.rejectedByReason.PENDING_CAPACITY_EXCEEDED++;
    }
    while (this.pendingDisplacements.length > MAX_PENDING) {
      this.pendingDisplacements.splice(0, 1);
      this.counts.pendingEventsExpired++;
      this.counts.expiredDisplacements++;
      this.counts.rejectedByReason.PENDING_CAPACITY_EXCEEDED++;
    }
    while (this.recentTransfers.length > MAX_PENDING) this.recentTransfers.splice(0, 1);
  }
}

export function createStructuralConfirmationEngine(
  config: Partial<StructuralConfirmationConfig> = {}): StructuralConfirmationEngine {
  return new StructuralConfirmationEngine(config);
}
export function analyzeHistoricalStructuralConfirmations(historical: HistoricalResult,
  psychology: CandlePsychologyResult, structure: MultiTimeframeStructureResult,
  interaction: LiquidityInteractionResult,
  overrides: Partial<StructuralConfirmationConfig> = {}): StructuralConfirmationResult {
  const config = resolveConfig(overrides);
  const engine = createStructuralConfirmationEngine(config);
  const empty = (status: DataStatus, code: string, index?: number): StructuralConfirmationResult => {
    const diagnostics = emptyDiagnostics();
    diagnostics.errorCode = code;
    if (index !== undefined) diagnostics.errorIndex = index;
    return { status, symbol: "XAUUSD", config, confirmations: [],
      latest: emptyLatest(), diagnostics, timings: engine.timings };
  };
  let index = 0;
  try {
    const displacement = analyzeHistoricalDisplacement(historical, psychology,
      structure, interaction, {}, (timestamp, control, transfers, confirmed) => {
        engine.push({ timestamp, currentControl: control,
          structureEvents: structure.timeframes["1m"].events,
          controlTransferEvents: transfers, displacementEvents: confirmed });
        index++;
      });
    if (displacement.status === "BLOCKED" || displacement.status === "FAILED") {
      return empty(displacement.status,
        displacement.diagnostics.errorCode ?? "UPSTREAM_DATA_STATUS",
        displacement.diagnostics.errorIndex);
    }
    const counts = engine.diagnostics;
    if (counts.structureEventsConsumed !== structure.timeframes["1m"].events.length ||
        counts.displacementEventsConsumed !== displacement.confirmed.length) {
      return empty("BLOCKED", "EVENT_STREAM_INCOMPLETE");
    }
    return { status: displacement.status, symbol: "XAUUSD", config,
      confirmations: engine.confirmations, latest: { ...engine.latest },
      diagnostics: counts, timings: engine.timings };
  } catch (error) {
    if (error instanceof StructuralConfirmationInputError) {
      return empty("BLOCKED", error.code, index);
    }
    throw error;
  }
}
