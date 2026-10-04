import assert from "node:assert/strict";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity } from "../lib/traderbrain/analysis/liquidity.ts";
import { analyzeLiquidityInteractions } from "../lib/traderbrain/analysis/liquidity-interaction.ts";
import { analyzeHistoricalControl, createControlEngine } from
  "../lib/traderbrain/analysis/control-engine.ts";

if (!process.env.FINAGE_API_KEY) {
  console.error("FINAGE_API_KEY is unavailable; real Phase 7 verification cannot run.");
  process.exitCode = 1;
} else {
  const historical = await new HistoricalService(new FinageClient(process.env.FINAGE_API_KEY),
    new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles("2026-03-01", "2026-03-05");
  const psychology = analyzeHistoricalPsychology(historical);
  const structure = analyzeHistoricalMarketStructure(historical, psychology);
  const liquidity = analyzeHistoricalLiquidity(structure, psychology);
  const interaction = analyzeLiquidityInteractions(historical, psychology, liquidity);
  const result = analyzeHistoricalControl(historical, psychology, structure, interaction);
  const repeat = analyzeHistoricalControl(historical, psychology, structure, interaction);
  const candles = historical.candles1m;
  const features = psychology.timeframes["1m"].features;
  const structureEvents = structure.timeframes["1m"].events;
  const engine = createControlEngine();
  const prefixes = new Map();
  for (let i = 0; i < candles.length; i++) {
    engine.push({ candle: candles[i], psychology: features[i],
      interactionEvents: interaction.events, structureEvents });
    if (i === 1000 || i === 2000) {
      prefixes.set(i, { states: structuredClone(engine.stateChanges),
        transfers: structuredClone(engine.transfers), current: engine.current });
    }
  }
  const clean = (output) => ({ current: output.current,
    stateChanges: output.stateChanges, transfers: output.transfers,
    diagnostics: output.diagnostics });
  assert.ok(result.status === "READY" || result.status === "WARN",
    JSON.stringify({ statuses: [historical.status, psychology.status, structure.status,
      liquidity.status, interaction.status, result.status],
    historicalError: historical.diagnostics.errorCode,
    interactionError: interaction.diagnostics.errorCode,
    controlError: result.diagnostics.errorCode,
    controlErrorIndex: result.diagnostics.errorIndex }));
  assert.deepEqual(clean(result), clean(repeat));
  assert.deepEqual(result.stateChanges, engine.stateChanges);
  assert.deepEqual(result.transfers, engine.transfers);
  assert.deepEqual(result.current, engine.current);
  assert.deepEqual(result.diagnostics, engine.diagnostics);
  for (const [index, prefix] of prefixes) {
    const time = candles[index].timestamp;
    assert.deepEqual(prefix.states, result.stateChanges.filter((event) => event.availableAt <= time));
    assert.deepEqual(prefix.transfers, result.transfers.filter((event) => event.availableAt <= time));
    assert.equal(prefix.current.timestamp, time);
  }
  assert.equal(result.diagnostics.processedCandles, candles.length);
  assert.equal(result.diagnostics.interactionEventsConsumed, interaction.events.length);
  assert.equal(result.diagnostics.structureEventsConsumed, structureEvents.length);
  assert.ok(result.stateChanges.every((event) =>
    event.availableAt === event.timestamp && event.createdAt === event.timestamp));
  assert.ok(result.transfers.every((event) =>
    event.availableAt === event.createdAt &&
    event.interactionId && event.liquidityId));
  console.log(JSON.stringify({
    status: result.status,
    candlesProcessed: candles.length,
    interactionEventsConsumed: result.diagnostics.interactionEventsConsumed,
    structureEventsConsumed: result.diagnostics.structureEventsConsumed,
    stateChanges: result.diagnostics.stateChanges,
    transfers: result.diagnostics.transfers,
    failedTransferCandidates: result.diagnostics.failedTransferCandidates,
    current: result.current,
    timings: result.timings,
    upstream: { historical: historical.status, psychology: psychology.status,
      structure: structure.status, liquidity: liquidity.status,
      interaction: interaction.status },
    checks: { batchIncremental: "PASS", prefix: "PASS",
      determinism: "PASS", causalTimestamps: "PASS" },
  }));
}
