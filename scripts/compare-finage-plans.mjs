import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";

const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable");
const [from = "2026-03-02", to = "2026-03-14"] = process.argv.slice(2);

const directService = new HistoricalService(new FinageClient(key),
  new MemoryCandleStore(), { log: () => {} });
const direct = await directService.getHistoricalCandles(from, to);

const primedService = new HistoricalService(new FinageClient(key),
  new MemoryCandleStore(), { log: () => {} });
await primedService.getHistoricalCandles("2026-03-03", "2026-03-04");
const primed = await primedService.getHistoricalCandles(from, to);

const directByTime = new Map(direct.candles1m.map((item) => [item.timestamp, item]));
const primedByTime = new Map(primed.candles1m.map((item) => [item.timestamp, item]));
const onlyDirect = direct.candles1m.filter((item) => !primedByTime.has(item.timestamp));
const onlyPrimed = primed.candles1m.filter((item) => !directByTime.has(item.timestamp));
const conflicts = direct.candles1m.filter((item) => {
  const other = primedByTime.get(item.timestamp);
  return other && (item.open !== other.open || item.high !== other.high ||
    item.low !== other.low || item.close !== other.close || item.volume !== other.volume);
});
const conflictPairs = conflicts.slice(0, 10).map((item) => ({
  timestamp: item.timestamp, utc: new Date(item.timestamp).toISOString(),
  direct: { o: item.open, h: item.high, l: item.low, c: item.close, v: item.volume },
  primed: (() => { const other = primedByTime.get(item.timestamp); return other ?
    { o: other.open, h: other.high, l: other.low, c: other.close, v: other.volume } : null; })(),
}));
const sample = (items) => items.slice(0, 10).map((item) => ({
  timestamp: item.timestamp, utc: new Date(item.timestamp).toISOString(),
  o: item.open, h: item.high, l: item.low, c: item.close, v: item.volume,
}));
console.log(JSON.stringify({ from, to,
  direct: { status: direct.status, candles: direct.candles1m.length,
    calls: direct.diagnostics.actualApiCalls, retries: direct.diagnostics.retryCount,
    splits: direct.diagnostics.splitCount, gaps: direct.diagnostics.internalGapCount,
    missingMinutes: direct.diagnostics.internalMissingMinuteCount },
  primed: { status: primed.status, candles: primed.candles1m.length,
    callsForFullAfterPrime: primed.diagnostics.actualApiCalls,
    retries: primed.diagnostics.retryCount, splits: primed.diagnostics.splitCount,
    gaps: primed.diagnostics.internalGapCount,
    missingMinutes: primed.diagnostics.internalMissingMinuteCount },
  onlyDirect: onlyDirect.length, onlyPrimed: onlyPrimed.length,
  conflictingSharedTimestamps: conflicts.length,
  samples: { onlyDirect: sample(onlyDirect), onlyPrimed: sample(onlyPrimed),
    conflicts: conflictPairs } }, null, 2));
