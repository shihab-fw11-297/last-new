import type { Timeframe } from "../data/types.ts";

const MINUTE_MS = 60_000;

const TIMEFRAME_MINUTES: Readonly<Record<Timeframe, number>> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
};

export function chartAsOfTimestamp(
  timeframe: Timeframe,
  chartTimestamp: number,
  lastSourceTimestamp: number,
): number {
  if (!Number.isSafeInteger(chartTimestamp) || !Number.isSafeInteger(lastSourceTimestamp)) {
    throw new TypeError("Chart timestamps must be safe integers");
  }

  const bucketCloseTimestamp =
    chartTimestamp + (TIMEFRAME_MINUTES[timeframe] - 1) * MINUTE_MS;

  return Math.min(bucketCloseTimestamp, lastSourceTimestamp);
}
