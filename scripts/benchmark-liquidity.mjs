import { analyzeLiquidity } from "../lib/traderbrain/analysis/liquidity.ts";

const cases = [["1m", 80_000, 60_000], ["5m", 16_000, 300_000],
  ["15m", 5_333, 900_000], ["1h", 1_333, 3_600_000]];
const results = {};
let totalMs = 0;
let scaling;

function measure(input, source) {
  const result = analyzeLiquidity(input, source);
  if (result.status !== "READY" || result.diagnostics.swingsProcessed !== input.swings.length) {
    throw new Error("Liquidity benchmark count mismatch");
  }
  return { ms: result.timingMs, levels: result.levels.length };
}

for (const [timeframe, count, step] of cases) {
  const features = Array.from({ length: count * 2 }, (_, index) => ({
    timestamp: 1_700_000_000_000 + index * step, timeframe, atr: 10, atrReady: true,
  }));
  const swings = Array.from({ length: count }, (_, index) => {
    const sourceIndex = index * 2;
    const type = index % 2 ? "SWING_LOW" : "SWING_HIGH";
    const createdAt = features[sourceIndex].timestamp;
    const availableAt = features[sourceIndex + 1].timestamp;
    return {
      id: `XAUUSD:${timeframe}:${type}:${sourceIndex}:${createdAt}:${availableAt}`,
      timeframe, type, timestamp: createdAt,
      price: (type === "SWING_HIGH" ? 2650 : 2640) +
        Math.floor(index / 10) * 2 + (index % 10) * 0.05,
      sourceIndex, createdAt, availableAt, previousSameTypeSwingId: null,
      classification: "UNCLASSIFIED",
    };
  });
  const input = { status: "READY", timeframe, swings };
  for (let i = 0; i < 3; i++) {
    measure({ ...input, swings: swings.slice(0, Math.min(count, 10_000)) }, features);
  }
  if (timeframe === "1m") {
    const halfTimes = [];
    for (let i = 0; i < 3; i++) {
      global.gc?.();
      halfTimes.push(measure({ ...input, swings: swings.slice(0, count / 2) }, features).ms);
    }
    halfTimes.sort((a, b) => a - b);
    scaling = { halfCount: count / 2, halfMs: halfTimes[1], fullCount: count };
  }
  global.gc?.();
  const result = measure(input, features);
  results[timeframe] = { swings: count, levels: result.levels, ms: result.ms };
  if (timeframe === "1m") {
    const fullTimes = [result.ms];
    for (let i = 0; i < 2; i++) {
      global.gc?.();
      fullTimes.push(measure(input, features).ms);
    }
    fullTimes.sort((a, b) => a - b);
    scaling.fullMs = fullTimes[1];
    scaling.ratio = scaling.fullMs / scaling.halfMs;
  }
  totalMs += result.ms;
}
console.log(JSON.stringify({ syntheticStructureFixture: true, timeframes: results, scaling, totalMs }));
