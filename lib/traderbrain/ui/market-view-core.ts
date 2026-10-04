import { createReplaySession } from "../analysis/replay-engine.ts";
import type { SetupFamily, Signal, SignalAction } from "../analysis/signal-decision.ts";
import type { ImmutableSignal, LifecycleStatus } from "../analysis/signal-ledger.ts";
import type { DataStatus, HistoricalResult, Timeframe } from "../data/types.ts";
import { chartAsOfTimestamp } from "./as-of.ts";
import type { HistoricalDateRange } from "./date-range.ts";

export type ChartCandle = { timestamp: number; open: number; high: number;
  low: number; close: number; complete: boolean };
export type ChartOverlay = { id: string; price: number; label: string;
  kind: "LIQUIDITY" | "ENTRY" | "STOP" | "TARGET";
  side?: "BSL" | "SSL"; availableAt: number };
export type SignalView = { id: string; timestamp: number; direction: SignalAction;
  setupFamily: SetupFamily; entry: number; stopLoss: number; takeProfit: number;
  rr: number; lifecycle: LifecycleStatus };
export type MarketView = {
  status: DataStatus; period: string; timeframe: Timeframe;
  candles: ChartCandle[]; overlays: ChartOverlay[];
  latestPrice: number | null; latestAt: number | null; asOf: number | null;
  firstAt: number | null; dataGaps: number; counts: Record<Timeframe, number>;
  requestedRange: HistoricalDateRange["requestedRange"];
  effectiveRange: HistoricalDateRange["effectiveRange"];
  rangeNotice: string | null; finageCalls: number; cacheHit: boolean; loadMs: number;
  structure: string; liquidityCount: number; approachAbove: string; approachBelow: string;
  latestInteraction: string; control: string; latestDisplacement: string;
  latestConfirmation: string; latestFvg: string; latestEntry: string;
  latestSignal: SignalView | null; signalHistory: SignalView[];
};

export type MarketViewRequest = Readonly<{
  timeframe: Timeframe;
  windowBars: number;
  offsetBars: number;
  range: HistoricalDateRange;
}>;

export type HistoricalFetcher = (start: number, end: number,
  signal?: AbortSignal) => Promise<HistoricalResult>;

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h"];
const DATE_LABEL = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
});

function formatPeriod(range: HistoricalDateRange): string {
  const from = DATE_LABEL.format(range.requestedRange.start);
  const to = DATE_LABEL.format(range.requestedRange.end - 1);
  return `${from} -> ${to} UTC`;
}

export async function loadMarketView(request: MarketViewRequest,
  fetchHistorical: HistoricalFetcher, signal?: AbortSignal): Promise<MarketView> {
  const historical = await fetchHistorical(request.range.effectiveRange.start,
    request.range.effectiveRange.end, signal);
  return buildMarketView(request, historical);
}

export function buildMarketView(request: MarketViewRequest,
  historical: HistoricalResult): MarketView {
  const { timeframe, windowBars, offsetBars, range } = request;
  const sources = { "1m": historical.candles1m, ...historical.timeframes };
  const counts = Object.fromEntries(TIMEFRAMES.map((tf) =>
    [tf, sources[tf].length])) as Record<Timeframe, number>;
  const selected = sources[timeframe];
  const chartEnd = Math.max(0, selected.length - offsetBars);
  const chartStart = Math.max(0, chartEnd - windowBars);
  const canRender = historical.status === "READY" || historical.status === "WARN";
  const candles: ChartCandle[] = canRender ? selected.slice(chartStart, chartEnd).map((candle) => ({
    timestamp: candle.timestamp, open: candle.open, high: candle.high,
    low: candle.low, close: candle.close,
    complete: "isComplete" in candle ? candle.isComplete : true,
  })) : [];
  const latestPrice = candles.at(-1)?.close ?? null;
  const chartAt = candles.at(-1)?.timestamp ?? null;
  const firstSourceAt = historical.candles1m[0]?.timestamp ?? null;
  const lastSourceAt = historical.candles1m.at(-1)?.timestamp ?? null;
  const asOf = chartAt === null || lastSourceAt === null ? null :
    chartAsOfTimestamp(timeframe, chartAt, lastSourceAt);
  const base: MarketView = {
    status: historical.status, period: formatPeriod(range), timeframe, candles,
    overlays: [], latestPrice, latestAt: lastSourceAt, firstAt: firstSourceAt, asOf,
    dataGaps: historical.diagnostics.internalGapCount, counts,
    requestedRange: range.requestedRange, effectiveRange: range.effectiveRange,
    rangeNotice: range.notice, finageCalls: historical.diagnostics.actualApiCalls,
    cacheHit: historical.diagnostics.actualApiCalls === 0,
    loadMs: historical.timings.totalMs,
    structure: "Unavailable", liquidityCount: 0, approachAbove: "None",
    approachBelow: "None", latestInteraction: "None", control: "Unavailable",
    latestDisplacement: "None", latestConfirmation: "None", latestFvg: "None",
    latestEntry: "None", latestSignal: null, signalHistory: [],
  };
  if (!canRender || latestPrice === null || asOf === null || firstSourceAt === null) return base;

  const replay = createReplaySession({ dataset: historical,
    start: firstSourceAt, end: historical.requestedRange.end });
  replay.runTo(asOf);
  if (replay.status === "BLOCKED") return { ...base, status: "BLOCKED", candles: [] };
  const snapshot = replay.getSnapshot();
  if (!snapshot) return base;
  const artifacts = replay.getArtifacts();
  const levels = artifacts.liquidity[timeframe].filter((level) => level.availableAt <= asOf);
  const overlays: ChartOverlay[] = levels.slice().sort((a, b) =>
    Math.abs(a.price - latestPrice) - Math.abs(b.price - latestPrice) ||
      a.id.localeCompare(b.id)).slice(0, 6).map((level) => ({ id: level.id,
        price: level.price, label: `${level.side} / ${level.kind}`, side: level.side,
        kind: "LIQUIDITY", availableAt: level.availableAt }));

  const latestRecord = snapshot.latestSignal;
  if (latestRecord) {
    const signal = latestRecord.signal;
    overlays.push(
      { id: `${signal.id}:entry`, price: signal.entryPrice, label: "ENTRY",
        kind: "ENTRY", availableAt: signal.availableAt },
      { id: `${signal.id}:stop`, price: signal.stopLoss, label: "SL",
        kind: "STOP", availableAt: signal.availableAt },
      { id: `${signal.id}:target`, price: signal.takeProfit, label: "TP",
        kind: "TARGET", availableAt: signal.availableAt });
  }
  const lifecycleBySignal = new Map<string, LifecycleStatus>();
  for (const event of artifacts.lifecycle) lifecycleBySignal.set(event.signalId,
    event.type === "ACTIVATED" ? "ACTIVE" : event.type);
  const signalView = (signal: Signal | ImmutableSignal): SignalView => ({
    id: signal.id, timestamp: signal.availableAt, direction: signal.direction,
    setupFamily: signal.setupFamily, entry: signal.entryPrice,
    stopLoss: signal.stopLoss, takeProfit: signal.takeProfit, rr: signal.rr,
    lifecycle: lifecycleBySignal.get(signal.id) ?? "ACTIVE" });
  const above = snapshot.approach["1m"].above;
  const below = snapshot.approach["1m"].below;
  const lastImpulse = snapshot.displacement.latestConfirmed;
  const qualified = snapshot.entryLocation.latestQualified;
  const candidate = snapshot.entryCandidate;
  return { ...base, overlays, structure: snapshot.structure[timeframe].state,
    liquidityCount: levels.length,
    approachAbove: above ? `${above.state} / ${above.sourceTimeframe} ${above.liquiditySide}` : "None",
    approachBelow: below ? `${below.state} / ${below.sourceTimeframe} ${below.liquiditySide}` : "None",
    latestInteraction: snapshot.interaction.latestEvent?.type ?? "None",
    control: snapshot.control.state,
    latestDisplacement: lastImpulse ? `${lastImpulse.direction} ${lastImpulse.classification}` : "None",
    latestConfirmation: snapshot.structuralConfirmation?.type ?? "None",
    latestFvg: qualified ? `${qualified.direction} ${qualified.status}` : "None",
    latestEntry: candidate ? `${candidate.direction} ${candidate.retracementClass}` : "None",
    latestSignal: latestRecord ? signalView(latestRecord.signal) : null,
    signalHistory: artifacts.signals.slice(-5).map(signalView) };
}
