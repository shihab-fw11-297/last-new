import { analyzeCandleSeries } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";

const cases = [
  ["1m", 100_000, 60_000],
  ["5m", 20_000, 300_000],
  ["15m", 6_667, 900_000],
  ["1h", 1_667, 3_600_000],
];
const results = {};
let totalMs = 0;
let scaling = null;
for (const [timeframe, count, step] of cases) {
  const candles = Array.from({ length: count }, (_, i) => {
    const close = 2_000 + Math.sin(i / 6) * 5 + i * 0.002;
    const base = { timestamp: i * step, open: close, high: close + 1, low: close - 1,
      close, volume: null, symbol: "XAUUSD", timeframe };
    return timeframe === "1m" ? base : { ...base, bucketStart: i * step, bucketEnd: (i + 1) * step,
      sourceCount: step / 60_000, isComplete: true };
  });
  const psychology = analyzeCandleSeries(candles, timeframe);
  if (timeframe === "1m") {
    analyzeMarketStructure(candles.slice(0, 5_000), psychology.slice(0, 5_000), timeframe);
    const half = analyzeMarketStructure(candles.slice(0, count / 2),
      psychology.slice(0, count / 2), timeframe);
    scaling = { halfCount: count / 2, halfMs: half.timingMs, fullCount: count };
  }
  const structure = analyzeMarketStructure(candles, psychology, timeframe);
  if (structure.status !== "READY" || structure.diagnostics.processedCandles !== count) {
    throw new Error("Structure benchmark count mismatch");
  }
  results[timeframe] = { count, ms: structure.timingMs,
    swings: structure.swings.length, events: structure.events.length };
  if (timeframe === "1m") scaling.fullMs = structure.timingMs;
  totalMs += structure.timingMs;
}
console.log(JSON.stringify({ syntheticPerformanceFixture: true, timeframes: results, scaling, totalMs }));
