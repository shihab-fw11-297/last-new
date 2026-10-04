import { MINUTE_MS, type Interval, validateInterval } from "../data/types.ts";

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class HistoricalDateRangeError extends RangeError {
  constructor(readonly code: "INVALID_DATE" | "INCOMPLETE_RANGE" |
    "FROM_AFTER_TO" | "FUTURE_RANGE", message: string) {
    super(message);
  }
}

export type HistoricalDateRange = Readonly<{
  fromDate: string;
  toDate: string;
  requestedRange: Interval;
  effectiveRange: Interval;
  notice: string | null;
}>;

export function currentUtcTimestamp(): number {
  return Date.now();
}

function parseUtcDateOnly(value: string): number {
  if (!DATE_ONLY.test(value)) {
    throw new HistoricalDateRangeError("INVALID_DATE", "Enter valid FROM and TO dates.");
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isSafeInteger(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new HistoricalDateRangeError("INVALID_DATE", "Enter valid FROM and TO dates.");
  }
  return timestamp;
}

export function utcDateString(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp)) throw new RangeError("Invalid UTC timestamp");
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function defaultHistoricalDates(now = Date.now()): Readonly<{
  fromDate: string; toDate: string;
}> {
  if (!Number.isSafeInteger(now)) throw new RangeError("Invalid current UTC time");
  const todayUtc = Math.floor(now / DAY_MS) * DAY_MS;
  return {
    fromDate: utcDateString(todayUtc - 4 * DAY_MS),
    toDate: utcDateString(todayUtc - DAY_MS),
  };
}

export function resolveHistoricalDateRange(fromDate: string, toDate: string,
  now = Date.now()): HistoricalDateRange {
  if (!fromDate || !toDate) {
    throw new HistoricalDateRangeError("INCOMPLETE_RANGE", "Choose both FROM and TO dates.");
  }
  if (!Number.isSafeInteger(now)) throw new RangeError("Invalid current UTC time");
  const start = parseUtcDateOnly(fromDate);
  const toStart = parseUtcDateOnly(toDate);
  if (start > toStart) {
    throw new HistoricalDateRangeError("FROM_AFTER_TO", "FROM must be on or before TO.");
  }
  const requestedRange = validateInterval(start, toStart + DAY_MS);
  const availableEnd = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  if (start >= availableEnd) {
    throw new HistoricalDateRangeError("FUTURE_RANGE",
      "Selected range begins beyond the available UTC market-data boundary.");
  }
  const clamped = requestedRange.end > availableEnd;
  return {
    fromDate,
    toDate,
    requestedRange,
    effectiveRange: validateInterval(start, clamped ? availableEnd : requestedRange.end),
    notice: clamped ?
      "Selected range extends beyond available data and ends at the current UTC boundary." : null,
  };
}

export function resolveHistoricalDateQuery(query: Readonly<{
  from?: string; to?: string;
}>, now = Date.now()): HistoricalDateRange {
  if (query.from === undefined && query.to === undefined) {
    const defaults = defaultHistoricalDates(now);
    return resolveHistoricalDateRange(defaults.fromDate, defaults.toDate, now);
  }
  return resolveHistoricalDateRange(query.from ?? "", query.to ?? "", now);
}

export function historicalHref(input: Readonly<{
  timeframe: string;
  fromDate: string;
  toDate: string;
  bars: number;
  offset?: number;
}>): string {
  const params = new URLSearchParams({
    tf: input.timeframe,
    from: input.fromDate,
    to: input.toDate,
    bars: String(input.bars),
    offset: String(input.offset ?? 0),
  });
  return `/?${params.toString()}`;
}
