import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../lib/traderbrain/data/candles.ts";
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
import { analyzeHistoricalSignalLedger } from "../lib/traderbrain/analysis/signal-ledger.ts";
import { createReplaySession, findFirstReplayDivergence,
  fingerprintHistoricalDataset, fingerprintReplayConfig, ReplayInputError } from
  "../lib/traderbrain/analysis/replay-engine.ts";

const MINUTE = 60_000;
const start = Date.parse("2026-03-02T10:00:00Z");
const at = (minute) => start + minute * MINUTE;

function closes(kind = "reversal-entry") {
  const values = Array.from({ length: 15 }, (_, i) => 100 + (i % 2 ? 0.2 : 0));
  values.push(...[104, 108, 112, 116, 112, 109, 106, 110, 114, 118, 114, 110,
    108, 112, 116, 120, 116, 112, 110]);
  values.push(...[110.5, 111.5, 112.5, 113.5, 114.5, 115.5, 116.5,
    117.5, 118.5, 119.5]);
  values.push(...[119.5, 116, 112, 104, 99, 95, 93, 92, 91]);
  if (kind === "reversal-entry") values.push(...[94, 97, 100, 103, 106, 102.5]);
  while (values.length < 120) values.push(values.at(-1) + (values.length % 2 ? 0.15 : -0.1));
  return values;
}

function historical(count = 120) {
  const values = closes().slice(0, count);
  const candles = values.map((close, index) => {
    const open = index ? values[index - 1] : close;
    let high = Math.max(open, close) + 0.6;
    let low = Math.min(open, close) - 0.6;
    if (index >= 34 && index <= 43) {
      high = Math.max(open, close) + 0.05;
      low = Math.min(open, close) - 0.05;
    }
    if (index === 44) high = 123;
    return { timestamp: at(index), open, high, low, close, volume: null,
      symbol: "XAUUSD", timeframe: "1m" };
  });
  return { status: "READY", symbol: "XAUUSD",
    requestedRange: { start: at(0), end: at(count) }, candles1m: candles,
    timeframes: { "5m": aggregate(candles, "5m"),
      "15m": aggregate(candles, "15m"), "1h": aggregate(candles, "1h") },
    coverage: { fetched: [{ start: at(0), end: at(count) }],
      firstTimestamp: candles[0]?.timestamp ?? null,
      lastTimestamp: candles.at(-1)?.timestamp ?? null,
      startsAfterRequest: false, endsBeforeRequest: false },
    diagnostics: { requestId: "test", requestedCalendarMinutes: count,
      estimatedInitialChunks: 1, plannedCalls: 0, actualApiCalls: 0,
      retryCount: 0, splitCount: 0, splits: [], providerRows: count,
      returnedCandleCount: count, firstTimestamp: candles[0]?.timestamp ?? null,
      lastTimestamp: candles.at(-1)?.timestamp ?? null, duplicateCount: 0,
      duplicateConflictCount: 0, conflicts: [], invalidCandleCount: 0,
      internalGapCount: 0, internalMissingMinuteCount: 0, largestGapMinutes: 0,
      gaps: [], providerTruncationDetected: false, executionMs: 0 },
    timings: { rangePlanningMs: 0, cacheLookupMs: 0, fetchMs: 0,
      normalizeMs: 0, mergeMs: 0, integrityMs: 0, aggregationMs: 0, totalMs: 0 } };
}

function batch(dataset) {
  const psychology = analyzeHistoricalPsychology(dataset);
  const structure = analyzeHistoricalMarketStructure(dataset, psychology);
  const liquidity = analyzeHistoricalLiquidity(structure, psychology);
  const compressionEvidence = [];
  const lastCompressed = new Map();
  const approach = analyzePriceApproach(dataset, psychology, liquidity, {},
    (_, __, current) => {
      for (const timeframe of ["1m", "5m", "15m", "1h"]) {
        for (const item of [current[timeframe].above, current[timeframe].below]) {
          if (item?.behaviorClass !== "COMPRESSED") continue;
          const previous = lastCompressed.get(item.liquidityId);
          if (previous !== item.timestamp - MINUTE) compressionEvidence.push({
            liquidityId: item.liquidityId, sourceTimeframe: item.sourceTimeframe,
            timestamp: item.timestamp, behaviorClass: "COMPRESSED" });
          lastCompressed.set(item.liquidityId, item.timestamp);
        }
      }
    });
  const interaction = analyzeLiquidityInteractions(dataset, psychology, liquidity);
  const control = analyzeHistoricalControl(dataset, psychology, structure, interaction);
  const displacement = analyzeHistoricalDisplacement(dataset, psychology, structure, interaction);
  const confirmation = analyzeHistoricalStructuralConfirmations(dataset, psychology,
    structure, interaction);
  const fvg = analyzeHistoricalFvgs(dataset, psychology, displacement, confirmation);
  const entry = analyzeHistoricalEntryCandidates(dataset, psychology, control, fvg);
  const risk = analyzeHistoricalRiskValidations({ psychology, structure, liquidity,
    interaction, confirmation, fvg, entry });
  const signal = analyzeHistoricalSignals({ entry, risk, confirmation, displacement,
    control, interaction, liquidity, fvg, compressionEvidence });
  const ledger = analyzeHistoricalSignalLedger(dataset, signal);
  return { psychology, structure, liquidity, approach, interaction, control,
    displacement, confirmation, fvg, entry, risk, signal, ledger };
}

function streamsFromBatch(result) {
  return {
    psychology: ["1m", "5m", "15m", "1h"].flatMap((tf) =>
      result.psychology.timeframes[tf].features),
    structureSwings: ["1m", "5m", "15m", "1h"].flatMap((tf) =>
      result.structure.timeframes[tf].swings),
    structureEvents: ["1m", "5m", "15m", "1h"].flatMap((tf) =>
      result.structure.timeframes[tf].events),
    liquidity: ["1m", "5m", "15m", "1h"].flatMap((tf) =>
      result.liquidity.timeframes[tf].levels),
    approachTransitions: result.approach.transitions,
    interactionEvents: result.interaction.events,
    interactions: result.interaction.completed,
    controlStateChanges: result.control.stateChanges,
    controlTransfers: result.control.transfers,
    ignitions: result.displacement.ignitions,
    displacements: result.displacement.confirmed,
    failedDisplacements: result.displacement.failed,
    confirmations: result.confirmation.confirmations,
    fvgZones: result.fvg.zones, fvgEvents: result.fvg.events,
    entryEvents: result.entry.events, entryCandidates: result.entry.candidates,
    entryEpisodes: result.entry.episodes, riskValidations: result.risk.validations,
    decisions: result.signal.decisions, signals: result.signal.signals,
    lifecycle: result.ledger.ledger.getLifecycleEventsThrough(Infinity),
  };
}

function streamsFromReplay(artifacts) {
  return { ...artifacts,
    psychology: ["1m", "5m", "15m", "1h"].flatMap((tf) => artifacts.psychology[tf]),
    structureSwings: ["1m", "5m", "15m", "1h"].flatMap((tf) =>
      artifacts.structureSwings[tf]),
    structureEvents: ["1m", "5m", "15m", "1h"].flatMap((tf) =>
      artifacts.structureEvents[tf]),
    liquidity: ["1m", "5m", "15m", "1h"].flatMap((tf) => artifacts.liquidity[tf]),
  };
}

test("one step, runTo, pause/resume, range end and HTF close are causal", () => {
  const dataset = historical();
  const session = createReplaySession({ dataset, start: at(0), end: at(20) });
  assert.equal(session.currentIndex, -1);
  assert.equal(session.step().snapshot.index, 0);
  session.runTo(at(10));
  assert.equal(session.currentIndex, 10);
  assert.equal(session.getSnapshot().timeframeState["15m"].processed, 0);
  session.pause();
  assert.equal(session.step(), null);
  assert.equal(session.currentIndex, 10);
  session.resume();
  session.runTo(at(14));
  assert.equal(session.getSnapshot().timeframeState["15m"].processed, 1);
  session.runToEnd();
  assert.equal(session.currentIndex, 19);
  assert.equal(session.status, "COMPLETED");
  assert.equal(session.getSnapshot().timestamp, at(19));
});

test("backward seek uses deterministic reset/replay and identity mismatches block", () => {
  const dataset = historical();
  const session = createReplaySession({ dataset, start: at(5), end: at(100) });
  session.runTo(at(80));
  const first = session.getResultFingerprint();
  session.runTo(at(40));
  assert.equal(session.currentIndex, 40);
  assert.equal(session.diagnostics.backwardSeeks, 1);
  const clean = createReplaySession({ dataset, start: at(5), end: at(100) });
  clean.runTo(at(40));
  assert.equal(session.getResultFingerprint(), clean.getResultFingerprint());
  session.runTo(at(80));
  assert.equal(session.getResultFingerprint(), first);
  session.pause();
  session.resume("wrong", session.configHash);
  assert.equal(session.status, "BLOCKED");
  assert.equal(session.diagnostics.blocked.reason, "DATASET_IDENTITY_MISMATCH");
  assert.throws(() => createReplaySession({ dataset, start: at(0), end: at(10),
    expectedConfigHash: "wrong" }), ReplayInputError);

  const mutable = historical(20);
  const guarded = createReplaySession({ dataset: mutable, start: at(0), end: at(20) });
  guarded.runTo(at(5));
  guarded.pause();
  mutable.candles1m[10].close += 0.01;
  mutable.candles1m[10].high += 0.01;
  guarded.resume();
  assert.equal(guarded.status, "BLOCKED");
  assert.equal(guarded.diagnostics.blocked.reason, "DATASET_IDENTITY_MISMATCH");
});

test("full production batch and one-candle replay are semantically equal", () => {
  const dataset = historical();
  const expected = streamsFromBatch(batch(dataset));
  const session = createReplaySession({ dataset, start: at(0), end: at(120) });
  session.runToEnd();
  const actual = streamsFromReplay(session.getArtifacts());
  const divergence = findFirstReplayDivergence(expected, actual);
  assert.equal(divergence, null, JSON.stringify(divergence));
  assert.equal(session.diagnostics.replayCandles, 120);
  assert.equal(session.datasetFingerprint, fingerprintHistoricalDataset(dataset));
  assert.equal(session.configHash, fingerprintReplayConfig());
});

test("future data does not change facts available through a closed prefix", () => {
  const prefixData = historical(60);
  const fullData = historical(120);
  const prefix = createReplaySession({ dataset: prefixData, start: at(0), end: at(60) });
  const full = createReplaySession({ dataset: fullData, start: at(0), end: at(120) });
  prefix.runToEnd();
  full.runTo(at(59));
  assert.deepEqual(streamsFromReplay(prefix.getArtifacts()),
    streamsFromReplay(full.getArtifacts()));
  assert.equal(prefix.getSnapshot().timestamp, at(59));
  assert.equal(full.getSnapshot().timestamp, at(59));
});

test("first divergence reports phase, position and causal timestamp", () => {
  const divergence = findFirstReplayDivergence(
    { phase3: [{ id: "a", availableAt: at(3), price: 100 }] },
    { phase3: [{ id: "a", availableAt: at(3), price: 101 }] });
  assert.deepEqual({ phase: divergence.phase, index: divergence.index,
    timestamp: divergence.timestamp }, { phase: "phase3", index: 0, timestamp: at(3) });
});
