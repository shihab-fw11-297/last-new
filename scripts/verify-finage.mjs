import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";

if (!process.env.FINAGE_API_KEY) {
  console.error("FINAGE_API_KEY is unavailable; live verification skipped.");
  process.exitCode = 1;
} else {
  const service = new HistoricalService(new FinageClient(process.env.FINAGE_API_KEY),
    new MemoryCandleStore(), { log: () => {} });
  for (const [label, start, end] of [
    ["March sample", "2026-03-01", "2026-03-05"],
    ["Preferred 30-day window", "2026-03-01", "2026-03-31"],
  ]) {
    const result = await service.getHistoricalCandles(start, end);
    console.log(JSON.stringify({
      sample: label,
      status: result.status,
      requestedRange: result.requestedRange,
      candles1m: result.candles1m.length,
      candles5m: result.timeframes["5m"].length,
      candles15m: result.timeframes["15m"].length,
      candles1h: result.timeframes["1h"].length,
      firstTimestamp: result.diagnostics.firstTimestamp,
      lastTimestamp: result.diagnostics.lastTimestamp,
      apiCalls: result.diagnostics.actualApiCalls,
      retries: result.diagnostics.retryCount,
      splits: result.diagnostics.splitCount,
      gaps: result.diagnostics.internalGapCount,
      duplicates: result.diagnostics.duplicateCount,
      conflicts: result.diagnostics.duplicateConflictCount,
      invalidCandles: result.diagnostics.invalidCandleCount,
      truncationEvidence: result.diagnostics.providerTruncationDetected,
      timings: result.timings,
      errorCode: result.diagnostics.errorCode,
    }));
    if (result.status === "BLOCKED" || result.status === "FAILED") process.exitCode = 1;
  }
}
