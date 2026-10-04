import { createHash } from "node:crypto";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity } from "../lib/traderbrain/analysis/liquidity.ts";
import { createPriceApproachEngine } from "../lib/traderbrain/analysis/price-approach.ts";
import { analyzeLiquidityInteractions, createLiquidityInteractionEngine } from
  "../lib/traderbrain/analysis/liquidity-interaction.ts";

const timeframes = ["1m", "5m", "15m", "1h"];
function digest(items) {
  const hash = createHash("sha256");
  for (const item of items) hash.update(JSON.stringify(item));
  return hash.digest("hex");
}

if (!process.env.FINAGE_API_KEY) {
  console.error("FINAGE_API_KEY is unavailable; real Phase 6 verification cannot run.");
  process.exitCode = 1;
} else {
  const historical = await new HistoricalService(new FinageClient(process.env.FINAGE_API_KEY),
    new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles("2026-03-01", "2026-03-05");
  const psychology = analyzeHistoricalPsychology(historical);
  const structure = analyzeHistoricalMarketStructure(historical, psychology);
  const liquidity = analyzeHistoricalLiquidity(structure, psychology);
  const upstream = [historical.status, psychology.status, structure.status, liquidity.status];
  if (!upstream.every((status) => status === "READY" || status === "WARN")) {
    console.error(`Upstream status prevents interaction verification: ${upstream.join("/")}`);
    process.exitCode = 1;
  } else {
    const candles = historical.candles1m;
    const features = psychology.timeframes["1m"].features;
    const levels = Object.fromEntries(timeframes.map((tf) => [tf, liquidity.timeframes[tf].levels]));
    const before = {
      candles: digest(candles), features: digest(features),
      swings: Object.fromEntries(timeframes.map((tf) => [tf, digest(structure.timeframes[tf].swings)])),
      levels: Object.fromEntries(timeframes.map((tf) => [tf, digest(levels[tf])])),
    };
    const result = analyzeLiquidityInteractions(historical, psychology, liquidity);
    const repeat = analyzeLiquidityInteractions(historical, psychology, liquidity);
    const approachEngine = createPriceApproachEngine();
    const interactionEngine = createLiquidityInteractionEngine();
    const cursors = Object.fromEntries(timeframes.map((tf) => [tf, 0]));
    for (let i = 0; i < candles.length; i++) {
      const newlyAvailable = [];
      for (const tf of timeframes) {
        const stream = levels[tf];
        while (cursors[tf] < stream.length && stream[cursors[tf]].availableAt <= candles[i].timestamp) {
          newlyAvailable.push(stream[cursors[tf]++]);
        }
      }
      const current = approachEngine.push({ candle: candles[i], psychology: features[i],
        newLiquidity: newlyAvailable });
      interactionEngine.push({ candle: candles[i], psychology: features[i], current });
    }
    const known = new Map(timeframes.flatMap((tf) => levels[tf].map((item) => [item.id, item])));
    const episodes = [...result.completed, ...result.active];
    const episodeIds = new Set(episodes.map((item) => item.id));
    const finiteOrNull = (value) => value === null || Number.isFinite(value);
    let valid = result.status === liquidity.status &&
      result.diagnostics.processedCandles === candles.length &&
      result.diagnostics.invalidSources === 0 && result.diagnostics.integrationInconsistencies === 0;
    valid &&= result.diagnostics.episodesStarted === episodes.length;
    valid &&= result.diagnostics.completedEpisodes === result.completed.length;
    valid &&= result.diagnostics.maximumActiveMapSize >= result.active.length;
    valid &&= result.diagnostics.maximumActiveMapSize <= 8 * result.config.maxInteractionBars;
    valid &&= episodes.every((item) => {
      const source = known.get(item.liquidityId);
      return source && item.createdAt === item.firstTouchAt &&
        item.firstTouchAt >= source.availableAt && item.availableAt >= item.createdAt &&
        item.sourceTimeframe === source.timeframe &&
        [item.maxPenetration, item.maxPenetrationAtr, item.maximumReactionAway,
          item.maximumReactionAwayAtr].every(finiteOrNull);
    });
    valid &&= result.events.every((event) => {
      const source = known.get(event.liquidityId);
      return source && episodeIds.has(event.interactionId) &&
        event.availableAt === event.timestamp && event.createdAt === event.timestamp &&
        event.timestamp >= source.availableAt && Number.isFinite(event.price) &&
        finiteOrNull(event.penetrationAtr) && finiteOrNull(event.reactionAtr);
    });
    valid &&= new Set(result.events.map((event) => event.id)).size === result.events.length;
    valid &&= digest(candles) === before.candles && digest(features) === before.features;
    valid &&= timeframes.every((tf) => digest(structure.timeframes[tf].swings) === before.swings[tf] &&
      digest(levels[tf]) === before.levels[tf]);
    valid &&= digest(result.events) === digest(repeat.events) &&
      digest(result.completed) === digest(repeat.completed) &&
      digest(result.active) === digest(repeat.active) &&
      JSON.stringify(result.diagnostics) === JSON.stringify(repeat.diagnostics);
    valid &&= digest(result.events) === digest(interactionEngine.events) &&
      digest(result.completed) === digest(interactionEngine.completed) &&
      digest(result.active) === digest(interactionEngine.activeEpisodes) &&
      JSON.stringify(result.diagnostics) === JSON.stringify(interactionEngine.diagnostics);
    console.log(JSON.stringify({ status: result.status, valid,
      candlesProcessed: result.diagnostics.processedCandles,
      candidatesProcessed: result.diagnostics.candidatesProcessed,
      episodesStarted: result.diagnostics.episodesStarted,
      eventCounts: result.diagnostics.events,
      completedEpisodes: result.diagnostics.completedEpisodes,
      activeEpisodes: result.active.length,
      maximumActiveMapSize: result.diagnostics.maximumActiveMapSize,
      timings: result.timings }));
    if (!valid) process.exitCode = 1;
  }
}
