import { analyzeCandleSeries } from "../lib/traderbrain/analysis/candle-psychology.ts";

const cases = [
  ["1m", 100_000, 60_000],
  ["5m", 20_000, 300_000],
  ["15m", 6_667, 900_000],
  ["1h", 1_667, 3_600_000],
];
const results = {};
let totalMs = 0;
for (const [timeframe, count, step] of cases) {
  const candles = Array.from({ length: count }, (_, i) => {
    const open = 2_000 + i * 0.001 + Math.sin(i / 17) * 2;
    return { timestamp: i * step, open, high: open + 1, low: open - 1,
      close: open + Math.sin(i) * 0.5, volume: null, symbol: "XAUUSD", timeframe };
  });
  const start = performance.now();
  const features = analyzeCandleSeries(candles, timeframe);
  const elapsed = performance.now() - start;
  if (features.length !== count) throw new Error("Psychology feature count mismatch");
  results[timeframe] = { count, ms: elapsed };
  totalMs += elapsed;
}
console.log(JSON.stringify({ syntheticPerformanceFixture: true, timeframes: results, totalMs }));
