import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { aggregate } from "../lib/traderbrain/data/candles.ts";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from
  "../lib/traderbrain/data/historical-core.ts";
import { defaultHistoricalDates, historicalHref, resolveHistoricalDateQuery,
  resolveHistoricalDateRange } from "../lib/traderbrain/ui/date-range.ts";
import { buildMarketView, loadMarketView } from
  "../lib/traderbrain/ui/market-view-core.ts";

const MINUTE = 60_000;
const NOW = Date.parse("2026-10-04T12:34:56Z");
const START = Date.parse("2026-10-01T00:00:00Z");

function candles(count, start = START) {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index * 0.01;
    const close = open + (index % 2 ? -0.05 : 0.05);
    return { timestamp: start + index * MINUTE, open,
      high: Math.max(open, close) + 0.2, low: Math.min(open, close) - 0.2,
      close, volume: 1, symbol: "XAUUSD", timeframe: "1m" };
  });
}

function historical(count, status = "READY", actualApiCalls = 1) {
  const source = candles(count);
  const end = START + 24 * 60 * MINUTE;
  return { status, symbol: "XAUUSD", requestedRange: { start: START, end },
    candles1m: source, timeframes: { "5m": aggregate(source, "5m"),
      "15m": aggregate(source, "15m"), "1h": aggregate(source, "1h") },
    coverage: { fetched: [{ start: START, end }],
      firstTimestamp: source[0]?.timestamp ?? null,
      lastTimestamp: source.at(-1)?.timestamp ?? null,
      startsAfterRequest: false, endsBeforeRequest: false },
    diagnostics: { requestId: "range-test", requestedCalendarMinutes: 1_440,
      estimatedInitialChunks: 1, plannedCalls: 1, actualApiCalls,
      retryCount: 0, splitCount: 0, splits: [], providerRows: count,
      returnedCandleCount: count, firstTimestamp: source[0]?.timestamp ?? null,
      lastTimestamp: source.at(-1)?.timestamp ?? null, duplicateCount: 0,
      duplicateConflictCount: 0, conflicts: [], invalidCandleCount: 0,
      internalGapCount: 0, internalMissingMinuteCount: 0, largestGapMinutes: 0,
      gaps: [], providerTruncationDetected: false, executionMs: 5 },
    timings: { rangePlanningMs: 0, cacheLookupMs: 0, fetchMs: 1,
      normalizeMs: 1, mergeMs: 1, integrityMs: 1, aggregationMs: 1, totalMs: 5 } };
}

const range = () => resolveHistoricalDateRange("2026-10-01", "2026-10-01", NOW);
const request = (timeframe = "1m") => ({ timeframe, windowBars: 120,
  offsetBars: 0, range: range() });

test("inclusive UI dates convert to exact UTC half-open ranges", () => {
  const selected = resolveHistoricalDateRange("2026-09-30", "2026-10-04",
    Date.parse("2026-10-06T00:00:00Z"));
  assert.deepEqual(selected.requestedRange, {
    start: Date.parse("2026-09-30T00:00:00Z"),
    end: Date.parse("2026-10-05T00:00:00Z"),
  });
  assert.deepEqual(selected.effectiveRange, selected.requestedRange);
});

test("same-day selection requests one UTC calendar day", () => {
  const selected = resolveHistoricalDateRange("2026-10-04", "2026-10-04",
    Date.parse("2026-10-05T00:00:00Z"));
  assert.equal(selected.effectiveRange.end - selected.effectiveRange.start,
    24 * 60 * MINUTE);
});

test("reversed, incomplete and invalid dates reject before fetching", () => {
  assert.throws(() => resolveHistoricalDateRange("2026-10-05", "2026-10-04", NOW),
    /FROM must be/);
  assert.throws(() => resolveHistoricalDateRange("", "2026-10-04", NOW),
    /both FROM and TO/);
  assert.throws(() => resolveHistoricalDateRange("2026-02-30", "2026-10-04", NOW),
    /valid FROM and TO/);
});

test("future end is clamped explicitly and a wholly future range rejects", () => {
  const selected = resolveHistoricalDateRange("2026-10-03", "2026-10-08", NOW);
  assert.equal(selected.effectiveRange.end, Math.floor(NOW / MINUTE) * MINUTE);
  assert.match(selected.notice, /extends beyond available data/);
  assert.throws(() => resolveHistoricalDateRange("2026-10-05", "2026-10-08", NOW),
    /begins beyond/);
});

test("resolved range is passed unchanged to the existing Phase 1 fetch boundary", async () => {
  const calls = [];
  const view = await loadMarketView(request(), async (start, end, signal) => {
    calls.push({ start, end, signal });
    return historical(0, "BLOCKED");
  });
  assert.deepEqual(calls.map(({ start, end }) => ({ start, end })),
    [range().effectiveRange]);
  assert.equal(view.status, "BLOCKED");
  assert.deepEqual(view.candles, []);
});

test("timeframe changes reuse Phase 1 cache and local aggregates", async () => {
  const source = candles(120);
  const raw = source.map((item) => ({ t: item.timestamp, o: item.open, h: item.high,
    l: item.low, c: item.close, v: item.volume }));
  let providerCalls = 0;
  const client = new FinageClient("test-key", { maxRetries: 0,
    fetchImpl: async () => { providerCalls++; return new Response(JSON.stringify({
      results: raw, totalResults: raw.length }), { status: 200 }); } });
  const service = new HistoricalService(client, new MemoryCandleStore(), { log: () => {} });
  const fetcher = service.getHistoricalCandles.bind(service);
  const oneMinute = await loadMarketView(request("1m"), fetcher);
  const fifteenMinute = await loadMarketView(request("15m"), fetcher);
  assert.equal(providerCalls, 1);
  assert.equal(oneMinute.finageCalls, 1);
  assert.equal(fifteenMinute.finageCalls, 0);
  assert.equal(fifteenMinute.cacheHit, true);
  assert.equal(fifteenMinute.counts["15m"], aggregate(source, "15m").length);
});

test("URL state restores range and the latest URL remains authoritative", () => {
  const href = historicalHref({ timeframe: "15m", fromDate: "2026-09-30",
    toDate: "2026-10-03", bars: 60 });
  const params = new URL(href, "http://localhost").searchParams;
  const restored = resolveHistoricalDateQuery({ from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined }, NOW);
  assert.equal(params.get("tf"), "15m");
  assert.equal(params.get("bars"), "60");
  assert.equal(restored.fromDate, "2026-09-30");
  assert.equal(restored.toDate, "2026-10-03");
  const latest = resolveHistoricalDateQuery({ from: "2026-10-02", to: "2026-10-03" }, NOW);
  assert.notDeepEqual(restored.requestedRange, latest.requestedRange);
  assert.deepEqual(defaultHistoricalDates(NOW), {
    fromDate: "2026-09-30", toDate: "2026-10-03" });
});

test("selected dataset updates chart candles and all timeframe counts", () => {
  const smaller = buildMarketView(request(), historical(60));
  const larger = buildMarketView(request(), historical(120));
  assert.equal(smaller.candles.length, 60);
  assert.equal(larger.candles.length, 120);
  assert.equal(smaller.counts["1m"], 60);
  assert.equal(larger.counts["1m"], 120);
  assert.ok(larger.counts["5m"] > smaller.counts["5m"]);
  assert.ok(larger.counts["15m"] > smaller.counts["15m"]);
  assert.ok(larger.counts["1h"] > smaller.counts["1h"]);
});

test("client date selector contains no Finage endpoint or API key access", async () => {
  const clientSource = await readFile(new URL("../app/date-range-selector.tsx",
    import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const source of [clientSource, pageSource]) {
    assert.doesNotMatch(source, /FINAGE_API_KEY|api\.finage\.co\.uk|process\.env/);
  }
  assert.match(await readFile(new URL("../lib/traderbrain/ui/market-view.ts",
    import.meta.url), "utf8"), /server-only/);
});
