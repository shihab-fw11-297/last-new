import "server-only";

import { FinageClient } from "./finage-core.ts";
import { HistoricalService, MemoryCandleStore } from "./historical-core.ts";

let service: HistoricalService | undefined;

export function getHistoricalCandles(start: Date | string | number, end: Date | string | number,
  signal?: AbortSignal) {
  const apiKey = process.env.FINAGE_API_KEY;
  if (!apiKey) throw new Error("FINAGE_API_KEY is not configured on the server");
  service ??= new HistoricalService(new FinageClient(apiKey), new MemoryCandleStore());
  return service.getHistoricalCandles(start, end, signal);
}
