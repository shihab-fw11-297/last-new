import assert from "node:assert/strict";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity } from "../lib/traderbrain/analysis/liquidity.ts";
import { analyzeLiquidityInteractions } from "../lib/traderbrain/analysis/liquidity-interaction.ts";
import { createControlEngine } from "../lib/traderbrain/analysis/control-engine.ts";
import { createDisplacementEngine } from "../lib/traderbrain/analysis/displacement-engine.ts";
import { analyzeHistoricalStructuralConfirmations, createStructuralConfirmationEngine } from
  "../lib/traderbrain/analysis/structural-confirmation.ts";

if (!process.env.FINAGE_API_KEY) {
  console.error("FINAGE_API_KEY is unavailable; real Phase 9 verification cannot run.");
  process.exitCode = 1;
} else {
  const historical = await new HistoricalService(new FinageClient(process.env.FINAGE_API_KEY),
    new MemoryCandleStore(), { log: () => {} }).getHistoricalCandles("2026-03-01", "2026-03-05");
  const psychology = analyzeHistoricalPsychology(historical);
  const structure = analyzeHistoricalMarketStructure(historical, psychology);
  const liquidity = analyzeHistoricalLiquidity(structure, psychology);
  const interaction = analyzeLiquidityInteractions(historical, psychology, liquidity);
  const batch = analyzeHistoricalStructuralConfirmations(historical, psychology,
    structure, interaction);
  const repeat = analyzeHistoricalStructuralConfirmations(historical, psychology,
    structure, interaction);
  assert.ok(batch.status === "READY" || batch.status === "WARN",
    JSON.stringify({ status: batch.status, error: batch.diagnostics.errorCode,
      index: batch.diagnostics.errorIndex,
      upstream: [historical.status, psychology.status, structure.status,
        liquidity.status, interaction.status] }));
  const candles = historical.candles1m;
  const features = psychology.timeframes["1m"].features;
  const structureEvents = structure.timeframes["1m"].events;
  const control = createControlEngine();
  const displacement = createDisplacementEngine();
  const structural = createStructuralConfirmationEngine();
  const prefixes = new Map();
  for (let i = 0; i < candles.length; i++) {
    const snapshot = control.push({ candle: candles[i], psychology: features[i],
      interactionEvents: interaction.events, structureEvents });
    displacement.push({ candle: candles[i], psychology: features[i],
      control: snapshot, controlTransferEvents: control.transfers });
    structural.push({ timestamp: candles[i].timestamp, currentControl: snapshot,
      structureEvents, controlTransferEvents: control.transfers,
      displacementEvents: displacement.confirmed });
    if (i === 1000 || i === 2000) {
      prefixes.set(i, structuredClone(structural.confirmations));
    }
  }
  assert.deepEqual(batch.confirmations, repeat.confirmations);
  assert.deepEqual(batch.latest, repeat.latest);
  assert.deepEqual(batch.diagnostics, repeat.diagnostics);
  assert.deepEqual(batch.confirmations, structural.confirmations);
  assert.deepEqual(batch.latest, structural.latest);
  assert.deepEqual(batch.diagnostics, structural.diagnostics);
  for (const [index, facts] of prefixes) {
    assert.deepEqual(facts,
      batch.confirmations.filter((event) => event.availableAt <= candles[index].timestamp));
  }
  assert.equal(batch.diagnostics.processedTicks, candles.length);
  assert.equal(batch.diagnostics.structureEventsConsumed, structureEvents.length);
  assert.equal(batch.diagnostics.controlTransfersConsumed, control.transfers.length);
  assert.equal(batch.diagnostics.displacementEventsConsumed, displacement.confirmed.length);
  assert.ok(batch.confirmations.every((event) =>
    event.createdAt <= event.availableAt &&
    [event.createdAt, event.availableAt, event.structurePrice].every(Number.isFinite) &&
    event.structureEventId && event.brokenSwingId && event.displacementEventId));
  assert.equal(new Set(batch.confirmations.map((event) => event.structureEventId)).size,
    batch.confirmations.length);
  const displacementById = new Map(displacement.confirmed.map((event) => [event.id, event]));
  const structureById = new Map(structureEvents.map((event) => [event.id, event]));
  const transferById = new Map(control.transfers.map((event) => [event.id, event]));
  assert.ok(batch.confirmations.every((event) => {
    const raw = structureById.get(event.structureEventId);
    const impulse = displacementById.get(event.displacementEventId);
    const source = event.controlTransferId ? transferById.get(event.controlTransferId) : null;
    return raw && impulse &&
      event.createdAt === raw.createdAt &&
      event.availableAt === Math.max(raw.availableAt, impulse.availableAt,
        source?.availableAt ?? -Infinity) &&
      (!source || (event.interactionId === source.interactionId &&
        event.liquidityId === source.liquidityId));
  }));
  const confirmedCounts = { BULLISH_BOS: 0, BEARISH_BOS: 0,
    BULLISH_MSS: 0, BEARISH_MSS: 0 };
  for (const event of batch.confirmations) confirmedCounts[event.type]++;
  const topRejections = Object.entries(batch.diagnostics.rejectedByReason)
    .sort((a, b) => b[1] - a[1]).filter(([, count]) => count > 0).slice(0, 6);
  const rawContinuation = batch.diagnostics.rawBullishContinuationBreaks +
    batch.diagnostics.rawBearishContinuationBreaks;
  const rawShifts = batch.diagnostics.rawBullishShifts + batch.diagnostics.rawBearishShifts;
  const transferDisplacements = displacement.confirmed.filter((event) =>
    event.context === "TRANSFER").length;
  const continuationDisplacements = displacement.confirmed.length - transferDisplacements;
  console.log(JSON.stringify({
    status: batch.status, candlesProcessed: candles.length,
    rawContinuationBreaks: rawContinuation, rawStructureShifts: rawShifts,
    controlTransfers: control.transfers.length,
    transferDisplacements, continuationDisplacements,
    confirmations: confirmedCounts,
    pendingEventsExpired: batch.diagnostics.pendingEventsExpired,
    pendingAtEnd: structural.pendingCounts,
    topRejectionReasons: topRejections,
    firstCollapseForMss: rawShifts > 0 && control.transfers.length > 0 &&
      transferDisplacements === 0 ? "NO_TRANSFER_DISPLACEMENTS" : null,
    firstCollapseForBos: rawContinuation > 0 && continuationDisplacements > 0 &&
      batch.diagnostics.confirmedBos === 0 ?
      "NO_CORRELATED_CONTINUATION_DISPLACEMENT_WITHIN_WINDOW" : null,
    timings: batch.timings,
    upstream: { historical: historical.status, psychology: psychology.status,
      structure: structure.status, liquidity: liquidity.status,
      interaction: interaction.status },
    checks: { eventOrder: "PASS", lineage: "PASS",
      batchIncremental: "PASS", prefix: "PASS",
      determinism: "PASS", lookAhead: 0 },
  }));
}
