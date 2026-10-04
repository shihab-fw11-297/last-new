# TraderBrain Phase 1 data foundation

**PHASE 1 — FROZEN.** Real Finage verification on 2026-10-03 produced 5,454 1m candles for 2026-03-01 through 2026-03-05, and 40,682 for the preferred 30-day window. The longer request recovered through bounded retries and splits; both results were WARN with zero invalid candles and zero conflicting duplicates.

`getHistoricalCandles(start, end)` in `historical.ts` is the server entry point. Dates are UTC and intervals are half-open: `[start, end)`. Date-only strings mean midnight UTC; date-time strings must include an offset. The Finage key is read only by this server-only entry point from `FINAGE_API_KEY`.

The in-memory store tracks successfully fetched intervals, including intervals with no candles. It avoids repeat requests within one server process; it is not persistent across processes or restarts. The store keeps fetched coverage separate from observed candle continuity. The latter is reported through first/last timestamps and gap ranges. No missing candles are invented.

Finage accepts UTC calendar dates in the URL path; `date_format=ts` controls returned candle timestamps. The provider request covers each UTC day touched by the internal half-open interval, and the final merge trims to the exact caller range. This can overfetch up to the edges of two calendar days for sub-day requests. Responses at the result cap, with pagination metadata, or with substantial uncovered edges on a multi-day request are split. A large request that still receives a 5xx after bounded retries is also split, because Finage returned HTTP 502 for the preferred 30-day request at runtime. Rate-limit failures are not split. Such edge evidence may also arise from market closures, so splitting can make extra requests. Without provider metadata, no calendar-only heuristic can prove that a sparse response is complete.

Volume policy: any unknown 1m volume makes its aggregate volume `null`. An aggregate is complete only when its UTC bucket contains 5, 15, or 60 distinct source candles, respectively. Aggregate timestamps are bucket starts.

## Hot-path complexity

Let `N` be returned candles, `K` be response chunks, `C` be coverage intervals, `R` be requested intervals, and `S` be candles already stored.

| Stage | Expected time | Extra space |
| --- | --- | --- |
| Range planning | O(K) for actual chunks; O(1) estimate | O(K) |
| Coverage difference, sorted inputs | O(C + R) | O(C + R) worst case |
| Response validation | O(N) | O(N) canonical output |
| Sorting out-of-order responses | O(N log N) worst case; skipped for sorted responses | O(log N) sort stack |
| K-way merge and deduplication | O(N log K) | O(K + N) output |
| Cache lookup | O(log S + output count) | Output slice |
| Gap audit | O(N) | O(number of gaps) |
| 5m aggregation | O(N) | O(number of buckets) |
| 15m aggregation | O(N) | O(number of buckets) |
| 1h aggregation | O(N) | O(number of buckets) |

There is no O(N²) candle hot path. Cache insertion may merge stored and new sorted arrays once, O(S + N). The in-memory store is intentionally process-local. A future persistent store can implement `CandleStore` without changing the provider.

Run `npm test`, `npm run lint`, and `npm run build`. With a key in `.env` or `.env.local`, run `npm run verify:finage` for the March sample and one preferred 30-day request. The script prints only summary diagnostics.
