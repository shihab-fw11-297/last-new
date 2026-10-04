import assert from "node:assert/strict";

import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from
  "../lib/traderbrain/data/historical-core.ts";
import { resolveHistoricalDateRange } from "../lib/traderbrain/ui/date-range.ts";
import { loadMarketView } from "../lib/traderbrain/ui/market-view-core.ts";

const apiKey = process.env.FINAGE_API_KEY;
if (!apiKey) throw new Error("FINAGE_API_KEY is required");

const service = new HistoricalService(new FinageClient(apiKey), new MemoryCandleStore(),
  { log: () => {} });
const fetchHistorical = service.getHistoricalCandles.bind(service);

async function load(label, fromDate, toDate, timeframe) {
  const range = resolveHistoricalDateRange(fromDate, toDate);
  const started = performance.now();
  const view = await loadMarketView({ timeframe, windowBars: 120, offsetBars: 0, range },
    fetchHistorical);
  const result = { label, selectedRange: { fromDate, toDate },
    effectiveUtcRange: {
      start: new Date(range.effectiveRange.start).toISOString(),
      end: new Date(range.effectiveRange.end).toISOString(),
    }, timeframe, counts: view.counts, finageCalls: view.finageCalls,
    cacheHit: view.cacheHit, dataStatus: view.status,
    firstCandle: view.firstAt === null ? null : new Date(view.firstAt).toISOString(),
    lastCandle: view.latestAt === null ? null : new Date(view.latestAt).toISOString(),
    loadMs: Number((performance.now() - started).toFixed(2)) };
  console.log(JSON.stringify(result));
  return result;
}

const first = await load("A-1m", "2026-10-01", "2026-10-03", "1m");
const five = await load("A-5m", "2026-10-01", "2026-10-03", "5m");
const fifteen = await load("A-15m", "2026-10-01", "2026-10-03", "15m");
const hour = await load("A-1h", "2026-10-01", "2026-10-03", "1h");
const second = await load("B", "2026-09-30", "2026-09-30", "1m");
const returned = await load("C", "2026-10-01", "2026-10-03", "1m");

assert.ok(first.counts["1m"] > 0, "TEST A returned no real XAUUSD candles");
assert.deepEqual(five.counts, first.counts);
assert.deepEqual(fifteen.counts, first.counts);
assert.deepEqual(hour.counts, first.counts);
assert.equal(five.finageCalls + fifteen.finageCalls + hour.finageCalls, 0,
  "Timeframe switching refetched Finage");
assert.ok(second.counts["1m"] >= 0);
assert.equal(returned.finageCalls, 0, "Returning to TEST A missed the Phase 1 cache");
console.log(JSON.stringify({ result: "PASS", clientFinageCalls: 0 }));
