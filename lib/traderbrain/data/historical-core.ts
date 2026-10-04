import { aggregate, auditGaps, mergeCandles } from "./candles.ts";
import { type Chunk, FinageClient, ProviderError, type FetchStats } from "./finage-core.ts";
import { PREFERRED_CHUNK_MS, mergeIntervals, missingIntervals, planRanges, splitRange } from "./intervals.ts";
import { MINUTE_MS, type Candle, type Diagnostics, type HistoricalResult, type Interval,
  type Timings, utcMillis, validateInterval } from "./types.ts";

export interface CandleStore {
  coverage(): readonly Interval[];
  read(range: Interval): Candle[];
  save(intervals: readonly Interval[], candles: readonly Candle[]): void;
}

function lowerBound(candles: readonly Candle[], timestamp: number): number {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class MemoryCandleStore implements CandleStore {
  private intervals: Interval[] = [];
  private candles: Candle[] = [];

  coverage(): readonly Interval[] { return this.intervals.map((interval) => ({ ...interval })); }
  read(range: Interval): Candle[] {
    return this.candles.slice(lowerBound(this.candles, range.start), lowerBound(this.candles, range.end));
  }
  save(intervals: readonly Interval[], candles: readonly Candle[]): void {
    const merged = mergeCandles([this.candles, candles], Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    if (merged.conflicts.length) throw new Error("DATA_CONFLICT");
    this.candles = merged.candles;
    this.intervals = mergeIntervals([...this.intervals, ...intervals]);
  }
}

class UnresolvedTruncation extends Error {}

export type HistoricalOptions = {
  concurrency?: number;
  maxSplitDepth?: number;
  log?: (summary: Record<string, unknown>) => void;
};

export class HistoricalService {
  private readonly concurrency: number;
  private readonly maxSplitDepth: number;
  private readonly log: (summary: Record<string, unknown>) => void;

  constructor(private readonly provider: FinageClient, private readonly store: CandleStore,
    options: HistoricalOptions = {}) {
    this.concurrency = options.concurrency ?? 3;
    this.maxSplitDepth = options.maxSplitDepth ?? 8;
    this.log = options.log ?? ((summary) => console.info("TraderBrain historical", summary));
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 16 ||
        !Number.isSafeInteger(this.maxSplitDepth) || this.maxSplitDepth < 0 || this.maxSplitDepth > 16) {
      throw new RangeError("Invalid historical concurrency or split depth");
    }
  }

  async getHistoricalCandles(start: Date | string | number, end: Date | string | number,
    signal?: AbortSignal): Promise<HistoricalResult> {
    const totalStart = performance.now();
    const range = validateInterval(utcMillis(start), utcMillis(end));
    const timings: Timings = { rangePlanningMs: 0, cacheLookupMs: 0, fetchMs: 0, normalizeMs: 0,
      mergeMs: 0, integrityMs: 0, aggregationMs: 0, totalMs: 0 };
    const diagnostics: Diagnostics = {
      requestId: crypto.randomUUID(), requestedCalendarMinutes: (range.end - range.start) / MINUTE_MS,
      estimatedInitialChunks: 0, plannedCalls: 0, actualApiCalls: 0, retryCount: 0,
      splitCount: 0, splits: [], providerRows: 0, returnedCandleCount: 0,
      firstTimestamp: null, lastTimestamp: null, duplicateCount: 0, duplicateConflictCount: 0,
      conflicts: [], invalidCandleCount: 0, internalGapCount: 0,
      internalMissingMinuteCount: 0, largestGapMinutes: 0, gaps: [],
      providerTruncationDetected: false, executionMs: 0,
    };
    let stage = performance.now();
    diagnostics.estimatedInitialChunks = Math.ceil((range.end - range.start) / PREFERRED_CHUNK_MS);
    timings.rangePlanningMs = performance.now() - stage;

    stage = performance.now();
    const cached = this.store.read(range);
    const missing = missingIntervals([range], this.store.coverage());
    const planned = missing.flatMap((item) => planRanges(item));
    diagnostics.plannedCalls = planned.length;
    timings.cacheLookupMs = performance.now() - stage;

    const stats: FetchStats = { actualApiCalls: 0, retryCount: 0, providerRows: 0,
      normalizeMs: 0, invalidCandleCount: 0 };
    const fetched: { chunks: Candle[][]; intervals: Interval[] }[] = new Array(planned.length);
    const errors: unknown[] = [];
    let cursor = 0;
    stage = performance.now();
    const workers = Array.from({ length: Math.min(this.concurrency, planned.length) }, async () => {
      while (cursor < planned.length) {
        if (errors.length) break;
        const index = cursor++;
        try {
          fetched[index] = await this.fetchAdaptive(planned[index], stats, diagnostics, signal);
        } catch (error) {
          errors.push(error);
        }
      }
    });
    await Promise.all(workers);
    timings.fetchMs = performance.now() - stage;
    timings.normalizeMs = stats.normalizeMs;
    diagnostics.actualApiCalls = stats.actualApiCalls;
    diagnostics.retryCount = stats.retryCount;
    diagnostics.providerRows = stats.providerRows;
    diagnostics.invalidCandleCount = stats.invalidCandleCount;

    stage = performance.now();
    const chunks: Candle[][] = [cached];
    const fetchedCoverage: Interval[] = [];
    for (const item of fetched) {
      if (!item) continue;
      chunks.push(...item.chunks);
      fetchedCoverage.push(...item.intervals);
    }
    const merged = mergeCandles(chunks, range.start, range.end);
    timings.mergeMs = performance.now() - stage;
    diagnostics.duplicateCount = merged.duplicateCount;
    diagnostics.conflicts = merged.conflicts;
    diagnostics.duplicateConflictCount = merged.conflicts.length;
    diagnostics.returnedCandleCount = merged.candles.length;
    diagnostics.firstTimestamp = merged.candles[0]?.timestamp ?? null;
    diagnostics.lastTimestamp = merged.candles[merged.candles.length - 1]?.timestamp ?? null;

    stage = performance.now();
    const gaps = auditGaps(merged.candles);
    diagnostics.gaps = gaps.gaps;
    diagnostics.internalGapCount = gaps.gaps.length;
    diagnostics.internalMissingMinuteCount = gaps.missingMinutes;
    diagnostics.largestGapMinutes = gaps.largestGapMinutes;
    timings.integrityMs = performance.now() - stage;

    stage = performance.now();
    const timeframes = { "5m": aggregate(merged.candles, "5m"),
      "15m": aggregate(merged.candles, "15m"), "1h": aggregate(merged.candles, "1h") };
    timings.aggregationMs = performance.now() - stage;
    const first = diagnostics.firstTimestamp;
    const last = diagnostics.lastTimestamp;
    const coverage = {
      fetched: mergeIntervals([...this.store.coverage(), ...fetchedCoverage])
        .filter((item) => item.end > range.start && item.start < range.end)
        .map((item) => ({ start: Math.max(item.start, range.start), end: Math.min(item.end, range.end) })),
      firstTimestamp: first, lastTimestamp: last,
      startsAfterRequest: first === null || first > range.start,
      endsBeforeRequest: last === null || last < range.end - MINUTE_MS,
    };

    let status: HistoricalResult["status"];
    if (errors.some((error) => error instanceof UnresolvedTruncation)) status = "BLOCKED";
    else if (errors.length) status = "FAILED";
    else if (merged.conflicts.length || stats.invalidCandleCount) status = "BLOCKED";
    else if (gaps.gaps.length || coverage.startsAfterRequest || coverage.endsBeforeRequest) status = "WARN";
    else status = "READY";
    if (!errors.length && !merged.conflicts.length && !stats.invalidCandleCount && fetchedCoverage.length) {
      try {
        this.store.save(fetchedCoverage, merged.candles);
      } catch (error) {
        status = error instanceof Error && error.message === "DATA_CONFLICT" ? "BLOCKED" : "FAILED";
        diagnostics.errorCode = status === "BLOCKED" ? "DATA_CONFLICT" : "CACHE_WRITE_ERROR";
      }
    }
    if (errors.length) {
      const primary = errors[0];
      diagnostics.errorCode = primary instanceof UnresolvedTruncation ? "UNRESOLVED_TRUNCATION" :
        primary instanceof ProviderError ? primary.code : "PIPELINE_ERROR";
    }
    timings.totalMs = performance.now() - totalStart;
    diagnostics.executionMs = timings.totalMs;
    this.log({ requestId: diagnostics.requestId, requestedRange: range,
      plannedChunks: diagnostics.plannedCalls, actualFinageCalls: diagnostics.actualApiCalls,
      retries: diagnostics.retryCount, splits: diagnostics.splitCount,
      providerRows: diagnostics.providerRows, finalRows: diagnostics.returnedCandleCount,
      duplicates: diagnostics.duplicateCount, conflicts: diagnostics.duplicateConflictCount,
      gaps: diagnostics.internalGapCount, status, executionMs: diagnostics.executionMs });
    return { status, symbol: "XAUUSD", requestedRange: range, candles1m: merged.candles,
      timeframes, coverage, diagnostics, timings };
  }

  private async fetchAdaptive(range: Interval, stats: FetchStats, diagnostics: Diagnostics,
    signal?: AbortSignal): Promise<{ chunks: Candle[][]; intervals: Interval[] }> {
    const pending: { interval: Interval; depth: number }[] = [{ interval: range, depth: 0 }];
    const chunks: Candle[][] = [];
    const intervals: Interval[] = [];
    while (pending.length) {
      const { interval, depth } = pending.pop()!;
      let chunk: Chunk | undefined;
      let reason: string | undefined;
      try {
        chunk = await this.provider.fetchChunk(interval, stats, signal);
        reason = chunk.truncationReason;
        if (reason) diagnostics.providerTruncationDetected = true;
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        if (error.code === "RANGE") reason = "PROVIDER_RANGE_REJECTION";
        else if (error.code === "HTTP" && error.status !== undefined && error.status >= 500 &&
          interval.end - interval.start > 86_400_000) reason = "PROVIDER_SERVER_WINDOW";
        else throw error;
      }
      if (reason) {
        const halves = depth < this.maxSplitDepth ? splitRange(interval) : null;
        if (!halves) throw new UnresolvedTruncation();
        diagnostics.splitCount++;
        diagnostics.splits.push({ interval, splitDepth: depth, splitReason: reason });
        pending.push({ interval: halves[1], depth: depth + 1 }, { interval: halves[0], depth: depth + 1 });
      } else {
        chunks.push(chunk!.candles);
        intervals.push(interval);
      }
    }
    return { chunks, intervals };
  }
}
