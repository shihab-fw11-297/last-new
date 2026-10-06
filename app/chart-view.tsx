"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  LineStyle,
  ColorType,
  CrosshairMode,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickData,
  type Time,
  type MouseEventParams,
  type ISeriesMarkersPluginApi,
  type LineWidth,
  type SeriesMarker,
} from "lightweight-charts";

import type { Timeframe } from "@/lib/traderbrain/data/types";
import type { ChartCandle, ChartOverlay, MarketView } from "@/lib/traderbrain/ui/market-view";

const fmt = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

import {
  toChartTime,
  isValidChartCandle,
  transformCandlesForChart,
} from "@/lib/traderbrain/ui/chart-adapter";

export { toChartTime, isValidChartCandle, transformCandlesForChart };

export interface ChartViewProps {
  candles: ChartCandle[];
  overlays: ChartOverlay[];
  timeframe: Timeframe;
  status: MarketView["status"];
  rangeNotice: string | null;
  rangeError: string | null;
  emptyMessage: string;
  isLoading?: boolean;
  onFitRequest?: () => void;
  isRadarOpen: boolean;
  onToggleRadar: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenDateModal?: () => void;
}

interface HoveredCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
}

export function ChartView({
  candles,
  overlays,
  timeframe,
  rangeNotice,
  rangeError,
  emptyMessage,
  isLoading = false,
  isRadarOpen,
  onToggleRadar,
  isFullscreen,
  onToggleFullscreen,
  onOpenDateModal,
}: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastFittedKeyRef = useRef<string>("");
  const hasEverFittedRef = useRef<boolean>(false);

  const [hoveredCandle, setHoveredCandle] = useState<HoveredCandle | null>(null);

  // Derive latest candle stats for default header display
  const latestCandle = candles.at(-1);
  const defaultStats = latestCandle
    ? {
        open: latestCandle.open,
        high: latestCandle.high,
        low: latestCandle.low,
        close: latestCandle.close,
        change: latestCandle.close - latestCandle.open,
        changePercent:
          latestCandle.open !== 0
            ? ((latestCandle.close - latestCandle.open) / latestCandle.open) * 100
            : 0,
      }
    : null;

  // Initialize Chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const initialRect = container.getBoundingClientRect();
    const initialWidth = initialRect.width > 0 ? initialRect.width : container.clientWidth || 800;
    const initialHeight = initialRect.height > 0 ? initialRect.height : container.clientHeight || 500;

    const chart = createChart(container, {
      width: initialWidth,
      height: initialHeight,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#09111d" },
        textColor: "#8491a5",
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      },
      grid: {
        vertLines: { color: "#131f30", style: LineStyle.Solid },
        horzLines: { color: "#131f30", style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#8195aa",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1b293d",
        },
        horzLine: {
          color: "#8195aa",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1b293d",
        },
      },
      rightPriceScale: {
        borderColor: "#202b3e",
        autoScale: true,
        scaleMargins: {
          top: 0.12,
          bottom: 0.12,
        },
        alignLabels: true,
      },
      timeScale: {
        borderColor: "#202b3e",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 0.001, // Allow fitting thousands of candles without clamping
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
        mouseWheel: true,
        pinch: true,
        axisDoubleClickReset: {
          time: true,
          price: true,
        },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Crosshair hover subscription (presentation only, ZERO network requests)
    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.point || !param.time || !seriesRef.current) {
        setHoveredCandle(null);
        return;
      }

      const data = param.seriesData.get(seriesRef.current) as CandlestickData<Time> | undefined;
      if (!data || typeof data.open !== "number") {
        setHoveredCandle(null);
        return;
      }

      const open = data.open;
      const high = data.high;
      const low = data.low;
      const close = data.close;
      const change = close - open;
      const changePercent = open !== 0 ? (change / open) * 100 : 0;

      const dateStr =
        typeof param.time === "number"
          ? new Date(param.time * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC"
          : String(param.time);

      setHoveredCandle({
        time: dateStr,
        open,
        high,
        low,
        close,
        change,
        changePercent,
      });
    };

    chart.subscribeCrosshairMove(onCrosshairMove);

    // ResizeObserver: If container geometry becomes valid after initial mount, re-fit content once
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          if (!hasEverFittedRef.current && seriesRef.current) {
            hasEverFittedRef.current = true;
            chart.timeScale().fitContent();
          }
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      if (markersPluginRef.current) {
        try {
          markersPluginRef.current.detach();
        } catch {
          // ignore
        }
        markersPluginRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Update Data and Overlays when props change
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!series || !chart) return;

    if (!candles.length) {
      series.setData([]);
      // Clear price lines
      priceLinesRef.current.forEach((line) => {
        try {
          series.removePriceLine(line);
        } catch {
          // ignore
        }
      });
      priceLinesRef.current = [];
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers([]);
      }
      return;
    }

    // Transform and validate candles
    const { chartData, outOfOrderCount, duplicateTimeCount, malformedCount } =
      transformCandlesForChart(candles);

    const containerWidth = container ? container.clientWidth : 0;
    const containerHeight = container ? container.clientHeight : 0;

    // Compact diagnostic logging required by audit protocol
    if (typeof window !== "undefined") {
      console.log("[CHART_RENDER_DIAGNOSTIC]", {
        timeframe,
        sourceCandleCount: candles.length,
        transformedCandleCount: chartData.length,
        firstCandle: candles[0]
          ? { timestamp: candles[0].timestamp, open: candles[0].open, close: candles[0].close }
          : null,
        lastCandle: candles.at(-1)
          ? { timestamp: candles.at(-1)?.timestamp, open: candles.at(-1)?.open, close: candles.at(-1)?.close }
          : null,
        firstChartTime: chartData[0]?.time ?? null,
        lastChartTime: chartData.at(-1)?.time ?? null,
        containerWidth,
        containerHeight,
        chartInitialized: Boolean(chartRef.current),
        seriesInitialized: Boolean(seriesRef.current),
        outOfOrderCount,
        duplicateTimeCount,
        malformedCount,
      });
    }

    // Load candles into series
    series.setData(chartData);

    // Remove existing price lines
    priceLinesRef.current.forEach((line) => {
      try {
        series.removePriceLine(line);
      } catch {
        // ignore
      }
    });
    priceLinesRef.current = [];

    // Add new price lines for Overlays
    const newPriceLines: IPriceLine[] = [];
    for (const overlay of overlays) {
      let color = "#d3a85c"; // Gold for BSL
      const lineStyle = overlay.kind === "ENTRY" ? LineStyle.Dotted : LineStyle.Dashed;
      let lineWidth: LineWidth = 1;
      let title = overlay.label;

      if (overlay.kind === "ENTRY") {
        color = "#ffffff";
        lineWidth = 2;
        title = "ENTRY";
      } else if (overlay.kind === "STOP") {
        color = "#ef4444";
        lineWidth = 2;
        title = "SL";
      } else if (overlay.kind === "TARGET") {
        color = "#22c55e";
        lineWidth = 2;
        title = "TP";
      } else if (overlay.side === "SSL") {
        color = "#5b9cb8";
        title = overlay.label;
      }

      try {
        const line = series.createPriceLine({
          price: overlay.price,
          color,
          lineWidth,
          lineStyle,
          axisLabelVisible: true,
          title,
        });
        newPriceLines.push(line);
      } catch {
        // ignore
      }
    }
    priceLinesRef.current = newPriceLines;

    // Signal markers
    const signalOverlays = overlays.filter((o) => o.kind === "ENTRY" || o.kind === "STOP");
    const markers: SeriesMarker<Time>[] = [];
    if (signalOverlays.length > 0) {
      const entryOverlay = overlays.find((o) => o.kind === "ENTRY");
      const stopOverlay = overlays.find((o) => o.kind === "STOP");
      if (entryOverlay && stopOverlay) {
        const isBuy = entryOverlay.price > stopOverlay.price;
        const timeSec = toChartTime(entryOverlay.availableAt);
        markers.push({
          time: timeSec,
          position: isBuy ? "belowBar" : "aboveBar",
          color: isBuy ? "#22c55e" : "#ef4444",
          shape: isBuy ? "arrowUp" : "arrowDown",
          text: isBuy ? "BUY SIGNAL" : "SELL SIGNAL",
          size: 1.5,
        });
      }
    }

    if (!markersPluginRef.current) {
      markersPluginRef.current = createSeriesMarkers(series, markers);
    } else {
      markersPluginRef.current.setMarkers(markers);
    }

    // Auto-fit content upon receiving dataset
    const datasetKey = `${candles[0]?.timestamp}-${candles.at(-1)?.timestamp}-${timeframe}-${candles.length}`;
    if (lastFittedKeyRef.current !== datasetKey) {
      lastFittedKeyRef.current = datasetKey;
      const currentWidth = container ? container.clientWidth : 0;
      if (currentWidth > 0) {
        hasEverFittedRef.current = true;
        chart.timeScale().fitContent();
      } else {
        hasEverFittedRef.current = false;
      }

      // Double-tap fitContent in requestAnimationFrame to ensure canvas geometry has rendered
      requestAnimationFrame(() => {
        if (
          chartRef.current &&
          containerRef.current &&
          containerRef.current.clientWidth > 0
        ) {
          hasEverFittedRef.current = true;
          chartRef.current.timeScale().fitContent();
        }
      });
    }
  }, [candles, overlays, timeframe]);

  // Fit Content action
  const handleFitContent = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, []);

  // Viewport preset actions (changes visible range locally without modifying data)
  const handleSetBarsRange = useCallback(
    (count: number) => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series || !candles.length) return;

      const total = candles.length;
      const from = Math.max(0, total - count);
      const to = total - 1;

      chart.timeScale().setVisibleLogicalRange({
        from,
        to: to + 8, // slight right margin offset
      });
    },
    [candles]
  );

  const activeStats = hoveredCandle ?? defaultStats;
  const isUp = activeStats ? activeStats.change >= 0 : true;

  return (
    <div className="flex flex-col h-full w-full min-h-0 min-w-0 bg-[#09111d] overflow-hidden select-none">
      {/* Chart Top Sub-Bar: Interactive stats & Viewport controls */}
      <div className="flex-none min-h-10 border-b border-[#202b3e] bg-[#0c1626] px-2.5 sm:px-4 py-1.5 flex items-center justify-between gap-1.5 sm:gap-2 text-xs overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1.5 sm:gap-4 shrink-0 font-mono text-[10px] sm:text-[11px]">
          <div className="flex items-center gap-1 font-sans font-semibold text-[#e1e9f4]">
            <span>XAUUSD</span>
            <span className="text-[#a98953]">/</span>
            <span className="text-[#d3a85c]">{timeframe}</span>
          </div>

          {candles.length > 0 && (
            <span className="hidden xl:inline-flex items-center gap-1 text-[#4ade80] bg-[#122b1e] border border-[#1d5c3d] px-2 py-0.5 rounded text-[10px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
              {candles.length.toLocaleString()} candles loaded
            </span>
          )}

          {activeStats ? (
            <div className="flex items-center gap-1.5 sm:gap-2.5 text-[#9aaac0]">
              <span className="hidden sm:inline">
                <span className="text-[#6d7e94] text-[9px] sm:text-[10px] mr-0.5">O</span>
                <span className="text-[#dce5f1]">{fmt(activeStats.open)}</span>
              </span>
              <span className="hidden sm:inline">
                <span className="text-[#6d7e94] text-[9px] sm:text-[10px] mr-0.5">H</span>
                <span className="text-[#dce5f1]">{fmt(activeStats.high)}</span>
              </span>
              <span className="hidden sm:inline">
                <span className="text-[#6d7e94] text-[9px] sm:text-[10px] mr-0.5">L</span>
                <span className="text-[#dce5f1]">{fmt(activeStats.low)}</span>
              </span>
              <span>
                <span className="text-[#6d7e94] text-[9px] sm:text-[10px] mr-0.5">C</span>
                <span className={isUp ? "text-[#22c55e] font-semibold" : "text-[#ef4444] font-semibold"}>
                  {fmt(activeStats.close)}
                </span>
              </span>
              <span className={`text-[10px] sm:text-[11px] font-semibold ${isUp ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
                {isUp ? "+" : ""}
                {fmt(activeStats.change)} ({isUp ? "+" : ""}
                {activeStats.changePercent.toFixed(2)}%)
              </span>
            </div>
          ) : (
            <span className="text-[#6d7e94]">No OHLC</span>
          )}
        </div>

        {/* Viewport bar presets & actions with mobile touch-friendly sizes */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center bg-[#111e2d] border border-[#243249] rounded-lg p-0.5 text-[10px] sm:text-[11px]">
            <button
              type="button"
              onClick={() => handleSetBarsRange(30)}
              className="min-h-[28px] px-2 sm:px-2 py-0.5 rounded text-[#9aaac0] hover:text-white hover:bg-[#202f45] active:bg-[#273852] transition-colors"
              title="Show last 30 bars"
            >
              30b
            </button>
            <button
              type="button"
              onClick={() => handleSetBarsRange(60)}
              className="min-h-[28px] px-2 sm:px-2 py-0.5 rounded text-[#9aaac0] hover:text-white hover:bg-[#202f45] active:bg-[#273852] transition-colors"
              title="Show last 60 bars"
            >
              60b
            </button>
            <button
              type="button"
              onClick={() => handleSetBarsRange(120)}
              className="min-h-[28px] px-2 sm:px-2 py-0.5 rounded text-[#9aaac0] hover:text-white hover:bg-[#202f45] active:bg-[#273852] transition-colors hidden xs:inline-block"
              title="Show last 120 bars"
            >
              120b
            </button>
            <button
              type="button"
              onClick={handleFitContent}
              className="min-h-[28px] px-2 sm:px-2 py-0.5 rounded text-[#d3a85c] font-semibold hover:text-white hover:bg-[#202f45] active:bg-[#273852] transition-colors"
              title="Show all loaded bars"
            >
              All
            </button>
          </div>

          <button
            type="button"
            onClick={handleFitContent}
            className="min-h-[28px] px-2.5 py-1 rounded-lg bg-[#16253b] hover:bg-[#223652] active:bg-[#273d5c] border border-[#263750] text-[#c7d5e6] text-[10px] sm:text-[11px] font-semibold transition-colors"
            title="Fit all candles in viewport"
          >
            Fit
          </button>

          <button
            type="button"
            onClick={onToggleRadar}
            className={`min-h-[28px] px-2.5 py-1 rounded-lg border text-[10px] sm:text-[11px] font-medium transition-colors hidden md:inline-flex items-center gap-1 ${
              isRadarOpen
                ? "bg-[#21344f] border-[#3b5376] text-white"
                : "bg-[#16253b] border-[#263750] text-[#9aaac0] hover:text-white active:bg-[#20334d]"
            }`}
            title="Toggle Opportunity Radar panel"
          >
            <span>Radar</span>
          </button>

          <button
            type="button"
            onClick={onToggleFullscreen}
            className={`min-h-[28px] min-w-[28px] px-2 py-1 rounded-lg border text-[10px] sm:text-[11px] font-bold transition-all active:scale-95 ${
              isFullscreen
                ? "bg-[#d3a85c] text-[#0c1421] border-[#d3a85c]"
                : "bg-[#16253b] border-[#263750] text-[#c7d5e6] hover:bg-[#223652] active:bg-[#283f5e]"
            }`}
            title="Toggle full-screen chart layout (Esc to exit)"
            aria-label="Toggle Fullscreen"
          >
            {isFullscreen ? "Exit ✕" : "⛶"}
          </button>
        </div>
      </div>

      {/* Notice / Range Error banner if any */}
      {(rangeError || rangeNotice) && (
        <div
          className={`flex-none px-4 py-2 text-xs flex items-center justify-between border-b ${
            rangeError
              ? "bg-[#240e12] border-[#5e1e24] text-[#fca5a5]"
              : "bg-[#1a160d] border-[#3d3119] text-[#e5be71]"
          }`}
          role="alert"
        >
          <div className="flex items-center gap-2">
            <span className="font-bold">{rangeError ? "ERROR:" : "NOTICE:"}</span>
            <span className="font-mono">{rangeError ?? rangeNotice}</span>
          </div>
        </div>
      )}

      {/* Canvas container */}
      <div className="flex-1 min-h-0 min-w-0 w-full relative">
        <div
          ref={containerRef}
          className="w-full h-full min-h-[200px] relative select-none"
          style={{ touchAction: "pan-x pan-y pinch-zoom" }}
        />

        {/* Floating Quick Action Overlay when in Fullscreen */}
        {isFullscreen && (
          <div className="absolute top-3 right-3 z-40 flex items-center gap-1.5 p-1 bg-[#0b1422]/90 backdrop-blur-md border border-[#243249] rounded-xl shadow-2xl">
            <button
              type="button"
              onClick={handleFitContent}
              className="px-2.5 py-1 rounded-lg bg-[#16253b] hover:bg-[#20334d] text-[#c7d5e6] text-xs font-semibold"
            >
              Fit
            </button>
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="px-2.5 py-1 rounded-lg bg-[#d3a85c] hover:bg-[#e0b56b] text-[#142033] text-xs font-bold shadow-sm"
            >
              Exit ✕
            </button>
          </div>
        )}

        {/* 1. Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#09111d]/85 backdrop-blur-[2px] transition-all duration-150">
            <div className="flex flex-col items-center gap-3 p-6 rounded-xl border border-[#202b3e] bg-[#0c1626] shadow-2xl max-w-sm text-center">
              <div className="relative w-12 h-12 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-[#d3a85c]/20" />
                <div className="absolute inset-0 rounded-full border-2 border-[#d3a85c] border-t-transparent animate-spin" />
                <span className="text-[10px] font-mono font-bold text-[#d3a85c]">TB</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#e1e9f4] tracking-wide uppercase">
                  Fetching Market Data
                </h3>
                <p className="text-xs text-[#8491a5] mt-1 leading-relaxed">
                  Querying <strong className="text-[#d3a85c]">XAUUSD / {timeframe}</strong> candles from backend...
                </p>
                <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-mono text-[#6d7e94] bg-[#09111d] py-1 px-3 rounded border border-[#1c293b]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-ping" />
                  <span>Backend is processing · please wait</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. Prominent Error State */}
        {!isLoading && rangeError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#09111d]/90 p-6 text-center">
            <div className="max-w-lg w-full p-6 rounded-xl border border-[#ef4444]/40 bg-[#140c10] shadow-2xl text-center">
              <div className="w-11 h-11 rounded-full bg-[#ef4444]/15 text-[#ef4444] flex items-center justify-center mx-auto mb-3 font-bold text-xl border border-[#ef4444]/30">
                ✕
              </div>
              <h3 className="text-base font-bold text-[#fca5a5] mb-2">
                Backend Request Failed
              </h3>
              <div className="text-xs text-[#fca5a5]/90 font-mono bg-[#231014] p-3 rounded border border-[#ef4444]/25 text-left overflow-x-auto leading-relaxed mb-4 break-words">
                {rangeError}
              </div>
              <p className="text-[11px] text-[#9aaac0] mb-4">
                {rangeError.toLowerCase().includes("key")
                  ? "Please configure your environment credentials on the server to enable live and historical data."
                  : "Please check your requested date range or backend connection."}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-1.5 rounded bg-[#ef4444] hover:bg-[#dc2626] text-white text-xs font-bold transition-colors shadow-sm"
              >
                Retry Request
              </button>
            </div>
          </div>
        )}

        {/* 3. Empty State (no candles, no error) */}
        {!isLoading && !rangeError && !candles.length && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#09111d]/90 p-6 text-center">
            <div className="max-w-md p-6 rounded-xl border border-[#202b3e] bg-[#0d1624] shadow-2xl">
              <div className="w-10 h-10 rounded-full bg-[#d3a85c]/10 text-[#d3a85c] flex items-center justify-center mx-auto mb-3 font-bold text-lg">
                !
              </div>
              <h3 className="text-base font-semibold text-[#e1e9f4] mb-1">
                No Market Data
              </h3>
              <p className="text-xs text-[#8491a5] leading-relaxed">
                {emptyMessage}
              </p>
              {onOpenDateModal && (
                <button
                  type="button"
                  onClick={onOpenDateModal}
                  className="mt-3.5 min-h-[40px] px-4 py-2 rounded-xl bg-[#d3a85c] hover:bg-[#e0b56b] active:scale-95 text-[#0d1624] font-bold text-xs flex items-center justify-center gap-1.5 mx-auto transition-all shadow-md"
                >
                  <span>📅</span>
                  <span>Select Date Range</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile Subtle Gesture Hint */}
      <div className="sm:hidden flex-none h-5 px-3 bg-[#080e18] border-t border-[#182538] flex items-center justify-between text-[9px] text-[#6d7e94] font-mono select-none">
        <span>👆 Drag to pan · 🤏 Pinch to zoom · Tap for OHLC</span>
        <span className="text-[#a98953] font-bold">{timeframe}</span>
      </div>
    </div>
  );
}
