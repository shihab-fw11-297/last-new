import { MINUTE_MS, PREFERRED_CHUNK_DAYS, type Interval, validateInterval } from "./types.ts";

export const PREFERRED_CHUNK_MS = PREFERRED_CHUNK_DAYS * 24 * 60 * MINUTE_MS;

export function planRanges(range: Interval, chunkMs = PREFERRED_CHUNK_MS): Interval[] {
  validateInterval(range.start, range.end);
  if (!Number.isSafeInteger(chunkMs) || chunkMs <= 0) throw new RangeError("Invalid chunk duration");
  const chunks: Interval[] = [];
  for (let cursor = range.start; cursor < range.end;) {
    const end = Math.min(cursor + chunkMs, range.end);
    if (end <= cursor) throw new RangeError("Chunk duration overflow");
    chunks.push({ start: cursor, end });
    cursor = end;
  }
  return chunks;
}

export function splitRange(range: Interval): [Interval, Interval] | null {
  const midpoint = Math.floor((range.start + (range.end - range.start) / 2) / MINUTE_MS) * MINUTE_MS;
  if (midpoint <= range.start || midpoint >= range.end) return null;
  return [{ start: range.start, end: midpoint }, { start: midpoint, end: range.end }];
}

export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: Interval[] = [];
  for (const interval of sorted) {
    validateInterval(interval.start, interval.end);
    const last = result[result.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

// Coverage is sorted and disjoint. The walk is O(C + R) for sorted requests.
export function missingIntervals(requests: readonly Interval[], coverage: readonly Interval[]): Interval[] {
  const missing: Interval[] = [];
  let coverageIndex = 0;
  for (const request of requests) {
    validateInterval(request.start, request.end);
    let cursor = request.start;
    while (coverageIndex < coverage.length && coverage[coverageIndex].end <= cursor) coverageIndex++;
    let index = coverageIndex;
    while (index < coverage.length && coverage[index].start < request.end) {
      const item = coverage[index];
      if (item.start > cursor) missing.push({ start: cursor, end: Math.min(item.start, request.end) });
      cursor = Math.max(cursor, item.end);
      if (cursor >= request.end) break;
      index++;
    }
    if (cursor < request.end) missing.push({ start: cursor, end: request.end });
    coverageIndex = index;
  }
  return missing;
}
