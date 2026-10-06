import type { Timeframe } from "@/lib/traderbrain/data/types";
import {
  currentUtcTimestamp,
  defaultHistoricalDates,
  resolveHistoricalDateQuery,
  utcDateString,
} from "@/lib/traderbrain/ui/date-range";
import { getMarketView, type MarketView } from "@/lib/traderbrain/ui/market-view";
import { TradingTerminal } from "./terminal";

const TIMEFRAMES: readonly Timeframe[] = ["1m", "5m", "15m", "1h"];

export const dynamic = "force-dynamic";
export const revalidate = 0;

const scalar = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

function emptyChartMessage(view: MarketView | null, rangeError: string | null): string {
  if (rangeError) return rangeError;
  if (!view) return "Real data could not be loaded from backend.";
  if (view.status === "BLOCKED" || view.status === "FAILED") {
    return `Historical range ${view.status.toLowerCase()}. Partial unsafe candles are hidden.`;
  }
  return "No candles available for the selected range.";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    tf?: string | string[];
    bars?: string | string[];
    offset?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const now = currentUtcTimestamp();
  const requested = scalar(query.tf) ?? "1m";
  const timeframe: Timeframe = TIMEFRAMES.includes(requested as Timeframe)
    ? (requested as Timeframe)
    : "1m";

  const barsParam = scalar(query.bars);
  const barsValue = Number(barsParam);
  // Default to 10000 so all loaded candles for the selected date range are presented on the chart
  const bars =
    Number.isSafeInteger(barsValue) && barsValue > 0
      ? barsValue
      : 10000;

  const offsetValue = Number(scalar(query.offset));
  const offset =
    Number.isSafeInteger(offsetValue) && offsetValue >= 0
      ? Math.min(offsetValue, 10_000)
      : 0;

  const defaults = defaultHistoricalDates(now);
  const selectedFrom = scalar(query.from) ?? defaults.fromDate;
  const selectedTo = scalar(query.to) ?? defaults.toDate;

  let rangeError: string | null = null;
  let range;

  try {
    range = resolveHistoricalDateQuery(
      { from: scalar(query.from), to: scalar(query.to) },
      now
    );
  } catch (cause) {
    rangeError = cause instanceof Error ? cause.message : "Invalid historical range.";
  }

  let view: MarketView | null = null;
  if (range) {
    try {
      view = await getMarketView({
        timeframe,
        windowBars: bars,
        offsetBars: offset,
        range,
      });
    } catch (cause) {
      rangeError =
        cause instanceof Error
          ? cause.message
          : "Historical data could not be loaded from backend.";
    }
  }

  return (
    <TradingTerminal
      view={view}
      timeframe={timeframe}
      bars={bars}
      offset={offset}
      selectedFrom={selectedFrom}
      selectedTo={selectedTo}
      maxDate={utcDateString(now)}
      rangeError={rangeError}
      emptyMessage={emptyChartMessage(view, rangeError)}
    />
  );
}
