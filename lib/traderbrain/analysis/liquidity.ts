import type { DataStatus, Timeframe } from "../data/types.ts";
import type { CandlePsychologyFeature, CandlePsychologyResult } from "./candle-psychology.ts";
import type { MarketStructureResult, MarketSwing, MultiTimeframeStructureResult, SwingClassification } from "./market-structure.ts";

type AtrSource = Pick<CandlePsychologyFeature, "timestamp" | "timeframe" | "atr" | "atrReady">;
export type LiquiditySide = "BSL" | "SSL";
export type LiquidityKind = "SWING" | "EQH" | "EQL";

export type LiquidityConfig = {
  equalLevelToleranceAtr: number;
  equalLevelCandidateLimit: number;
};

export const DEFAULT_LIQUIDITY_CONFIG: Readonly<LiquidityConfig> = Object.freeze({
  equalLevelToleranceAtr: 0.1,
  equalLevelCandidateLimit: 8,
});

export type LiquidityLevel = {
  id: string;
  timeframe: Timeframe;
  side: LiquiditySide;
  kind: LiquidityKind;
  price: number;
  createdAt: number;
  availableAt: number;
  sourceSwingIds: readonly string[];
  sourceClassifications: readonly SwingClassification[];
  sourceTimeframe: Timeframe;
};

export type LiquidityLatest = {
  latestBSLId: string | null;
  latestSSLId: string | null;
  latestEQHId: string | null;
  latestEQLId: string | null;
};

export type LiquidityDiagnostics = {
  swingsProcessed: number;
  bslCreated: number;
  sslCreated: number;
  eqhCreated: number;
  eqlCreated: number;
  duplicatesPrevented: number;
  invalidSources: number;
  errorCode?: string;
  errorIndex?: number;
};

export type LiquidityResult = {
  status: "READY" | "BLOCKED";
  timeframe: Timeframe;
  levels: LiquidityLevel[];
  latest: LiquidityLatest;
  diagnostics: LiquidityDiagnostics;
  timingMs: number;
};

export type MultiTimeframeLiquidityResult = {
  status: DataStatus;
  symbol: "XAUUSD";
  config: Readonly<LiquidityConfig>;
  timeframes: Record<Timeframe, LiquidityResult>;
  timings: Record<Timeframe, number> & { totalMs: number };
  errorCode?: string;
};

export class LiquidityInputError extends Error {
  constructor(readonly code: "INVALID_SWING" | "INPUT_ALIGNMENT" | "INPUT_ORDER" | "DUPLICATE_SWING_ID") {
    super(code);
  }
}

function resolveConfig(overrides: Partial<LiquidityConfig>): Readonly<LiquidityConfig> {
  const config = { ...DEFAULT_LIQUIDITY_CONFIG, ...overrides };
  if (!Number.isFinite(config.equalLevelToleranceAtr) || config.equalLevelToleranceAtr < 0 ||
      !Number.isSafeInteger(config.equalLevelCandidateLimit) ||
      config.equalLevelCandidateLimit < 1 || config.equalLevelCandidateLimit > 64) {
    throw new RangeError("Invalid liquidity configuration");
  }
  return Object.freeze(config);
}

function diagnostics(): LiquidityDiagnostics {
  return { swingsProcessed: 0, bslCreated: 0, sslCreated: 0, eqhCreated: 0,
    eqlCreated: 0, duplicatesPrevented: 0, invalidSources: 0 };
}

function latest(): LiquidityLatest {
  return { latestBSLId: null, latestSSLId: null, latestEQHId: null, latestEQLId: null };
}

function emptyResult(timeframe: Timeframe, errorCode?: string,
  errorIndex?: number, invalidSources = 0, timingMs = 0): LiquidityResult {
  const detail = diagnostics();
  detail.invalidSources = invalidSources;
  if (errorCode) detail.errorCode = errorCode;
  if (errorIndex !== undefined) detail.errorIndex = errorIndex;
  return { status: "BLOCKED", timeframe, levels: [], latest: latest(), diagnostics: detail, timingMs };
}

function validSwing(swing: MarketSwing, timeframe: Timeframe): boolean {
  if (!swing || (swing.type !== "SWING_HIGH" && swing.type !== "SWING_LOW")) return false;
  const classification = swing.type === "SWING_HIGH" ?
    ["HH", "LH", "UNCLASSIFIED"] : ["HL", "LL", "UNCLASSIFIED"];
  return typeof swing.id === "string" && swing.id.length > 0 &&
    swing.timeframe === timeframe &&
    Number.isFinite(swing.price) && swing.price > 0 &&
    Number.isSafeInteger(swing.sourceIndex) && swing.sourceIndex >= 0 &&
    Number.isSafeInteger(swing.timestamp) && Number.isSafeInteger(swing.createdAt) &&
    Number.isSafeInteger(swing.availableAt) && swing.timestamp === swing.createdAt &&
    swing.createdAt <= swing.availableAt && classification.includes(swing.classification);
}

function sameSwing(a: MarketSwing, b: MarketSwing): boolean {
  return a.timeframe === b.timeframe && a.type === b.type && a.price === b.price &&
    a.sourceIndex === b.sourceIndex && a.timestamp === b.timestamp &&
    a.createdAt === b.createdAt && a.availableAt === b.availableAt &&
    a.classification === b.classification &&
    a.previousSameTypeSwingId === b.previousSameTypeSwingId;
}

export class LiquidityEngine {
  readonly config: Readonly<LiquidityConfig>;
  readonly levels: LiquidityLevel[] = [];
  private readonly highs: MarketSwing[] = [];
  private readonly lows: MarketSwing[] = [];
  private readonly seenSwings = new Map<string, MarketSwing>();
  private readonly equalPairs = new Set<string>();
  private readonly counts = diagnostics();
  private readonly newest = latest();
  private previousAvailableAt: number | null = null;

  constructor(readonly timeframe: Timeframe, overrides: Partial<LiquidityConfig> = {}) {
    this.config = resolveConfig(overrides);
  }

  get diagnostics(): LiquidityDiagnostics { return { ...this.counts }; }
  get latest(): LiquidityLatest { return { ...this.newest }; }
  get candidateCounts(): { highs: number; lows: number } {
    return { highs: this.highs.length, lows: this.lows.length };
  }

  pushSwing(swing: MarketSwing, originFeature: AtrSource): readonly LiquidityLevel[] {
    if (!validSwing(swing, this.timeframe)) return this.invalid("INVALID_SWING");
    if (!originFeature || originFeature.timeframe !== this.timeframe ||
        originFeature.timestamp !== swing.createdAt || !originFeature.atrReady ||
        originFeature.atr === null || !Number.isFinite(originFeature.atr) || originFeature.atr <= 0) {
      return this.invalid("INPUT_ALIGNMENT");
    }
    if (this.previousAvailableAt !== null && swing.availableAt < this.previousAvailableAt) {
      return this.invalid("INPUT_ORDER");
    }
    const tolerance = originFeature.atr * this.config.equalLevelToleranceAtr;
    if (!Number.isFinite(tolerance)) return this.invalid("INPUT_ALIGNMENT");
    const seen = this.seenSwings.get(swing.id);
    if (seen) {
      if (!sameSwing(seen, swing)) return this.invalid("DUPLICATE_SWING_ID");
      this.counts.duplicatesPrevented++;
      return [];
    }

    const isHigh = swing.type === "SWING_HIGH";
    const side: LiquiditySide = isHigh ? "BSL" : "SSL";
    const candidates = isHigh ? this.highs : this.lows;
    const created: LiquidityLevel[] = [];
    const raw: LiquidityLevel = {
      id: `XAUUSD:${this.timeframe}:${side}:SWING:${swing.id}`,
      timeframe: this.timeframe, side, kind: "SWING", price: swing.price,
      createdAt: swing.createdAt, availableAt: swing.availableAt,
      sourceSwingIds: [swing.id], sourceClassifications: [swing.classification],
      sourceTimeframe: swing.timeframe,
    };
    this.levels.push(raw);
    created.push(raw);
    if (isHigh) {
      this.counts.bslCreated++;
      this.newest.latestBSLId = raw.id;
    } else {
      this.counts.sslCreated++;
      this.newest.latestSSLId = raw.id;
    }

    const kind = isHigh ? "EQH" : "EQL";
    for (const previous of candidates) {
      if (Math.abs(swing.price - previous.price) > tolerance) continue;
      const first = previous.id < swing.id ? previous.id : swing.id;
      const second = previous.id < swing.id ? swing.id : previous.id;
      const id = `XAUUSD:${this.timeframe}:${kind}:${first}:${second}`;
      if (this.equalPairs.has(id)) {
        this.counts.duplicatesPrevented++;
        continue;
      }
      this.equalPairs.add(id);
      const equal: LiquidityLevel = {
        id, timeframe: this.timeframe, side, kind,
        price: previous.price / 2 + swing.price / 2,
        createdAt: swing.createdAt, availableAt: swing.availableAt,
        sourceSwingIds: [previous.id, swing.id],
        sourceClassifications: [previous.classification, swing.classification],
        sourceTimeframe: swing.timeframe,
      };
      this.levels.push(equal);
      created.push(equal);
      if (isHigh) {
        this.counts.eqhCreated++;
        this.newest.latestEQHId = id;
      } else {
        this.counts.eqlCreated++;
        this.newest.latestEQLId = id;
      }
    }
    candidates.push(swing);
    if (candidates.length > this.config.equalLevelCandidateLimit) candidates.shift();
    this.seenSwings.set(swing.id, swing);
    this.previousAvailableAt = swing.availableAt;
    this.counts.swingsProcessed++;
    return created;
  }

  private invalid(code: LiquidityInputError["code"]): never {
    this.counts.invalidSources++;
    throw new LiquidityInputError(code);
  }
}

export function createLiquidityEngine(timeframe: Timeframe,
  config: Partial<LiquidityConfig> = {}): LiquidityEngine {
  return new LiquidityEngine(timeframe, config);
}

export function analyzeLiquidity(structure: MarketStructureResult,
  psychologyFeatures: readonly AtrSource[],
  config: Partial<LiquidityConfig> = {}): LiquidityResult {
  const started = performance.now();
  if (structure.status !== "READY") return emptyResult(structure.timeframe, "UPSTREAM_STRUCTURE_STATUS");
  const engine = createLiquidityEngine(structure.timeframe, config);
  const lastFeatureTimestamp = psychologyFeatures.at(-1)?.timestamp;
  const bucketMinutes = structure.timeframe === "1h" ? 60 :
    structure.timeframe === "15m" ? 15 : structure.timeframe === "5m" ? 5 : 1;
  const lastAvailableTimestamp = lastFeatureTimestamp === undefined ? undefined :
    lastFeatureTimestamp + (bucketMinutes - 1) * 60_000;
  for (let i = 0; i < structure.swings.length; i++) {
    const swing = structure.swings[i];
    if (!swing || lastAvailableTimestamp === undefined || swing.availableAt > lastAvailableTimestamp) {
      return emptyResult(structure.timeframe, "INPUT_ALIGNMENT", i, 1, performance.now() - started);
    }
    try {
      engine.pushSwing(swing, psychologyFeatures[swing.sourceIndex]);
    } catch (error) {
      if (error instanceof LiquidityInputError) {
        return emptyResult(structure.timeframe, error.code, i,
          engine.diagnostics.invalidSources, performance.now() - started);
      }
      throw error;
    }
  }
  return { status: "READY", timeframe: structure.timeframe, levels: engine.levels,
    latest: engine.latest, diagnostics: engine.diagnostics, timingMs: performance.now() - started };
}

export function analyzeHistoricalLiquidity(structure: MultiTimeframeStructureResult,
  psychology: CandlePsychologyResult,
  overrides: Partial<LiquidityConfig> = {}): MultiTimeframeLiquidityResult {
  const started = performance.now();
  const config = resolveConfig(overrides);
  const emptyTimeframes = (): Record<Timeframe, LiquidityResult> => ({
    "1m": emptyResult("1m"), "5m": emptyResult("5m"),
    "15m": emptyResult("15m"), "1h": emptyResult("1h"),
  });
  const emptyTimings = () => ({ "1m": 0, "5m": 0, "15m": 0, "1h": 0,
    totalMs: performance.now() - started });
  if (structure.status === "BLOCKED" || structure.status === "FAILED" ||
      psychology.status === "BLOCKED" || psychology.status === "FAILED") {
    const status = structure.status === "FAILED" || psychology.status === "FAILED" ? "FAILED" : "BLOCKED";
    return { status, symbol: "XAUUSD", config, timeframes: emptyTimeframes(),
      timings: emptyTimings(), errorCode: "UPSTREAM_DATA_STATUS" };
  }
  const results = emptyTimeframes();
  for (const timeframe of ["1m", "5m", "15m", "1h"] as const) {
    if (structure.timeframes[timeframe].timeframe !== timeframe) {
      const blocked = emptyTimeframes();
      blocked[timeframe] = emptyResult(timeframe, "INPUT_ALIGNMENT", undefined, 1);
      return { status: "BLOCKED", symbol: "XAUUSD", config,
        timeframes: blocked, timings: emptyTimings(), errorCode: "INPUT_ALIGNMENT" };
    }
    const result = analyzeLiquidity(structure.timeframes[timeframe],
      psychology.timeframes[timeframe].features, config);
    if (result.status === "BLOCKED") {
      const blocked = emptyTimeframes();
      blocked[timeframe] = result;
      return { status: "BLOCKED", symbol: "XAUUSD", config,
        timeframes: blocked, timings: emptyTimings(), errorCode: result.diagnostics.errorCode };
    }
    results[timeframe] = result;
  }
  return { status: structure.status === "WARN" || psychology.status === "WARN" ? "WARN" : "READY",
    symbol: "XAUUSD", config, timeframes: results,
    timings: { "1m": results["1m"].timingMs, "5m": results["5m"].timingMs,
      "15m": results["15m"].timingMs, "1h": results["1h"].timingMs,
      totalMs: performance.now() - started } };
}
