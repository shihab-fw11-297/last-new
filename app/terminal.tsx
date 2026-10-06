"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

import type { Timeframe } from "@/lib/traderbrain/data/types";
import { historicalHref } from "@/lib/traderbrain/ui/date-range";
import type { MarketView } from "@/lib/traderbrain/ui/market-view";
import { DateRangeSelector, DateRangeModal } from "./date-range-selector";
import { ChartView } from "./chart-view";

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h"];

const fmt = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function formatShortDate(dateStr: string): string {
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const m = months[parseInt(parts[1], 10) - 1] ?? parts[1];
      return `${parseInt(parts[2], 10)} ${m}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

export interface TradingTerminalProps {
  view: MarketView | null;
  timeframe: Timeframe;
  bars: number;
  offset: number;
  selectedFrom: string;
  selectedTo: string;
  maxDate: string;
  rangeError: string | null;
  emptyMessage: string;
}

export function TradingTerminal({
  view,
  timeframe,
  bars,
  offset,
  selectedFrom,
  selectedTo,
  maxDate,
  rangeError,
  emptyMessage,
}: TradingTerminalProps) {
  const [isRadarOpen, setIsRadarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSignalStripOpen, setIsSignalStripOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"chart" | "radar" | "signal">("chart");

  // Reset loading state when new props arrive (standard React pattern)
  const currentKey = `${selectedFrom}:${selectedTo}:${timeframe}:${bars}:${rangeError ?? ""}:${view?.candles?.length ?? 0}:${view?.status ?? ""}`;
  const [prevKey, setPrevKey] = useState(currentKey);
  if (prevKey !== currentKey) {
    setPrevKey(currentKey);
    setIsLoading(false);
  }

  // Handle Escape key to exit fullscreen mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  const link = (tf: Timeframe, nextBars = bars, nextOffset = offset) =>
    historicalHref({
      timeframe: tf,
      fromDate: selectedFrom,
      toDate: selectedTo,
      bars: nextBars,
      offset: nextOffset,
    });

  const isReady = view?.status === "READY";
  const dataLabel = rangeError
    ? "RANGE INVALID"
    : view
    ? `DATA ${view.status}`
    : "DATA UNAVAILABLE";

  // Derive latest candle stats for top header ticker
  const latestCandle = view?.candles?.at(-1);
  const candleChange = latestCandle ? latestCandle.close - latestCandle.open : 0;
  const candleChangePct = latestCandle && latestCandle.open !== 0 ? (candleChange / latestCandle.open) * 100 : 0;
  const isUp = candleChange >= 0;

  const handleToggleRadar = () => {
    // If on mobile viewport, switch active tab to radar
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileTab((prev) => (prev === "radar" ? "chart" : "radar"));
    } else {
      setIsRadarOpen((prev) => !prev);
    }
  };

  // Reusable Opportunity Radar Content
  const renderRadarContent = () => (
    <div className="space-y-3.5 text-xs">
      {/* Section: Market Structure & Control */}
      <div className="rounded-lg border border-[#1e2d42] bg-[#09111c] p-3 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#7f8fa5] flex items-center justify-between">
          <span>Structure &amp; Control</span>
          <span className="text-[#a98953] font-mono">{timeframe}</span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Structure:</span>
          <strong
            className={`font-semibold ${
              view?.structure.includes("BULLISH")
                ? "text-[#4ade80]"
                : view?.structure.includes("BEARISH")
                ? "text-[#f87171]"
                : "text-[#e1e9f4]"
            }`}
          >
            {view?.structure ?? "Unavailable"}
          </strong>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Market Control:</span>
          <strong className="text-[#e1e9f4] font-semibold">
            {view?.control ?? "Unavailable"}
          </strong>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Active Liquidity:</span>
          <span className="font-mono font-semibold text-[#d3a85c]">
            {view?.liquidityCount ?? "--"} levels
          </span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Data Gaps:</span>
          <span className="font-mono text-[#8491a5]">
            {view?.dataGaps ?? 0}
          </span>
        </div>
      </div>

      {/* Section: Multi-Timeframe Coverage */}
      <div className="rounded-lg border border-[#1e2d42] bg-[#09111c] p-3 space-y-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#7f8fa5] mb-1">
          Candle Distribution
        </div>
        <div className="grid grid-cols-4 gap-1.5 text-center font-mono">
          {TIMEFRAMES.map((tf) => {
            const active = tf === timeframe;
            return (
              <Link
                key={tf}
                href={link(tf)}
                prefetch={false}
                onClick={() => {
                  if (!active) setIsLoading(true);
                  if (typeof window !== "undefined" && window.innerWidth < 768) {
                    setMobileTab("chart");
                  }
                }}
                className={`p-2 rounded-lg border transition-all ${
                  active
                    ? "border-[#a98953] bg-[#a98953]/20 text-[#d3a85c] font-bold shadow-sm"
                    : "border-[#1c293b] bg-[#0e1623] text-[#95a3b6] hover:text-white hover:bg-[#162234] active:bg-[#1f3049]"
                }`}
                title={`Switch to ${tf} timeframe`}
              >
                <div className="text-[10px] font-sans font-bold">{tf}</div>
                <div className="text-[11px] font-semibold">
                  {view?.counts[tf] ?? 0}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Section: Causal Setup Pipeline */}
      <div className="rounded-lg border border-[#1e2d42] bg-[#09111c] p-3 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#7f8fa5]">
          Causal Setup Pipeline
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Nearest Above:</span>
          <strong className="text-[#e1e9f4] font-mono text-[11px] truncate max-w-[150px]">
            {view?.approachAbove ?? "None"}
          </strong>
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Nearest Below:</span>
          <strong className="text-[#e1e9f4] font-mono text-[11px] truncate max-w-[150px]">
            {view?.approachBelow ?? "None"}
          </strong>
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Interaction:</span>
          <strong className="text-[#e1e9f4]">
            {view?.latestInteraction ?? "None"}
          </strong>
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Displacement:</span>
          <strong className="text-[#e1e9f4]">
            {view?.latestDisplacement ?? "None"}
          </strong>
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">BOS / MSS:</span>
          <strong className="text-[#e1e9f4]">
            {view?.latestConfirmation ?? "None"}
          </strong>
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Qualified FVG:</span>
          <strong className="text-[#e1e9f4]">
            {view?.latestFvg ?? "None"}
          </strong>
        </div>
      </div>

      {/* Section: Execution & Entry */}
      <div className="rounded-lg border border-[#1e2d42] bg-[#09111c] p-3 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#7f8fa5]">
          Execution State
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Entry Candidate:</span>
          <strong className="text-[#e1e9f4]">
            {view?.latestEntry ?? "None"}
          </strong>
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Setup Family:</span>
          <strong className="text-[#d3a85c]">
            {view?.latestSignal?.setupFamily ?? "Waiting Setup"}
          </strong>
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-[#8491a5]">Signal Status:</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
              view?.latestSignal
                ? "bg-[#22c55e]/20 text-[#4ade80] border border-[#22c55e]/30"
                : "bg-[#1c293b] text-[#8491a5]"
            }`}
          >
            {view?.latestSignal?.lifecycle ?? "NO ACTIVE SIGNAL"}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`h-[100dvh] w-screen overflow-hidden flex flex-col bg-[#080e18] text-[#e8eef7] ${
        isFullscreen ? "terminal-fullscreen" : ""
      }`}
    >
      {/* 1. TOP HEADER (Responsive for mobile & desktop) */}
      <header className="flex-none border-b border-[#202b3e] bg-[#0b1422] px-2.5 sm:px-4 py-2 sm:py-0 sm:h-13 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 select-none z-20 pt-safe">
        {/* Row 1 on mobile / Left section on desktop */}
        <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-3 w-full sm:w-auto">
          {/* Brand & Instrument */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-[#d3a85c] text-[#0d1624] font-black text-xs flex items-center justify-center font-mono shadow-sm">
                TB
              </span>
              <span className="font-bold text-sm tracking-tight text-white hidden xs:inline">
                TraderBrain
              </span>
            </div>

            <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-[#202b3e]">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs tracking-wider text-[#e1e9f4]">
                  XAUUSD
                </span>
                {view?.latestPrice && (
                  <span className={`text-[11px] sm:text-xs font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${
                    isUp ? "bg-[#143322] text-[#4ade80] border border-[#1e5436]" : "bg-[#331414] text-[#f87171] border border-[#541e1e]"
                  }`}>
                    <span>{fmt(view.latestPrice)}</span>
                    <span className="text-[10px] opacity-85 hidden xxs:inline">({isUp ? "+" : ""}{candleChangePct.toFixed(2)}%)</span>
                  </span>
                )}
              </div>
              <span className="text-[9px] text-[#6d7e94] hidden lg:inline leading-none">
                Gold / USD
              </span>
            </div>

            {/* Desktop Mode Pill */}
            <div className="hidden lg:flex items-center bg-[#111e2d] border border-[#202b3e] rounded-md p-0.5 text-[10px] font-semibold">
              <span className="px-2 py-0.5 text-[#5e6e84] cursor-not-allowed">LIVE</span>
              <span className="px-2 py-0.5 bg-[#d3a85c] text-[#0d1624] rounded font-bold">
                HISTORY
              </span>
              <span className="px-2 py-0.5 text-[#5e6e84] cursor-not-allowed">REPLAY</span>
            </div>
          </div>

          {/* Mobile Right: Date Range Button + Compact Status */}
          <div className="flex items-center gap-1.5 sm:hidden shrink-0">
            <button
              type="button"
              onClick={() => setIsDateModalOpen(true)}
              className="min-h-[32px] px-2 py-1 rounded-lg bg-[#111e2d] hover:bg-[#1f3148] active:bg-[#283f5e] border border-[#243249] text-[11px] font-mono text-[#c7d5e6] flex items-center gap-1 transition-colors"
              title="Change historical date range"
            >
              <span className="text-[#d3a85c]">📅</span>
              <span>{formatShortDate(selectedFrom)}→{formatShortDate(selectedTo)}</span>
            </button>

            <div
              className={`min-h-[32px] px-2 py-1 border rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 shrink-0 ${
                isLoading
                  ? "border-[#d3a85c] bg-[#2a220e]/80 text-[#e8c382]"
                  : isReady
                  ? "border-[#1d5c42] bg-[#0c2a1e]/60 text-[#4ade80]"
                  : rangeError
                  ? "border-[#682424] bg-[#2a0e0e]/60 text-[#f87171]"
                  : "border-[#68521d] bg-[#2a220e]/60 text-[#fbbf24]"
              }`}
            >
              {isLoading ? (
                <>
                  <span className="w-2 h-2 rounded-full border border-[#d3a85c] border-t-transparent animate-spin" />
                  <span>FETCHING DATA...</span>
                </>
              ) : (
                <>
                  <span className={`w-1.5 h-1.5 rounded-full ${isReady ? "bg-[#4ade80]" : rangeError ? "bg-[#f87171]" : "bg-[#fbbf24]"}`} />
                  <span>{dataLabel}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Row 2 on mobile / Center & Right on desktop */}
        <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-4 w-full sm:w-auto min-w-0">
          {/* Timeframes with thumb-friendly touch targets */}
          <nav className="flex items-center bg-[#111e2d] border border-[#243249] rounded-lg p-0.5 flex-1 sm:flex-initial" aria-label="Chart timeframe">
            {TIMEFRAMES.map((tf) => {
              const active = tf === timeframe;
              return (
                <Link
                  key={tf}
                  href={link(tf)}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    if (!active) setIsLoading(true);
                  }}
                  className={`flex-1 sm:flex-initial text-center min-h-[34px] sm:min-h-0 px-3 sm:px-2.5 py-1 sm:py-1 text-xs rounded-md transition-all font-semibold flex items-center justify-center ${
                    active
                      ? "bg-[#d3a85c] text-[#111e2d] font-bold shadow-sm"
                      : "text-[#9aaac0] hover:text-white hover:bg-[#1a2b3f] active:bg-[#20344d]"
                  }`}
                >
                  {tf}
                </Link>
              );
            })}
          </nav>

          {/* Desktop Inline Date Range Selector */}
          <div className="hidden md:flex items-center">
            <DateRangeSelector
              key={`${selectedFrom}:${selectedTo}`}
              fromDate={selectedFrom}
              toDate={selectedTo}
              timeframe={timeframe}
              bars={bars}
              maxDate={maxDate}
              onLoadingChange={setIsLoading}
              onOpenModal={() => setIsDateModalOpen(true)}
            />
          </div>

          {/* Desktop Right: Data status badge */}
          <div className="hidden sm:flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div
              className={`px-2.5 py-1 border rounded text-[11px] font-bold tracking-wider uppercase flex items-center gap-1.5 ${
                isLoading
                  ? "border-[#d3a85c] bg-[#2a220e]/80 text-[#e8c382]"
                  : isReady
                  ? "border-[#1d5c42] bg-[#0c2a1e]/60 text-[#4ade80]"
                  : rangeError
                  ? "border-[#682424] bg-[#2a0e0e]/60 text-[#f87171]"
                  : "border-[#68521d] bg-[#2a220e]/60 text-[#fbbf24]"
              }`}
            >
              {isLoading ? (
                <>
                  <span className="w-2 h-2 rounded-full border border-[#d3a85c] border-t-transparent animate-spin" />
                  <span className="hidden sm:inline">FETCHING DATA...</span>
                  <span className="sm:hidden">FETCHING...</span>
                </>
              ) : (
                <span>{dataLabel}</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE (Flex-1 filling remaining viewport height) */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
        {/* Left/Center: Main Chart Area */}
        <main
          className={`flex-1 min-w-0 flex flex-col h-full bg-[#09111d] transition-all duration-150 ${
            isFullscreen ? "w-full" : ""
          } ${mobileTab === "chart" ? "flex" : "hidden md:flex"}`}
          aria-label="Primary XAUUSD chart"
        >
          <ChartView
            candles={view?.candles ?? []}
            overlays={view?.overlays ?? []}
            timeframe={timeframe}
            status={view?.status ?? "WARN"}
            rangeNotice={view?.rangeNotice ?? null}
            rangeError={rangeError}
            emptyMessage={emptyMessage}
            isLoading={isLoading}
            isRadarOpen={isRadarOpen}
            onToggleRadar={handleToggleRadar}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            onOpenDateModal={() => setIsDateModalOpen(true)}
          />

          {/* Micro Footer Bar for Chart Metadata */}
          <div className="flex-none h-6 border-t border-[#1c293b] bg-[#0a1320] px-3 sm:px-4 flex items-center justify-between text-[10px] text-[#6d7e94] font-mono select-none">
            <div className="flex items-center gap-2 sm:gap-3 truncate">
              <span>
                {view?.counts[timeframe] ?? 0} {timeframe} candles loaded
              </span>
              <span className="hidden md:inline">·</span>
              <span className="hidden md:inline">
                {view
                  ? `${view.finageCalls} API calls (${view.cacheHit ? "cached" : `${view.loadMs.toFixed(0)}ms`})`
                  : "--"}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <span className="hidden sm:inline">
                {view?.firstAt
                  ? `${new Date(view.firstAt).toISOString().slice(0, 16).replace("T", " ")} UTC`
                  : ""}
              </span>
              <span className="hidden sm:inline">→</span>
              <span>
                {view?.latestAt
                  ? `${new Date(view.latestAt).toISOString().slice(0, 16).replace("T", " ")} UTC`
                  : ""}
              </span>
            </div>
          </div>

          {/* Mobile Tap-To-View Signal Bar (shown on Chart tab on mobile) */}
          <div
            onClick={() => setMobileTab("signal")}
            className="md:hidden flex-none h-10 min-h-[40px] border-t border-[#202b3e] bg-[#0c1626] px-3 flex items-center justify-between text-xs cursor-pointer hover:bg-[#132238] active:bg-[#182a44] transition-colors"
          >
            <div className="flex items-center gap-2 truncate">
              <span className="text-[10px] font-bold text-[#a98953]">SIGNAL:</span>
              {view?.latestSignal ? (
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span
                    className={`px-1.5 py-0.5 rounded font-black text-[10px] ${
                      view.latestSignal.direction === "BUY"
                        ? "bg-[#22c55e] text-[#0a1e12]"
                        : "bg-[#ef4444] text-[#1f0909]"
                    }`}
                  >
                    {view.latestSignal.direction}
                  </span>
                  <span className="text-[#e1e9f4] font-sans font-semibold">{view.latestSignal.setupFamily}</span>
                  <span className="text-[#d3a85c] font-bold">RR 1:{view.latestSignal.rr.toFixed(1)}</span>
                </div>
              ) : (
                <span className="text-[#8491a5] text-[10px]">No active setup · Waiting for confirmation</span>
              )}
            </div>
            <span className="text-[#d3a85c] text-[11px] font-semibold shrink-0">Details →</span>
          </div>
        </main>

        {/* Opportunity Radar Mobile Tab View */}
        <div
          className={`flex-1 min-w-0 flex flex-col h-full bg-[#0c1421] md:hidden ${
            mobileTab === "radar" ? "flex" : "hidden"
          }`}
          aria-label="Opportunity Radar Mobile"
        >
          <div className="flex-none p-3.5 border-b border-[#202b3e] bg-[#0e1827] flex items-center justify-between">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#a98953]">
                PHASE 1–15 EVIDENCE
              </p>
              <h2 className="text-sm font-bold text-[#e1e9f4] tracking-tight">
                Opportunity Radar
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setMobileTab("chart")}
              className="px-2.5 py-1 rounded bg-[#16253b] hover:bg-[#20334d] border border-[#263750] text-[#c7d5e6] text-xs font-semibold"
            >
              ← Back to Chart
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {renderRadarContent()}
          </div>
        </div>

        {/* Signals Mobile Tab View */}
        <div
          className={`flex-1 min-w-0 flex flex-col h-full bg-[#080e18] md:hidden ${
            mobileTab === "signal" ? "flex" : "hidden"
          }`}
          aria-label="Signal Details Mobile"
        >
          <div className="flex-none p-3.5 border-b border-[#202b3e] bg-[#0e1827] flex items-center justify-between">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#a98953]">
                EXECUTION PIPELINE
              </p>
              <h2 className="text-sm font-bold text-[#e1e9f4] tracking-tight">
                Signal Ledger &amp; Setup
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setMobileTab("chart")}
              className="px-2.5 py-1 rounded bg-[#16253b] hover:bg-[#20334d] border border-[#263750] text-[#c7d5e6] text-xs font-semibold"
            >
              ← Back to Chart
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Active Signal Details Card */}
            <div className="rounded-xl border border-[#243750] bg-[#0c1626] p-4 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#a98953]">
                  LATEST SIGNAL
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    view?.latestSignal
                      ? "bg-[#22c55e]/20 text-[#4ade80] border border-[#22c55e]/30"
                      : "bg-[#1c293b] text-[#8491a5]"
                  }`}
                >
                  {view?.latestSignal?.lifecycle ?? "WAITING SETUP"}
                </span>
              </div>

              {view?.latestSignal ? (
                <>
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-3 py-1 rounded font-black text-sm tracking-wider uppercase shadow-md ${
                        view.latestSignal.direction === "BUY"
                          ? "bg-[#22c55e] text-[#0a1e12]"
                          : "bg-[#ef4444] text-[#1f0909]"
                      }`}
                    >
                      {view.latestSignal.direction}
                    </span>
                    <div>
                      <h4 className="font-bold text-sm text-white">
                        {view.latestSignal.setupFamily}
                      </h4>
                      <p className="text-[11px] font-mono text-[#8491a5]">
                        {new Date(view.latestSignal.timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1c2b3e]">
                    <div className="p-2.5 rounded-lg bg-[#09111c] border border-[#1e2d42]">
                      <span className="block text-[10px] text-[#6d7e94]">ENTRY LEVEL</span>
                      <strong className="text-sm font-mono text-[#dce5f1]">
                        {fmt(view.latestSignal.entry)}
                      </strong>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#09111c] border border-[#1e2d42]">
                      <span className="block text-[10px] text-[#6d7e94]">RISK / REWARD</span>
                      <strong className="text-sm font-mono text-[#d3a85c]">
                        1 : {view.latestSignal.rr.toFixed(2)}
                      </strong>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#09111c] border border-[#1e2d42]">
                      <span className="block text-[10px] text-[#f87171]">STOP LOSS</span>
                      <strong className="text-sm font-mono text-[#f87171]">
                        {fmt(view.latestSignal.stopLoss)}
                      </strong>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#09111c] border border-[#1e2d42]">
                      <span className="block text-[10px] text-[#4ade80]">TAKE PROFIT</span>
                      <strong className="text-sm font-mono text-[#4ade80]">
                        {fmt(view.latestSignal.takeProfit)}
                      </strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setMobileTab("chart")}
                    className="w-full mt-3 h-11 min-h-[44px] rounded-xl bg-[#16253b] hover:bg-[#20334d] active:bg-[#284063] border border-[#2b3e58] text-xs font-bold text-[#d3a85c] flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                  >
                    <span>View Setup on Live Chart</span>
                    <span>→</span>
                  </button>
                </>
              ) : (
                <div className="text-center py-6">
                  <div className="w-10 h-10 rounded-full bg-[#1b2738] text-[#8491a5] flex items-center justify-center mx-auto mb-2 text-base">
                    ⏳
                  </div>
                  <h4 className="text-sm font-semibold text-[#e1e9f4]">No Active Signal</h4>
                  <p className="text-xs text-[#8491a5] mt-1 max-w-xs mx-auto">
                    The causal model is continuously scanning for high-probability market structure confirmations.
                  </p>
                </div>
              )}
            </div>

            {/* Signal History List */}
            <div className="rounded-xl border border-[#1e2d42] bg-[#0c1626] p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#7f8fa5]">
                Signal History ({view?.signalHistory?.length ?? 0})
              </h3>

              {view?.signalHistory && view.signalHistory.length > 0 ? (
                <div className="space-y-2">
                  {view.signalHistory.slice(-8).reverse().map((sig) => (
                    <div
                      key={sig.id}
                      className="p-3 rounded-lg bg-[#09111c] border border-[#1a283c] flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`px-2 py-0.5 rounded font-black text-[10px] ${
                            sig.direction === "BUY"
                              ? "bg-[#22c55e]/20 text-[#4ade80] border border-[#22c55e]/30"
                              : "bg-[#ef4444]/20 text-[#f87171] border border-[#ef4444]/30"
                          }`}
                        >
                          {sig.direction}
                        </span>
                        <div>
                          <span className="font-semibold text-white block">{sig.setupFamily}</span>
                          <span className="font-mono text-[10px] text-[#6d7e94]">
                            Entry {fmt(sig.entry)} · SL {fmt(sig.stopLoss)}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-mono font-bold text-[#d3a85c] block">
                          RR 1:{sig.rr.toFixed(1)}
                        </span>
                        <span className="text-[10px] text-[#8491a5] uppercase">
                          {sig.lifecycle}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#6d7e94] italic">No prior signals in this window.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right: Opportunity Radar Sidebar (Desktop only) */}
        {!isFullscreen && (
          <aside
            className={`${
              isRadarOpen ? "w-[280px] lg:w-[320px]" : "w-0"
            } flex-none border-l border-[#202b3e] bg-[#0c1421] hidden md:flex flex-col h-full overflow-hidden transition-all duration-200 ease-in-out select-none`}
            aria-label="Opportunity Radar"
          >
            {/* Radar Header */}
            <div className="flex-none p-3.5 border-b border-[#202b3e] bg-[#0e1827] flex items-center justify-between">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-[#a98953]">
                  PHASE 1–15 EVIDENCE
                </p>
                <h2 className="text-sm font-bold text-[#e1e9f4] tracking-tight">
                  Opportunity Radar
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsRadarOpen(false)}
                className="w-6 h-6 rounded flex items-center justify-center text-[#8491a5] hover:text-white hover:bg-[#1a283c] text-xs"
                title="Collapse sidebar"
              >
                ✕
              </button>
            </div>

            {/* Radar Content (Scrollable internally) */}
            <div className="flex-1 overflow-y-auto p-3">
              {renderRadarContent()}
            </div>
          </aside>
        )}
      </div>

      {/* 3. BOTTOM SIGNAL STRIP (Desktop footer bar) */}
      {!isFullscreen && isSignalStripOpen && (
        <footer className="flex-none border-t border-[#202b3e] bg-[#0b1422] px-4 py-2 hidden md:flex items-center justify-between gap-2 text-xs select-none z-10">
          <div className="flex items-center flex-wrap gap-3 sm:gap-4 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#a98953]">
                LATEST SIGNAL
              </span>
              <button
                type="button"
                onClick={() => setIsSignalStripOpen(false)}
                className="text-[#6d7e94] hover:text-white text-[10px]"
                title="Hide signal strip"
              >
                ▼
              </button>
            </div>

            {view?.latestSignal ? (
              <div className="flex items-center flex-wrap gap-2.5 sm:gap-3 text-xs">
                <span
                  className={`px-2 py-0.5 rounded font-black text-[11px] tracking-wider uppercase ${
                    view.latestSignal.direction === "BUY"
                      ? "bg-[#22c55e] text-[#0a1e12] shadow-sm"
                      : "bg-[#ef4444] text-[#1f0909] shadow-sm"
                  }`}
                >
                  {view.latestSignal.direction}
                </span>

                <span className="font-semibold text-[#e1e9f4]">
                  {view.latestSignal.setupFamily}
                </span>

                <span className="font-mono text-[#c5d3e4]">
                  <span className="text-[#6d7e94] text-[10px] mr-1">ENTRY</span>
                  {fmt(view.latestSignal.entry)}
                </span>

                <span className="font-mono text-[#f87171]">
                  <span className="text-[#6d7e94] text-[10px] mr-1">SL</span>
                  {fmt(view.latestSignal.stopLoss)}
                </span>

                <span className="font-mono text-[#4ade80]">
                  <span className="text-[#6d7e94] text-[10px] mr-1">TP</span>
                  {fmt(view.latestSignal.takeProfit)}
                </span>

                <span className="font-mono bg-[#16253b] px-1.5 py-0.5 rounded border border-[#263750] text-[#d3a85c] font-bold">
                  RR 1:{view.latestSignal.rr.toFixed(2)}
                </span>

                <span className="px-1.5 py-0.5 rounded bg-[#132030] text-[#95a3b6] text-[10px] font-bold uppercase border border-[#202f43]">
                  {view.latestSignal.lifecycle}
                </span>

                <time
                  dateTime={new Date(view.latestSignal.timestamp).toISOString()}
                  className="text-[#6d7e94] font-mono text-[10px] hidden md:inline"
                >
                  {new Date(view.latestSignal.timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC
                </time>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[#8491a5]">
                <span className="w-2 h-2 rounded-full bg-[#d3a85c]/60 animate-pulse" />
                <span className="font-medium text-[#c5d3e4]">NO ACTIVE SIGNAL</span>
                <span className="text-[#6d7e94] hidden sm:inline">· Waiting for causal setup</span>
              </div>
            )}
          </div>

          {/* Mini Signal History */}
          {view?.signalHistory && view.signalHistory.length > 0 && (
            <div className="hidden lg:flex items-center gap-2 shrink-0 border-l border-[#202b3e] pl-4 font-mono text-[10px]">
              <span className="text-[#6d7e94]">HISTORY:</span>
              <div className="flex items-center gap-1.5">
                {view.signalHistory.slice(-4).map((sig) => (
                  <span
                    key={sig.id}
                    className={`px-1.5 py-0.5 rounded border ${
                      sig.direction === "BUY"
                        ? "border-[#1e4d35] bg-[#0f291d] text-[#4ade80]"
                        : "border-[#4d1e22] bg-[#290f12] text-[#f87171]"
                    }`}
                    title={`${sig.direction} ${sig.setupFamily} RR ${sig.rr.toFixed(2)} - ${sig.lifecycle}`}
                  >
                    {sig.direction} {sig.rr.toFixed(1)}R
                  </span>
                ))}
              </div>
            </div>
          )}
        </footer>
      )}

      {/* 4. PINNED MOBILE BOTTOM NAVIGATION (md:hidden) */}
      <nav
        className="flex-none h-14 landscape:h-11 border-t border-[#202b3e] bg-[#0b1422] px-2 flex items-center justify-around md:hidden select-none z-30 pb-safe"
        aria-label="Mobile Navigation"
      >
        <button
          type="button"
          onClick={() => setMobileTab("chart")}
          className={`flex-1 h-full min-h-[48px] py-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-all active:scale-95 ${
            mobileTab === "chart" ? "text-[#d3a85c]" : "text-[#7f8fa5] hover:text-[#e1e9f4]"
          }`}
        >
          <span className="text-base leading-none">📊</span>
          <span>Chart</span>
          {mobileTab === "chart" && <span className="w-4 h-0.5 rounded-full bg-[#d3a85c] -mt-0.5" />}
        </button>

        <button
          type="button"
          onClick={() => setMobileTab("radar")}
          className={`flex-1 h-full min-h-[48px] py-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-all active:scale-95 ${
            mobileTab === "radar" ? "text-[#d3a85c]" : "text-[#7f8fa5] hover:text-[#e1e9f4]"
          }`}
        >
          <span className="text-base leading-none">🎯</span>
          <span>Radar</span>
          {mobileTab === "radar" && <span className="w-4 h-0.5 rounded-full bg-[#d3a85c] -mt-0.5" />}
        </button>

        <button
          type="button"
          onClick={() => setMobileTab("signal")}
          className={`flex-1 h-full min-h-[48px] py-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold relative transition-all active:scale-95 ${
            mobileTab === "signal" ? "text-[#d3a85c]" : "text-[#7f8fa5] hover:text-[#e1e9f4]"
          }`}
        >
          <div className="relative">
            <span className="text-base leading-none">⚡</span>
            {view?.latestSignal && (
              <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
            )}
          </div>
          <span>Signals</span>
          {mobileTab === "signal" && <span className="w-4 h-0.5 rounded-full bg-[#d3a85c] -mt-0.5" />}
        </button>

        <button
          type="button"
          onClick={() => setIsDateModalOpen(true)}
          className="flex-1 h-full min-h-[48px] py-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-[#7f8fa5] hover:text-[#e1e9f4] active:scale-95 transition-all"
        >
          <span className="text-base leading-none">📅</span>
          <span>Dates</span>
        </button>
      </nav>

      {/* Mobile Date Range Modal */}
      <DateRangeModal
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        fromDate={selectedFrom}
        toDate={selectedTo}
        timeframe={timeframe}
        bars={bars}
        maxDate={maxDate}
        onLoadingChange={setIsLoading}
      />
    </div>
  );
}
