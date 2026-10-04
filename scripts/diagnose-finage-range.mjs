import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";

const [from = "2025-01-01", to = "2025-02-01"] = process.argv.slice(2);
const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable");
const data = await new HistoricalService(new FinageClient(key),
  new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles(from, to);
const gaps = data.diagnostics.gaps;
console.log(JSON.stringify({ requestedRange: data.requestedRange,
  status: data.status, errorCode: data.diagnostics.errorCode ?? null,
  candleCount: data.candles1m.length, firstTimestamp: data.diagnostics.firstTimestamp,
  lastTimestamp: data.diagnostics.lastTimestamp,
  apiCalls: data.diagnostics.actualApiCalls, retries: data.diagnostics.retryCount,
  splitCount: data.diagnostics.splitCount, splitDetails: data.diagnostics.splits,
  providerRows: data.diagnostics.providerRows,
  duplicateCount: data.diagnostics.duplicateCount,
  conflictCount: data.diagnostics.duplicateConflictCount,
  conflicts: data.diagnostics.conflicts.slice(0, 20),
  invalidCandleCount: data.diagnostics.invalidCandleCount,
  gapCount: gaps.length, missingMinutes: data.diagnostics.internalMissingMinuteCount,
  largestGapMinutes: data.diagnostics.largestGapMinutes,
  firstGaps: gaps.slice(0, 3), lastGaps: gaps.slice(-3),
  coverage: data.coverage, timings: data.timings,
  requestedChunks: data.diagnostics.estimatedInitialChunks,
  plannedChunks: data.diagnostics.plannedCalls }, null, 2));
