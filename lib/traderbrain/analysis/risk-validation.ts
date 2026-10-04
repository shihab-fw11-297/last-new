import type { DataStatus, Timeframe } from "../data/types.ts";
import type { CandlePsychologyResult } from "./candle-psychology.ts";
import type { EntryCandidate, EntryCandidateResult } from "./entry-candidate.ts";
import type { FvgResult, FvgZone } from "./fvg-entry-location.ts";
import type { InteractionEvent, LiquidityInteraction,
  LiquidityInteractionResult } from "./liquidity-interaction.ts";
import type { LiquidityLevel, MultiTimeframeLiquidityResult } from "./liquidity.ts";
import type { MarketSwing, MultiTimeframeStructureResult } from "./market-structure.ts";
import type { StructuralConfirmationEvent, StructuralConfirmationResult } from
  "./structural-confirmation.ts";

export type RiskStatus = "VALID" | "NO_DESTINATION" | "INVALID_STOP" |
  "INSUFFICIENT_ROOM" | "OBSTACLE_TOO_CLOSE" | "RR_TOO_LOW" | "INVALIDATED";
export type RiskReason = "NO_CAUSAL_DESTINATION" |
  "NO_STRUCTURAL_INVALIDATION" | "STOP_WRONG_SIDE" | "RISK_TOO_SMALL" |
  "ROOM_TOO_SMALL" | "OBSTACLE_TOO_CLOSE" | "RR_BELOW_MINIMUM" |
  "UPSTREAM_INVALIDATED" | "FUTURE_LIQUIDITY_REJECTED" |
  "FUTURE_STRUCTURE_REJECTED" | "NO_REFERENCE_ATR";
export type StopSource = "INTERACTION_EXTREME" | "STRUCTURAL_SWING" |
  "ZONE_INVALIDATION";
export type RiskValidationConfig = {
  stopBufferAtr: number;
  minimumRiskAtr: number;
  minRoomAtr: number;
  minimumObstacleRoomAtr: number;
  minRR: number;
};
export const DEFAULT_RISK_VALIDATION_CONFIG: Readonly<RiskValidationConfig> =
  Object.freeze({ stopBufferAtr: 0.02, minimumRiskAtr: 0.05,
    minRoomAtr: 0.5, minimumObstacleRoomAtr: 0.3, minRR: 1.5 });
export type GateMetric = { actual: number; required: number; pass: boolean };
export type RiskValidation = {
  id: string;
  entryCandidateId: string;
  direction: EntryCandidate["direction"];
  availableAt: number;
  entryPrice: number;
  structuralInvalidationPrice: number | null;
  stopPrice: number | null;
  stopSource: StopSource | null;
  stopSourceId: string | null;
  stopBufferAtr: number;
  referenceAtr: number | null;
  riskDistance: number | null;
  riskAtr: number | null;
  destinationLiquidityId: string | null;
  destinationType: LiquidityLevel["kind"] | null;
  destinationTimeframe: Timeframe | null;
  destinationPrice: number | null;
  roomToDestination: number | null;
  roomToDestinationAtr: number | null;
  nearestObstacleId: string | null;
  nearestObstaclePrice: number | null;
  roomToObstacle: number | null;
  roomToObstacleAtr: number | null;
  rewardDistance: number | null;
  rewardAtr: number | null;
  rawRR: number | null;
  executionAdjustedRR: null;
  executionCostStatus: "NOT_AVAILABLE";
  checks: { stopSide: boolean | null; minimumRisk: GateMetric | null;
    room: GateMetric | null; obstacleRoom: GateMetric | null;
    rr: GateMetric | null };
  status: RiskStatus;
  reasons: RiskReason[];
  lineage: { liquidityId: string | null; interactionId: string | null;
    controlTransferId: string | null; displacementEventId: string;
    structuralConfirmationId: string; fvgId: string;
    entryCandidateId: string };
};
export type RiskDiagnostics = {
  entryCandidatesConsumed: number;
  structuralStopsFound: number;
  stopValid: number;
  invalidStop: number;
  destinationFound: number;
  noDestination: number;
  roomPass: number;
  insufficientRoom: number;
  obstaclePass: number;
  obstacleTooClose: number;
  rrPass: number;
  rrTooLow: number;
  riskValid: number;
  invalidated: number;
  futureLiquidityExcluded: number;
  futureStructureExcluded: number;
  destinationTimeframes: Record<Timeframe, number>;
  rejectedByReason: Record<RiskReason, number>;
  sumRiskAtr: number;
  sumRewardAtr: number;
  sumRawRR: number;
  riskMetricCount: number;
  rewardMetricCount: number;
  rrMetricCount: number;
  errorCode?: string;
  errorIndex?: number;
};
export type RiskTimings = { lineageLookupMs: number; stopSelectionMs: number;
  destinationLookupMs: number; roomValidationMs: number;
  rrCalculationMs: number; totalMs: number };
export type RiskValidationResult = { status: DataStatus; symbol: "XAUUSD";
  config: Readonly<RiskValidationConfig>; validations: RiskValidation[];
  diagnostics: RiskDiagnostics; timings: RiskTimings };

type TreeNode = { level: LiquidityLevel; active: boolean; height: number;
  activeCount: number; left: TreeNode | null; right: TreeNode | null };
function height(node: TreeNode | null): number { return node?.height ?? 0; }
function activeCount(node: TreeNode | null): number { return node?.activeCount ?? 0; }
function compareLevel(a: LiquidityLevel, b: LiquidityLevel): number {
  return a.price - b.price || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function fix(node: TreeNode): void {
  node.height = 1 + Math.max(height(node.left), height(node.right));
  node.activeCount = (node.active ? 1 : 0) +
    activeCount(node.left) + activeCount(node.right);
}
function rotateLeft(root: TreeNode): TreeNode {
  const next = root.right!;
  root.right = next.left;
  next.left = root;
  fix(root); fix(next);
  return next;
}
function rotateRight(root: TreeNode): TreeNode {
  const next = root.left!;
  root.left = next.right;
  next.right = root;
  fix(root); fix(next);
  return next;
}
function balance(root: TreeNode): TreeNode {
  fix(root);
  const skew = height(root.left) - height(root.right);
  if (skew > 1) {
    if (height(root.left!.left) < height(root.left!.right)) {
      root.left = rotateLeft(root.left!);
    }
    return rotateRight(root);
  }
  if (skew < -1) {
    if (height(root.right!.right) < height(root.right!.left)) {
      root.right = rotateRight(root.right!);
    }
    return rotateLeft(root);
  }
  return root;
}
function insert(root: TreeNode | null, level: LiquidityLevel): TreeNode {
  if (!root) return { level, active: true, height: 1,
    activeCount: 1, left: null, right: null };
  const order = compareLevel(level, root.level);
  if (order < 0) root.left = insert(root.left, level);
  else if (order > 0) root.right = insert(root.right, level);
  else root.active = true;
  return balance(root);
}
function deactivate(root: TreeNode | null, level: LiquidityLevel): TreeNode | null {
  if (!root) return null;
  const order = compareLevel(level, root.level);
  if (order < 0) root.left = deactivate(root.left, level);
  else if (order > 0) root.right = deactivate(root.right, level);
  else root.active = false;
  fix(root);
  return root;
}
function above(root: TreeNode | null, price: number): LiquidityLevel | null {
  if (!root || !root.activeCount) return null;
  if (root.level.price <= price) return above(root.right, price);
  return above(root.left, price) ??
    (root.active ? root.level : above(root.right, price));
}
function below(root: TreeNode | null, price: number): LiquidityLevel | null {
  if (!root || !root.activeCount) return null;
  if (root.level.price >= price) return below(root.left, price);
  return below(root.right, price) ??
    (root.active ? root.level : below(root.left, price));
}
class CausalPriceIndex {
  private root: TreeNode | null = null;
  activate(level: LiquidityLevel): void { this.root = insert(this.root, level); }
  deactivate(level: LiquidityLevel): void { this.root = deactivate(this.root, level); }
  nearest(direction: EntryCandidate["direction"], price: number):
    LiquidityLevel | null {
    return direction === "BULLISH" ? above(this.root, price) :
      below(this.root, price);
  }
}
function primaryDestination(level: LiquidityLevel): boolean {
  return level.timeframe !== "1m" || level.kind === "EQH" ||
    level.kind === "EQL" ||
    (level.side === "BSL" && level.sourceClassifications.includes("HH")) ||
    (level.side === "SSL" && level.sourceClassifications.includes("LL"));
}
function safePositiveRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) ||
      numerator <= 0 || denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) && value > 0 ? value : null;
}
function resolvedConfig(overrides: Partial<RiskValidationConfig>):
  Readonly<RiskValidationConfig> {
  const config = { ...DEFAULT_RISK_VALIDATION_CONFIG, ...overrides };
  for (const value of Object.values(config)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new RangeError("Invalid risk validation configuration");
    }
  }
  if (config.minRR <= 0 || config.minRoomAtr <= 0 ||
      config.minimumRiskAtr <= 0) {
    throw new RangeError("Invalid risk validation configuration");
  }
  return Object.freeze(config);
}
function diagnostics(): RiskDiagnostics {
  return { entryCandidatesConsumed: 0, structuralStopsFound: 0,
    stopValid: 0, invalidStop: 0, destinationFound: 0,
    noDestination: 0, roomPass: 0, insufficientRoom: 0,
    obstaclePass: 0, obstacleTooClose: 0, rrPass: 0,
    rrTooLow: 0, riskValid: 0, invalidated: 0,
    futureLiquidityExcluded: 0, futureStructureExcluded: 0,
    destinationTimeframes: { "1m": 0, "5m": 0, "15m": 0, "1h": 0 },
    rejectedByReason: { NO_CAUSAL_DESTINATION: 0,
      NO_STRUCTURAL_INVALIDATION: 0, STOP_WRONG_SIDE: 0,
      RISK_TOO_SMALL: 0, ROOM_TOO_SMALL: 0, OBSTACLE_TOO_CLOSE: 0,
      RR_BELOW_MINIMUM: 0, UPSTREAM_INVALIDATED: 0,
      FUTURE_LIQUIDITY_REJECTED: 0, FUTURE_STRUCTURE_REJECTED: 0,
      NO_REFERENCE_ATR: 0 },
    sumRiskAtr: 0, sumRewardAtr: 0, sumRawRR: 0,
    riskMetricCount: 0, rewardMetricCount: 0, rrMetricCount: 0 };
}
function timings(): RiskTimings {
  return { lineageLookupMs: 0, stopSelectionMs: 0,
    destinationLookupMs: 0, roomValidationMs: 0,
    rrCalculationMs: 0, totalMs: 0 };
}
type Stop = { price: number; source: StopSource; id: string };
export class RiskValidationInputError extends Error {
  constructor(readonly code: "INPUT_ORDER" | "INVALID_CONTEXT" |
    "INVALID_CANDIDATE" | "FUTURE_CONTEXT" | "DUPLICATE_ID") { super(code); }
}
export class RiskValidationEngine {
  readonly config: Readonly<RiskValidationConfig>;
  readonly validations: RiskValidation[] = [];
  readonly diagnostics = diagnostics();
  readonly timings = timings();
  private readonly all = { BSL: new CausalPriceIndex(),
    SSL: new CausalPriceIndex() };
  private readonly primary = { BSL: new CausalPriceIndex(),
    SSL: new CausalPriceIndex() };
  private readonly liquidityById = new Map<string, LiquidityLevel>();
  private readonly accepted = new Set<string>();
  private readonly swingsById = new Map<string, MarketSwing>();
  private readonly confirmationsById = new Map<string, StructuralConfirmationEvent>();
  private readonly interactionsById = new Map<string, LiquidityInteraction>();
  private readonly zonesById = new Map<string, FvgZone>();
  private readonly seenCandidateIds = new Set<string>();
  private latestHigh: MarketSwing | null = null;
  private latestLow: MarketSwing | null = null;
  private contextAt = -Infinity;
  private lastCandidateAt = -Infinity;
  constructor(config: Partial<RiskValidationConfig> = {}) {
    this.config = resolvedConfig(config);
  }
  updateMarketContext(input: { at: number;
    newLiquidity?: readonly LiquidityLevel[];
    newSwings?: readonly MarketSwing[];
    newConfirmations?: readonly StructuralConfirmationEvent[];
    newInteractions?: readonly LiquidityInteraction[];
    newFvgs?: readonly FvgZone[];
    newInteractionEvents?: readonly InteractionEvent[] }): void {
    const { at } = input;
    if (!Number.isSafeInteger(at) || at < this.contextAt) {
      throw new RiskValidationInputError("INPUT_ORDER");
    }
    const validAt = (availableAt: number): void => {
      if (!Number.isSafeInteger(availableAt) || availableAt > at) {
        throw new RiskValidationInputError("FUTURE_CONTEXT");
      }
    };
    for (const swing of input.newSwings ?? []) {
      validAt(swing.availableAt);
      if (this.swingsById.has(swing.id)) continue;
      if (swing.timeframe !== "1m" || !Number.isFinite(swing.price) ||
          swing.price <= 0) throw new RiskValidationInputError("INVALID_CONTEXT");
      this.swingsById.set(swing.id, swing);
      if (swing.type === "SWING_HIGH") {
        if (!this.latestHigh || swing.availableAt > this.latestHigh.availableAt ||
            (swing.availableAt === this.latestHigh.availableAt &&
              swing.id > this.latestHigh.id)) this.latestHigh = swing;
      } else if (swing.type === "SWING_LOW") {
        if (!this.latestLow || swing.availableAt > this.latestLow.availableAt ||
            (swing.availableAt === this.latestLow.availableAt &&
              swing.id > this.latestLow.id)) this.latestLow = swing;
      } else throw new RiskValidationInputError("INVALID_CONTEXT");
    }
    for (const event of input.newConfirmations ?? []) {
      validAt(event.availableAt);
      if (this.confirmationsById.has(event.id)) continue;
      this.confirmationsById.set(event.id, event);
    }
    for (const interaction of input.newInteractions ?? []) {
      validAt(interaction.completedAt);
      if (this.interactionsById.has(interaction.id)) continue;
      this.interactionsById.set(interaction.id, interaction);
    }
    for (const zone of input.newFvgs ?? []) {
      if (zone.qualifiedAt === null) throw new RiskValidationInputError("INVALID_CONTEXT");
      validAt(zone.qualifiedAt);
      if (this.zonesById.has(zone.id)) continue;
      this.zonesById.set(zone.id, zone);
    }
    for (const level of input.newLiquidity ?? []) {
      validAt(level.availableAt);
      if (this.liquidityById.has(level.id)) continue;
      if (!Number.isFinite(level.price) || level.price <= 0 ||
          (level.side !== "BSL" && level.side !== "SSL")) {
        throw new RiskValidationInputError("INVALID_CONTEXT");
      }
      this.liquidityById.set(level.id, level);
      if (!this.accepted.has(level.id)) {
        this.all[level.side].activate(level);
        if (primaryDestination(level)) this.primary[level.side].activate(level);
      }
    }
    for (const event of input.newInteractionEvents ?? []) {
      validAt(event.availableAt);
      if (event.type !== "ACCEPTANCE_CONFIRMED" ||
          this.accepted.has(event.liquidityId)) continue;
      this.accepted.add(event.liquidityId);
      const level = this.liquidityById.get(event.liquidityId);
      if (level) {
        this.all[level.side].deactivate(level);
        if (primaryDestination(level)) this.primary[level.side].deactivate(level);
      }
    }
    this.contextAt = at;
  }
  evaluate(candidate: EntryCandidate, candidateAtr: number | null = null):
    RiskValidation {
    const started = performance.now();
    if (!candidate || !candidate.id || !Number.isSafeInteger(candidate.availableAt) ||
        !Number.isFinite(candidate.entryPrice) || candidate.entryPrice <= 0 ||
        (candidate.direction !== "BULLISH" && candidate.direction !== "BEARISH")) {
      throw new RiskValidationInputError("INVALID_CANDIDATE");
    }
    if (candidate.availableAt !== this.contextAt ||
        candidate.availableAt < this.lastCandidateAt) {
      throw new RiskValidationInputError("INPUT_ORDER");
    }
    if (this.seenCandidateIds.has(candidate.id)) {
      throw new RiskValidationInputError("DUPLICATE_ID");
    }
    this.seenCandidateIds.add(candidate.id);
    this.lastCandidateAt = candidate.availableAt;
    this.diagnostics.entryCandidatesConsumed++;
    const referenceAtr = candidateAtr !== null && Number.isFinite(candidateAtr) &&
      candidateAtr > 0 ? candidateAtr : Number.isFinite(candidate.referenceAtr) &&
      candidate.referenceAtr > 0 ? candidate.referenceAtr : null;
    const result: RiskValidation = {
      id: `XAUUSD:1m:RISK:${candidate.id}`, entryCandidateId: candidate.id,
      direction: candidate.direction, availableAt: candidate.availableAt,
      entryPrice: candidate.entryPrice, structuralInvalidationPrice: null,
      stopPrice: null, stopSource: null, stopSourceId: null,
      stopBufferAtr: this.config.stopBufferAtr, referenceAtr,
      riskDistance: null, riskAtr: null, destinationLiquidityId: null,
      destinationType: null, destinationTimeframe: null, destinationPrice: null,
      roomToDestination: null, roomToDestinationAtr: null,
      nearestObstacleId: null, nearestObstaclePrice: null,
      roomToObstacle: null, roomToObstacleAtr: null,
      rewardDistance: null, rewardAtr: null, rawRR: null,
      executionAdjustedRR: null, executionCostStatus: "NOT_AVAILABLE",
      checks: { stopSide: null, minimumRisk: null, room: null,
        obstacleRoom: null, rr: null },
      status: "INVALIDATED", reasons: [],
      lineage: { liquidityId: candidate.liquidityId,
        interactionId: candidate.interactionId,
        controlTransferId: candidate.controlTransferId,
        displacementEventId: candidate.displacementEventId,
        structuralConfirmationId: candidate.structuralConfirmationId,
        fvgId: candidate.fvgId, entryCandidateId: candidate.id },
    };
    const reject = (status: RiskStatus, reason: RiskReason): RiskValidation => {
      result.status = status;
      result.reasons.push(reason);
      this.diagnostics.rejectedByReason[reason]++;
      if (status === "INVALID_STOP") this.diagnostics.invalidStop++;
      if (status === "NO_DESTINATION") this.diagnostics.noDestination++;
      if (status === "INSUFFICIENT_ROOM") this.diagnostics.insufficientRoom++;
      if (status === "OBSTACLE_TOO_CLOSE") this.diagnostics.obstacleTooClose++;
      if (status === "RR_TOO_LOW") this.diagnostics.rrTooLow++;
      if (status === "INVALIDATED") this.diagnostics.invalidated++;
      this.validations.push(result);
      this.timings.totalMs += performance.now() - started;
      return result;
    };
    let stage = performance.now();
    const confirmation = this.confirmationsById.get(candidate.structuralConfirmationId);
    const zone = this.zonesById.get(candidate.fvgId);
    const interaction = candidate.interactionId ?
      this.interactionsById.get(candidate.interactionId) : null;
    this.timings.lineageLookupMs += performance.now() - stage;
    if (candidate.status !== "CANDIDATE" || !confirmation || !zone ||
        confirmation.displacementEventId !== candidate.displacementEventId ||
        confirmation.direction !== candidate.direction ||
        confirmation.controlTransferId !== candidate.controlTransferId ||
        confirmation.interactionId !== candidate.interactionId ||
        confirmation.liquidityId !== candidate.liquidityId ||
        zone.structuralConfirmationId !== confirmation.id ||
        zone.direction !== candidate.direction ||
        zone.displacementEventId !== candidate.displacementEventId ||
        zone.qualifiedAt === null || zone.qualifiedAt > candidate.availableAt) {
      return reject("INVALIDATED", "UPSTREAM_INVALIDATED");
    }
    if (referenceAtr === null) return reject("INVALID_STOP", "NO_REFERENCE_ATR");
    stage = performance.now();
    const stop = this.chooseStop(candidate, confirmation, zone, interaction);
    this.timings.stopSelectionMs += performance.now() - stage;
    if (!stop) return reject("INVALID_STOP", "NO_STRUCTURAL_INVALIDATION");
    this.diagnostics.structuralStopsFound++;
    result.structuralInvalidationPrice = stop.price;
    result.stopSource = stop.source;
    result.stopSourceId = stop.id;
    const buffer = referenceAtr * this.config.stopBufferAtr;
    result.stopPrice = candidate.direction === "BULLISH" ?
      stop.price - buffer : stop.price + buffer;
    if (!Number.isFinite(result.stopPrice) || result.stopPrice <= 0) {
      result.stopPrice = null;
      return reject("INVALID_STOP", "STOP_WRONG_SIDE");
    }
    const risk = candidate.direction === "BULLISH" ?
      candidate.entryPrice - result.stopPrice : result.stopPrice - candidate.entryPrice;
    result.checks.stopSide = Number.isFinite(risk) && risk > 0;
    if (!result.checks.stopSide) return reject("INVALID_STOP", "STOP_WRONG_SIDE");
    result.riskDistance = risk;
    const riskAtr = safePositiveRatio(risk, referenceAtr);
    if (riskAtr === null) return reject("INVALID_STOP", "RISK_TOO_SMALL");
    result.riskAtr = riskAtr;
    result.checks.minimumRisk = { actual: riskAtr,
      required: this.config.minimumRiskAtr,
      pass: riskAtr >= this.config.minimumRiskAtr };
    if (!result.checks.minimumRisk.pass) return reject("INVALID_STOP", "RISK_TOO_SMALL");
    this.diagnostics.stopValid++;
    this.diagnostics.sumRiskAtr += riskAtr;
    this.diagnostics.riskMetricCount++;
    stage = performance.now();
    const side = candidate.direction === "BULLISH" ? "BSL" : "SSL";
    const destination = this.primary[side].nearest(candidate.direction,
      candidate.entryPrice) ?? this.all[side].nearest(candidate.direction,
      candidate.entryPrice);
    const nearest = this.all[side].nearest(candidate.direction, candidate.entryPrice);
    this.timings.destinationLookupMs += performance.now() - stage;
    if (!destination) return reject("NO_DESTINATION", "NO_CAUSAL_DESTINATION");
    this.diagnostics.destinationFound++;
    this.diagnostics.destinationTimeframes[destination.timeframe]++;
    result.destinationLiquidityId = destination.id;
    result.destinationType = destination.kind;
    result.destinationTimeframe = destination.timeframe;
    result.destinationPrice = destination.price;
    stage = performance.now();
    const room = candidate.direction === "BULLISH" ?
      destination.price - candidate.entryPrice :
      candidate.entryPrice - destination.price;
    if (!Number.isFinite(room) || room <= 0) {
      return reject("NO_DESTINATION", "NO_CAUSAL_DESTINATION");
    }
    result.roomToDestination = room;
    const roomAtr = safePositiveRatio(room, referenceAtr);
    if (roomAtr === null) return reject("INVALIDATED", "UPSTREAM_INVALIDATED");
    result.roomToDestinationAtr = roomAtr;
    result.rewardDistance = room;
    result.rewardAtr = roomAtr;
    this.diagnostics.sumRewardAtr += roomAtr;
    this.diagnostics.rewardMetricCount++;
    const rrStarted = performance.now();
    const rawRR = safePositiveRatio(room, risk);
    if (rawRR === null) {
      return reject("INVALID_STOP", "RISK_TOO_SMALL");
    }
    result.rawRR = rawRR;
    this.diagnostics.sumRawRR += rawRR;
    this.diagnostics.rrMetricCount++;
    result.checks.rr = { actual: rawRR, required: this.config.minRR,
      pass: rawRR >= this.config.minRR };
    this.timings.rrCalculationMs += performance.now() - rrStarted;
    result.checks.room = { actual: roomAtr,
      required: this.config.minRoomAtr,
      pass: roomAtr >= this.config.minRoomAtr };
    if (!result.checks.room.pass) {
      this.timings.roomValidationMs += performance.now() - stage;
      return reject("INSUFFICIENT_ROOM", "ROOM_TOO_SMALL");
    }
    this.diagnostics.roomPass++;
    if (nearest && nearest.id !== destination.id &&
        (candidate.direction === "BULLISH" ? nearest.price < destination.price :
          nearest.price > destination.price)) {
      result.nearestObstacleId = nearest.id;
      result.nearestObstaclePrice = nearest.price;
      result.roomToObstacle = candidate.direction === "BULLISH" ?
        nearest.price - candidate.entryPrice :
        candidate.entryPrice - nearest.price;
      const obstacleAtr = safePositiveRatio(result.roomToObstacle, referenceAtr);
      if (obstacleAtr === null) return reject("INVALIDATED", "UPSTREAM_INVALIDATED");
      result.roomToObstacleAtr = obstacleAtr;
      result.checks.obstacleRoom = { actual: obstacleAtr,
        required: this.config.minimumObstacleRoomAtr,
        pass: obstacleAtr >= this.config.minimumObstacleRoomAtr };
      if (!result.checks.obstacleRoom.pass) {
        this.timings.roomValidationMs += performance.now() - stage;
        return reject("OBSTACLE_TOO_CLOSE", "OBSTACLE_TOO_CLOSE");
      }
    }
    this.diagnostics.obstaclePass++;
    this.timings.roomValidationMs += performance.now() - stage;
    if (!result.checks.rr.pass) return reject("RR_TOO_LOW", "RR_BELOW_MINIMUM");
    this.diagnostics.rrPass++;
    this.diagnostics.riskValid++;
    result.status = "VALID";
    this.validations.push(result);
    this.timings.totalMs += performance.now() - started;
    return result;
  }
  private chooseStop(candidate: EntryCandidate,
    confirmation: StructuralConfirmationEvent, zone: FvgZone,
    interaction: LiquidityInteraction | null | undefined): Stop | null {
    const reversal = confirmation.type.endsWith("MSS");
    if (reversal && interaction &&
        interaction.completedAt <= candidate.availableAt &&
        interaction.id === candidate.interactionId &&
        (interaction.finalType === "SWEEP" || interaction.finalType === "RAID" ||
         interaction.finalType === "FAILED_BREAK" ||
         interaction.finalType === "REJECTION")) {
      const expectedSide = candidate.direction === "BULLISH" ? "SSL" : "BSL";
      if (interaction.liquiditySide === expectedSide) {
        const price = candidate.direction === "BULLISH" ?
          interaction.liquidityPrice - interaction.maxPenetration :
          interaction.liquidityPrice + interaction.maxPenetration;
        if (Number.isFinite(price) && price > 0) {
          return { price, source: "INTERACTION_EXTREME", id: interaction.id };
        }
      }
    }
    // Phase 3's protected ID is a final snapshot, so historical candidates use
    // its equivalent causal rule: the latest confirmed opposite-side swing.
    const swing = candidate.direction === "BULLISH" ?
      this.latestLow : this.latestHigh;
    if (swing && swing.availableAt <= candidate.availableAt) {
      return { price: swing.price, source: "STRUCTURAL_SWING", id: swing.id };
    }
    const edge = candidate.direction === "BULLISH" ? zone.lower : zone.upper;
    return Number.isFinite(edge) && edge > 0 ?
      { price: edge, source: "ZONE_INVALIDATION", id: zone.id } : null;
  }
}
export function createRiskValidationEngine(
  config: Partial<RiskValidationConfig> = {}): RiskValidationEngine {
  return new RiskValidationEngine(config);
}

type RiskSources = { psychology: CandlePsychologyResult;
  structure: MultiTimeframeStructureResult;
  liquidity: MultiTimeframeLiquidityResult;
  interaction: LiquidityInteractionResult;
  confirmation: StructuralConfirmationResult;
  fvg: FvgResult;
  entry: EntryCandidateResult };
const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h"];
function atrAt(features: CandlePsychologyResult["timeframes"]["1m"]["features"],
  timestamp: number): number | null {
  let left = 0; let right = features.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (features[middle].timestamp < timestamp) left = middle + 1;
    else right = middle;
  }
  const feature = features[left];
  return feature?.timestamp === timestamp && feature.atrReady &&
    feature.atr !== null && feature.atr > 0 ? feature.atr : null;
}
export function analyzeHistoricalRiskValidations(sources: RiskSources,
  overrides: Partial<RiskValidationConfig> = {}): RiskValidationResult {
  const engine = createRiskValidationEngine(overrides);
  const blocked = (code: string, index?: number): RiskValidationResult => {
    const counts = diagnostics();
    counts.errorCode = code;
    if (index !== undefined) counts.errorIndex = index;
    return { status: "BLOCKED", symbol: "XAUUSD", config: engine.config,
      validations: [], diagnostics: counts, timings: timings() };
  };
  const statuses = [sources.psychology.status, sources.structure.status,
    sources.liquidity.status, sources.interaction.status,
    sources.confirmation.status, sources.fvg.status, sources.entry.status];
  if (statuses.some((status) => status === "BLOCKED" || status === "FAILED")) {
    return blocked("UPSTREAM_DATA_STATUS");
  }
  const levels = TIMEFRAMES.flatMap((tf) => sources.liquidity.timeframes[tf].levels)
    .sort((a, b) => a.availableAt - b.availableAt ||
      a.timeframe.localeCompare(b.timeframe) || a.id.localeCompare(b.id));
  const swings = [...sources.structure.timeframes["1m"].swings]
    .sort((a, b) => a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  const confirmations = sources.confirmation.confirmations;
  const interactions = [...sources.interaction.completed]
    .sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id));
  const accepted = sources.interaction.events;
  const fvgById = new Map(sources.fvg.zones.map((zone) => [zone.id, zone]));
  const qualified = sources.fvg.events.filter((event) => event.type === "FVG_QUALIFIED");
  let l = 0; let s = 0; let c = 0; let x = 0; let a = 0; let f = 0;
  const started = performance.now();
  try {
    for (let i = 0; i < sources.entry.candidates.length; i++) {
      const candidate = sources.entry.candidates[i];
      const now = candidate.availableAt;
      const newLiquidity: LiquidityLevel[] = [];
      const newSwings: MarketSwing[] = [];
      const newConfirmations: StructuralConfirmationEvent[] = [];
      const newInteractions: LiquidityInteraction[] = [];
      const newAccepted: InteractionEvent[] = [];
      const newFvgs: FvgZone[] = [];
      while (l < levels.length && levels[l].availableAt <= now) {
        newLiquidity.push(levels[l++]);
      }
      while (s < swings.length && swings[s].availableAt <= now) {
        newSwings.push(swings[s++]);
      }
      while (c < confirmations.length && confirmations[c].availableAt <= now) {
        newConfirmations.push(confirmations[c++]);
      }
      while (x < interactions.length && interactions[x].completedAt <= now) {
        newInteractions.push(interactions[x++]);
      }
      while (a < accepted.length && accepted[a].availableAt <= now) {
        if (accepted[a].type === "ACCEPTANCE_CONFIRMED") newAccepted.push(accepted[a]);
        a++;
      }
      while (f < qualified.length && qualified[f].availableAt <= now) {
        const zone = fvgById.get(qualified[f++].zoneId);
        if (!zone) throw new RiskValidationInputError("INVALID_CONTEXT");
        newFvgs.push(zone);
      }
      engine.updateMarketContext({ at: now, newLiquidity, newSwings,
        newConfirmations, newInteractions, newFvgs,
        newInteractionEvents: newAccepted });
      engine.evaluate(candidate,
        atrAt(sources.psychology.timeframes["1m"].features, now));
    }
    engine.timings.totalMs = performance.now() - started;
    return { status: statuses.includes("WARN") ? "WARN" : "READY",
      symbol: "XAUUSD", config: engine.config,
      validations: engine.validations, diagnostics: engine.diagnostics,
      timings: engine.timings };
  } catch (error) {
    if (error instanceof RiskValidationInputError) {
      return blocked(error.code, engine.diagnostics.entryCandidatesConsumed);
    }
    throw error;
  }
}
