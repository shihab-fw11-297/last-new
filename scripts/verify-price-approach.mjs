import { createHash } from "node:crypto";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity } from "../lib/traderbrain/analysis/liquidity.ts";
import { analyzePriceApproach, createPriceApproachEngine } from
  "../lib/traderbrain/analysis/price-approach.ts";

const timeframes = ["1m", "5m", "15m", "1h"];
function digest(items) {
  const hash = createHash("sha256");
  for (const item of items) hash.update(JSON.stringify(item));
  return hash.digest("hex");
}

if (!process.env.FINAGE_API_KEY) {
  console.error("FINAGE_API_KEY is unavailable; real Phase 5 verification cannot run.");
  process.exitCode = 1;
} else {
  const historical = await new HistoricalService(new FinageClient(process.env.FINAGE_API_KEY),
    new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles("2026-03-01", "2026-03-05");
  const psychology = analyzeHistoricalPsychology(historical);
  const structure = analyzeHistoricalMarketStructure(historical, psychology);
  const liquidity = analyzeHistoricalLiquidity(structure, psychology);
  const upstream = [historical.status, psychology.status, structure.status, liquidity.status];
  if (!upstream.every((status) => status === "READY" || status === "WARN")) {
    console.error(`Upstream status prevents approach verification: ${upstream.join("/")}`);
    process.exitCode = 1;
  } else {
    const candles = historical.candles1m;
    const features = psychology.timeframes["1m"].features;
    const levels = Object.fromEntries(timeframes.map((tf) => [tf, liquidity.timeframes[tf].levels]));
    const before = {
      candles: digest(candles), features: digest(features),
      swings: Object.fromEntries(timeframes.map((tf) => [tf, digest(structure.timeframes[tf].swings)])),
      liquidity: Object.fromEntries(timeframes.map((tf) => [tf, digest(levels[tf])])),
    };
    const approach = analyzePriceApproach(historical, psychology, liquidity);
    const repeat = analyzePriceApproach(historical, psychology, liquidity);
    const engine = createPriceApproachEngine();
    const cursors = Object.fromEntries(timeframes.map((tf) => [tf, 0]));
    for (let i = 0; i < candles.length; i++) {
      const newlyAvailable = [];
      for (const tf of timeframes) {
        const stream = levels[tf];
        while (cursors[tf] < stream.length && stream[cursors[tf]].availableAt <= candles[i].timestamp) {
          newlyAvailable.push(stream[cursors[tf]++]);
        }
      }
      engine.push({ candle: candles[i], psychology: features[i], newLiquidity: newlyAvailable });
    }
    const known = new Map(timeframes.flatMap((tf) => levels[tf].map((item) => [item.id, item])));
    const snapshots = timeframes.flatMap((tf) => Object.values(approach.current[tf]).filter(Boolean));
    const finiteOrNull = (value) => value === null || Number.isFinite(value);
    let valid = approach.status === liquidity.status && approach.diagnostics.processedCandles === candles.length;
    valid &&= approach.diagnostics.invalidSources === 0;
    valid &&= timeframes.every((tf) => approach.diagnostics.activatedByTimeframe[tf] === cursors[tf]);
    valid &&= snapshots.every((item) => {
      const source = known.get(item.liquidityId);
      return source && source.availableAt <= item.timestamp &&
        item.timestamp === candles.at(-1).timestamp &&
        [item.absoluteDistance, item.signedDistance, item.distanceAtr,
          item.distanceChange, item.distanceChangeAtr, item.approachConsistency,
          item.speedAtrPerBar].every(finiteOrNull);
    });
    valid &&= approach.transitions.every((event) => {
      const source = known.get(event.liquidityId);
      return source && event.timestamp >= source.availableAt &&
        event.availableAt === event.timestamp && finiteOrNull(event.distanceAtr);
    });
    valid &&= new Set(approach.transitions.map((event) => event.id)).size === approach.transitions.length;
    valid &&= digest(candles) === before.candles && digest(features) === before.features;
    valid &&= timeframes.every((tf) => digest(structure.timeframes[tf].swings) === before.swings[tf] &&
      digest(levels[tf]) === before.liquidity[tf]);
    valid &&= JSON.stringify(approach.current) === JSON.stringify(repeat.current) &&
      digest(approach.transitions) === digest(repeat.transitions) &&
      JSON.stringify(approach.diagnostics) === JSON.stringify(repeat.diagnostics);
    valid &&= JSON.stringify(approach.current) === JSON.stringify(engine.current) &&
      digest(approach.transitions) === digest(engine.transitions) &&
      JSON.stringify(approach.diagnostics) === JSON.stringify(engine.diagnostics);
    console.log(JSON.stringify({ status: approach.status, valid,
      candlesProcessed: approach.diagnostics.processedCandles,
      liquidityActivated: approach.diagnostics.activatedByTimeframe,
      transitions: approach.diagnostics.transitions,
      approachStates: approach.diagnostics.stateObservations,
      speed: approach.diagnostics.speedObservations,
      behavior: approach.diagnostics.behaviorObservations,
      heapOperations: { pushes: approach.diagnostics.heapPushes,
        pops: approach.diagnostics.heapPops, peeks: approach.diagnostics.heapPeeks,
        partitionCrossings: approach.diagnostics.partitionCrossings },
      timings: approach.timings }));
    if (!valid) process.exitCode = 1;
  }
}
