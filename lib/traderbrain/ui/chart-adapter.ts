import type { UTCTimestamp, CandlestickData, Time } from "lightweight-charts";
import type { ChartCandle } from "./market-view-core.ts";

/**
 * Single canonical timestamp adapter for Lightweight Charts.
 * Converts Unix milliseconds (TraderBrain canonical format) to Unix seconds (Lightweight Charts UTCTimestamp).
 * Guarantees exactly one conversion; will not divide twice if already in seconds.
 */
export function toChartTime(timestamp: number): UTCTimestamp {
  const seconds = timestamp > 1e11 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
  return seconds as UTCTimestamp;
}

/**
 * Validates that a candle point conforms strictly to OHLC geometric and finite constraints.
 */
export function isValidChartCandle(c: ChartCandle): boolean {
  return (
    typeof c.timestamp === "number" &&
    Number.isFinite(c.timestamp) &&
    typeof c.open === "number" &&
    Number.isFinite(c.open) &&
    typeof c.high === "number" &&
    Number.isFinite(c.high) &&
    typeof c.low === "number" &&
    Number.isFinite(c.low) &&
    typeof c.close === "number" &&
    Number.isFinite(c.close) &&
    c.high >= c.low &&
    c.high >= c.open &&
    c.high >= c.close &&
    c.low <= c.open &&
    c.low <= c.close
  );
}

/**
 * Transforms source domain candles into ordered, unique, validated Lightweight Charts CandlestickData.
 */
export function transformCandlesForChart(candles: readonly ChartCandle[]): {
  chartData: CandlestickData<Time>[];
  outOfOrderCount: number;
  duplicateTimeCount: number;
  malformedCount: number;
} {
  const chartData: CandlestickData<Time>[] = [];
  let outOfOrderCount = 0;
  let duplicateTimeCount = 0;
  let malformedCount = 0;
  let prevChartTime = -Infinity;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!isValidChartCandle(c)) {
      malformedCount++;
      continue;
    }

    const chartTime = toChartTime(c.timestamp);
    if (chartTime < prevChartTime) {
      outOfOrderCount++;
    } else if (chartTime === prevChartTime) {
      duplicateTimeCount++;
      continue;
    }

    chartData.push({
      time: chartTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });
    prevChartTime = chartTime;
  }

  // Ensure strict ascending order if any points were out of order
  if (outOfOrderCount > 0) {
    chartData.sort((a, b) => Number(a.time) - Number(b.time));
  }

  return { chartData, outOfOrderCount, duplicateTimeCount, malformedCount };
}
