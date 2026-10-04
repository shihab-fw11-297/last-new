import { createHash } from "node:crypto";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";

function digest(series) {
  const hash = createHash("sha256");
  for (const candle of series) {
    hash.update(`${candle.timestamp}|${candle.open}|${candle.high}|${candle.low}|${candle.close}|${candle.volume}|${candle.timeframe}|${"isComplete" in candle ? candle.isComplete : true}\n`);
  }
  return hash.digest("hex");
}

function sourceSeries(data) {
  return { "1m": data.candles1m, "5m": data.timeframes["5m"],
    "15m": data.timeframes["15m"], "1h": data.timeframes["1h"] };
}

if (!process.env.FINAGE_API_KEY) {
  console.error("FINAGE_API_KEY is unavailable; real Phase 2 verification skipped.");
  process.exitCode = 1;
} else {
  const historical = await new HistoricalService(new FinageClient(process.env.FINAGE_API_KEY),
    new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles("2026-03-01", "2026-03-05");
  if (historical.status !== "READY" && historical.status !== "WARN") {
    console.error(`Phase 1 returned ${historical.status}; Phase 2 verification cannot proceed.`);
    process.exitCode = 1;
  } else {
    const sources = sourceSeries(historical);
    const before = Object.fromEntries(Object.entries(sources).map(([tf, candles]) => [tf, digest(candles)]));
    const psychology = analyzeHistoricalPsychology(historical);
    let aligned = true;
    let finite = true;
    let atrReadyCorrectly = true;
    let latestSane = true;
    for (const tf of ["1m", "5m", "15m", "1h"]) {
      const candles = sources[tf];
      const features = psychology.timeframes[tf].features;
      aligned &&= features.length === candles.length;
      for (let i = 0; i < features.length; i++) {
        const feature = features[i];
        aligned &&= feature.timestamp === candles[i].timestamp;
        atrReadyCorrectly &&= feature.atrReady === (i >= psychology.config.atrPeriod - 1);
        for (const value of Object.values(feature)) {
          if (typeof value === "number" && !Number.isFinite(value)) finite = false;
        }
      }
      const latest = psychology.timeframes[tf].latest;
      if (latest) latestSane &&= latest.range >= latest.body && latest.upperWick >= 0 && latest.lowerWick >= 0;
    }
    const unchanged = Object.entries(sources).every(([tf, candles]) => before[tf] === digest(candles));
    const result = {
      phase1Status: historical.status,
      psychologyStatus: psychology.status,
      counts: Object.fromEntries(Object.entries(psychology.timeframes).map(([tf, item]) => [tf, item.features.length])),
      aligned, unchanged, finite, atrReadyCorrectly, latestSane,
      latest1m: psychology.timeframes["1m"].latest,
      timings: psychology.timings,
    };
    console.log(JSON.stringify(result));
    if (!aligned || !unchanged || !finite || !atrReadyCorrectly || !latestSane ||
        psychology.status !== historical.status) process.exitCode = 1;
  }
}
