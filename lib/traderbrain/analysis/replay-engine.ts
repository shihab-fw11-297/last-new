import type { AggregateCandle, Candle, HistoricalResult, Timeframe } from "../data/types.ts";
import { MINUTE_MS } from "../data/types.ts";
import { createCandlePsychologyEngine, DEFAULT_CANDLE_PSYCHOLOGY_CONFIG,
  type CandlePsychologyConfig, type CandlePsychologyFeature } from "./candle-psychology.ts";
import { createMarketStructureEngine, DEFAULT_MARKET_STRUCTURE_CONFIG,
  type MarketStructureConfig, type MarketSwing, type StructureCurrent,
  type StructureEvent } from "./market-structure.ts";
import { createLiquidityEngine, DEFAULT_LIQUIDITY_CONFIG,
  type LiquidityConfig, type LiquidityLevel } from "./liquidity.ts";
import { createPriceApproachEngine, DEFAULT_PRICE_APPROACH_CONFIG,
  type ApproachCurrent, type ApproachTransition,
  type PriceApproachConfig } from "./price-approach.ts";
import { createLiquidityInteractionEngine, DEFAULT_LIQUIDITY_INTERACTION_CONFIG,
  type InteractionEvent, type LiquidityInteraction,
  type LiquidityInteractionConfig } from "./liquidity-interaction.ts";
import { createControlEngine, DEFAULT_CONTROL_CONFIG,
  type ControlConfig, type ControlSnapshot, type ControlStateChange,
  type ControlTransferEvent } from "./control-engine.ts";
import { createDisplacementEngine, DEFAULT_DISPLACEMENT_CONFIG,
  type ActiveDisplacement, type DisplacementConfig, type DisplacementEvent,
  type FailedDisplacementEvent, type IgnitionEvent } from "./displacement-engine.ts";
import { createStructuralConfirmationEngine, DEFAULT_STRUCTURAL_CONFIRMATION_CONFIG,
  type StructuralConfirmationConfig,
  type StructuralConfirmationEvent } from "./structural-confirmation.ts";
import { createFvgEngine, DEFAULT_FVG_CONFIG, type FvgConfig,
  type FvgLifecycleEvent, type FvgZone } from "./fvg-entry-location.ts";
import { createEntryCandidateEngine, DEFAULT_ENTRY_CANDIDATE_CONFIG,
  type EntryCandidate, type EntryCandidateConfig, type EntryEpisode,
  type EntryStateEvent } from "./entry-candidate.ts";
import { createRiskValidationEngine, DEFAULT_RISK_VALIDATION_CONFIG,
  type RiskValidation, type RiskValidationConfig } from "./risk-validation.ts";
import { createSignalDecisionEngine, type CompressionEvidence,
  type Signal, type SignalDecision } from "./signal-decision.ts";
import { createSignalLedger, type LifecycleEvent,
  type SignalRecord } from "./signal-ledger.ts";

export const REPLAY_ENGINE_VERSION = "phase15-v1";
const TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const;
const DERIVED_TIMEFRAMES = ["5m", "15m", "1h"] as const;

export type ReplayStatus = "READY" | "RUNNING" | "PAUSED" | "COMPLETED" | "BLOCKED";
export type ReplayPipelineConfig = {
  psychology?: Partial<CandlePsychologyConfig>;
  structure?: Partial<MarketStructureConfig>;
  liquidity?: Partial<LiquidityConfig>;
  approach?: Partial<PriceApproachConfig>;
  interaction?: Partial<LiquidityInteractionConfig>;
  control?: Partial<ControlConfig>;
  displacement?: Partial<DisplacementConfig>;
  confirmation?: Partial<StructuralConfirmationConfig>;
  fvg?: Partial<FvgConfig>;
  entry?: Partial<EntryCandidateConfig>;
  risk?: Partial<RiskValidationConfig>;
};
export type CreateReplaySessionInput = {
  dataset: HistoricalResult;
  start: number;
  end: number;
  config?: ReplayPipelineConfig;
  expectedDatasetFingerprint?: string;
  expectedConfigHash?: string;
};
export type ReplayBlock = { phase: string; timestamp: number | null; reason: string };
export type ReplayDiagnostics = {
  warmupCandles: number;
  replayCandles: number;
  resetCount: number;
  backwardSeeks: number;
  totalStepMs: number;
  maximumStepMs: number;
  blocked: ReplayBlock | null;
};
export type ReplayCandleView = Readonly<Pick<Candle,
  "timestamp" | "open" | "high" | "low" | "close" | "volume">>;
export type ReplaySnapshot = Readonly<{
  timestamp: number;
  index: number;
  price: number;
  candle: ReplayCandleView;
  timeframeState: Readonly<Record<Timeframe, Readonly<{
    timestamp: number | null; close: number | null; complete: boolean; processed: number;
  }>>>;
  structure: Readonly<Record<Timeframe, StructureCurrent>>;
  nearestLiquidity: ApproachCurrent;
  approach: ApproachCurrent;
  interaction: Readonly<{ active: number; latestEvent: InteractionEvent | null;
    latestCompleted: LiquidityInteraction | null }>;
  control: ControlSnapshot;
  displacement: Readonly<{ active: ActiveDisplacement | null;
    latestConfirmed: DisplacementEvent | null }>;
  structuralConfirmation: StructuralConfirmationEvent | null;
  entryLocation: Readonly<{ latestRaw: FvgZone | null; latestQualified: FvgZone | null }>;
  entryCandidate: EntryCandidate | null;
  riskValidation: RiskValidation | null;
  decision: SignalDecision | null;
  latestSignal: SignalRecord | null;
  signalLifecycle: SignalRecord["lifecycle"] | null;
}>;
export type ReplayEventDelta = Readonly<{
  candle: ReplayCandleView;
  structure: readonly StructureEvent[];
  liquidity: readonly LiquidityLevel[];
  interaction: readonly InteractionEvent[];
  controlTransfers: readonly ControlTransferEvent[];
  displacement: readonly DisplacementEvent[];
  confirmations: readonly StructuralConfirmationEvent[];
  fvg: readonly FvgLifecycleEvent[];
  entries: readonly EntryCandidate[];
  risks: readonly RiskValidation[];
  decisions: readonly SignalDecision[];
  signals: readonly Signal[];
  lifecycle: readonly LifecycleEvent[];
}>;
export type ReplayStepResult = Readonly<{ snapshot: ReplaySnapshot; newEvents: ReplayEventDelta }>;

type SourceCandle = Candle | AggregateCandle;
type Pipeline = ReturnType<typeof makePipeline>;

export type ReplayArtifacts = Readonly<{
  psychology: Readonly<Record<Timeframe, readonly CandlePsychologyFeature[]>>;
  structureSwings: Readonly<Record<Timeframe, readonly MarketSwing[]>>;
  structureEvents: Readonly<Record<Timeframe, readonly StructureEvent[]>>;
  liquidity: Readonly<Record<Timeframe, readonly LiquidityLevel[]>>;
  approachTransitions: readonly ApproachTransition[];
  interactionEvents: readonly InteractionEvent[];
  interactions: readonly LiquidityInteraction[];
  controlStateChanges: readonly ControlStateChange[];
  controlTransfers: readonly ControlTransferEvent[];
  ignitions: readonly IgnitionEvent[];
  displacements: readonly DisplacementEvent[];
  failedDisplacements: readonly FailedDisplacementEvent[];
  confirmations: readonly StructuralConfirmationEvent[];
  fvgZones: readonly FvgZone[];
  fvgEvents: readonly FvgLifecycleEvent[];
  entryEvents: readonly EntryStateEvent[];
  entryCandidates: readonly EntryCandidate[];
  entryEpisodes: readonly EntryEpisode[];
  riskValidations: readonly RiskValidation[];
  decisions: readonly SignalDecision[];
  signals: readonly Signal[];
  lifecycle: readonly LifecycleEvent[];
}>;

export type ReplayDivergence = Readonly<{ phase: string; index: number;
  timestamp: number | null; expected: unknown; actual: unknown }>;

export class ReplayInputError extends Error {
  constructor(readonly code: "UPSTREAM_DATA_STATUS" | "INVALID_RANGE" |
    "EMPTY_RANGE" | "INVALID_DATASET" | "DATASET_IDENTITY_MISMATCH" |
    "CONFIG_IDENTITY_MISMATCH") { super(code); }
}

function lowerBound(candles: readonly Candle[], timestamp: number): number {
  let left = 0; let right = candles.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (candles[middle].timestamp < timestamp) left = middle + 1;
    else right = middle;
  }
  return left;
}
function upperBound(candles: readonly Candle[], timestamp: number): number {
  let left = 0; let right = candles.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (candles[middle].timestamp <= timestamp) left = middle + 1;
    else right = middle;
  }
  return left;
}

function hashParts(parts: Iterable<string>): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const code = part.charCodeAt(i);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
    }
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
export function deterministicValueHash(value: unknown): string {
  return hashParts([canonical(value)]);
}
export function fingerprintHistoricalDataset(dataset: HistoricalResult): string {
  function* parts(): Generator<string> {
    yield `${dataset.symbol}|${dataset.requestedRange.start}|${dataset.requestedRange.end}|`;
    for (const candle of dataset.candles1m) {
      yield `${candle.timestamp},${candle.open},${candle.high},${candle.low},${candle.close},${candle.volume ?? "n"};`;
    }
    for (const timeframe of DERIVED_TIMEFRAMES) {
      yield `|${timeframe}|`;
      for (const candle of dataset.timeframes[timeframe]) {
        yield `${candle.timestamp},${candle.open},${candle.high},${candle.low},${candle.close},${candle.volume ?? "n"},${candle.bucketEnd},${candle.sourceCount},${candle.isComplete ? 1 : 0};`;
      }
    }
  }
  return `xauusd-${hashParts(parts())}`;
}

function resolvedConfig(config: ReplayPipelineConfig): Record<string, unknown> {
  return {
    psychology: { ...DEFAULT_CANDLE_PSYCHOLOGY_CONFIG, ...config.psychology },
    structure: { ...DEFAULT_MARKET_STRUCTURE_CONFIG, ...config.structure },
    liquidity: { ...DEFAULT_LIQUIDITY_CONFIG, ...config.liquidity },
    approach: { ...DEFAULT_PRICE_APPROACH_CONFIG, ...config.approach },
    interaction: { ...DEFAULT_LIQUIDITY_INTERACTION_CONFIG, ...config.interaction },
    control: { ...DEFAULT_CONTROL_CONFIG, ...config.control },
    displacement: { ...DEFAULT_DISPLACEMENT_CONFIG, ...config.displacement },
    confirmation: { ...DEFAULT_STRUCTURAL_CONFIRMATION_CONFIG, ...config.confirmation },
    fvg: { ...DEFAULT_FVG_CONFIG, ...config.fvg },
    entry: { ...DEFAULT_ENTRY_CANDIDATE_CONFIG, ...config.entry },
    risk: { ...DEFAULT_RISK_VALIDATION_CONFIG, ...config.risk },
  };
}
function copyConfig(config: ReplayPipelineConfig): ReplayPipelineConfig {
  return { psychology: config.psychology ? { ...config.psychology } : undefined,
    structure: config.structure ? { ...config.structure } : undefined,
    liquidity: config.liquidity ? { ...config.liquidity } : undefined,
    approach: config.approach ? { ...config.approach } : undefined,
    interaction: config.interaction ? { ...config.interaction } : undefined,
    control: config.control ? { ...config.control } : undefined,
    displacement: config.displacement ? { ...config.displacement } : undefined,
    confirmation: config.confirmation ? { ...config.confirmation } : undefined,
    fvg: config.fvg ? { ...config.fvg } : undefined,
    entry: config.entry ? { ...config.entry } : undefined,
    risk: config.risk ? { ...config.risk } : undefined };
}
export function fingerprintReplayConfig(config: ReplayPipelineConfig = {}): string {
  return `${REPLAY_ENGINE_VERSION}-${hashParts([canonical(resolvedConfig(config))])}`;
}

function makePipeline(config: ReplayPipelineConfig) {
  const psychology = Object.fromEntries(TIMEFRAMES.map((timeframe) =>
    [timeframe, createCandlePsychologyEngine(timeframe, config.psychology)])) as
    Record<Timeframe, ReturnType<typeof createCandlePsychologyEngine>>;
  const structure = Object.fromEntries(TIMEFRAMES.map((timeframe) =>
    [timeframe, createMarketStructureEngine(timeframe, config.structure)])) as
    Record<Timeframe, ReturnType<typeof createMarketStructureEngine>>;
  const liquidity = Object.fromEntries(TIMEFRAMES.map((timeframe) =>
    [timeframe, createLiquidityEngine(timeframe, config.liquidity)])) as
    Record<Timeframe, ReturnType<typeof createLiquidityEngine>>;
  return { psychology, structure, liquidity,
    features: { "1m": [], "5m": [], "15m": [], "1h": [] } as
      Record<Timeframe, CandlePsychologyFeature[]>,
    latestSource: { "1m": null, "5m": null, "15m": null, "1h": null } as
      Record<Timeframe, SourceCandle | null>,
    aggregateCursor: { "5m": 0, "15m": 0, "1h": 0 } as
      Record<Exclude<Timeframe, "1m">, number>,
    approach: createPriceApproachEngine(config.approach),
    interaction: createLiquidityInteractionEngine(config.interaction),
    control: createControlEngine(config.control),
    displacement: createDisplacementEngine(config.displacement),
    confirmation: createStructuralConfirmationEngine(config.confirmation),
    fvg: createFvgEngine(config.fvg),
    entry: createEntryCandidateEngine(config.entry),
    risk: createRiskValidationEngine(config.risk),
    signal: createSignalDecisionEngine(), ledger: createSignalLedger(),
    lastCompressed: new Map<string, number>(),
    zoneById: new Map<string, FvgZone>(),
    latestQualifiedZoneId: null as string | null,
  };
}

function validCandle(candle: Candle): boolean {
  return candle.symbol === "XAUUSD" && candle.timeframe === "1m" &&
    Number.isSafeInteger(candle.timestamp) && candle.low > 0 &&
    [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.low <= candle.open && candle.low <= candle.close &&
    candle.high >= candle.open && candle.high >= candle.close;
}
function availableAt(candle: SourceCandle): number {
  return "bucketEnd" in candle ? candle.bucketEnd - MINUTE_MS : candle.timestamp;
}
function candleView(candle: Candle): ReplayCandleView {
  return Object.freeze({ timestamp: candle.timestamp, open: candle.open,
    high: candle.high, low: candle.low, close: candle.close, volume: candle.volume });
}
function eventTimestamp(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  for (const key of ["availableAt", "timestamp", "qualifiedAt", "completedAt", "createdAt"]) {
    if (typeof item[key] === "number") return item[key];
  }
  return null;
}

export function findFirstReplayDivergence(
  expected: Record<string, readonly unknown[]>,
  actual: Record<string, readonly unknown[]>): ReplayDivergence | null {
  const phases = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const phase of phases) {
    const left = expected[phase] ?? [];
    const right = actual[phase] ?? [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
      if (canonical(left[index]) !== canonical(right[index])) {
        return Object.freeze({ phase, index,
          timestamp: eventTimestamp(right[index] ?? left[index]),
          expected: left[index], actual: right[index] });
      }
    }
  }
  return null;
}

export class ReplaySession {
  readonly datasetFingerprint: string;
  readonly configHash: string;
  readonly engineVersion = REPLAY_ENGINE_VERSION;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly diagnostics: ReplayDiagnostics = { warmupCandles: 0,
    replayCandles: 0, resetCount: 0, backwardSeeks: 0,
    totalStepMs: 0, maximumStepMs: 0, blocked: null };
  status: ReplayStatus = "READY";
  currentIndex: number;
  currentTimestamp: number | null = null;
  private pipeline: Pipeline;
  private latest: ReplayStepResult | null = null;
  private readonly config: ReplayPipelineConfig;
  private warming = false;

  constructor(private readonly dataset: HistoricalResult,
    start: number, end: number, config: ReplayPipelineConfig = {},
    expectedDatasetFingerprint?: string, expectedConfigHash?: string) {
    if (dataset.status === "BLOCKED" || dataset.status === "FAILED") {
      throw new ReplayInputError("UPSTREAM_DATA_STATUS");
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) {
      throw new ReplayInputError("INVALID_RANGE");
    }
    this.validateDataset();
    this.startIndex = lowerBound(dataset.candles1m, start);
    this.endIndex = lowerBound(dataset.candles1m, end);
    if (this.startIndex >= this.endIndex) throw new ReplayInputError("EMPTY_RANGE");
    this.config = copyConfig(config);
    this.datasetFingerprint = fingerprintHistoricalDataset(dataset);
    this.configHash = fingerprintReplayConfig(this.config);
    if (expectedDatasetFingerprint && expectedDatasetFingerprint !== this.datasetFingerprint) {
      throw new ReplayInputError("DATASET_IDENTITY_MISMATCH");
    }
    if (expectedConfigHash && expectedConfigHash !== this.configHash) {
      throw new ReplayInputError("CONFIG_IDENTITY_MISMATCH");
    }
    this.pipeline = makePipeline(this.config);
    this.currentIndex = this.startIndex - 1;
    this.warmup();
  }

  private validateDataset(): void {
    let previous = -Infinity;
    for (const candle of this.dataset.candles1m) {
      if (!validCandle(candle) || candle.timestamp <= previous) {
        throw new ReplayInputError("INVALID_DATASET");
      }
      previous = candle.timestamp;
    }
  }

  private warmup(): void {
    this.warming = true;
    for (let index = 0; index < this.startIndex; index++) {
      this.process(index);
      if (this.status === "BLOCKED") break;
      this.diagnostics.warmupCandles++;
    }
    this.warming = false;
    this.currentIndex = this.startIndex - 1;
    this.currentTimestamp = null;
    this.latest = null;
    if (this.status !== "BLOCKED") this.status = "READY";
  }

  private block(phase: string, timestamp: number, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.status = "BLOCKED";
    this.diagnostics.blocked = { phase, timestamp, reason };
  }

  private runStage<T>(phase: string, timestamp: number, run: () => T): T {
    try { return run(); }
    catch (error) { this.block(phase, timestamp, error); throw error; }
  }

  private pushSource(timeframe: Timeframe, source: SourceCandle,
    newLiquidity: LiquidityLevel[], newStructure: StructureEvent[]): void {
    const p = this.pipeline;
    const swingBefore = p.structure[timeframe].swings.length;
    const eventBefore = p.structure[timeframe].events.length;
    const feature = p.psychology[timeframe].push(source);
    p.features[timeframe].push(feature);
    p.latestSource[timeframe] = source;
    p.structure[timeframe].push(source, feature);
    newStructure.push(...p.structure[timeframe].events.slice(eventBefore));
    const swings = p.structure[timeframe].swings;
    for (let index = swingBefore; index < swings.length; index++) {
      const swing = swings[index];
      const origin = p.features[timeframe][swing.sourceIndex];
      newLiquidity.push(...p.liquidity[timeframe].pushSwing(swing, origin));
    }
  }

  private process(index: number): ReplayStepResult | null {
    const started = performance.now();
    const candle = this.dataset.candles1m[index];
    if (!candle || !validCandle(candle)) {
      this.block("PHASE_1", candle?.timestamp ?? -1,
        new Error("INVALID_CANDLE"));
      return null;
    }
    const at = candle.timestamp;
    const p = this.pipeline;
    const newStructure: StructureEvent[] = [];
    const newLiquidity: LiquidityLevel[] = [];
    const oneMinuteSwingBefore = p.structure["1m"].swings.length;
    try {
      this.runStage("PHASE_2_4", at, () => {
        this.pushSource("1m", candle, newLiquidity, newStructure);
        for (const timeframe of DERIVED_TIMEFRAMES) {
          const candles = this.dataset.timeframes[timeframe];
          while (p.aggregateCursor[timeframe] < candles.length &&
              availableAt(candles[p.aggregateCursor[timeframe]]) <= at) {
            this.pushSource(timeframe, candles[p.aggregateCursor[timeframe]++],
              newLiquidity, newStructure);
          }
        }
      });
      const feature = p.features["1m"].at(-1)!;
      const approach = this.runStage("PHASE_5", at, () =>
        p.approach.push({ candle, psychology: feature, newLiquidity }));
      const compression: CompressionEvidence[] = [];
      for (const timeframe of TIMEFRAMES) {
        for (const item of [approach[timeframe].above, approach[timeframe].below]) {
          if (item?.behaviorClass !== "COMPRESSED") continue;
          const previous = p.lastCompressed.get(item.liquidityId);
          if (previous !== item.timestamp - MINUTE_MS) {
            compression.push({ liquidityId: item.liquidityId,
              sourceTimeframe: item.sourceTimeframe,
              timestamp: item.timestamp, behaviorClass: "COMPRESSED" });
          }
          p.lastCompressed.set(item.liquidityId, item.timestamp);
        }
      }
      const interactionEventBefore = p.interaction.events.length;
      const interactionBefore = p.interaction.completed.length;
      this.runStage("PHASE_6", at, () =>
        p.interaction.push({ candle, psychology: feature, current: approach }));
      const newInteractionEvents = p.interaction.events.slice(interactionEventBefore);
      const newInteractions = p.interaction.completed.slice(interactionBefore);
      const transferBefore = p.control.transfers.length;
      this.runStage("PHASE_7", at, () => p.control.push({ candle,
        psychology: feature, interactionEvents: p.interaction.events,
        structureEvents: p.structure["1m"].events }));
      const newTransfers = p.control.transfers.slice(transferBefore);
      const displacementBefore = p.displacement.confirmed.length;
      this.runStage("PHASE_8", at, () => p.displacement.push({ candle,
        psychology: feature, control: p.control.current,
        controlTransferEvents: p.control.transfers }));
      const newDisplacements = p.displacement.confirmed.slice(displacementBefore);
      const confirmationBefore = p.confirmation.confirmations.length;
      this.runStage("PHASE_9", at, () => p.confirmation.push({ timestamp: at,
        structureEvents: p.structure["1m"].events,
        controlTransferEvents: p.control.transfers,
        displacementEvents: p.displacement.confirmed,
        currentControl: p.control.current }));
      const newConfirmations = p.confirmation.confirmations.slice(confirmationBefore);
      const zoneBefore = p.fvg.zones.length;
      const fvgEvents = this.runStage("PHASE_10", at, () => p.fvg.push({ candle,
        psychology: feature, displacementEvents: newDisplacements,
        structuralConfirmations: newConfirmations }));
      for (let zoneIndex = zoneBefore; zoneIndex < p.fvg.zones.length; zoneIndex++) {
        const zone = p.fvg.zones[zoneIndex];
        p.zoneById.set(zone.id, zone);
      }
      const newZones: FvgZone[] = [];
      for (const event of fvgEvents) {
        if (event.type !== "FVG_QUALIFIED") continue;
        const zone = p.zoneById.get(event.zoneId);
        if (!zone) throw new Error("QUALIFIED_ZONE_MISSING");
        newZones.push(zone);
        p.latestQualifiedZoneId = zone.id;
      }
      const candidateBefore = p.entry.candidates.length;
      this.runStage("PHASE_11", at, () => p.entry.push({ candle,
        psychology: feature, control: { timestamp: at,
          state: p.control.current.state,
          lastTransferId: p.control.current.lastTransferId },
        newZones, zoneUpdates: fvgEvents }));
      const newCandidates = p.entry.candidates.slice(candidateBefore);
      this.runStage("PHASE_12", at, () => p.risk.updateMarketContext({ at,
        newLiquidity, newSwings: p.structure["1m"].swings.slice(oneMinuteSwingBefore),
        newConfirmations,
        newInteractions, newFvgs: newZones,
        newInteractionEvents: newInteractionEvents.filter((event) =>
          event.type === "ACCEPTANCE_CONFIRMED") }));
      const newRisks = newCandidates.map((candidate) =>
        this.runStage("PHASE_12", at, () => p.risk.evaluate(candidate,
          feature.atrReady ? feature.atr : null)));
      const signalBefore = p.signal.signals.length;
      const newDecisions = this.runStage("PHASE_13", at, () => p.signal.push({ at,
        newCandidates, newRisks, newConfirmations,
        newDisplacements, newTransfers, newInteractions,
        newInteractionEvents, newLiquidity, newZones,
        newCompression: compression }));
      const newSignals = p.signal.signals.slice(signalBefore);
      const lifecycleBefore = p.ledger.lifecycleEventCount;
      this.runStage("PHASE_14", at, () =>
        p.ledger.push({ candle, newSignals }));
      const lifecycle = p.ledger.getLifecycleEventsSince(lifecycleBefore, at);
      const result = this.makeResult(index, candle, newStructure, newLiquidity,
        newInteractionEvents, newTransfers, newDisplacements, newConfirmations,
        fvgEvents, newCandidates, newRisks, newDecisions, newSignals, lifecycle);
      const elapsed = performance.now() - started;
      if (!this.warming) {
        this.diagnostics.replayCandles++;
        this.diagnostics.totalStepMs += elapsed;
        this.diagnostics.maximumStepMs = Math.max(this.diagnostics.maximumStepMs, elapsed);
      }
      return result;
    } catch {
      return null;
    }
  }

  private makeResult(index: number, candle: Candle,
    structure: readonly StructureEvent[], liquidity: readonly LiquidityLevel[],
    interaction: readonly InteractionEvent[],
    transfers: readonly ControlTransferEvent[],
    displacement: readonly DisplacementEvent[],
    confirmations: readonly StructuralConfirmationEvent[],
    fvg: readonly FvgLifecycleEvent[], entries: readonly EntryCandidate[],
    risks: readonly RiskValidation[], decisions: readonly SignalDecision[],
    signals: readonly Signal[], lifecycle: readonly LifecycleEvent[]): ReplayStepResult {
    const p = this.pipeline;
    const sourceState = Object.fromEntries(TIMEFRAMES.map((timeframe) => {
      const source = p.latestSource[timeframe];
      return [timeframe, Object.freeze({ timestamp: source?.timestamp ?? null,
        close: source?.close ?? null,
        complete: source ? !("isComplete" in source) || source.isComplete : false,
        processed: p.features[timeframe].length })];
    })) as ReplaySnapshot["timeframeState"];
    const latestQualified = p.latestQualifiedZoneId ?
      p.zoneById.get(p.latestQualifiedZoneId) ?? null : null;
    const latestSignal = p.ledger.getLatestSignal(candle.timestamp);
    const snapshot = Object.freeze({ timestamp: candle.timestamp, index,
      price: candle.close, candle: candleView(candle), timeframeState: sourceState,
      structure: Object.fromEntries(TIMEFRAMES.map((timeframe) =>
        [timeframe, p.structure[timeframe].current])) as ReplaySnapshot["structure"],
      nearestLiquidity: p.approach.current, approach: p.approach.current,
      interaction: Object.freeze({ active: p.interaction.activeCount,
        latestEvent: p.interaction.events.at(-1) ?? null,
        latestCompleted: p.interaction.completed.at(-1) ?? null }),
      control: p.control.current,
      displacement: Object.freeze({ active: p.displacement.active,
        latestConfirmed: p.displacement.confirmed.at(-1) ?? null }),
      structuralConfirmation: p.confirmation.confirmations.at(-1) ?? null,
      entryLocation: Object.freeze({ latestRaw: p.fvg.zones.at(-1) ?? null,
        latestQualified }),
      entryCandidate: p.entry.candidates.at(-1) ?? null,
      riskValidation: p.risk.validations.at(-1) ?? null,
      decision: p.signal.decisions.at(-1) ?? null,
      latestSignal, signalLifecycle: latestSignal?.lifecycle ?? null,
    }) as ReplaySnapshot;
    const newEvents = Object.freeze({ candle: candleView(candle),
      structure: Object.freeze([...structure]), liquidity: Object.freeze([...liquidity]),
      interaction: Object.freeze([...interaction]),
      controlTransfers: Object.freeze([...transfers]),
      displacement: Object.freeze([...displacement]),
      confirmations: Object.freeze([...confirmations]), fvg: Object.freeze([...fvg]),
      entries: Object.freeze([...entries]), risks: Object.freeze([...risks]),
      decisions: Object.freeze([...decisions]), signals: Object.freeze([...signals]),
      lifecycle: Object.freeze([...lifecycle]) }) as ReplayEventDelta;
    return Object.freeze({ snapshot, newEvents });
  }

  step(): ReplayStepResult | null {
    if (this.status === "BLOCKED" || this.status === "COMPLETED" ||
        this.status === "PAUSED") return null;
    const next = this.currentIndex + 1;
    if (next >= this.endIndex) { this.status = "COMPLETED"; return null; }
    this.status = "RUNNING";
    const result = this.process(next);
    if (!result) return null;
    this.currentIndex = next;
    this.currentTimestamp = result.snapshot.timestamp;
    this.latest = result;
    if (this.currentIndex === this.endIndex - 1) this.status = "COMPLETED";
    return result;
  }

  runTo(timestamp: number): ReplayStepResult | null {
    if (!Number.isSafeInteger(timestamp)) throw new ReplayInputError("INVALID_RANGE");
    const target = Math.min(this.endIndex - 1,
      upperBound(this.dataset.candles1m, timestamp) - 1);
    if (target < this.startIndex) {
      if (this.currentIndex >= this.startIndex) this.reset();
      return null;
    }
    if (target < this.currentIndex) {
      this.diagnostics.backwardSeeks++;
      this.reset();
    }
    if (this.status === "PAUSED") return this.latest;
    while (this.currentIndex < target && this.status !== "BLOCKED") this.step();
    return this.latest;
  }

  runToEnd(): ReplayStepResult | null {
    if (this.status === "PAUSED") return this.latest;
    while (this.currentIndex < this.endIndex - 1 && this.status !== "BLOCKED") this.step();
    return this.latest;
  }

  pause(): void {
    if (this.status === "RUNNING" || this.status === "READY") this.status = "PAUSED";
  }
  resume(datasetFingerprint = this.datasetFingerprint,
    configHash = this.configHash): void {
    if (datasetFingerprint !== this.datasetFingerprint ||
        fingerprintHistoricalDataset(this.dataset) !== this.datasetFingerprint) {
      this.status = "BLOCKED";
      this.diagnostics.blocked = { phase: "IDENTITY", timestamp: this.currentTimestamp,
        reason: "DATASET_IDENTITY_MISMATCH" };
      return;
    }
    if (configHash !== this.configHash ||
        fingerprintReplayConfig(this.config) !== this.configHash) {
      this.status = "BLOCKED";
      this.diagnostics.blocked = { phase: "IDENTITY", timestamp: this.currentTimestamp,
        reason: "CONFIG_IDENTITY_MISMATCH" };
      return;
    }
    if (this.status === "PAUSED") this.status = this.currentIndex >= this.endIndex - 1 ?
      "COMPLETED" : this.currentIndex < this.startIndex ? "READY" : "RUNNING";
  }

  reset(): void {
    if (fingerprintHistoricalDataset(this.dataset) !== this.datasetFingerprint) {
      this.status = "BLOCKED";
      this.diagnostics.blocked = { phase: "IDENTITY", timestamp: this.currentTimestamp,
        reason: "DATASET_IDENTITY_MISMATCH" };
      return;
    }
    if (fingerprintReplayConfig(this.config) !== this.configHash) {
      this.status = "BLOCKED";
      this.diagnostics.blocked = { phase: "IDENTITY", timestamp: this.currentTimestamp,
        reason: "CONFIG_IDENTITY_MISMATCH" };
      return;
    }
    this.pipeline = makePipeline(this.config);
    this.currentIndex = this.startIndex - 1;
    this.currentTimestamp = null;
    this.latest = null;
    this.status = "READY";
    this.diagnostics.resetCount++;
    this.diagnostics.blocked = null;
    this.warmup();
  }

  getSnapshot(): ReplaySnapshot | null { return this.latest?.snapshot ?? null; }

  getArtifacts(): ReplayArtifacts {
    const p = this.pipeline;
    const record = <T>(select: (timeframe: Timeframe) => readonly T[]) =>
      Object.fromEntries(TIMEFRAMES.map((timeframe) =>
        [timeframe, Object.freeze([...select(timeframe)])])) as Record<Timeframe, readonly T[]>;
    return Object.freeze({ psychology: record((tf) => p.features[tf]),
      structureSwings: record((tf) => p.structure[tf].swings),
      structureEvents: record((tf) => p.structure[tf].events),
      liquidity: record((tf) => p.liquidity[tf].levels),
      approachTransitions: Object.freeze([...p.approach.transitions]),
      interactionEvents: Object.freeze([...p.interaction.events]),
      interactions: Object.freeze([...p.interaction.completed]),
      controlStateChanges: Object.freeze([...p.control.stateChanges]),
      controlTransfers: Object.freeze([...p.control.transfers]),
      ignitions: Object.freeze([...p.displacement.ignitions]),
      displacements: Object.freeze([...p.displacement.confirmed]),
      failedDisplacements: Object.freeze([...p.displacement.failed]),
      confirmations: Object.freeze([...p.confirmation.confirmations]),
      fvgZones: Object.freeze([...p.fvg.zones]), fvgEvents: Object.freeze([...p.fvg.events]),
      entryEvents: Object.freeze([...p.entry.events]),
      entryCandidates: Object.freeze([...p.entry.candidates]),
      entryEpisodes: Object.freeze([...p.entry.episodes]),
      riskValidations: Object.freeze([...p.risk.validations]),
      decisions: Object.freeze([...p.signal.decisions]),
      signals: Object.freeze([...p.signal.signals]),
      lifecycle: p.ledger.getLifecycleEventsThrough(Infinity) });
  }

  getResultFingerprint(): string {
    return `replay-${hashParts([canonical(this.getArtifacts())])}`;
  }
}

export function createReplaySession(input: CreateReplaySessionInput): ReplaySession {
  return new ReplaySession(input.dataset, input.start, input.end,
    input.config ?? {}, input.expectedDatasetFingerprint,
    input.expectedConfigHash);
}
