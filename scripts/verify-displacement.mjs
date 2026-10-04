import assert from "node:assert/strict";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity } from "../lib/traderbrain/analysis/liquidity.ts";
import { analyzeLiquidityInteractions } from "../lib/traderbrain/analysis/liquidity-interaction.ts";
import { createControlEngine } from
  "../lib/traderbrain/analysis/control-engine.ts";
import { analyzeHistoricalDisplacement, createDisplacementEngine } from
  "../lib/traderbrain/analysis/displacement-engine.ts";

if (!process.env.FINAGE_API_KEY) {
  console.error("FINAGE_API_KEY is unavailable; real Phase 8 verification cannot run.");
  process.exitCode = 1;
} else {
  const historical = await new HistoricalService(new FinageClient(process.env.FINAGE_API_KEY),
    new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles("2026-03-01", "2026-03-05");
  const psychology = analyzeHistoricalPsychology(historical);
  const structure = analyzeHistoricalMarketStructure(historical, psychology);
  const liquidity = analyzeHistoricalLiquidity(structure, psychology);
  const interaction = analyzeLiquidityInteractions(historical, psychology, liquidity);
  const batch = analyzeHistoricalDisplacement(historical, psychology, structure, interaction);
  const repeat = analyzeHistoricalDisplacement(historical, psychology, structure, interaction);
  assert.ok(batch.status === "READY" || batch.status === "WARN",
    JSON.stringify({ upstream: [historical.status, psychology.status, structure.status,
      liquidity.status, interaction.status], status: batch.status,
    error: batch.diagnostics.errorCode, index: batch.diagnostics.errorIndex,
    historicalError: historical.diagnostics.errorCode }));
  const candles = historical.candles1m;
  const features = psychology.timeframes["1m"].features;
  const control = createControlEngine();
  const displacement = createDisplacementEngine();
  const prefixes = new Map();
  for (let i = 0; i < candles.length; i++) {
    const snapshot = control.push({ candle: candles[i], psychology: features[i],
      interactionEvents: interaction.events,
      structureEvents: structure.timeframes["1m"].events });
    displacement.push({ candle: candles[i], psychology: features[i],
      control: snapshot, controlTransferEvents: control.transfers });
    if (i === 1000 || i === 2000) {
      prefixes.set(i, { ignitions: structuredClone(displacement.ignitions),
        confirmed: structuredClone(displacement.confirmed),
        failed: structuredClone(displacement.failed) });
    }
  }
  const stable = (value) => ({ ignitions: value.ignitions, confirmed: value.confirmed,
    failed: value.failed, active: value.active, diagnostics: value.diagnostics });
  assert.deepEqual(stable(batch), stable(repeat));
  assert.deepEqual(batch.ignitions, displacement.ignitions);
  assert.deepEqual(batch.confirmed, displacement.confirmed);
  assert.deepEqual(batch.failed, displacement.failed);
  assert.deepEqual(batch.active, displacement.active);
  assert.deepEqual(batch.diagnostics, displacement.diagnostics);
  for (const [index, prefix] of prefixes) {
    const timestamp = candles[index].timestamp;
    assert.deepEqual(prefix.ignitions,
      batch.ignitions.filter((event) => event.availableAt <= timestamp));
    assert.deepEqual(prefix.confirmed,
      batch.confirmed.filter((event) => event.availableAt <= timestamp));
    assert.deepEqual(prefix.failed,
      batch.failed.filter((event) => event.availableAt <= timestamp));
  }
  assert.equal(batch.diagnostics.processedCandles, candles.length);
  assert.equal(batch.diagnostics.controlTransfersConsumed, control.transfers.length);
  assert.ok(batch.ignitions.every((event) =>
    event.createdAt === event.availableAt && event.timestamp === event.availableAt));
  assert.ok(batch.confirmed.every((event) =>
    event.ignitionAt === event.createdAt && event.confirmedAt === event.availableAt &&
    event.createdAt < event.availableAt && event.referenceAtr > 0 &&
    event.totalTravelAtr === event.totalTravel / event.referenceAtr));
  assert.ok(batch.failed.every((event) =>
    event.ignitionAt === event.createdAt && event.failedAt === event.availableAt &&
    event.createdAt < event.availableAt));
  const top = Object.entries(batch.diagnostics.failureReasons)
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topRejections = Object.entries(batch.diagnostics.ignitionRejections)
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(JSON.stringify({
    status: batch.status, candlesProcessed: candles.length,
    controlTransfersConsumed: batch.diagnostics.controlTransfersConsumed,
    ignitions: batch.diagnostics.ignitions,
    candidates: batch.diagnostics.candidates,
    valid: batch.diagnostics.valid, strong: batch.diagnostics.strong,
    extreme: batch.diagnostics.extreme, failed: batch.diagnostics.failed,
    transferContext: batch.diagnostics.transferContext,
    continuationContext: batch.diagnostics.continuationContext,
    averageBarsToConfirm: batch.confirmed.length ?
      batch.diagnostics.totalBarsToConfirm / batch.confirmed.length : null,
    topFailureReasons: top, topIgnitionRejections: topRejections,
    active: batch.active, timings: batch.timings,
    upstream: { historical: historical.status, psychology: psychology.status,
      structure: structure.status, liquidity: liquidity.status,
      interaction: interaction.status },
    checks: { referenceAtr: "PASS", batchIncremental: "PASS",
      prefix: "PASS", determinism: "PASS", causalTimestamps: "PASS" },
  }));
}
