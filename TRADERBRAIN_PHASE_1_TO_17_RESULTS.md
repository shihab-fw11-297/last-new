# TraderBrain Phase 1-17 Master Audit, Repair, and Certification

**Audit date:** 2026-10-04  
**Audited application:** Next.js 16.3.8, TypeScript 5, npm, Node test runner, App Router  
**Certification data window:** `[2026-03-02, 2026-03-14)` UTC  

## 1. OVERALL STATUS

**TRADERBRAIN BLOCKED**

The strategy implementation passes its current deterministic test suite, typecheck,
lint, production build, fixed-input causality checks, and fixed-input replay checks.
End-to-end certification is blocked because Finage returned different counts and
different OHLCV values for the same XAUUSD historical timestamps. A changing source
dataset cannot support a reproducible Phase 1 fingerprint, backtest, or Phase 17
holdout result.

The repository is a server-rendered App Router application. Finage access is confined
to the server-only historical data graph. The internal dependency chain is Phase 1
data -> Phases 2-14 analysis -> Phase 15 replay -> Phase 16 execution -> Phase 17
validation. The UI now reads that production replay chain as of the selected chart
time.

## 2. PRIMARY BLOCKER

**FINAGE HISTORICAL RESPONSE NONDETERMINISM**

For identical historical XAUUSD timestamps, direct Finage calls returned different
row counts and different OHLCV values. A direct-range and cache-primed fetch differed
at 9,511 shared timestamps in one comparison and 10,816 in another. An identical raw
short-range URL first returned 1,440 rows, then 2,744 rows, and changed the candle at
2026-03-02 00:00 UTC. This behavior occurs before TraderBrain normalization and cannot
be repaired inside the strategy engines.

## 3. FILES CHANGED

- `lib/traderbrain/data/finage-core.ts` - enforce each internal child range after
  provider normalization so inclusive/out-of-window provider rows cannot cross chunk
  boundaries.
- `lib/traderbrain/ui/market-view.ts` - use Phase 15 replay at the selected chart time
  and expose FVG, entry, final signal, ledger history, and exact domain entry/SL/TP.
- `lib/traderbrain/ui/as-of.ts` - centralize causal chart bucket-close calculation.
- `app/page.tsx` - render the production analysis and signal/ledger DTO.
- `app/globals.css` - style signal, entry, stop, and target output.
- `tests/data.test.mjs` - regression coverage for provider boundary leakage.
- `tests/ui-market-view.test.mjs` - regression coverage for historical chart as-of
  replay boundaries.
- `scripts/audit-master.mjs` - extend the real audit through Phases 10-16 and emit the
  complete funnel, equivalence, execution, and timing evidence.
- `scripts/compare-finage-plans.mjs` - compare direct and cache-primed provider plans.
- `scripts/probe-finage-consistency.mjs` - inspect repeat raw provider responses
  without printing the API key.
- `scripts/diagnose-finage-range.mjs` - isolate long-range Phase 1 failures.
- `scripts/recertify-finage-progressive.mjs` - progressively test historical coverage.
- `scripts/chunk-forensics.mjs` - remove four unused diagnostic imports.
- `package.json` - add master audit and provider-consistency commands.
- `TRADERBRAIN_PHASE_1_TO_17_RESULTS.md` - replace stale certification claims with
  this current audit.

No strategy threshold or setup rule was changed.

## 4. DEFECTS FOUND

| Owner | Root cause | Repair / disposition |
|---|---|---|
| Phase 1 | Provider calendar responses could contain rows outside an internal child `[start,end)` interval. Overlapping children could therefore introduce conflicting duplicates. | Filter normalized rows to the exact child interval before caching/merge; added deterministic regression coverage. |
| Phase 1 / external provider | Finage returned different counts and OHLCV revisions for identical historical requests. | Added raw and plan-comparison diagnostics. No application-side repair can make an unstable upstream history authoritative; certification remains blocked. |
| Phase 15 / UI adapter | Moving to an older chart window still calculated the final state from the newest dataset timestamp, exposing future structure and signals in a historical view. | Compute the selected bucket close, run the production Phase 15 replay only to that timestamp, and test the boundary calculation. |
| UI integration | The UI stopped at Phase 9 and stated that no signal engine existed although Phases 10-17 were implemented. | Wire the server-only view through Phase 15 artifacts and render final signal and ledger history from domain values. |

## 5. PHASE 1-17 CERTIFICATION TABLE

| Phase | Current evidence | Status |
|---|---|---|
| 1 - Finage data | Client, normalization, merge, gaps, cache, aggregation, retries, and boundary tests pass. Real source history is not reproducible. | **BLOCKED** |
| 2 - Psychology | 18 tests; nonzero four-timeframe real execution; fixed-input batch, prefix, and causal checks pass. | **RUNTIME_VERIFIED** |
| 3 - Structure | 22 tests; nonzero real swings/events; created/available timing and incremental checks pass. | **RUNTIME_VERIFIED** |
| 4 - Liquidity | 13 tests; nonzero real BSL/SSL/EQH/EQL with causal lineage. | **RUNTIME_VERIFIED** |
| 5 - Price approach | 20 tests; nonzero real transitions; MTF activation and indexed lookup checks pass. | **RUNTIME_VERIFIED** |
| 6 - Interaction | 21 tests; nonzero real episodes/events; episode and bounded-state checks pass. | **RUNTIME_VERIFIED** |
| 7 - Control | 14 tests; nonzero real states/transfers; continuation and transfer paths pass. | **RUNTIME_VERIFIED** |
| 8 - Displacement | 15 tests; 547 real ignitions and 34 confirmed displacements; causal ATR reuse passes. | **RUNTIME_VERIFIED** |
| 9 - BOS/MSS | 16 controlled tests pass; real path ran but produced zero confirmations. | **CODE_READY** |
| 10 - FVG | 10 controlled tests pass; 3,993 raw real FVGs, zero qualified because Phase 9 was zero. | **CODE_READY** |
| 11 - Entry | 9 controlled tests pass; real input from Phase 10 was zero. | **CODE_READY** |
| 12 - Risk | 11 controlled tests pass; real input from Phase 11 was zero. | **CODE_READY** |
| 13 - Signal router | 12 controlled tests cover every family and both directions; no real candidates. | **CODE_READY** |
| 14 - Ledger | 10 controlled tests pass; no real signals to exercise lifecycle. | **CODE_READY** |
| 15 - Replay | 5 tests plus real fixed-run batch/replay equivalence and zero look-ahead/repaint diagnostics. | **RUNTIME_VERIFIED** |
| 16 - Backtest | 11 controlled tests pass; real run executed with zero signals/trades, so fills and metrics were not demonstrated on real events. | **CODE_READY** |
| 17 - OOS/robustness | 10 controlled validation tests pass. Real folds/holdout were not run on inconsistent source history. | **BLOCKED** |

No phase is marked `FROZEN`: Phase 1 prevents reproducible real-runtime certification
of the complete dependency chain.

## 6. REAL FINAGE DATA RESULT

The [official Finage Forex aggregates contract](https://finage.co.uk/docs/api/forex/forex-aggregates)
was verified as XAUUSD, multiply `1`, time `minute`, calendar date path values,
`limit=50000`, ascending sort, and timestamp output. The API key remained server-side
and was not logged.

One captured master run for `[2026-03-02, 2026-03-14)` returned:

| Check | Result |
|---|---:|
| Small weekday request | 1,440 rows, HTTP success |
| 1m canonical candles | 14,133 |
| 5m / 15m / 1h | 2,844 / 948 / 237 |
| API calls / retries / splits | 7 / 3 / 1 |
| Invalid / duplicate / conflicting rows | 0 / 0 / 0 within that captured run |
| Internal gaps / missing minutes | 66 / 3,147 |
| Largest gap | 2,881 minutes |
| Truncation flag | false |
| Dataset status | `WARN` |

The captured run is execution evidence, not a reproducible certification dataset.
Other fetches of the same period returned different candle counts, including 15,078,
15,559, 16,788, and 16,852. Direct versus cache-primed responses also changed shared
OHLCV values. No candles were synthesized or forward-filled.

## 7. FULL PIPELINE FUNNEL

These are exact counts from the captured 14,133-candle master run:

| Stage | Count |
|---|---:|
| CANDLES | 14,133 |
| PSYCHOLOGY READY (all timeframes) | 18,162 |
| SWINGS | 227 |
| RAW BREAKS | 32 |
| RAW SHIFTS | 17 |
| LIQUIDITY LEVELS | 262 |
| APPROACHES (state transitions) | 38,132 |
| INTERACTIONS | 1,721 completed episodes; 9,807 event records |
| CONTROL TRANSFERS | 35 |
| IGNITIONS | 547 |
| DISPLACEMENTS | 34 |
| BOS | 0 |
| MSS | 0 |
| RAW FVG | 3,993 |
| QUALIFIED FVG | 0 |
| RETRACEMENTS | 0 |
| ENTRY CANDIDATES | 0 |
| RISK VALID | 0 |
| FAMILY CLASSIFIED | 0 |
| BUY SIGNALS | 0 |
| SELL SIGNALS | 0 |

Supporting counts: 130 BSL, 132 SSL, 18 EQH, 17 EQL; control transfers were
26 seller-to-buyer and 9 buyer-to-seller; displacement classifications were 20
EXTREME, 12 STRONG, and 2 VALID, all in continuation context.

## 8. FIRST-COLLAPSE ANALYSIS

The first strategy funnel collapse is Phase 9:

`34 confirmed displacements + 49 raw break/shift events -> 0 BOS/MSS`

Recorded rejection counters were 31 correlation-window expiries, 20 cases without a
continuation displacement, and 11 cases without aligned displacement. The counters
can overlap. Controlled Phase 9 tests produce bullish/bearish BOS and MSS in both
event orders, so this audit found no proof of a Phase 9 implementation defect. The
captured market evidence did not satisfy its configured correlation and lineage
rules. Thresholds were not loosened. Because Phase 1 is nondeterministic, this zero
cannot be promoted to a stable market conclusion.

## 9. CAUSALITY

| Invariant | Result |
|---|---|
| LOOK_AHEAD | **PASS on fixed input**; Phase 15 and 16 diagnostics were zero. |
| REPAINT | **PASS on fixed input**; replay prefix artifacts remained unchanged. |
| PREFIX INVARIANCE | **PASS** in phase tests and master prefix checkpoints. |
| AVAILABLE_AT | **PASS** for confirmed swings, HTF bars, liquidity, qualification, entries, and signals. |
| HTF CAUSALITY | **PASS**; HTF facts activate only when their final source minute is available. |

The historical UI leak was repaired: an older selected chart now stops the production
replay at that candle's causal bucket close. Source-data mutation across requests is a
reproducibility failure, separate from fixed-input look-ahead behavior.

## 10. DETERMINISM

- **Fixed canonical input:** PASS. Repeated analysis/replay fingerprints and ordered
  artifacts match.
- **Provider-to-canonical end to end:** FAIL/BLOCKED. Identical Finage history requests
  produced different counts and candle values.
- **IDs/configuration:** deterministic IDs and configuration fingerprints pass tests.
- **Audit conclusion:** the engines are deterministic functions of their inputs; the
  current real input source was not deterministic during certification.

## 11. BATCH / INCREMENTAL / REPLAY EQUIVALENCE

- Phases 2-9 batch and incremental outputs matched in the master audit.
- Prefix checkpoints matched and did not acquire future availability timestamps.
- Phase 15 production replay and the batch semantic artifact bundle had no divergence.
- Phase 15 reset/seek and repeated replay fingerprints matched.
- Phase 16 consumed the Phase 15 signal stream and matched Phase 14 lifecycle output.
- Replay/backtest made zero additional Finage calls after the dataset was supplied.

Result: **PASS for a fixed dataset; end-to-end repeatability remains BLOCKED by Phase 1.**

## 12. SIGNAL FAMILY WIRING

| Family | Controlled wiring | Captured real run |
|---|---|---:|
| Liquidity Reversal | MSS + transfer + sweep lineage; BUY and SELL pass | 0 |
| Continuation | BOS + continuation evidence; BUY and SELL pass | 0 |
| Compression Expansion | Phase 5 compression release lineage; BUY and SELL pass | 0 |
| Breakout Retest | Phase 6 break/acceptance/retest lineage; BUY and SELL pass | 0 |

Family priority, collision handling, duplicate suppression, opposite-direction ties,
risk rejection, and incremental equality pass. The router consumes prior phase facts;
there is no second backtest-only signal engine.

## 13. FINAL SIGNAL SAMPLES

**No real BUY or SELL signal was emitted in the captured certification run.** There
are therefore no honest real signal samples to print. Controlled tests generate BUY
and SELL signals for all four families and verify exact entry, structural stop, real
liquidity target, RR, direction, lineage, and availability, but those fixtures are not
presented as real market results.

## 14. SIGNAL LEDGER / HISTORY

- Real unique signals: 0; real lifecycle events: 0.
- Controlled verification covers immutable insertion, idempotent duplicate handling,
  activation, BUY/SELL TP and SL, same-candle ambiguity, as-of visibility, range
  queries, ordering, and future-outcome exclusion.
- The UI reads entry/SL/TP and lifecycle from the Phase 14/15 domain records without
  recalculation.
- Ledger storage is process memory; durable database persistence is not implemented.

## 15. BACKTEST EXECUTION RESULT

Captured master run:

- Evaluation: `[2026-03-04, 2026-03-14)` UTC after warmup
- Evaluation trading days: 9
- Processed evaluation candles: 11,317
- Signals / fills / resolved / wins / losses / ambiguous: all 0
- Raw expectancy, profit factor, MFE, and MAE: unavailable because there were no trades
- Adjusted metrics: unavailable because historical spread/slippage data was absent
- Phase 14 comparability, signal-stream identity, look-ahead, and repaint checks: PASS

This is an execution smoke test, not evidence of strategy performance.

## 16. OOS / WALK-FORWARD RESULT

| Item | Result |
|---|---|
| Real historical coverage | BLOCKED by Phase 1 nondeterminism |
| Real folds | 0 |
| Fixed-config OOS | Not run |
| Walk-forward | Not run |
| Sensitivity | Disabled / not run |
| Execution scenarios | Not run |
| Family OOS | 0 |
| BUY OOS / SELL OOS | 0 / 0 |
| Final holdout | Not run |
| Sample sufficiency | Unknown |
| Holdout contamination | None; no real holdout result was opened for tuning |
| Test-to-train leakage | 0 in controlled tests |
| Certification | **BLOCKED** |

The Phase 17 framework tests chronology, expanding/rolling folds, optional gaps,
candidate budgets, train-only selection, holdout separation, overlap deduplication,
sample gates, deterministic aggregation, and future-data invariance. No profitability
or robustness claim is made.

## 17. UI INTEGRATION

| UI path | Result |
|---|---|
| Real chart data and 1m/5m/15m/1h selection | PASS |
| Structure, liquidity, approach, interaction, control, displacement | PASS |
| BOS/MSS, qualified FVG, entry candidate | PASS wiring; captured values are zero where stated |
| Final signal and exact domain Entry/SL/TP | PASS wiring; no real signal in range |
| Signal history/lifecycle | PASS wiring |
| Historical as-of replay | PASS after repair and regression test |
| Secret boundary | PASS; server-only adapter |
| Client workload | PASS; analysis remains on the server and browser receives a compact DTO |

## 18. PERFORMANCE

Measured on the captured 14,133-candle real run:

| Stage | Time |
|---|---:|
| Phase 1 total | 16,684.62 ms (16,647.34 ms network fetch) |
| Phase 2 | 123.09 ms |
| Phase 3 | 39.19 ms |
| Phase 4 | 4.22 ms |
| Phase 5 | 216.91 ms |
| Phase 6 | 236.78 ms |
| Phase 7 | 27.81 ms |
| Phase 8 | 80.14 ms |
| Phase 9 | 99.60 ms |
| Phase 10 | 103.06 ms |
| Phase 11 | 157.38 ms |
| Phase 12 | 28.23 ms |
| Phase 13 | 2.30 ms |
| Phase 14 | 28.68 ms |
| Phase 15 full replay | 1,096.61 ms |
| Phase 16 backtest | 86.96 ms |
| Phase 17 | Not run on real data |

A comparable replay audit observed about 133 MB heap use. Network retries dominate
wall time. No measured analysis phase showed a blocking hot path at this sample size.

## 19. COMPLEXITY

| Phase | Main algorithm / structures | Time / space and bounded assumption |
|---|---|---|
| 1 | Interval coverage, bounded fetch queue, k-way merge, linear integrity/aggregation | `O(N log K)` merge, `O(N+G)` space; provider retries/splits are bounded. |
| 2 | Rolling sums/deques and incremental candle state | `O(N)` time, `O(N)` emitted history plus bounded windows. |
| 3 | Forward structure state machine | `O(N)` time and emitted-fact space; candidate confirmation is bounded. |
| 4 | Confirmed swing activation with bounded recent equality candidates | `O(S*K)`, constant configured `K`; `O(L)` output. |
| 5 | Time activation plus indexed nearest-level lookup/heaps | Approximately `O((N+L) log L)`; no full level scan per candle. |
| 6 | Persistent active interaction episodes and indexed approach input | `O(N*K)` with active `K` bounded by level activation/expiry. |
| 7 | Cursor-based evidence consumption and control state | `O(N+E)` time; bounded transition state. |
| 8 | One active impulse plus event cursors | `O(N+E)` time; bounded active impulse state. |
| 9 | Direction/lineage maps and expiring pending buffers | `O(E*K)` with configured correlation window; no full cross product. |
| 10 | Three-candle geometry plus active-zone indexes | About `O(N log Z)`; active zones expire/fill. |
| 11 | Active entry episodes | `O(N*K)` with timeout/invalidation-bounded `K`. |
| 12 | Indexed causal destination/obstacle lookup | Approximately `O(E log L)` plus emitted validations. |
| 13 | Keyed joins and deterministic ordering | `O(E log E)` batch ordering, linear keyed routing. |
| 14 | Ordered ledger indexes and bounded active signals | Insert/query `O(log S)`; lifecycle scan `O(N*A)` with active `A` bounded by resolution. |
| 15 | Single production replay with timestamp indexes | `O(N+E)` per full run; `O(N+E)` artifact memory. Reset replays the prefix. |
| 16 | Signal cursor and active-trade execution | `O(N*A + S log S)`; active trades bounded by signals/configuration. |
| 17 | Bounded candidate/fold orchestration over cached replay/backtest results | Roughly candidates x folds x replay/backtest cost; explicit budgets are required. |

The most expensive expected path is Phase 17 over many candidates/folds. Its candidate
budget and identity cache are required bounds. No unavoidable `O(N^2)` production hot
path was found in the audited ranges.

## 20. TESTS

Baseline before master repairs: 250 tests passed, typecheck passed, production build
passed, and lint had four unused-import warnings in a diagnostic script.

Final gates:

- Unit/integration/causality/replay/execution/OOS: **253 passed, 0 failed** in 17.45 s.
- Phase test counts: data 26, psychology 18, structure 22, liquidity 13, approach
  20, interaction 21, control 14, displacement 15, confirmation 16, FVG 10,
  entry 9, risk 11, signal 12, ledger 10, replay 5, backtest 11, validation 10,
  full pipeline 7, UI as-of 3.
- TypeScript: `npx tsc --noEmit` - PASS.
- ESLint: changed application, diagnostics, and regression files - PASS with zero
  warnings/errors.
- Production build: `next build` - PASS; compile 76 s, TypeScript 16.3 s, four
  pages generated in 552 ms.
- Real integration: Phases 1-16 executed, but the source dataset was `WARN` and not
  reproducible; Phase 17 correctly did not proceed.

## 21. KNOWN LIMITATIONS

- Finage historical results were not stable across identical requests during this
  audit, so no real dataset fingerprint can be treated as authoritative.
- The captured period contained 66 internal gaps and one 2,881-minute gap.
- The real run produced no BOS/MSS, qualified FVG, candidate, signal, or trade, so
  later positive paths are demonstrated only by controlled tests.
- Historical bid/ask spread and slippage were unavailable; adjusted execution metrics
  cannot be claimed.
- The signal ledger and Phase 1 cache are process-local rather than durable stores.
- Phase 17 real OOS, walk-forward, sensitivity, scenario, and holdout metrics remain
  unavailable until a reproducible real dataset is supplied.

## 22. FINAL CERTIFICATION

**TRADERBRAIN BLOCKED**

The current code is causal and deterministic for a fixed input under the exercised
tests and runtime checks. It is not certifiable end to end because the canonical real
Finage history was not reproducible. Resolve the Phase 1 source-data consistency issue,
then rerun the existing master audit and Phase 17 validation without changing strategy
thresholds.
