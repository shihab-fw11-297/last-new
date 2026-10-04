import Link from "next/link";

import type { Timeframe } from "@/lib/traderbrain/data/types";
import { currentUtcTimestamp, defaultHistoricalDates, historicalHref, resolveHistoricalDateQuery,
  utcDateString } from "@/lib/traderbrain/ui/date-range";
import { getMarketView, type ChartCandle, type ChartOverlay,
  type MarketView } from "@/lib/traderbrain/ui/market-view";
import { DateRangeSelector } from "./date-range-selector";

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h"];
const fmt = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2,
  maximumFractionDigits: 2 });
const scalar = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

function CandleChart({ candles, overlays, timeframe, emptyMessage }: { candles: ChartCandle[];
  overlays: ChartOverlay[]; timeframe: Timeframe; emptyMessage: string }) {
  if (!candles.length) return <div className="empty-chart">{emptyMessage}</div>;
  const width = 1000, height = 440, left = 24, right = 88, top = 22, bottom = 38;
  const minimum = Math.min(...candles.map((item) => item.low));
  const maximum = Math.max(...candles.map((item) => item.high));
  const padding = Math.max((maximum - minimum) * 0.08, 0.01);
  const low = minimum - padding, high = maximum + padding;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = (index: number) => left + (index + 0.5) * plotWidth / candles.length;
  const y = (price: number) => top + (high - price) * plotHeight / (high - low);
  const bodyWidth = Math.max(2, Math.min(8, plotWidth / candles.length * 0.65));
  const bucketMinutes = timeframe === "1h" ? 60 : timeframe === "15m" ? 15 :
    timeframe === "5m" ? 5 : 1;
  return <svg className="price-chart" viewBox={`0 0 ${width} ${height}`} role="img"
    aria-label={`XAUUSD chart with ${candles.length} real candles`}>
    {[0, 1, 2, 3, 4].map((i) => {
      const price = low + (high - low) * i / 4;
      return <g key={i}><line x1={left} x2={width - right} y1={y(price)} y2={y(price)} className="grid-line" />
        <text x={width - right + 10} y={y(price) + 4} className="axis-label">{fmt(price)}</text></g>;
    })}
    {overlays.filter((item) => item.price >= low && item.price <= high).map((item) => {
      const firstIndex = candles.findIndex((candle) =>
        candle.timestamp + (bucketMinutes - 1) * 60_000 >= item.availableAt);
      const startX = firstIndex < 0 ? width - right : x(firstIndex);
      return <g key={item.id}><line x1={startX} x2={width - right} y1={y(item.price)} y2={y(item.price)}
        className={item.kind === "ENTRY" ? "level-entry" : item.kind === "STOP" ?
          "level-stop" : item.kind === "TARGET" ? "level-target" :
            item.side === "BSL" ? "level-bsl" : "level-ssl"} />
        <text x={startX + 5} y={y(item.price) - 5} className="level-label">
          {item.label} {fmt(item.price)}</text></g>;
    })}
    {candles.map((item, i) => {
      const bodyTop = y(Math.max(item.open, item.close));
      const bodyBottom = y(Math.min(item.open, item.close));
      return <g key={item.timestamp} className={`candle-group ${item.close >= item.open ? "candle-up" : "candle-down"}`}>
        <title>{`${new Date(item.timestamp).toISOString()} / O ${fmt(item.open)} H ${fmt(item.high)} L ${fmt(item.low)} C ${fmt(item.close)}${item.complete ? "" : " / partial"}`}</title>
        <line className="crosshair-line" x1={x(i)} x2={x(i)} y1={top} y2={height - bottom} />
        <line x1={x(i)} x2={x(i)} y1={y(item.high)} y2={y(item.low)} />
        <rect x={x(i) - bodyWidth / 2} y={bodyTop} width={bodyWidth}
          height={Math.max(1.5, bodyBottom - bodyTop)} /></g>;
    })}
    <text x={left} y={height - 10} className="axis-label">
      {new Date(candles[0].timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC</text>
    <text x={width - right} y={height - 10} textAnchor="end" className="axis-label">
      {new Date(candles.at(-1)!.timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC</text>
  </svg>;
}

function emptyChartMessage(view: MarketView | null, rangeError: string | null): string {
  if (rangeError) return rangeError;
  if (!view) return "Real data could not be loaded.";
  if (view.status === "BLOCKED" || view.status === "FAILED") {
    return `Historical range ${view.status.toLowerCase()}. Partial unsafe candles are hidden.`;
  }
  return "No candles available for the selected range.";
}

export default async function Home({ searchParams }: {
  searchParams: Promise<{ tf?: string | string[]; bars?: string | string[];
    offset?: string | string[]; from?: string | string[]; to?: string | string[] }>;
}) {
  const query = await searchParams;
  const now = currentUtcTimestamp();
  const requested = scalar(query.tf) ?? "1m";
  const timeframe: Timeframe = TIMEFRAMES.includes(requested as Timeframe) ?
    requested as Timeframe : "1m";
  const barsValue = Number(scalar(query.bars));
  const bars = [30, 60, 120].includes(barsValue) ? barsValue : 120;
  const offsetValue = Number(scalar(query.offset));
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ?
    Math.min(offsetValue, 10_000) : 0;
  const defaults = defaultHistoricalDates(now);
  const selectedFrom = scalar(query.from) ?? defaults.fromDate;
  const selectedTo = scalar(query.to) ?? defaults.toDate;
  let rangeError: string | null = null;
  let range;
  try {
    range = resolveHistoricalDateQuery({ from: scalar(query.from), to: scalar(query.to) }, now);
  } catch (cause) {
    rangeError = cause instanceof Error ? cause.message : "Invalid historical range.";
  }
  let view: MarketView | null = null;
  if (range) {
    try {
      view = await getMarketView({ timeframe, windowBars: bars, offsetBars: offset, range });
    } catch {
      rangeError = "Historical data could not be loaded.";
    }
  }
  const link = (tf: Timeframe, nextBars = bars, nextOffset = 0) => historicalHref({
    timeframe: tf, fromDate: selectedFrom, toDate: selectedTo,
    bars: nextBars, offset: nextOffset,
  });
  const dataLabel = rangeError ? "RANGE INVALID" : view ? `DATA ${view.status}` : "DATA UNAVAILABLE";
  const isReady = view?.status === "READY";
  return <main className="traderbrain-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">TB</span><span>TraderBrain</span></div>
      <div className="instrument"><strong>XAUUSD</strong><span>Gold / U.S. Dollar</span></div>
      <div className="mode">HISTORICAL / FINAGE</div>
      <div className={`data-status ${isReady ? "ready" : "warn"}`}>{dataLabel}</div>
    </header>
    <div className="workspace">
      <section className="chart-panel" aria-label="Primary XAUUSD chart">
        <div className="panel-head">
          <div><p className="eyebrow">MARKET STRUCTURE</p><h1>XAUUSD <span>/ {timeframe}</span></h1>
            <p className="subtle">{view?.period ?? `${selectedFrom} -> ${selectedTo} UTC`}</p></div>
          <div className="market-controls">
            <nav className="timeframe-nav" aria-label="Chart timeframe">
              {TIMEFRAMES.map((tf) => <Link key={tf} href={link(tf)} prefetch={false}
                aria-current={tf === timeframe ? "page" : undefined}>{tf}</Link>)}
            </nav>
            <DateRangeSelector key={`${selectedFrom}:${selectedTo}`} fromDate={selectedFrom}
              toDate={selectedTo} timeframe={timeframe} bars={bars}
              maxDate={utcDateString(now)} />
          </div>
        </div>
        {rangeError || view?.rangeNotice ? <div className="range-notice" role="status">
          {rangeError ?? view?.rangeNotice}</div> : null}
        <nav className="chart-controls" aria-label="Chart zoom and pan">
          <span>VIEW</span>
          {[30, 60, 120].map((count) => <Link key={count}
            className={bars === count ? "active" : undefined} prefetch={false}
            href={link(timeframe, count, offset)}>{count} bars</Link>)}
          <Link prefetch={false} href={link(timeframe, bars, offset + bars)}>Older</Link>
          <Link prefetch={false} href={link(timeframe, bars, Math.max(0, offset - bars))}>Newer</Link>
        </nav>
        <div className="chart-summary">
          <div><span>LAST CLOSE</span><strong>{view?.latestPrice == null ? "--" : fmt(view.latestPrice)}</strong></div>
          <div><span>STRUCTURE</span><strong>{view?.structure ?? "Unavailable"}</strong></div>
          <div><span>LIQUIDITY LEVELS</span><strong>{view?.liquidityCount ?? "--"}</strong></div>
          <div><span>DATA GAPS</span><strong>{view?.dataGaps ?? "--"}</strong></div>
        </div>
        <CandleChart candles={view?.candles ?? []} overlays={view?.overlays ?? []}
          timeframe={timeframe} emptyMessage={emptyChartMessage(view, rangeError)} />
        <div className="chart-foot"><span>Loaded {view?.counts[timeframe] ?? 0} {timeframe} candles / showing up to {bars}</span>
          <span>{view ? `${view.finageCalls} Finage calls / ${view.cacheHit ? "cache hit" : `${view.loadMs.toFixed(0)} ms`}` : "No data request"}</span>
          <span>{view?.firstAt ? `First ${new Date(view.firstAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : "No first candle"}</span>
          <span>{view?.latestAt ? `Last ${new Date(view.latestAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : "No last candle"}</span></div>
      </section>
      <aside className="radar" aria-label="Opportunity Radar">
        <div className="radar-head"><p className="eyebrow">LATEST RECORDED FACTS</p><h2>Opportunity Radar</h2>
          <p>Phase 1-15 evidence from the selected UTC dataset as known at the chart time.</p></div>
        <div className="radar-section"><span>SELECTED RANGE COUNTS</span>
          {TIMEFRAMES.map((tf) => <div className="radar-row" key={tf}><span>{tf}</span>
            <strong>{view?.counts[tf] ?? 0} candles</strong></div>)}</div>
        <div className="radar-section"><span>PRICE APPROACH / 1M</span>
          <div className="radar-row"><span>Nearest above</span><strong>{view?.approachAbove ?? "--"}</strong></div>
          <div className="radar-row"><span>Nearest below</span><strong>{view?.approachBelow ?? "--"}</strong></div></div>
        <div className="radar-section"><span>CAUSAL STATE</span>
          <div className="radar-row"><span>Interaction</span><strong>{view?.latestInteraction ?? "--"}</strong></div>
          <div className="radar-row"><span>Control</span><strong>{view?.control ?? "--"}</strong></div>
          <div className="radar-row"><span>Displacement</span><strong>{view?.latestDisplacement ?? "--"}</strong></div>
          <div className="radar-row"><span>BOS / MSS</span><strong>{view?.latestConfirmation ?? "--"}</strong></div>
          <div className="radar-row"><span>Qualified FVG</span><strong>{view?.latestFvg ?? "--"}</strong></div>
          <div className="radar-row"><span>Entry candidate</span><strong>{view?.latestEntry ?? "--"}</strong></div></div>
      </aside>
    </div>
    <footer className="signal-placeholder"><span>LATEST SIGNAL / SIGNAL HISTORY</span>
      {view?.latestSignal ? <div className="signal-grid">
        <strong className={view.latestSignal.direction === "BUY" ? "signal-buy" : "signal-sell"}>
          {view.latestSignal.direction}</strong>
        <span>{view.latestSignal.setupFamily}</span>
        <span>Entry {fmt(view.latestSignal.entry)}</span>
        <span>SL {fmt(view.latestSignal.stopLoss)}</span>
        <span>TP {fmt(view.latestSignal.takeProfit)}</span>
        <span>RR {view.latestSignal.rr.toFixed(2)}</span>
        <span>{view.latestSignal.lifecycle}</span>
        <time dateTime={new Date(view.latestSignal.timestamp).toISOString()}>
          {new Date(view.latestSignal.timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC</time>
      </div> : <p>No final signal available as of the selected chart time.</p>}
      {view?.signalHistory.length ? <div className="signal-history">
        {view.signalHistory.map((signal) => <div key={signal.id}>
          <strong>{signal.direction}</strong><span>{signal.setupFamily}</span>
          <span>RR {signal.rr.toFixed(2)}</span><span>{signal.lifecycle}</span>
        </div>)}
      </div> : null}
    </footer>
  </main>;
}
