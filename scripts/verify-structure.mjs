import { createHash } from "node:crypto";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";

function digest(items) {
  const hash = createHash("sha256");
  for (const item of items) hash.update(JSON.stringify(item));
  return hash.digest("hex");
}

if (!process.env.FINAGE_API_KEY) {
  console.error("FINAGE_API_KEY is unavailable; real Phase 3 verification skipped.");
  process.exitCode = 1;
} else {
  const historical = await new HistoricalService(new FinageClient(process.env.FINAGE_API_KEY),
    new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles("2026-03-01", "2026-03-05");
  const psychology = analyzeHistoricalPsychology(historical);
  if (!["READY", "WARN"].includes(historical.status) || !["READY", "WARN"].includes(psychology.status)) {
    console.error(`Upstream status prevents structure verification: ${historical.status}/${psychology.status}`);
    process.exitCode = 1;
  } else {
    const candles = { "1m": historical.candles1m, "5m": historical.timeframes["5m"],
      "15m": historical.timeframes["15m"], "1h": historical.timeframes["1h"] };
    const beforeCandles = Object.fromEntries(Object.entries(candles).map(([tf, series]) => [tf, digest(series)]));
    const beforeFeatures = Object.fromEntries(Object.entries(psychology.timeframes)
      .map(([tf, item]) => [tf, digest(item.features)]));
    const structure = analyzeHistoricalMarketStructure(historical, psychology);
    const summaries = {};
    let valid = structure.status === historical.status;
    for (const tf of ["1m", "5m", "15m", "1h"]) {
      const series = structure.timeframes[tf];
      const knownIds = new Set(series.swings.map((s) => s.id));
      const source = candles[tf];
      valid &&= series.status === "READY" && series.diagnostics.processedCandles === source.length;
      valid &&= beforeCandles[tf] === digest(source);
      valid &&= beforeFeatures[tf] === digest(psychology.timeframes[tf].features);
      valid &&= series.swings.every((s) => s.availableAt >= s.createdAt &&
        source[s.sourceIndex]?.timestamp === s.createdAt && Number.isFinite(s.price));
      valid &&= series.events.every((e) => knownIds.has(e.brokenSwingId) &&
        e.createdAt === e.availableAt && e.availableAt === e.timestamp && Number.isFinite(e.price));
      const protectedHigh = series.swings.find((s) => s.id === series.current.protectedHighId);
      const protectedLow = series.swings.find((s) => s.id === series.current.protectedLowId);
      summaries[tf] = {
        candles: source.length,
        swingHighs: series.diagnostics.swingHighs,
        swingLows: series.diagnostics.swingLows,
        HH: series.diagnostics.HH,
        HL: series.diagnostics.HL,
        LH: series.diagnostics.LH,
        LL: series.diagnostics.LL,
        continuationBreaks: series.diagnostics.continuationBreaks,
        rawShifts: series.diagnostics.rawShifts,
        levelPenetrations: series.diagnostics.levelPenetrations,
        currentState: series.current.state,
        protectedHigh: protectedHigh ? { id: protectedHigh.id, price: protectedHigh.price } : null,
        protectedLow: protectedLow ? { id: protectedLow.id, price: protectedLow.price } : null,
        timingMs: series.timingMs,
      };
    }
    console.log(JSON.stringify({ status: structure.status, valid, timeframes: summaries,
      totalMs: structure.timings.totalMs }));
    if (!valid) process.exitCode = 1;
  }
}
