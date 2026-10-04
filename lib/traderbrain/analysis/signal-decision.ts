import type { DataStatus } from "../data/types.ts";
import type { ControlResult, ControlTransferEvent } from "./control-engine.ts";
import type { DisplacementEvent, DisplacementResult } from "./displacement-engine.ts";
import type { EntryCandidate, EntryCandidateResult } from "./entry-candidate.ts";
import type { FvgResult, FvgZone } from "./fvg-entry-location.ts";
import type { InteractionEvent, LiquidityInteraction,
  LiquidityInteractionResult } from "./liquidity-interaction.ts";
import type { LiquidityLevel, MultiTimeframeLiquidityResult } from "./liquidity.ts";
import type { ApproachSnapshot } from "./price-approach.ts";
import type { RiskValidation, RiskValidationResult } from "./risk-validation.ts";
import type { StructuralConfirmationEvent, StructuralConfirmationResult } from
  "./structural-confirmation.ts";

export type SetupFamily = "LIQUIDITY_REVERSAL" | "CONTINUATION" |
  "COMPRESSION_EXPANSION" | "BREAKOUT_RETEST";
export type SignalAction = "BUY" | "SELL";
export type DecisionAction = SignalAction | "WAIT" | "NO_TRADE";
export type SignalReason = "LIQUIDITY_REVERSAL" | "CONTINUATION_BOS" |
  "COMPRESSION_RELEASE" | "BREAKOUT_ACCEPTED" | "RETEST_CONFIRMED" |
  "MSS_CONFIRMED" | "BOS_CONFIRMED" | "CONTROL_TRANSFER_CONFIRMED" |
  "DISPLACEMENT_CONFIRMED" | "ENTRY_VALID" | "STRUCTURAL_STOP_VALID" |
  "DESTINATION_VALID" | "ROOM_VALID" | "RR_VALID";
export type DecisionReason = "WAITING_RISK_VALIDATION" | "UPSTREAM_ENTRY_INVALID" |
  "UPSTREAM_RISK_INVALID" | "NO_SETUP_FAMILY" | "DIRECTION_MISMATCH" |
  "LINEAGE_MISSING" | "PRICE_GEOMETRY_INVALID" | "DUPLICATE_SETUP" |
  "CONFLICTING_SETUP" | "STALE_CANDIDATE";
export type FamilyRejection = "REVERSAL_LINEAGE_MISSING" |
  "CONTINUATION_CONTEXT_MISSING" | "COMPRESSION_CONTEXT_MISSING" |
  "BREAKOUT_ACCEPTANCE_MISSING";
export type CompressionEvidence = Pick<ApproachSnapshot,
  "liquidityId" | "sourceTimeframe" | "timestamp" | "behaviorClass">;
export type Signal = {
  id: string;
  symbol: "XAUUSD";
  timeframe: "1m";
  direction: SignalAction;
  setupFamily: SetupFamily;
  setupSubtype: "SWEEP_REVERSAL" | "RAID_REVERSAL" |
    "FAILED_BREAK_REVERSAL" | "REJECTION_REVERSAL" |
    "BOS_CONTINUATION" | "COMPRESSION_RELEASE" |
    "ACCEPTED_BREAK_RETEST";
  createdAt: number;
  availableAt: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  rawRR: number;
  executionAdjustedRR: null;
  executionCostStatus: "NOT_AVAILABLE";
  status: "ACTIVE";
  reasons: SignalReason[];
  lineage: RiskValidation["lineage"] & { riskValidationId: string };
};
export type SignalDecision = {
  id: string;
  entryCandidateId: string;
  riskValidationId: string | null;
  availableAt: number;
  action: DecisionAction;
  setupFamily: SetupFamily | null;
  signalId: string | null;
  reasons: DecisionReason[];
};
export type FamilyCounts = { eligible: number; riskValid: number;
  classified: number; signals: number;
  rejectedByReason: Record<FamilyRejection, number> };
export type SignalDiagnostics = {
  entryCandidates: number;
  riskResults: number;
  riskValid: number;
  familyEligible: number;
  families: Record<SetupFamily, FamilyCounts>;
  buySignals: number;
  sellSignals: number;
  wait: number;
  noTrade: number;
  duplicatesRemoved: number;
  conflicts: number;
  rejectedByReason: Record<DecisionReason, number>;
  errorCode?: string;
  errorIndex?: number;
};
export type SignalTimings = { candidateJoinMs: number;
  familyClassificationMs: number; dedupeConflictMs: number;
  signalEmissionMs: number; totalMs: number };
export type SignalDecisionResult = { status: DataStatus; symbol: "XAUUSD";
  signals: Signal[]; decisions: SignalDecision[];
  diagnostics: SignalDiagnostics; timings: SignalTimings };

const FAMILIES: readonly SetupFamily[] = ["LIQUIDITY_REVERSAL",
  "BREAKOUT_RETEST", "COMPRESSION_EXPANSION", "CONTINUATION"];
const FAMILY_REJECTION: Record<SetupFamily, FamilyRejection> = {
  LIQUIDITY_REVERSAL: "REVERSAL_LINEAGE_MISSING",
  CONTINUATION: "CONTINUATION_CONTEXT_MISSING",
  COMPRESSION_EXPANSION: "COMPRESSION_CONTEXT_MISSING",
  BREAKOUT_RETEST: "BREAKOUT_ACCEPTANCE_MISSING",
};
const DECISION_REASONS: readonly DecisionReason[] = ["WAITING_RISK_VALIDATION",
  "UPSTREAM_ENTRY_INVALID", "UPSTREAM_RISK_INVALID", "NO_SETUP_FAMILY",
  "DIRECTION_MISMATCH", "LINEAGE_MISSING", "PRICE_GEOMETRY_INVALID",
  "DUPLICATE_SETUP", "CONFLICTING_SETUP", "STALE_CANDIDATE"];
function familyCounts(): FamilyCounts {
  return { eligible: 0, riskValid: 0, classified: 0, signals: 0,
    rejectedByReason: { REVERSAL_LINEAGE_MISSING: 0,
      CONTINUATION_CONTEXT_MISSING: 0, COMPRESSION_CONTEXT_MISSING: 0,
      BREAKOUT_ACCEPTANCE_MISSING: 0 } };
}
function diagnostics(): SignalDiagnostics {
  return { entryCandidates: 0, riskResults: 0, riskValid: 0,
    familyEligible: 0, families: {
      LIQUIDITY_REVERSAL: familyCounts(), CONTINUATION: familyCounts(),
      COMPRESSION_EXPANSION: familyCounts(), BREAKOUT_RETEST: familyCounts() },
    buySignals: 0, sellSignals: 0, wait: 0, noTrade: 0,
    duplicatesRemoved: 0, conflicts: 0,
    rejectedByReason: Object.fromEntries(DECISION_REASONS.map((reason) =>
      [reason, 0])) as Record<DecisionReason, number> };
}
function timings(): SignalTimings {
  return { candidateJoinMs: 0, familyClassificationMs: 0,
    dedupeConflictMs: 0, signalEmissionMs: 0, totalMs: 0 };
}
function validTime(value: number, at: number): boolean {
  return Number.isSafeInteger(value) && value <= at;
}
function setupKey(candidate: EntryCandidate): string {
  return `${candidate.structuralConfirmationId}:${candidate.displacementEventId}:${candidate.direction}`;
}
function directionControl(direction: EntryCandidate["direction"]):
  "BUYER_CONTROL" | "SELLER_CONTROL" {
  return direction === "BULLISH" ? "BUYER_CONTROL" : "SELLER_CONTROL";
}
function latestAtOrBefore(times: readonly number[], at: number): number | null {
  let left = 0; let right = times.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (times[middle] <= at) left = middle + 1;
    else right = middle;
  }
  return left ? times[left - 1] : null;
}
type Classification = { family: SetupFamily; subtype: Signal["setupSubtype"];
  reasons: SignalReason[] };
type Prepared = { candidate: EntryCandidate; risk: RiskValidation;
  classification: Classification | null; confirmationAt: number;
  rejection: DecisionReason | null };
export class SignalDecisionInputError extends Error {
  constructor(readonly code: "INPUT_ORDER" | "FUTURE_CONTEXT" |
    "INVALID_CONTEXT" | "DUPLICATE_CANDIDATE") { super(code); }
}

/** Consumes already computed event-time facts; never reads candles or recalculates risk. */
export class SignalDecisionEngine {
  readonly signals: Signal[] = [];
  readonly decisions: SignalDecision[] = [];
  readonly diagnostics = diagnostics();
  readonly timings = timings();
  private readonly candidates = new Map<string, EntryCandidate>();
  private readonly confirmations = new Map<string, StructuralConfirmationEvent>();
  private readonly displacements = new Map<string, DisplacementEvent>();
  private readonly transfers = new Map<string, ControlTransferEvent>();
  private readonly interactions = new Map<string, LiquidityInteraction>();
  private readonly zones = new Map<string, FvgZone>();
  private readonly levels = new Map<string, LiquidityLevel>();
  private readonly swingLevels = new Map<string, string[]>();
  private readonly breakAt = new Map<string, number>();
  private readonly acceptanceBySwing = new Map<string, InteractionEvent>();
  private readonly compressionByLevel = new Map<string, number[]>();
  private readonly emittedSetups = new Set<string>();
  private readonly seenRisks = new Set<string>();
  private lastSignalDirection: EntryCandidate["direction"] | null = null;
  private lastSignalConfirmationAt = -Infinity;
  private at = -Infinity;

  push(input: { at: number; newCandidates?: readonly EntryCandidate[];
    newRisks?: readonly RiskValidation[];
    newConfirmations?: readonly StructuralConfirmationEvent[];
    newDisplacements?: readonly DisplacementEvent[];
    newTransfers?: readonly ControlTransferEvent[];
    newInteractions?: readonly LiquidityInteraction[];
    newInteractionEvents?: readonly InteractionEvent[];
    newLiquidity?: readonly LiquidityLevel[];
    newZones?: readonly FvgZone[];
    newCompression?: readonly CompressionEvidence[] }): SignalDecision[] {
    const started = performance.now();
    const at = input.at;
    if (!Number.isSafeInteger(at) || at < this.at) {
      throw new SignalDecisionInputError("INPUT_ORDER");
    }
    const check = (value: number): void => {
      if (!validTime(value, at)) throw new SignalDecisionInputError("FUTURE_CONTEXT");
    };
    // Validate timestamps before mutating any state.
    for (const item of input.newCandidates ?? []) check(item.availableAt);
    for (const item of input.newRisks ?? []) check(item.availableAt);
    for (const item of input.newConfirmations ?? []) check(item.availableAt);
    for (const item of input.newDisplacements ?? []) check(item.availableAt);
    for (const item of input.newTransfers ?? []) check(item.availableAt);
    for (const item of input.newInteractions ?? []) check(item.completedAt);
    for (const item of input.newInteractionEvents ?? []) check(item.availableAt);
    for (const item of input.newLiquidity ?? []) check(item.availableAt);
    for (const item of input.newZones ?? []) {
      if (item.qualifiedAt === null) throw new SignalDecisionInputError("INVALID_CONTEXT");
      check(item.qualifiedAt);
    }
    for (const item of input.newCompression ?? []) {
      check(item.timestamp);
      if (item.behaviorClass !== "COMPRESSED") {
        throw new SignalDecisionInputError("INVALID_CONTEXT");
      }
    }
    this.at = at;
    for (const item of input.newLiquidity ?? []) {
      if (this.levels.has(item.id)) continue;
      this.levels.set(item.id, item);
      for (const swingId of item.sourceSwingIds) {
        const ids = this.swingLevels.get(swingId) ?? [];
        ids.push(item.id);
        this.swingLevels.set(swingId, ids);
      }
    }
    for (const item of input.newConfirmations ?? []) this.confirmations.set(item.id, item);
    for (const item of input.newDisplacements ?? []) this.displacements.set(item.id, item);
    for (const item of input.newTransfers ?? []) this.transfers.set(item.id, item);
    for (const item of input.newInteractions ?? []) this.interactions.set(item.id, item);
    for (const item of input.newZones ?? []) this.zones.set(item.id, item);
    for (const item of input.newInteractionEvents ?? []) {
      if (item.type === "BREAK_CONFIRMED") {
        const previous = this.breakAt.get(item.interactionId);
        if (previous === undefined || item.availableAt < previous) {
          this.breakAt.set(item.interactionId, item.availableAt);
        }
      } else if (item.type === "ACCEPTANCE_CONFIRMED") {
        const level = this.levels.get(item.liquidityId);
        if (!level) continue;
        for (const swingId of level.sourceSwingIds) {
          const previous = this.acceptanceBySwing.get(swingId);
          if (!previous || item.availableAt > previous.availableAt ||
              (item.availableAt === previous.availableAt && item.id > previous.id)) {
            this.acceptanceBySwing.set(swingId, item);
          }
        }
      }
    }
    for (const item of input.newCompression ?? []) {
      const level = this.levels.get(item.liquidityId);
      if (!level || level.timeframe !== item.sourceTimeframe ||
          level.availableAt > item.timestamp) {
        throw new SignalDecisionInputError("INVALID_CONTEXT");
      }
      const history = this.compressionByLevel.get(item.liquidityId) ?? [];
      if (!history.length || item.timestamp > history[history.length - 1]) {
        history.push(item.timestamp);
      } else if (item.timestamp < history[history.length - 1]) {
        throw new SignalDecisionInputError("INPUT_ORDER");
      }
      this.compressionByLevel.set(item.liquidityId, history);
    }
    const newCandidates = [...(input.newCandidates ?? [])]
      .sort((a, b) => a.id.localeCompare(b.id));
    const newRisks = [...(input.newRisks ?? [])]
      .sort((a, b) => a.entryCandidateId.localeCompare(b.entryCandidateId) ||
        a.id.localeCompare(b.id));
    for (const item of newCandidates) {
      if (this.candidates.has(item.id)) throw new SignalDecisionInputError("DUPLICATE_CANDIDATE");
      this.candidates.set(item.id, item);
      this.diagnostics.entryCandidates++;
    }
    const out: SignalDecision[] = [];
    const risksInTick = new Set(newRisks.map((item) => item.entryCandidateId));
    for (const item of newCandidates) {
      if (!risksInTick.has(item.id)) {
        out.push(this.decision(item.id, null, at, "WAIT", null,
          ["WAITING_RISK_VALIDATION"]));
      }
    }
    let stage = performance.now();
    const prepared = newRisks.map((risk) => this.prepare(risk, at));
    this.timings.candidateJoinMs += performance.now() - stage;
    stage = performance.now();
    const eligible = prepared.filter((item) => item.rejection === null &&
      item.classification !== null);
    const newest = new Map<EntryCandidate["direction"], number>();
    for (const item of eligible) {
      newest.set(item.candidate.direction, Math.max(
        newest.get(item.candidate.direction) ?? -Infinity, item.confirmationAt));
    }
    let conflictDirection: EntryCandidate["direction"] | null = null;
    if (newest.has("BULLISH") && newest.has("BEARISH")) {
      const bullish = newest.get("BULLISH")!;
      const bearish = newest.get("BEARISH")!;
      if (bullish > bearish) conflictDirection = "BULLISH";
      else if (bearish > bullish) conflictDirection = "BEARISH";
      // Equal confirmation times are unresolved: reject both directions.
    }
    for (const item of prepared) {
      const { candidate, risk, classification } = item;
      if (item.rejection) {
        out.push(this.decision(candidate.id, risk.id, at, "NO_TRADE",
          classification?.family ?? null, [item.rejection]));
        continue;
      }
      if (!classification) {
        out.push(this.decision(candidate.id, risk.id, at, "NO_TRADE",
          null, ["NO_SETUP_FAMILY"]));
        continue;
      }
      if (newest.size === 2 && (conflictDirection === null ||
          candidate.direction !== conflictDirection)) {
        this.diagnostics.conflicts++;
        out.push(this.decision(candidate.id, risk.id, at, "NO_TRADE",
          classification.family, ["CONFLICTING_SETUP"]));
        continue;
      }
      if (this.lastSignalDirection !== null &&
          candidate.direction !== this.lastSignalDirection &&
          item.confirmationAt <= this.lastSignalConfirmationAt) {
        this.diagnostics.conflicts++;
        out.push(this.decision(candidate.id, risk.id, at, "NO_TRADE",
          classification.family, ["CONFLICTING_SETUP"]));
        continue;
      }
      const key = setupKey(candidate);
      if (this.emittedSetups.has(key)) {
        this.diagnostics.duplicatesRemoved++;
        out.push(this.decision(candidate.id, risk.id, at, "NO_TRADE",
          classification.family, ["DUPLICATE_SETUP"]));
        continue;
      }
      this.emittedSetups.add(key);
      const emissionStarted = performance.now();
      const signal = this.emit(candidate, risk, classification, at);
      this.lastSignalDirection = candidate.direction;
      this.lastSignalConfirmationAt = item.confirmationAt;
      this.timings.signalEmissionMs += performance.now() - emissionStarted;
      out.push(this.decision(candidate.id, risk.id, at, signal.direction,
        classification.family, [], signal.id));
    }
    this.timings.dedupeConflictMs += performance.now() - stage;
    this.timings.totalMs += performance.now() - started;
    return out;
  }

  private decision(candidateId: string, riskId: string | null, at: number,
    action: DecisionAction, family: SetupFamily | null,
    reasons: DecisionReason[], signalId: string | null = null): SignalDecision {
    const decision: SignalDecision = { id: `XAUUSD:1m:DECISION:${candidateId}:${riskId ?? "PENDING"}:${action}`,
      entryCandidateId: candidateId, riskValidationId: riskId,
      availableAt: at, action, setupFamily: family, signalId, reasons };
    this.decisions.push(decision);
    if (action === "WAIT") this.diagnostics.wait++;
    if (action === "NO_TRADE") this.diagnostics.noTrade++;
    for (const reason of reasons) this.diagnostics.rejectedByReason[reason]++;
    return decision;
  }

  private prepare(risk: RiskValidation, at: number): Prepared {
    this.diagnostics.riskResults++;
    const candidate = this.candidates.get(risk.entryCandidateId);
    if (!candidate) {
      // Orphan risk results are input integration defects; never make a signal.
      const missing = { id: risk.entryCandidateId, direction: risk.direction,
        structuralConfirmationId: risk.lineage.structuralConfirmationId,
        displacementEventId: risk.lineage.displacementEventId } as EntryCandidate;
      return { candidate: missing, risk, classification: null,
        confirmationAt: -Infinity, rejection: "UPSTREAM_ENTRY_INVALID" };
    }
    if (this.seenRisks.has(risk.id)) {
      this.diagnostics.duplicatesRemoved++;
      return { candidate, risk, classification: null,
        confirmationAt: -Infinity, rejection: "DUPLICATE_SETUP" };
    }
    this.seenRisks.add(risk.id);
    if (candidate.status !== "CANDIDATE") return { candidate, risk,
      classification: null, confirmationAt: -Infinity,
      rejection: "UPSTREAM_ENTRY_INVALID" };
    if (risk.availableAt !== candidate.availableAt || risk.availableAt !== at) {
      return { candidate, risk,
      classification: null, confirmationAt: -Infinity,
      rejection: "STALE_CANDIDATE" };
    }
    if (risk.status !== "VALID") return { candidate, risk,
      classification: null, confirmationAt: -Infinity,
      rejection: "UPSTREAM_RISK_INVALID" };
    this.diagnostics.riskValid++;
    const confirmation = this.confirmations.get(candidate.structuralConfirmationId);
    const displacement = this.displacements.get(candidate.displacementEventId);
    const zone = this.zones.get(candidate.fvgId);
    if (!confirmation || !displacement || !zone ||
        confirmation.availableAt > at || displacement.availableAt > at ||
        zone.qualifiedAt === null || zone.qualifiedAt > at ||
        confirmation.displacementEventId !== displacement.id ||
        zone.structuralConfirmationId !== confirmation.id ||
        zone.displacementEventId !== displacement.id) {
      return { candidate, risk, classification: null,
        confirmationAt: -Infinity, rejection: "LINEAGE_MISSING" };
    }
    if (candidate.direction !== risk.direction ||
        candidate.direction !== confirmation.direction ||
        candidate.direction !== displacement.direction ||
        candidate.direction !== zone.direction) {
      return { candidate, risk, classification: null,
        confirmationAt: confirmation.availableAt, rejection: "DIRECTION_MISMATCH" };
    }
    const lineage = risk.lineage;
    if (risk.entryPrice !== candidate.entryPrice ||
        lineage.entryCandidateId !== candidate.id ||
        lineage.fvgId !== candidate.fvgId ||
        lineage.structuralConfirmationId !== candidate.structuralConfirmationId ||
        lineage.displacementEventId !== candidate.displacementEventId ||
        lineage.controlTransferId !== candidate.controlTransferId ||
        lineage.interactionId !== candidate.interactionId ||
        lineage.liquidityId !== candidate.liquidityId ||
        confirmation.controlTransferId !== candidate.controlTransferId ||
        confirmation.interactionId !== candidate.interactionId ||
        confirmation.liquidityId !== candidate.liquidityId) {
      return { candidate, risk, classification: null,
        confirmationAt: confirmation.availableAt, rejection: "LINEAGE_MISSING" };
    }
    const stop = risk.stopPrice;
    const target = risk.destinationPrice;
    const rr = risk.rawRR;
    if (stop === null || target === null || rr === null ||
        !Number.isFinite(stop) || !Number.isFinite(target) ||
        !Number.isFinite(candidate.entryPrice) || !Number.isFinite(rr) ||
        rr <= 0 || (candidate.direction === "BULLISH" ?
          !(stop < candidate.entryPrice && candidate.entryPrice < target) :
          !(target < candidate.entryPrice && candidate.entryPrice < stop)) ||
        risk.checks.stopSide !== true || risk.checks.minimumRisk?.pass !== true ||
        risk.checks.room?.pass !== true || risk.checks.rr?.pass !== true ||
        risk.checks.obstacleRoom?.pass === false) {
      return { candidate, risk, classification: null,
        confirmationAt: confirmation.availableAt,
        rejection: "PRICE_GEOMETRY_INVALID" };
    }
    const started = performance.now();
    const matches = this.familyMatches(candidate, confirmation, displacement, at);
    let classification: Classification | null = null;
    for (const family of FAMILIES) {
      if (matches[family]) {
        this.diagnostics.families[family].eligible++;
        this.diagnostics.families[family].riskValid++;
        if (!classification) classification = this.classification(family,
          candidate, confirmation, displacement);
      } else {
        this.diagnostics.families[family].rejectedByReason[FAMILY_REJECTION[family]]++;
      }
    }
    if (classification) {
      this.diagnostics.familyEligible++;
      this.diagnostics.families[classification.family].classified++;
    }
    this.timings.familyClassificationMs += performance.now() - started;
    return { candidate, risk, classification,
      confirmationAt: confirmation.availableAt, rejection: null };
  }

  private familyMatches(candidate: EntryCandidate,
    confirmation: StructuralConfirmationEvent,
    displacement: DisplacementEvent, at: number): Record<SetupFamily, boolean> {
    const reversal = confirmation.type === `${candidate.direction}_MSS` &&
      displacement.context === "TRANSFER";
    const continuation = confirmation.type === `${candidate.direction}_BOS` &&
      displacement.context === "CONTINUATION" &&
      candidate.controlStateAtEntry === directionControl(candidate.direction);
    const transfer = candidate.controlTransferId ?
      this.transfers.get(candidate.controlTransferId) : null;
    const interaction = candidate.interactionId ?
      this.interactions.get(candidate.interactionId) : null;
    const expectedSide = candidate.direction === "BULLISH" ? "SSL" : "BSL";
    const reversalValid = !!(reversal && transfer && interaction &&
      candidate.controlStateAtEntry === directionControl(candidate.direction) &&
      transfer.availableAt <= at && interaction.completedAt <= at &&
      transfer.interactionId === interaction.id &&
      transfer.liquidityId === candidate.liquidityId &&
      interaction.liquidityId === candidate.liquidityId &&
      interaction.liquiditySide === expectedSide &&
      transfer.newControl === directionControl(candidate.direction) &&
      displacement.controlTransferId === transfer.id &&
      displacement.interactionId === interaction.id &&
      ["SWEEP", "RAID", "FAILED_BREAK", "REJECTION"].includes(interaction.finalType));
    const acceptance = this.acceptanceBySwing.get(confirmation.brokenSwingId);
    const breakAt = acceptance ? this.breakAt.get(acceptance.interactionId) : undefined;
    const breakoutValid = !!(continuation && acceptance && breakAt !== undefined &&
      breakAt <= acceptance.availableAt && acceptance.availableAt <= at &&
      acceptance.liquiditySide === (candidate.direction === "BULLISH" ? "BSL" : "SSL") &&
      candidate.type === "FVG_RETRACE");
    const relevantLevels = candidate.liquidityId ? [candidate.liquidityId] :
      this.swingLevels.get(confirmation.brokenSwingId) ?? [];
    let compressed = false;
    for (const levelId of relevantLevels) {
      const history = this.compressionByLevel.get(levelId);
      if (history && latestAtOrBefore(history, displacement.ignitionAt) !== null) {
        compressed = true;
        break;
      }
    }
    return { LIQUIDITY_REVERSAL: reversalValid,
      BREAKOUT_RETEST: breakoutValid,
      COMPRESSION_EXPANSION: compressed && (reversalValid || continuation),
      CONTINUATION: continuation };
  }

  private classification(family: SetupFamily, candidate: EntryCandidate,
    confirmation: StructuralConfirmationEvent,
    displacement: DisplacementEvent): Classification {
    const common: SignalReason[] = ["DISPLACEMENT_CONFIRMED", "ENTRY_VALID",
      "STRUCTURAL_STOP_VALID", "DESTINATION_VALID", "ROOM_VALID", "RR_VALID"];
    if (family === "LIQUIDITY_REVERSAL") {
      const kind = this.interactions.get(candidate.interactionId!)!.finalType;
      const subtype: Signal["setupSubtype"] = kind === "SWEEP" ? "SWEEP_REVERSAL" :
        kind === "RAID" ? "RAID_REVERSAL" : kind === "FAILED_BREAK" ?
          "FAILED_BREAK_REVERSAL" : "REJECTION_REVERSAL";
      return { family, subtype, reasons: ["LIQUIDITY_REVERSAL",
        "CONTROL_TRANSFER_CONFIRMED", "MSS_CONFIRMED", ...common] };
    }
    if (family === "BREAKOUT_RETEST") return { family,
      subtype: "ACCEPTED_BREAK_RETEST", reasons: ["BREAKOUT_ACCEPTED",
        "RETEST_CONFIRMED", "BOS_CONFIRMED", ...common] };
    if (family === "COMPRESSION_EXPANSION") return { family,
      subtype: "COMPRESSION_RELEASE", reasons: ["COMPRESSION_RELEASE",
        confirmation.type.endsWith("MSS") ? "MSS_CONFIRMED" : "BOS_CONFIRMED",
        ...common] };
    void displacement;
    return { family, subtype: "BOS_CONTINUATION",
      reasons: ["CONTINUATION_BOS", "BOS_CONFIRMED", ...common] };
  }

  private emit(candidate: EntryCandidate, risk: RiskValidation,
    classification: Classification, at: number): Signal {
    const direction: SignalAction = candidate.direction === "BULLISH" ? "BUY" : "SELL";
    const signal: Signal = {
      id: `XAUUSD:1m:SIGNAL:${setupKey(candidate)}:${candidate.id}:${risk.id}`,
      symbol: "XAUUSD", timeframe: "1m", direction,
      setupFamily: classification.family, setupSubtype: classification.subtype,
      createdAt: candidate.createdAt, availableAt: at,
      entryPrice: candidate.entryPrice, stopLoss: risk.stopPrice!,
      takeProfit: risk.destinationPrice!, rr: risk.rawRR!, rawRR: risk.rawRR!,
      executionAdjustedRR: risk.executionAdjustedRR,
      executionCostStatus: risk.executionCostStatus, status: "ACTIVE",
      reasons: classification.reasons,
      lineage: { ...risk.lineage, riskValidationId: risk.id },
    };
    this.signals.push(signal);
    if (direction === "BUY") this.diagnostics.buySignals++;
    else this.diagnostics.sellSignals++;
    this.diagnostics.families[classification.family].signals++;
    return signal;
  }
}

export function createSignalDecisionEngine(): SignalDecisionEngine {
  return new SignalDecisionEngine();
}

export type SignalSources = { entry: EntryCandidateResult;
  risk: RiskValidationResult; confirmation: StructuralConfirmationResult;
  displacement: DisplacementResult; control: ControlResult;
  interaction: LiquidityInteractionResult;
  liquidity: MultiTimeframeLiquidityResult; fvg: FvgResult;
  compressionEvidence?: readonly CompressionEvidence[] };
const TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const;
export function analyzeHistoricalSignals(sources: SignalSources): SignalDecisionResult {
  const engine = createSignalDecisionEngine();
  const started = performance.now();
  const statuses = [sources.entry.status, sources.risk.status,
    sources.confirmation.status, sources.displacement.status,
    sources.control.status, sources.interaction.status,
    sources.liquidity.status, sources.fvg.status];
  const blocked = (code: string, index?: number): SignalDecisionResult => {
    const counts = diagnostics();
    counts.errorCode = code;
    if (index !== undefined) counts.errorIndex = index;
    return { status: "BLOCKED", symbol: "XAUUSD", signals: [],
      decisions: [], diagnostics: counts, timings: timings() };
  };
  if (statuses.some((status) => status === "BLOCKED" || status === "FAILED")) {
    return blocked("UPSTREAM_DATA_STATUS");
  }
  if (sources.entry.candidates.length === 0 &&
      sources.risk.validations.length === 0) {
    engine.timings.totalMs = performance.now() - started;
    return { status: statuses.includes("WARN") ? "WARN" : "READY",
      symbol: "XAUUSD", signals: engine.signals, decisions: engine.decisions,
      diagnostics: engine.diagnostics, timings: engine.timings };
  }
  const candidates = [...sources.entry.candidates].sort((a, b) =>
    a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  const risks = [...sources.risk.validations].sort((a, b) =>
    a.availableAt - b.availableAt || a.entryCandidateId.localeCompare(b.entryCandidateId));
  const confirmations = [...sources.confirmation.confirmations].sort((a, b) =>
    a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  const displacements = [...sources.displacement.confirmed].sort((a, b) =>
    a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  const transfers = [...sources.control.transfers].sort((a, b) =>
    a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  const interactions = [...sources.interaction.completed].sort((a, b) =>
    a.completedAt - b.completedAt || a.id.localeCompare(b.id));
  const interactionEvents = [...sources.interaction.events].sort((a, b) =>
    a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  const levels = TIMEFRAMES.flatMap((tf) => sources.liquidity.timeframes[tf].levels)
    .sort((a, b) => a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  const zoneById = new Map(sources.fvg.zones.map((zone) => [zone.id, zone]));
  const qualified = sources.fvg.events.filter((event) => event.type === "FVG_QUALIFIED")
    .sort((a, b) => a.availableAt - b.availableAt || a.zoneId.localeCompare(b.zoneId));
  const compression = [...(sources.compressionEvidence ?? [])]
    .filter((item) => item.behaviorClass === "COMPRESSED")
    .sort((a, b) => a.timestamp - b.timestamp ||
      a.liquidityId.localeCompare(b.liquidityId));
  let e = 0; let r = 0; let c = 0; let d = 0; let t = 0;
  let i = 0; let v = 0; let l = 0; let z = 0; let p = 0;
  try {
    while (e < candidates.length || r < risks.length) {
      const now = Math.min(candidates[e]?.availableAt ?? Infinity,
        risks[r]?.availableAt ?? Infinity);
      const newCandidates: EntryCandidate[] = [];
      const newRisks: RiskValidation[] = [];
      const newConfirmations: StructuralConfirmationEvent[] = [];
      const newDisplacements: DisplacementEvent[] = [];
      const newTransfers: ControlTransferEvent[] = [];
      const newInteractions: LiquidityInteraction[] = [];
      const newInteractionEvents: InteractionEvent[] = [];
      const newLiquidity: LiquidityLevel[] = [];
      const newZones: FvgZone[] = [];
      const newCompression: CompressionEvidence[] = [];
      while (e < candidates.length && candidates[e].availableAt <= now) {
        newCandidates.push(candidates[e++]);
      }
      while (r < risks.length && risks[r].availableAt <= now) newRisks.push(risks[r++]);
      while (c < confirmations.length && confirmations[c].availableAt <= now) {
        newConfirmations.push(confirmations[c++]);
      }
      while (d < displacements.length && displacements[d].availableAt <= now) {
        newDisplacements.push(displacements[d++]);
      }
      while (t < transfers.length && transfers[t].availableAt <= now) {
        newTransfers.push(transfers[t++]);
      }
      while (i < interactions.length && interactions[i].completedAt <= now) {
        newInteractions.push(interactions[i++]);
      }
      while (v < interactionEvents.length && interactionEvents[v].availableAt <= now) {
        newInteractionEvents.push(interactionEvents[v++]);
      }
      while (l < levels.length && levels[l].availableAt <= now) {
        newLiquidity.push(levels[l++]);
      }
      while (z < qualified.length && qualified[z].availableAt <= now) {
        const zone = zoneById.get(qualified[z++].zoneId);
        if (!zone) throw new SignalDecisionInputError("INVALID_CONTEXT");
        newZones.push(zone);
      }
      while (p < compression.length && compression[p].timestamp <= now) {
        newCompression.push(compression[p++]);
      }
      engine.push({ at: now, newCandidates, newRisks, newConfirmations,
        newDisplacements, newTransfers, newInteractions, newInteractionEvents,
        newLiquidity, newZones, newCompression });
    }
    engine.timings.totalMs = performance.now() - started;
    return { status: statuses.includes("WARN") ? "WARN" : "READY",
      symbol: "XAUUSD", signals: engine.signals, decisions: engine.decisions,
      diagnostics: engine.diagnostics, timings: engine.timings };
  } catch (error) {
    if (error instanceof SignalDecisionInputError) {
      return blocked(error.code, engine.diagnostics.riskResults);
    }
    throw error;
  }
}
