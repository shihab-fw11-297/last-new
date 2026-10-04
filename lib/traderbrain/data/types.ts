export const MINUTE_MS = 60_000;
export const PROVIDER_LIMIT = 50_000;
export const PREFERRED_CHUNK_DAYS = 30;

export type Interval = { start: number; end: number }; // UTC, [start, end)
export type DataStatus = "READY" | "WARN" | "BLOCKED" | "FAILED";
export type Timeframe = "1m" | "5m" | "15m" | "1h";

export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  symbol: "XAUUSD";
  timeframe: "1m";
};

export type AggregateCandle = Omit<Candle, "timeframe"> & {
  timeframe: Exclude<Timeframe, "1m">;
  bucketStart: number;
  bucketEnd: number;
  sourceCount: number;
  isComplete: boolean;
};

export type Gap = { start: number; end: number; missingMinuteCount: number };
export type Conflict = { timestamp: number; reason: "DATA_CONFLICT" };

export type Diagnostics = {
  requestId: string;
  requestedCalendarMinutes: number;
  estimatedInitialChunks: number;
  plannedCalls: number;
  actualApiCalls: number;
  retryCount: number;
  splitCount: number;
  splits: { interval: Interval; splitDepth: number; splitReason: string }[];
  providerRows: number;
  returnedCandleCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  duplicateCount: number;
  duplicateConflictCount: number;
  conflicts: Conflict[];
  invalidCandleCount: number;
  internalGapCount: number;
  internalMissingMinuteCount: number;
  largestGapMinutes: number;
  gaps: Gap[];
  providerTruncationDetected: boolean;
  executionMs: number;
  errorCode?: string;
};

export type Timings = {
  rangePlanningMs: number;
  cacheLookupMs: number;
  fetchMs: number;
  normalizeMs: number;
  mergeMs: number;
  integrityMs: number;
  aggregationMs: number;
  totalMs: number;
};

export type HistoricalResult = {
  status: DataStatus;
  symbol: "XAUUSD";
  requestedRange: Interval;
  candles1m: Candle[];
  timeframes: { "5m": AggregateCandle[]; "15m": AggregateCandle[]; "1h": AggregateCandle[] };
  coverage: {
    fetched: Interval[];
    firstTimestamp: number | null;
    lastTimestamp: number | null;
    startsAfterRequest: boolean;
    endsBeforeRequest: boolean;
  };
  diagnostics: Diagnostics;
  timings: Timings;
};

export function utcMillis(value: Date | string | number): number {
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    throw new RangeError("Date strings must include a UTC offset or be YYYY-MM-DD");
  }
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : value;
  if (!Number.isSafeInteger(timestamp)) throw new RangeError("Invalid UTC timestamp");
  return timestamp;
}

export function validateInterval(start: number, end: number): Interval {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) {
    throw new RangeError("Expected a finite UTC half-open interval with start < end");
  }
  return { start, end };
}
