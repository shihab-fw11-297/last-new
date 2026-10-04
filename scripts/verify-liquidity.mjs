import { createHash } from "node:crypto";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity } from "../lib/traderbrain/analysis/liquidity.ts";

function digest(items) {
  const hash = createHash("sha256");
  for (const item of items) hash.update(JSON.stringify(item));
  return hash.digest("hex");
}

if (!process.env.FINAGE_API_KEY) {
  console.error("FINAGE_API_KEY is unavailable; real Phase 4 verification cannot run.");
  process.exitCode = 1;
} else {
  const historical = await new HistoricalService(new FinageClient(process.env.FINAGE_API_KEY),
    new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles("2026-03-01", "2026-03-05");
  const psychology = analyzeHistoricalPsychology(historical);
  const structure = analyzeHistoricalMarketStructure(historical, psychology);
  const acceptable = ["READY", "WARN"];
  if (![historical.status, psychology.status, structure.status].every((status) => acceptable.includes(status))) {
    console.error(`Upstream status prevents liquidity verification: ${historical.status}/${psychology.status}/${structure.status}`);
    process.exitCode = 1;
  } else {
    const timeframes = ["1m", "5m", "15m", "1h"];
    const candles = { "1m": historical.candles1m, "5m": historical.timeframes["5m"],
      "15m": historical.timeframes["15m"], "1h": historical.timeframes["1h"] };
    const before = Object.fromEntries(timeframes.map((tf) => [tf, {
      candles: digest(candles[tf]), features: digest(psychology.timeframes[tf].features),
      swings: digest(structure.timeframes[tf].swings), events: digest(structure.timeframes[tf].events),
    }]));
    const liquidity = analyzeHistoricalLiquidity(structure, psychology);
    const repeat = analyzeHistoricalLiquidity(structure, psychology);
    let valid = acceptable.includes(liquidity.status);
    const summaries = {};
    for (const tf of timeframes) {
      const result = liquidity.timeframes[tf];
      const swings = structure.timeframes[tf].swings;
      const sources = new Map(swings.map((s) => [s.id, s]));
      const raw = result.levels.filter((level) => level.kind === "SWING");
      const eqh = result.levels.filter((level) => level.kind === "EQH");
      const eql = result.levels.filter((level) => level.kind === "EQL");
      valid &&= result.status === "READY" && result.diagnostics.swingsProcessed === swings.length;
      valid &&= result.diagnostics.invalidSources === 0;
      valid &&= result.diagnostics.bslCreated === swings.filter((s) => s.type === "SWING_HIGH").length;
      valid &&= result.diagnostics.sslCreated === swings.filter((s) => s.type === "SWING_LOW").length;
      valid &&= result.diagnostics.eqhCreated === eqh.length && result.diagnostics.eqlCreated === eql.length;
      valid &&= raw.length === swings.length;
      valid &&= new Set(result.levels.map((level) => level.id)).size === result.levels.length;
      valid &&= result.levels.every((level) => {
        const parents = level.sourceSwingIds.map((id) => sources.get(id));
        if (parents.some((parent) => !parent) || !Number.isFinite(level.price) ||
            level.timeframe !== tf || level.sourceTimeframe !== tf ||
            level.availableAt < level.createdAt) return false;
        if (level.kind === "SWING") return parents.length === 1 &&
          level.createdAt === parents[0].createdAt && level.availableAt === parents[0].availableAt &&
          level.price === parents[0].price;
        return parents.length === 2 && parents[0].availableAt <= parents[1].availableAt &&
          level.createdAt === parents[1].createdAt && level.availableAt === parents[1].availableAt &&
          parents[0].type === parents[1].type;
      });
      valid &&= before[tf].candles === digest(candles[tf]);
      valid &&= before[tf].features === digest(psychology.timeframes[tf].features);
      valid &&= before[tf].swings === digest(swings);
      valid &&= before[tf].events === digest(structure.timeframes[tf].events);
      valid &&= digest(result.levels) === digest(repeat.timeframes[tf].levels);
      valid &&= JSON.stringify(result.diagnostics) === JSON.stringify(repeat.timeframes[tf].diagnostics);
      summaries[tf] = {
        swingsProcessed: result.diagnostics.swingsProcessed,
        BSL: result.diagnostics.bslCreated, SSL: result.diagnostics.sslCreated,
        EQH: result.diagnostics.eqhCreated, EQL: result.diagnostics.eqlCreated,
        duplicatesPrevented: result.diagnostics.duplicatesPrevented,
        invalidSources: result.diagnostics.invalidSources, timingMs: result.timingMs,
      };
    }
    console.log(JSON.stringify({ status: liquidity.status, valid, timeframes: summaries,
      totalMs: liquidity.timings.totalMs }));
    if (!valid) process.exitCode = 1;
  }
}
