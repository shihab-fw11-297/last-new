import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, auditGaps, mergeCandles, normalizeRows } from "../lib/traderbrain/data/candles.ts";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { mergeIntervals, missingIntervals, planRanges, splitRange } from "../lib/traderbrain/data/intervals.ts";
import { MINUTE_MS, utcMillis } from "../lib/traderbrain/data/types.ts";

const minute = MINUTE_MS;
const day = 1_440 * minute;
const raw = (t, o = 10, v = 1) => ({ t, o, h: o + 2, l: o - 2, c: o + 1, v });
const candle = (t, o = 10, v = 1) => normalizeRows([raw(t, o, v)]).candles[0];
const stats = () => ({ actualApiCalls: 0, retryCount: 0, providerRows: 0, normalizeMs: 0, invalidCandleCount: 0 });
const ok = (results, extra = {}) => new Response(JSON.stringify({ results, ...extra }), { status: 200 });
const service = (fetchImpl, options = {}) => new HistoricalService(
  new FinageClient("test-key", { fetchImpl, sleep: async () => {}, maxRetries: 1, timeoutMs: 10_000 }),
  new MemoryCandleStore(), { log: () => {}, ...options });

test("range planning: 1, 30, 34 and 35 calendar days", () => {
  assert.equal(planRanges({ start: 0, end: day }).length, 1);
  assert.equal(planRanges({ start: 0, end: 30 * day }).length, 1);
  assert.deepEqual(planRanges({ start: 0, end: 34 * day }), [
    { start: 0, end: 30 * day }, { start: 30 * day, end: 34 * day }]);
  assert.equal(34 * 1_440, 48_960);
  assert.equal(35 * 1_440, 50_400);
  assert.deepEqual(planRanges({ start: 0, end: 35 * day })[1], { start: 30 * day, end: 35 * day });
});

test("contiguous chunks and final partial chunk", () => {
  const plan = planRanges({ start: minute, end: 64 * day + minute });
  assert.equal(plan.length, 3);
  for (let i = 1; i < plan.length; i++) assert.equal(plan[i - 1].end, plan[i].start);
  assert.equal(plan.at(-1).end, 64 * day + minute);
  assert.throws(() => planRanges({ start: 1, end: 1 }), RangeError);
});

test("UTC conversion and explicit half-open semantics", () => {
  assert.equal(utcMillis("2026-03-01"), 1772323200000);
  assert.equal(utcMillis("2026-03-01T05:30:00+05:30"), 1772323200000);
  assert.throws(() => utcMillis("2026-03-01T00:00:00"), RangeError);
  assert.deepEqual(mergeCandles([[candle(0), candle(minute), candle(2 * minute)]], minute, 2 * minute).candles.map((c) => c.timestamp), [minute]);
});

test("adaptive split uses adjacent half-open ranges", () => {
  assert.deepEqual(splitRange({ start: 0, end: 4 * minute }), [
    { start: 0, end: 2 * minute }, { start: 2 * minute, end: 4 * minute }]);
  assert.equal(splitRange({ start: 0, end: minute }), null);
});

test("interval union and difference handle overlap, adjacency and partial cache", () => {
  const covered = mergeIntervals([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 3, end: 6 }, { start: 8, end: 10 }]);
  assert.deepEqual(covered, [{ start: 0, end: 6 }, { start: 8, end: 10 }]);
  assert.deepEqual(missingIntervals([{ start: 1, end: 12 }], covered), [{ start: 6, end: 8 }, { start: 10, end: 12 }]);
  assert.deepEqual(missingIntervals([{ start: 0, end: 6 }], covered), []);
});

test("normalization rejects invalid OHLC and numeric values", () => {
  const result = normalizeRows([raw(0), { ...raw(minute), h: 9 }, { ...raw(2 * minute), o: NaN }, { ...raw(3 * minute), t: Infinity }]);
  assert.equal(result.invalidCount, 3);
  assert.equal(result.candles.length, 1);
});

test("out-of-order rows become sorted and duplicates are detected", () => {
  const normalized = normalizeRows([raw(2 * minute), raw(0), raw(minute)]);
  assert.deepEqual(normalized.candles.map((c) => c.timestamp), [0, minute, 2 * minute]);
  const merged = mergeCandles([normalized.candles, [candle(2 * minute)]], 0, 3 * minute);
  assert.deepEqual(merged.candles.map((c) => c.timestamp), [0, minute, 2 * minute]);
  assert.equal(merged.duplicateCount, 1);
  assert.equal(merged.conflicts.length, 0);
});

test("chunk boundary identical duplicate and conflicting duplicate", () => {
  const identical = mergeCandles([[candle(0), candle(minute)], [candle(minute), candle(2 * minute)]], 0, 3 * minute);
  assert.equal(identical.duplicateCount, 1);
  assert.equal(identical.conflicts.length, 0);
  const conflict = mergeCandles([[candle(0), candle(minute)], [candle(minute, 20)]], 0, 2 * minute);
  assert.deepEqual(conflict.conflicts, [{ timestamp: minute, reason: "DATA_CONFLICT" }]);
});

test("single and multiple missing minutes need one gap object each", () => {
  const gaps = auditGaps([candle(0), candle(2 * minute), candle(6 * minute)]);
  assert.equal(gaps.gaps.length, 2);
  assert.equal(gaps.missingMinutes, 4);
  assert.equal(gaps.largestGapMinutes, 3);
  assert.deepEqual(gaps.gaps[0], { start: minute, end: 2 * minute, missingMinuteCount: 1 });
});

test("5m, 15m, 1h UTC buckets and partial HTF candles", () => {
  const base = Date.parse("2026-03-01T00:00:00Z");
  const candles = Array.from({ length: 61 }, (_, i) => candle(base + i * minute, i + 10));
  const five = aggregate(candles, "5m");
  const fifteen = aggregate(candles, "15m");
  const hour = aggregate(candles, "1h");
  assert.equal(five.length, 13);
  assert.equal(fifteen.length, 5);
  assert.equal(hour.length, 2);
  assert.equal(five[0].bucketStart, base);
  assert.equal(five[0].bucketEnd, base + 5 * minute);
  assert.equal(five[0].sourceCount, 5);
  assert.equal(five[0].isComplete, true);
  assert.equal(five.at(-1).isComplete, false);
  assert.equal(fifteen[0].sourceCount, 15);
  assert.equal(hour[0].sourceCount, 60);
  assert.equal(hour.at(-1).sourceCount, 1);
  assert.equal(hour[0].volume, 60);
  assert.equal(aggregate([candle(base, 10, null), candle(base + minute)], "5m")[0].volume, null);
});

test("429 and 500 retry, honoring Retry-After", async () => {
  for (const status of [429, 500]) {
    let calls = 0;
    const delays = [];
    const client = new FinageClient("test", {
      fetchImpl: async () => ++calls === 1 ? new Response("temporary", { status, headers: { "retry-after": "1" } }) : ok([raw(0)]),
      maxRetries: 1, sleep: async (ms) => { delays.push(ms); }, random: () => 0,
    });
    const s = stats();
    assert.equal((await client.fetchChunk({ start: 0, end: minute }, s)).candles.length, 1);
    assert.equal(s.actualApiCalls, 2);
    assert.equal(s.retryCount, 1);
    assert.deepEqual(delays, [1_000]);
  }
});

test("Finage request uses UTC date bounds and the specified market/query", async () => {
  let requested;
  const client = new FinageClient("test-key", { fetchImpl: async (url, init) => {
    requested = { url, init };
    return ok([raw(0)]);
  } });
  await client.fetchChunk({ start: 0, end: minute }, stats());
  assert.equal(requested.url.pathname, "/agg/forex/XAUUSD/1/minute/1970-01-01/1970-01-02");
  assert.equal(requested.url.searchParams.get("apikey"), "test-key");
  assert.equal(requested.url.searchParams.get("limit"), "50000");
  assert.equal(requested.url.searchParams.get("sort"), "asc");
  assert.equal(requested.url.searchParams.get("date_format"), "ts");
  assert.equal(requested.init.cache, "no-store");
});

test("Finage chunk trims date-window rows to its half-open interval", async () => {
  const client = new FinageClient("test", { fetchImpl: async () => ok([
    raw(0), raw(minute), raw(2 * minute), raw(3 * minute), raw(4 * minute),
  ]) });
  const s = stats();
  const result = await client.fetchChunk({ start: minute, end: 4 * minute }, s);
  assert.deepEqual(result.candles.map((item) => item.timestamp), [minute, 2 * minute, 3 * minute]);
  assert.equal(s.providerRows, 5);
});

test("network timeout retries and stops at limit", async () => {
  const client = new FinageClient("test", {
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }), timeoutMs: 2, maxRetries: 1, sleep: async () => {},
  });
  const s = stats();
  await assert.rejects(client.fetchChunk({ start: 0, end: minute }, s), { code: "NETWORK" });
  assert.equal(s.actualApiCalls, 2);
  assert.equal(s.retryCount, 1);
});

test("non-retryable 4xx is called once", async () => {
  const s = stats();
  const client = new FinageClient("test", { fetchImpl: async () => new Response("bad", { status: 400 }) });
  await assert.rejects(client.fetchChunk({ start: 0, end: minute }, s), { code: "HTTP" });
  assert.equal(s.actualApiCalls, 1);
});

test("in-flight identical chunks make one HTTP call", async () => {
  let calls = 0;
  let release;
  const client = new FinageClient("test", { fetchImpl: async () => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
    return ok([raw(0)]);
  } });
  const a = stats();
  const b = stats();
  const first = client.fetchChunk({ start: 0, end: minute }, a);
  const second = client.fetchChunk({ start: 0, end: minute }, b);
  release();
  assert.equal((await first).candles.length, 1);
  assert.equal((await second).candles.length, 1);
  assert.equal(calls, 1);
  assert.equal(a.actualApiCalls, 1);
  assert.equal(b.actualApiCalls, 0);
});

test("result-limit evidence splits and returns exact requested range", async () => {
  let calls = 0;
  const request = service(async () => {
    if (++calls === 1) return ok([raw(0)], { totalResults: 50_000 });
    // Date-based provider windows may return rows outside each internal split.
    return ok([raw(0), raw(minute), raw(2 * minute), raw(3 * minute), raw(4 * minute)]);
  });
  const result = await request.getHistoricalCandles(0, 4 * minute);
  assert.equal(result.status, "READY");
  assert.equal(result.diagnostics.splitCount, 1);
  assert.equal(result.diagnostics.actualApiCalls, 3);
  assert.equal(result.diagnostics.providerTruncationDetected, true);
  assert.deepEqual(result.candles1m.map((c) => c.timestamp), [0, minute, 2 * minute, 3 * minute]);
  assert.equal(result.diagnostics.duplicateCount, 0);
});

test("maximum split depth blocks suspected truncation", async () => {
  const request = service(async () => ok([raw(0)], { totalResults: 50_000 }), { maxSplitDepth: 0 });
  const result = await request.getHistoricalCandles(0, 2 * minute);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.diagnostics.errorCode, "UNRESOLVED_TRUNCATION");
});

test("missing end coverage on a multi-day response is treated as possible truncation", async () => {
  const client = new FinageClient("test", { fetchImpl: async () => ok([raw(0), raw(minute)]) });
  const result = await client.fetchChunk({ start: 0, end: 2 * day }, stats());
  assert.equal(result.truncationReason, "SUSPICIOUS_EDGE_COVERAGE");
});

test("provider range rejection adaptively splits", async () => {
  let calls = 0;
  const request = service(async () => {
    if (++calls === 1) return new Response("date range too long", { status: 422 });
    return ok([raw(0), raw(minute)]);
  });
  const result = await request.getHistoricalCandles(0, 2 * minute);
  assert.equal(result.status, "READY");
  assert.equal(result.diagnostics.splitCount, 1);
  assert.equal(result.diagnostics.actualApiCalls, 3);
});

test("exhausted 5xx on a large window splits; exhausted 429 does not", async () => {
  let calls = 0;
  const request = service(async () => {
    calls++;
    return calls <= 2 ? new Response("upstream failure", { status: 502 }) : ok([raw(0), raw(day)]);
  });
  const recovered = await request.getHistoricalCandles(0, 2 * day);
  assert.equal(recovered.status, "WARN");
  assert.equal(recovered.diagnostics.splitCount, 1);
  assert.equal(recovered.diagnostics.actualApiCalls, 4);
  assert.equal(recovered.diagnostics.splits[0].splitReason, "PROVIDER_SERVER_WINDOW");

  const limited = service(async () => new Response("rate limited", { status: 429 }));
  const failed = await limited.getHistoricalCandles(0, 2 * day);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.diagnostics.splitCount, 0);
});

test("fully cached interval avoids HTTP; partial cache fetches only missing", async () => {
  const calls = [];
  const request = service(async (url) => {
    calls.push(url.pathname);
    return ok([raw(calls.length === 1 ? 0 : 2 * minute)]);
  });
  await request.getHistoricalCandles(0, 2 * minute);
  const cached = await request.getHistoricalCandles(0, 2 * minute);
  assert.equal(cached.diagnostics.actualApiCalls, 0);
  assert.equal(cached.diagnostics.plannedCalls, 0);
  const partial = await request.getHistoricalCandles(0, 3 * minute);
  assert.equal(partial.diagnostics.actualApiCalls, 1);
  assert.equal(partial.diagnostics.lastTimestamp, 2 * minute);
  assert.deepEqual(calls, [
    "/agg/forex/XAUUSD/1/minute/1970-01-01/1970-01-02",
    "/agg/forex/XAUUSD/1/minute/1970-01-01/1970-01-02",
  ]);
});

test("invalid provider candle blocks cache and downstream readiness", async () => {
  const request = service(async () => ok([raw(0), { ...raw(minute), h: 0 }]));
  const result = await request.getHistoricalCandles(0, 2 * minute);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.diagnostics.invalidCandleCount, 1);
  assert.equal(result.diagnostics.returnedCandleCount, 1);
});

test("conflicting duplicate blocks readiness and is reported", async () => {
  const request = service(async () => ok([raw(0), raw(0, 20)]));
  const result = await request.getHistoricalCandles(0, minute);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.diagnostics.duplicateCount, 1);
  assert.deepEqual(result.diagnostics.conflicts, [{ timestamp: 0, reason: "DATA_CONFLICT" }]);
});

test("unrecoverable HTTP failure returns FAILED diagnostics", async () => {
  const request = service(async () => new Response("bad request", { status: 400 }));
  const result = await request.getHistoricalCandles(0, minute);
  assert.equal(result.status, "FAILED");
  assert.equal(result.diagnostics.errorCode, "HTTP");
});

test("historical March fixture records leading unavailable coverage", async () => {
  const start = 1772323200000;
  const first = 1772341320000;
  const request = service(async () => ok([raw(first)]), { maxSplitDepth: 0 });
  const result = await request.getHistoricalCandles(start, start + day);
  assert.equal(result.coverage.startsAfterRequest, true);
  assert.equal((first - start) / minute, 302);
  assert.equal(result.status, "WARN");
});
