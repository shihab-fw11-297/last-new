import "server-only";

import { getHistoricalCandles } from "../data/historical.ts";
import { loadMarketView, type MarketViewRequest } from "./market-view-core.ts";

export type { ChartCandle, ChartOverlay, MarketView, SignalView
} from "./market-view-core.ts";

// This is the only UI entry point into Phase 1. The browser receives a compact
// DTO; the Finage credential and complete analytical dataset stay on the server.
export function getMarketView(request: MarketViewRequest, signal?: AbortSignal) {
  return loadMarketView(request, getHistoricalCandles, signal);
}
