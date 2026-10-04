import { MINUTE_MS, type AggregateCandle, type Candle, type Conflict, type Gap } from "./types.ts";

export function normalizeRows(rows: readonly unknown[]): { candles: Candle[]; invalidCount: number } {
  const candles: Candle[] = [];
  let invalidCount = 0;
  let ordered = true;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (!row || typeof row !== "object") { invalidCount++; continue; }
    const value = row as Record<string, unknown>;
    const { t, o, h, l, c, v } = value;
    if (![t, o, h, l, c].every((item) => typeof item === "number" && Number.isFinite(item)) ||
        !Number.isSafeInteger(t) || (t as number) % MINUTE_MS !== 0 ||
        (h as number) < (o as number) || (h as number) < (c as number) ||
        (l as number) > (o as number) || (l as number) > (c as number) ||
        (h as number) < (l as number) ||
        (v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0))) {
      invalidCount++;
      continue;
    }
    candles.push({ timestamp: t as number, open: o as number, high: h as number,
      low: l as number, close: c as number, volume: v == null ? null : v as number,
      symbol: "XAUUSD", timeframe: "1m" });
    if ((t as number) < previousTimestamp) ordered = false;
    previousTimestamp = t as number;
  }
  if (!ordered) candles.sort((a, b) => a.timestamp - b.timestamp);
  return { candles, invalidCount };
}

function identical(a: Candle, b: Candle): boolean {
  return a.open === b.open && a.high === b.high && a.low === b.low &&
    a.close === b.close && a.volume === b.volume;
}

// Each chunk is sorted. Heap merge keeps memory O(K), time O(N log K).
export function mergeCandles(chunks: readonly (readonly Candle[])[], start: number, end: number):
  { candles: Candle[]; duplicateCount: number; conflicts: Conflict[] } {
  type Cursor = { chunk: number; index: number; candle: Candle };
  const heap: Cursor[] = [];
  const push = (entry: Cursor) => {
    heap.push(entry);
    for (let i = heap.length - 1; i > 0;) {
      const parent = Math.floor((i - 1) / 2);
      if (heap[parent].candle.timestamp <= heap[i].candle.timestamp) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = (): Cursor => {
    const first = heap[0];
    const tail = heap.pop()!;
    if (heap.length) {
      heap[0] = tail;
      for (let i = 0;;) {
        let child = i * 2 + 1;
        if (child >= heap.length) break;
        if (child + 1 < heap.length && heap[child + 1].candle.timestamp < heap[child].candle.timestamp) child++;
        if (heap[i].candle.timestamp <= heap[child].candle.timestamp) break;
        [heap[i], heap[child]] = [heap[child], heap[i]];
        i = child;
      }
    }
    return first;
  };
  chunks.forEach((chunk, index) => { if (chunk.length) push({ chunk: index, index: 0, candle: chunk[0] }); });
  const candles: Candle[] = [];
  const conflicts: Conflict[] = [];
  let duplicateCount = 0;
  while (heap.length) {
    const cursor = pop();
    const candle = cursor.candle;
    if (candle.timestamp >= start && candle.timestamp < end) {
      const previous = candles[candles.length - 1];
      if (previous && previous.timestamp === candle.timestamp) {
        duplicateCount++;
        if (!identical(previous, candle) && conflicts[conflicts.length - 1]?.timestamp !== candle.timestamp) {
          conflicts.push({ timestamp: candle.timestamp, reason: "DATA_CONFLICT" });
        }
      } else candles.push(candle);
    }
    const nextIndex = cursor.index + 1;
    if (nextIndex < chunks[cursor.chunk].length) push({ chunk: cursor.chunk, index: nextIndex, candle: chunks[cursor.chunk][nextIndex] });
  }
  return { candles, duplicateCount, conflicts };
}

export function auditGaps(candles: readonly Candle[]): { gaps: Gap[]; missingMinutes: number; largestGapMinutes: number } {
  const gaps: Gap[] = [];
  let missingMinutes = 0;
  let largestGapMinutes = 0;
  for (let i = 1; i < candles.length; i++) {
    const delta = candles[i].timestamp - candles[i - 1].timestamp;
    if (delta > MINUTE_MS) {
      const count = delta / MINUTE_MS - 1;
      gaps.push({ start: candles[i - 1].timestamp + MINUTE_MS, end: candles[i].timestamp, missingMinuteCount: count });
      missingMinutes += count;
      largestGapMinutes = Math.max(largestGapMinutes, count);
    }
  }
  return { gaps, missingMinutes, largestGapMinutes };
}

// Null volume means unknown; aggregate volume remains null if any constituent volume is unknown.
export function aggregate(candles: readonly Candle[], timeframe: "5m" | "15m" | "1h"):
  AggregateCandle[] {
  const expected = timeframe === "5m" ? 5 : timeframe === "15m" ? 15 : 60;
  const duration = expected * MINUTE_MS;
  const result: AggregateCandle[] = [];
  let current: AggregateCandle | undefined;
  for (const candle of candles) {
    const bucketStart = Math.floor(candle.timestamp / duration) * duration;
    if (!current || current.bucketStart !== bucketStart) {
      if (current) result.push(current);
      current = { ...candle, timeframe, timestamp: bucketStart, bucketStart, bucketEnd: bucketStart + duration,
        sourceCount: 0, isComplete: false };
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume = current.volume === null || candle.volume === null ? null : current.volume + candle.volume;
    }
    current.sourceCount++;
    current.isComplete = current.sourceCount === expected;
  }
  if (current) result.push(current);
  return result;
}
