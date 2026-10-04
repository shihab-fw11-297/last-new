import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";

const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable");
const store = new MemoryCandleStore();
const service = new HistoricalService(new FinageClient(key), store, { log: () => {} });
const stages = [
  ["1 MONTH", "2025-01-01", "2025-02-01"],
  ["3 MONTH", "2025-01-01", "2025-04-01"],
  ["6 MONTH", "2025-01-01", "2025-07-01"],
  ["12 MONTH", "2025-01-01", "2026-01-01"],
  ["FULL", "2025-01-01", "2026-10-01"],
];

for (const [label, from, to] of stages) {
  const before = store.coverage();
  const result = await service.getHistoricalCandles(from, to);
  const d = result.diagnostics;
  console.log(JSON.stringify({ label, from, to, status: result.status,
    errorCode: d.errorCode ?? null, candles: d.returnedCandleCount,
    uniqueCandles: result.candles1m.length, firstTimestamp: d.firstTimestamp,
    lastTimestamp: d.lastTimestamp, apiCalls: d.actualApiCalls, retries: d.retryCount,
    splitCount: d.splitCount, plannedCalls: d.plannedCalls,
    cacheCoverageBefore: before, coverage: result.coverage,
    duplicates: d.duplicateCount, conflicts: d.duplicateConflictCount,
    conflictSamples: d.conflicts.slice(0, 5), invalid: d.invalidCandleCount,
    gaps: d.internalGapCount, missingMinutes: d.internalMissingMinuteCount,
    largestGapMinutes: d.largestGapMinutes,
    timings: result.timings }, null, 2));
  if (result.status === "BLOCKED" || result.status === "FAILED") break;
}
