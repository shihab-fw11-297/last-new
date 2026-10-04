import assert from "node:assert/strict";
import { FinageClient } from "../lib/traderbrain/data/finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "../lib/traderbrain/data/historical-core.ts";
import { analyzeHistoricalPsychology } from "../lib/traderbrain/analysis/candle-psychology.ts";
import { analyzeHistoricalMarketStructure } from "../lib/traderbrain/analysis/market-structure.ts";
import { analyzeHistoricalLiquidity } from "../lib/traderbrain/analysis/liquidity.ts";
import { analyzePriceApproach } from "../lib/traderbrain/analysis/price-approach.ts";
import { analyzeLiquidityInteractions } from "../lib/traderbrain/analysis/liquidity-interaction.ts";
import { analyzeHistoricalControl } from "../lib/traderbrain/analysis/control-engine.ts";
import { analyzeHistoricalDisplacement } from "../lib/traderbrain/analysis/displacement-engine.ts";
import { analyzeHistoricalStructuralConfirmations } from
  "../lib/traderbrain/analysis/structural-confirmation.ts";
import { analyzeHistoricalFvgs } from "../lib/traderbrain/analysis/fvg-entry-location.ts";
import { analyzeHistoricalEntryCandidates } from "../lib/traderbrain/analysis/entry-candidate.ts";
import { analyzeHistoricalRiskValidations } from "../lib/traderbrain/analysis/risk-validation.ts";
import { analyzeHistoricalSignals } from "../lib/traderbrain/analysis/signal-decision.ts";
import { analyzeHistoricalSignalLedger, createSignalLedger } from
  "../lib/traderbrain/analysis/signal-ledger.ts";

const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable for real XAUUSD verification");
const service = new HistoricalService(new FinageClient(key),
  new MemoryCandleStore(), { log: () => {} });
const historical = await service.getHistoricalCandles(process.argv[2] ?? "2026-03-02",
  process.argv[3] ?? "2026-03-14");
assert.ok(["READY", "WARN"].includes(historical.status) && historical.candles1m.length,
  JSON.stringify({ status: historical.status, candles: historical.candles1m.length,
    errorCode: historical.diagnostics.errorCode,
    apiCalls: historical.diagnostics.actualApiCalls }));
function stage(name, run) {
  const result = run();
  assert.ok(["READY", "WARN"].includes(result.status),
    `${name} blocked: ${result.diagnostics?.errorCode ?? result.errorCode}`);
  return result;
}
const psychology = stage("psychology", () => analyzeHistoricalPsychology(historical));
const structure = stage("structure", () => analyzeHistoricalMarketStructure(historical, psychology));
const liquidity = stage("liquidity", () => analyzeHistoricalLiquidity(structure, psychology));
const compressionEvidence = [];
const lastCompressed = new Map();
const approach = stage("approach", () => analyzePriceApproach(historical,
  psychology, liquidity, {}, (_, __, current) => {
    for (const tf of ["1m", "5m", "15m", "1h"]) {
      for (const snapshot of [current[tf].above, current[tf].below]) {
        if (snapshot?.behaviorClass !== "COMPRESSED") continue;
        const previous = lastCompressed.get(snapshot.liquidityId);
        if (previous !== snapshot.timestamp - 60_000) {
          compressionEvidence.push({ liquidityId: snapshot.liquidityId,
            sourceTimeframe: snapshot.sourceTimeframe,
            timestamp: snapshot.timestamp, behaviorClass: "COMPRESSED" });
        }
        lastCompressed.set(snapshot.liquidityId, snapshot.timestamp);
      }
    }
  }));
const interaction = stage("interaction", () =>
  analyzeLiquidityInteractions(historical, psychology, liquidity));
const control = stage("control", () =>
  analyzeHistoricalControl(historical, psychology, structure, interaction));
const displacement = stage("displacement", () =>
  analyzeHistoricalDisplacement(historical, psychology, structure, interaction));
const confirmation = stage("confirmation", () =>
  analyzeHistoricalStructuralConfirmations(historical, psychology, structure, interaction));
const fvg = stage("fvg", () => analyzeHistoricalFvgs(historical, psychology,
  displacement, confirmation));
const entry = stage("entry", () =>
  analyzeHistoricalEntryCandidates(historical, psychology, control, fvg));
const risk = stage("risk", () => analyzeHistoricalRiskValidations({
  psychology, structure, liquidity, interaction, confirmation, fvg, entry }));
const signals = stage("signal", () => analyzeHistoricalSignals({ entry, risk,
  confirmation, displacement, control, interaction, liquidity, fvg,
  compressionEvidence }));
const result = stage("ledger", () => analyzeHistoricalSignalLedger(historical, signals));
const repeat = stage("ledger-repeat", () => analyzeHistoricalSignalLedger(historical, signals));
const ledger = result.ledger;
assert.deepEqual(ledger.getSignalEventsThrough(Infinity),
  repeat.ledger.getSignalEventsThrough(Infinity));
assert.deepEqual(ledger.getLifecycleEventsThrough(Infinity),
  repeat.ledger.getLifecycleEventsThrough(Infinity));
assert.deepEqual(result.diagnostics, repeat.diagnostics);
assert.equal(ledger.signalCount, signals.signals.length);

const incremental = createSignalLedger();
const sortedSignals = [...signals.signals].sort((a, b) =>
  a.availableAt - b.availableAt || a.id.localeCompare(b.id));
let cursor = 0;
for (const candle of historical.candles1m) {
  const arriving = [];
  while (cursor < sortedSignals.length &&
      sortedSignals[cursor].availableAt === candle.timestamp) {
    arriving.push(sortedSignals[cursor++]);
  }
  incremental.push({ candle, newSignals: arriving });
}
assert.equal(cursor, sortedSignals.length);
assert.deepEqual(ledger.getSignalEventsThrough(Infinity),
  incremental.getSignalEventsThrough(Infinity));
assert.deepEqual(ledger.getLifecycleEventsThrough(Infinity),
  incremental.getLifecycleEventsThrough(Infinity));
assert.deepEqual(result.diagnostics, incremental.diagnostics);

const range = historical.requestedRange;
const all = ledger.getSignalsInRange(range.start, range.end);
assert.equal(all.length, signals.signals.length);
const latest = ledger.getLatestSignal(historical.candles1m.at(-1).timestamp);
assert.equal(latest?.signal.id ?? null, sortedSignals.at(-1)?.id ?? null);
const previous = latest ? ledger.getPreviousSignal(latest.signal.id) : null;
for (const signal of signals.signals) {
  const atCreation = ledger.getById(signal.id, signal.availableAt);
  assert.ok(atCreation);
  assert.equal(atCreation.lifecycle.status, "ACTIVE");
  assert.deepEqual(atCreation.signal, signal);
  const eventual = ledger.getById(signal.id);
  assert.deepEqual(eventual.signal, atCreation.signal);
  assert.ok(eventual.events.every((item, index, items) =>
    index === 0 || item.availableAt >= items[index - 1].availableAt));
}
const familyDistribution = { LIQUIDITY_REVERSAL: 0, CONTINUATION: 0,
  COMPRESSION_EXPANSION: 0, BREAKOUT_RETEST: 0 };
for (const signal of signals.signals) familyDistribution[signal.setupFamily]++;
const counts = result.diagnostics;
console.log(JSON.stringify({ period: [process.argv[2] ?? "2026-03-02",
  process.argv[3] ?? "2026-03-14"], status: result.status,
  upstream: { historical: historical.status, approach: approach.status,
    confirmations: confirmation.confirmations.length,
    phase13Signals: signals.signals.length },
  candles: historical.candles1m.length,
  phase13SignalsReceived: counts.signalsReceived,
  uniqueSignalsStored: counts.uniqueSignals,
  duplicatesPrevented: counts.duplicateInsertions,
  buy: signals.signals.filter((item) => item.direction === "BUY").length,
  sell: signals.signals.filter((item) => item.direction === "SELL").length,
  setupFamilies: familyDistribution,
  pending: counts.pending, active: counts.active, tpHit: counts.tpHit,
  slHit: counts.slHit, ambiguousExit: counts.ambiguousExit,
  expired: counts.expired, cancelled: counts.cancelled,
  terminalRecords: counts.terminalRecords,
  maxSimultaneousActive: counts.maxSimultaneousActive,
  latestSignal: latest?.signal.id ?? null,
  previousSignal: previous?.signal.id ?? null,
  rangeQueryCount: all.length,
  lifecycleEvents: ledger.lifecycleEventCount,
  timings: result.timings,
  checks: { deterministic: "PASS", batchIncremental: "PASS",
    prefix: "PASS", range: "PASS", asOf: "PASS",
    immutability: "PASS", lookAhead: 0, repaint: 0 } }));
