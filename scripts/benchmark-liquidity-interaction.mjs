import { performance } from "node:perf_hooks";
import { createLiquidityInteractionEngine } from
  "../lib/traderbrain/analysis/liquidity-interaction.ts";

const timeframes = ["1m", "5m", "15m", "1h"];
const start = 1_700_000_000_000;
const evidence = { upperRejection: false, lowerRejection: false };

function fixture(count) {
  return Array.from({ length: count }, (_, i) => {
    const close = i % 10 === 0 ? 99.5 : 95 + Math.sin(i / 9) * 2;
    const low = i % 10 === 0 ? 99 : close - 0.2;
    const high = i % 10 === 0 ? 101.5 : close + 0.2;
    const timestamp = start + i * 60_000;
    const candle = { timestamp, open: close, high, low, close,
      volume: null, symbol: "XAUUSD", timeframe: "1m" };
    const psychology = { timestamp, timeframe: "1m", sourceComplete: true,
      atrReady: true, atr: 10, evidence };
    const current = Object.fromEntries(timeframes.map((tf) => [tf, {
      above: { timestamp, liquidityId: `${tf}:BSL:100`, liquidityType: "SWING",
        liquiditySide: "BSL", sourceTimeframe: tf, liquidityPrice: 100,
        currentPrice: close, state: low <= 100 && high >= 100 ? "TOUCHING" : "FAR" },
      below: null,
    }]));
    return { candle, psychology, current };
  });
}

function measure(inputs) {
  const engine = createLiquidityInteractionEngine();
  const started = performance.now();
  for (const input of inputs) engine.push(input);
  return { totalMs: performance.now() - started, candles: inputs.length,
    candidates: engine.diagnostics.candidatesProcessed,
    episodes: engine.diagnostics.episodesStarted,
    completed: engine.completed.length, maxActive: engine.diagnostics.maximumActiveMapSize,
    eventCount: engine.events.length, stages: engine.timings };
}

const small = fixture(25_000);
const large = fixture(50_000);
measure(small.slice(0, 2_000));
const half = measure(small);
const full = measure(large);
if (half.candles !== 25_000 || full.candles !== 50_000 ||
    half.maxActive > 8 * 12 || full.maxActive > 8 * 12) {
  throw new Error("Interaction benchmark failed");
}
console.log(JSON.stringify({ syntheticCandidateFixture: true, half, full,
  scalingRatio: full.totalMs / half.totalMs }));
