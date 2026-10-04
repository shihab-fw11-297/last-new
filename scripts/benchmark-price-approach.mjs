import { analyzePriceApproach } from "../lib/traderbrain/analysis/price-approach.ts";

const timeframes = ["1m", "5m", "15m", "1h"];
const every = { "1m": 3, "5m": 15, "15m": 45, "1h": 180 };
const start = 1_700_000_000_000;

function fixture(count) {
  const candles = Array.from({ length: count }, (_, i) => {
    const close = 2650 + Math.sin(i / 25) * 10;
    return { timestamp: start + i * 60_000, open: close, high: close + 0.5,
      low: close - 0.5, close, volume: null, symbol: "XAUUSD", timeframe: "1m" };
  });
  const evidence = { compression: false, expansion: false,
    momentumIncreasing: false, momentumDecaying: false };
  const features = candles.map((source) => ({ timestamp: source.timestamp, timeframe: "1m",
    sourceComplete: true, atr: 5, atrReady: true, directionalEfficiency: 0.7, evidence }));
  const liquidity = { status: "READY", timeframes: Object.fromEntries(timeframes.map((tf) => {
    const levels = Array.from({ length: Math.floor((count - 1) / every[tf]) + 1 }, (_, i) => {
      const availableAt = start + i * every[tf] * 60_000;
      const price = 2650 + Math.sin(i / 5) * 12 + (tf === "1h" ? 2 : 0);
      return { id: `XAUUSD:${tf}:SWING:${i}`, timeframe: tf, sourceTimeframe: tf,
        kind: "SWING", side: i % 2 ? "SSL" : "BSL", price,
        createdAt: availableAt, availableAt, sourceSwingIds: [`swing:${tf}:${i}`],
        sourceClassifications: ["UNCLASSIFIED"] };
    });
    return [tf, { status: "READY", timeframe: tf, levels }];
  })) };
  return { historical: { status: "READY", candles1m: candles },
    psychology: { status: "READY", timeframes: { "1m": { features } } }, liquidity };
}

const small = fixture(25_000);
const large = fixture(50_000);
analyzePriceApproach({ ...small.historical, candles1m: small.historical.candles1m.slice(0, 2_000) },
  { ...small.psychology, timeframes: { "1m": {
    features: small.psychology.timeframes["1m"].features.slice(0, 2_000) } } }, small.liquidity);
const half = analyzePriceApproach(small.historical, small.psychology, small.liquidity);
const full = analyzePriceApproach(large.historical, large.psychology, large.liquidity);
if (half.status !== "READY" || full.status !== "READY" ||
    half.diagnostics.processedCandles !== 25_000 || full.diagnostics.processedCandles !== 50_000) {
  throw new Error("Price approach benchmark failed");
}
console.log(JSON.stringify({ syntheticFixture: true,
  half: { candles: 25_000, levels: Object.values(small.liquidity.timeframes)
    .reduce((sum, item) => sum + item.levels.length, 0),
    crossings: half.diagnostics.partitionCrossings, transitions: half.diagnostics.transitions,
    timings: half.timings },
  full: { candles: 50_000, levels: Object.values(large.liquidity.timeframes)
    .reduce((sum, item) => sum + item.levels.length, 0),
    crossings: full.diagnostics.partitionCrossings, transitions: full.diagnostics.transitions,
    timings: full.timings },
  scalingRatio: full.timings.totalMs / half.timings.totalMs }));
