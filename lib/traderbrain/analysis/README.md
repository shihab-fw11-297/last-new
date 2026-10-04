# Phase 2 candle psychology

**PHASE 2 — FROZEN.** The real March 2026 Finage sample passed count alignment, ATR readiness, finite-value, and input-immutability checks on all four timeframes on 2026-10-03.

`createCandlePsychologyEngine(timeframe, config).push(candle)` is the incremental calculation. `analyzeCandleSeries` feeds the same transition in order. `analyzeHistoricalPsychology` applies it independently to the four Phase 1 series and returns no features when Phase 1 status is BLOCKED or FAILED. It never changes canonical candles or fetches data.

All results are descriptive. Evidence flags are computed only from the current and earlier candles. They are not trade signals. `sourceComplete` copies Phase 1 aggregate completeness; a partial higher-timeframe bucket can therefore be identified by later consumers.

## Definitions and warm-up

- First-candle true range equals its high-low range. Later true range is the maximum of that range and the two distances from the previous close.
- ATR is the simple mean of the last `atrPeriod` true ranges, including the current candle. It is `null` until the full window is present; `atrReady` becomes true at index `atrPeriod - 1`.
- Ratios with zero denominators are `null`, including positions on a zero-range candle and normalization when ATR is zero. Previous-candle fields are `null` for the first candle. Rolling means are `null` until the full window contains valid values. Evidence that needs unavailable values is false.
- Overlap ratio divides intersection height by the current candle range. Directional efficiency uses the last `mediumWindow` close-to-close changes: absolute net close change divided by the sum of absolute changes. A zero path yields `null`.
- `rollingAverageRange`, `rollingAverageBody`, both ATR-normalized rolling means, and `rollingAverageOverlap` use `shortWindow`. `baselineAverageRange` uses `baselineWindow`. `rollingDirectionalMovement` and `directionalEfficiency` use `mediumWindow` transitions.
- `outsidePreviousRange` means both a strictly higher high and strictly lower low. Equality counts as inside when both current bounds are within the previous bounds.
- All evidence thresholds and window lengths are in `DEFAULT_CANDLE_PSYCHOLOGY_CONFIG`. Override them through the config argument; no thresholds are hidden in the loop.

## Complexity

Each base candle primitive, ATR update, rolling mean update, overlap calculation, direction sequence, directional efficiency update, and evidence evaluation is O(1) per candle. The full engine is O(N) time and O(N) output plus O(W) rolling state, where W is the largest configured window. No candle hot path scans a previous slice or uses an O(N²) operation.

Run `npm test`, `npm run lint`, and `npm run build`. `npm run bench:psychology` measures four synthetic performance fixtures. With `FINAGE_API_KEY` in `.env` or `.env.local`, `npm run verify:psychology` fetches the real March sample through Phase 1 and checks count, alignment, ATR, finite values, and input immutability.

## Phase 3 market structure

**PHASE 3 — FROZEN.** Real March 2026 XAUUSD verification passed across all four timeframes on 2026-10-03, including source immutability, causal swing availability, event lineage, and finite prices. The 63-test suite, TypeScript, lint, and production build passed.

`createMarketStructureEngine(timeframe, config).push(candle, feature)` processes one closed candle and its aligned Phase 2 feature. `analyzeMarketStructure` feeds the same engine sequentially; `analyzeHistoricalMarketStructure` runs it independently across the four Phase 1 timeframes. BLOCKED or FAILED upstream status, mismatched counts, timestamps, timeframes, or source completeness block trusted output. The caller must feed only closed candles in future live use; Phase 3 has no live clock or stream.

The default minimum leg and close reversal are each 1 ATR. A close break must exceed its confirmed level by 0.1 ATR. Same-type swing prices within 0.01 ATR of each other stay `UNCLASSIFIED`; this is a price comparison policy, not liquidity classification. These four values live in `DEFAULT_MARKET_STRUCTURE_CONFIG` and can be overridden together for deterministic tests. Structure seeds only after Phase 2 ATR is ready and positive.

The engine tracks one candidate extreme and a post-extreme reversal extreme per leg. A swing's `createdAt` is the extreme candle, while `availableAt` is the later close that confirms a sufficient ATR-normalized reversal. Breaks use only levels confirmed before the current candle. A wick beyond a relevant level emits one `LEVEL_PENETRATION`; a close beyond the ATR break threshold emits one continuation or raw shift event with `brokenSwingId`. Raw shifts describe structural facts and do not claim MSS or CHoCH. A protected low exists only in confirmed bullish structure; a protected high exists only in confirmed bearish structure.

Swing detection, HH/HL/LH/LL classification, structure state updates, and break detection each take O(N) over a series, with O(1) work per candle. Event emission is O(E). Working state is O(1); stored swings, completed legs, and events use O(S + E). There are no window rescans, timestamp maps, or duplicate ATR calculations in the hot path. The batch wrapper performs one forward scan per timeframe. Tests cover a 10-to-13 candle swing confirmation delay, prefix invariance, incremental equality, deterministic IDs, alignment failure, and close-versus-wick behavior. Run `npm run bench:structure` for synthetic timings and `npm run verify:structure` for the real March XAUUSD data.

## Phase 4 structure-derived liquidity

**PHASE 4 — FROZEN.** The real March 2026 XAUUSD Phase 1 → Phase 2 → Phase 3 → Phase 4 pipeline passed on all four timeframes on 2026-10-03. It preserved upstream inputs, causal availability, lineage, deterministic output, and finite prices. The complete test suite, TypeScript, lint, and build passed.

`createLiquidityEngine(timeframe, config).pushSwing(swing, originFeature)` processes one confirmed Phase 3 swing. `analyzeLiquidity(structureResult, psychologyFeatures)` feeds the same engine in availability order and reads Phase 2 ATR directly at each swing's `sourceIndex`. `analyzeHistoricalLiquidity` runs four independent timeframe results. BLOCKED or FAILED upstream statuses, malformed swings, source misalignment, or out-of-order availability block trusted output. No candle, ATR, or swing computation is repeated.

Every confirmed swing creates one BSL or SSL object with its exact Phase 3 `createdAt` and `availableAt`. A new swing is compared only with up to eight recent confirmed same-side swings by default. The equality tolerance is 0.1 times the new swing's origin ATR; the origin ATR was already available when the extreme formed. Each qualifying pair emits a distinct EQH or EQL object at the mean price. Its `createdAt` is the later swing's formation time, and its `availableAt` is that swing's confirmation time. Older objects never change. IDs encode the timeframe, kind, and source swing IDs. The two small config values live in `DEFAULT_LIQUIDITY_CONFIG`.

Raw creation is O(S), equality checks are O(S × K), and bounded buffer eviction is O(K) per swing, where K is capped at 64 and defaults to 8. The effective hot path is O(S) for fixed K. Memory is O(L + K): levels and keyed deduplication use O(L), and recent candidates use O(K). There are no complete swing-history scans or repeated sorts. The result is descriptive location evidence; it contains no interaction, ranking, or trading decisions. Run `npm run bench:liquidity` for the synthetic scaling fixture and `npm run verify:liquidity` for the real Finage-derived pipeline.

## Phase 5 price approach

**PHASE 5 — FROZEN.** The March 2026 real Finage-derived Phase 1→5 run passed on 2026-10-03, including multi-timeframe availability, deterministic replay, batch versus incremental equality, source immutability, and finite metrics. The complete test suite, TypeScript, lint, and production build passed.

`createPriceApproachEngine(config).push({ candle, psychology, newLiquidity })` is the incremental transition. Feed only closed canonical 1m candles. `analyzePriceApproach(historical, psychology, liquidity, config)` uses four forward cursors over Phase 4's ordered timeframe streams, activating levels only when `availableAt <= candle.timestamp`. It passes those events to the same incremental engine. BLOCKED or FAILED upstream status, 1m feature misalignment, malformed levels, future level activation, and non-ascending input block trusted output. No Phase 1–4 calculations are repeated.

For each source timeframe, one min-heap holds levels strictly above the execution close and one max-heap holds levels at or below it. When price crosses a level, the engine moves the level between heaps; it does not delete it. Stable price, availability, timeframe, kind, and ID ordering chooses ties. At most one nearest above and one nearest below level per timeframe receives approach metrics. A small tracker keyed by liquidity ID records consecutive toward and away bars, recent consistency, and last observed state. A fixed close ring supplies K-bar progress. Results retain only the latest eight candidate snapshots and compact state-transition events.

Default `nearDistanceAtr` is 0.5, minimum approach and moving-away runs are two bars, the speed window is three bars, and FAST/SLOW cutoffs are 0.25/0.05 ATR per bar. TOUCHING is candle range geometry only. State precedence is TOUCHING, MOVING_AWAY after prior engagement, NEAR, APPROACHING, FAR. Behavior precedence when progressing toward a target is COMPRESSED from Phase 2 compression evidence, IMPULSIVE from expansion plus rising momentum and fast speed, EXHAUSTED from decaying momentum with slow speed or low directional efficiency, CONTROLLED from consistent progress, then MESSY; insufficient evidence is UNKNOWN. The thresholds live in `DEFAULT_PRICE_APPROACH_CONFIG`. These labels describe approach, not a liquidity interaction or trade outcome.

Input stream validation is one O(L) pass. Activation and price partition movement are O((L + C) log L), where C is the number of price crossings over known levels. Nearest queries and metrics are O(N × 4), with N 1m candles. Overall time is O(N + (L + C) log L), and memory is O(L + A + E + K) for indexed liquidity, trackers, transitions, and the close ring. There is no candle-by-liquidity scan or sort in the hot path. Stage timings sample one in 32 candles to limit measurement overhead; `totalMs` measures the full batch. Run `npm run verify:approach` for real XAUUSD and `npm run bench:approach` for the synthetic scaling fixture. The latter can grow faster than candle count when crossings grow faster than candle count.

## Phase 6 liquidity interaction

**PHASE 6 — FROZEN.** The real March 2026 Finage-derived Phase 1→6 pipeline passed on 2026-10-03, including causal acceptance and reclaim, source immutability, deterministic replay, batch versus incremental equality, finite metrics, and bounded active state. The complete test suite, TypeScript, lint, and production build passed.

Phase 5 originally exposed only its final nearest-candidate snapshot and omitted the BSL/SSL side. That was insufficient for a historical Phase 6 consumer. Its batch API now accepts an optional per-candle observer and each snapshot includes `liquiditySide`; the Phase 5 approach calculations and classification rules are unchanged. `analyzeLiquidityInteractions` uses that observer so Phase 5 runs once and the Phase 6 engine consumes each closed 1m candle, aligned Phase 2 feature, and bounded Phase 5 candidate set in the same forward pass. `createLiquidityInteractionEngine(config).push({ candle, psychology, current })` is the matching incremental API. No MTF liquidity alignment, nearest-level search, ATR, psychology, or structure calculation is repeated inside Phase 6.

An episode starts only when a current candidate has geometric candle contact. A Phase 5 TOUCHING claim without contact blocks the result as an integration inconsistency. The active Map holds one tracker per liquidity ID and an active-ID array supports bounded cleanup. Episode ID combines liquidity ID and first-touch timestamp. Each tracker records only scalar penetration, closes beyond, reclaim, reaction, duration, state, and evidence. Completed episodes are archived as compact immutable snapshots; later contact can create a new episode ID. The active duration defaults to 12 bars, so with at most eight new candidates per candle, the active set is bounded by 96 under the default rule.

BSL treats high above and close above the level as beyond; SSL reverses the comparisons. Exact equality is `CLOSE_AT_LEVEL`, matching the direct comparison convention used by Phase 5. TOUCH is range contact. PENETRATION is any traded price beyond. BREAK requires a closed candle beyond. ACCEPTANCE requires two consecutive beyond closes and at least 0.1 ATR beyond on the confirming candle; its event is emitted only then. A return close to or before the level after penetration is RECLAIM. If a break had occurred before acceptance, that reclaim confirms FAILED_BREAK. With no break, penetration of at least 0.1 ATR and a reclaim confirms SWEEP up to 0.75 ATR or RAID from 0.75 ATR; a later second penetrative bar can add RAID evidence without changing an earlier sweep event. REJECTION requires Phase 2 side-matched rejection evidence plus a later reaction of at least 0.3 ATR. It never claims market control. Thresholds are centralized in `DEFAULT_LIQUIDITY_INTERACTION_CONFIG`.

Evidence events are appended once per episode when knowable; future outcomes never rewrite earlier events. The principal completed type follows FAILED_BREAK, ACCEPTANCE, REJECTION, RAID, SWEEP, BREAK, PENETRATION, TOUCH precedence. Acceptance, failed break, and rejection are terminal classifications; the tracker archives after contact ends or the 12-bar cap. Acceptance is not later reclassified as a failed break. Stage timings sample one in 32 candles: `totalMs` estimates Phase 6 work from its three stages and `pipelineTotalMs` measures the whole Phase 5→6 batch. The default hot path checks up to eight candidates and at most 96 active trackers per candle, so it is O(N + E) with bounded constants, and stored memory is O(A + E + I). There is no scan of historical liquidity or approaches per candle. Run `npm run verify:interaction` for real XAUUSD and `npm run bench:interaction` for the synthetic candidate scaling fixture.
# Phase 10 FVG entry locations

**PHASE 10 — FROZEN.** `createFvgEngine(config).push({ candle, psychology,
displacementEvents, structuralConfirmations })` is the single incremental
implementation. `analyzeHistoricalFvgs` feeds it the existing Phase 1, 2, 8,
and 9 results using ordered event cursors. It fetches no data and does not
recalculate ATR, displacement, or structure. Feed only closed 1m candles.

A raw zone forms when candle A's high is below candle C's low (bullish), or
A's low is above C's high (bearish), with B between them. The zone is available
only at C's timestamp. Its size uses Phase 2 ATR at C and never repaints.
The default minimum size is 0.1 ATR; raw zones with unavailable or smaller ATR
normalization remain diagnostic and cannot qualify. A zone is eligible only
when its A..C formation interval overlaps the matching Phase 8
ignition..confirmation episode and a Phase 9 BOS or MSS names that exact
displacement ID. Qualification happens no earlier than both upstream events.
The default pending window is 12 processed bars. Configuration is limited to
these two thresholds.

Raw zones begin fill tracking on the candle after C, even before qualification.
A later candle reaching the near edge creates a partial fill, and one reaching
the far edge fills it. The maximum fill fraction is monotonic. A zone already
filled before confirmation can preserve its lineage but is unavailable as a
potential location. Phase 10 never marks an entry as ready.

Pending raw zones are bounded by the lag and updated once per candle. Recent
Phase 8 and 9 events are bounded by the same window and keyed by ID. Qualified
unfilled zones use Phase 5's binary heap utility for directional price
boundaries; filled zones leave the active heaps. Detection is O(N); event
consumption and pending correlation are O((D+C)×K + N×R), with pending K
and recent R bounded by the configured lag; heap lifecycle is O(T log Z) for actual new
price-extreme transitions T across Z qualified zones. There is no complete
historical FVG, displacement, or confirmation scan per candle.

`tests/fvg-entry-location.test.mjs` checks geometry, availability, frozen ATR,
qualification order, fill before confirmation, both directions, duplicate
events, lineage, batch/incremental equality, and prefix behavior. The full
OHLC pipeline fixtures also prove one reversal MSS FVG and one continuation
BOS FVG. `npm run verify:fvg` runs the real March 2026 Finage sample through
Phases 1–10 and verifies deterministic and incremental equality. The real
sample has no Phase 9 confirmations, so it creates no qualified Phase 10 zones;
that is an observed upstream funnel result, not a reason to loosen thresholds.

## Phase 11 retracement and entry candidates

**PHASE 11 — FROZEN.** `createEntryCandidateEngine(config).push` consumes one
closed 1m candle, its aligned Phase 2 feature, current Phase 7 control, and
new Phase 10 lifecycle events. `analyzeHistoricalEntryCandidates` feeds the
same engine from the existing Phase 7 state-change and transfer streams and
the Phase 10 event stream. It does not rerun any upstream phase. Phase 10
lifecycle events now carry their fill fraction and zone status at event time;
depth changes within PARTIAL emit a compact update. This prevents the
historical wrapper from reading a zone's final status or fill depth early.

Only a qualified, usable FVG creates a tracker. A contact on its qualification
candle is ignored because the intrabar order relative to confirmation is
unknown. A later candle moving toward or touching the zone starts a
retracement; a later touch records its reached time. Phase 2 movement and
momentum evidence classify controlled, aggressive, deep, shallow, messy, or
unknown retracements. These are descriptive. A completed opposing Phase 7
control transfer or a filled zone invalidates the tracker. An original-direction
close with Phase 2 response evidence can create a candidate on a subsequent
closed candle, provided its close is no more than 0.8 ATR beyond the near zone
edge. ATR is captured at qualification. The candidate entry price is that
trigger candle's close; no order fill or final trade is implied.

The default wait is 24 processed bars to reach a zone and 12 after contact
to form a candidate. An excessive move after contact is MISSED; a timeout
without a usable response is EXPIRED. A confirmed candidate is immutable.
When several FVGs share one displacement and structural confirmation, the
engine chooses the least extended current candidate, then stable FVG ID, and
emits at most one primary candidate for that setup.

Only active trackers are scanned each candle; both wait limits bound their
lifetimes. Phase 10 events and Phase 7 changes use forward cursors. Time is
O(N×A + F + E + C), with A the bounded active tracker count, F lifecycle
events, E emitted entry events, and C control events. Active memory is O(A),
plus compact output and one setup key per candidate. Phase 11 performs no
historical FVG scan, ATR calculation, psychology calculation, or market
structure calculation. Run `npm run verify:entry-candidate` for the real
Finage March sample and `npm test` for controlled, aggressive, deep, shallow,
messy, filled, opposing-control, no-chase, timeout, deduplication, prefix, and
batch/incremental fixtures. A full OHLC Phase 1–11 reversal fixture creates
one bearish candidate after a later retracement into its MSS-linked FVG. The
real audit period has no Phase 9 confirmation and therefore no qualified
Phase 10 zone; that upstream zero is reported without changing thresholds.

## Phase 12 destination and risk validation

**PHASE 12 — FROZEN.** The full test suite, causal fixtures, real March XAUUSD
pipeline, TypeScript check, lint, and production build passed. The real sample
has zero Phase 9 confirmations and thus no Phase 11 candidates; the full OHLC
fixture and focused Phase 12 cases verify nonempty candidate paths.

`createRiskValidationEngine(config).updateMarketContext` accepts only facts
available by the candidate timestamp; `evaluate(candidate, atr)` produces one
immutable risk plan per Phase 11 candidate. `analyzeHistoricalRiskValidations`
feeds the same engine with ordered source cursors. The batch wrapper reads the
Phase 2 ATR feature at the entry timestamp and falls back to the Phase 11
captured reference ATR if that feature is unavailable.

An MSS reversal uses its completed sweep, raid, failed break, or rejection
interaction extreme when it matches the trade side. Otherwise the engine uses
the latest causally confirmed 1m opposite-side swing. A BOS continuation uses
that latest swing, matching Phase 3's protected-low/high rule without reading
its future final snapshot. The qualified FVG far edge is the final
fallback. The selected structural price gets a small ATR buffer; RR never
influences stop selection. Wrong-side and near-zero risk stop distances reject.

Available BSL above a bullish entry and SSL below a bearish entry are indexed
by price in two AVL trees per side: all levels and primary levels. Primary
means higher timeframe, equal high/low, or 1m HH/LL sourced liquidity. The
nearest primary level is the destination; if none exists, the nearest known
level is used. This lets a nearby meaningful 1m target win over a farther HTF
target. A closer nonprimary level is separately reported as an obstacle and
gated for minimum room. Phase 6 `ACCEPTANCE_CONFIRMED` removes its level from
future destination queries. Other touch and sweep facts do not imply a frozen
consumed lifecycle and are not used to erase targets.

The engine reports risk, reward, room, obstacle room and raw RR with explicit
actual-versus-required gates. Verified spread and slippage are unavailable,
so `executionAdjustedRR` stays null and `executionCostStatus` is
`NOT_AVAILABLE`. No target is synthesized from a desired RR. Price lookup is
O(log L) per candidate; source IDs and latest structural swings are O(1).
Historical stream sorting and causal index updates cost
O(L log L + S log S + I log I + F + E log L), with one result per
candidate and O(L + S + I + F + E) memory. There is no per-candidate full
liquidity, structure, or candle scan. Phase 5's moving-current-price heaps
cannot answer arbitrary entry-time price queries and are not duplicated.
Run `npm run verify:risk` for the real March XAUUSD pipeline and `npm test` for
positive, rejection, future-source, batch/incremental, and prefix fixtures.

## Phase 13 final signal decisions

**PHASE 13 — FROZEN.** `createSignalDecisionEngine().push` consumes only newly
available upstream facts, Phase 11 candidates, and Phase 12 validations.
`analyzeHistoricalSignals` feeds that same engine with event-time cursors.
Every emitted signal is an immutable decision event with Phase 11 entry and
Phase 12 stop, destination, and raw RR copied exactly. There is no trade
outcome, confidence percentage, grading, or UI logic.

The classifier uses a single precedence rule: liquidity reversal with MSS,
transfer, and a completed sweep/raid/failed-break/rejection interaction;
accepted breakout and FVG retest from a BOS broken swing; Phase 5 compressed
approach followed by aligned displacement and BOS/MSS; then clean BOS
continuation. Continuation requires directional control but no sweep or
transfer. Phase 4 swing-to-liquidity IDs link BOS to Phase 6 break and
acceptance events. Phase 5's historical compression class is only exposed
through its existing per-candle observer, so callers pass compact
`compressionEvidence` captured during that Phase 5 run. The final Phase 5
snapshot alone cannot reconstruct past compression causally.

Candidates waiting for a risk result produce WAIT. A completed candidate
that fails risk, lineage, geometry, or family requirements produces one
NO_TRADE decision. Candidates available together with opposing directions
are compared by existing Phase 9 confirmation time; the newer context wins,
and an unresolved tie rejects both. A later opposite candidate with an older
confirmation is also rejected. A setup key made from confirmation,
displacement, and direction prevents repeated signals. There is no daily
quota or time cooldown. Batch and incremental processing use the same code.

Maps join lineage IDs in O(1) average time, Sets deduplicate, and compact
arrays hold decisions. Compression history uses binary search when multiple
Phase 5 facts exist for the same liquidity level. Routing performs no candle,
liquidity, or structure scan per candidate and does not recalculate ATR,
entry, stop, target, or RR. Empty candidate and risk streams return before
indexing upstream histories. Run `npm run verify:signal` for the established
real XAUUSD period and `npm test` for all four families, conflict, duplicate,
causality, and batch/incremental fixtures. The real March sample has no Phase 9
confirmations and consequently no Phase 11–13 signal candidates; controlled
fixtures exercise every nonempty family path.

## Phase 14 immutable signal ledger and lifecycle

**PHASE 14 — FROZEN.** `createSignalLedger().push({ candle, newSignals })`
processes a closed 1m candle, then inserts signals available at that close.
Phase 11's `entryPrice` is the trigger candle close, so Phase 13 signals are
ACTIVE at `availableAt`; there is no future limit-order PENDING state. The
signal candle's earlier high and low cannot cause an exit. A later candle can
append TP_HIT, SL_HIT, or AMBIGUOUS_EXIT when both levels are inside its OHLC
range. An ambiguous candle records both touches and no assumed exit price.
There is no invented expiry or cancellation policy.

Each Phase 13 signal is copied and frozen, including reasons and lineage.
Lifecycle events and current status are separate from the original decision.
The ledger stores ordered signal records in one array, direct ID indexes in a
Map, and only nonterminal signals in an active Map. Identical signal IDs are
idempotent; conflicting duplicate content rejects. Batch input is sorted
once, while incremental candles must arrive in increasing timestamp order.
No historical signal list is scanned on a candle update: lifecycle work is
O(A) for A currently active signals. Insertion and ID lookup are O(1)
average. Latest and half-open range queries use binary search: O(log S) and
O(log S + K), respectively.

`getById`, `getLatestSignal`, `getPreviousSignal`, and `getSignalsInRange`
support an as-of time. They derive lifecycle state only from events available
by that time. Compact history and chart DTOs carry IDs, timestamps, prices,
family and lifecycle status without renderer styling. Ordered signal and
lifecycle event streams are available for future replay cursors. The module
does not persist across process restarts: PERSISTENCE_NOT_IMPLEMENTED. No
dataset fingerprint or strategy version exists in the current Signal contract,
so callers must keep incompatible runs in separate ledger instances.

Run `npm run verify:ledger` for the established real XAUUSD period and
`npm test` for immutable insertion, both directions, ambiguous exits,
pre-signal exclusion, as-of replay, ordered queries, and batch/incremental
prefix behavior. The real period has no Phase 9 confirmations and therefore
no Phase 13 signals; controlled fixtures exercise nonempty lifecycle paths.

## Phase 15 causal replay

**PHASE 15 — FROZEN.** `createReplaySession({ dataset, start, end, config })`
binds one Phase 1 dataset and one effective strategy configuration to a
deterministic candle clock. `step()` sends one closed 1 minute candle through
the production Phase 2 through Phase 14 incremental engines. Derived 5 minute,
15 minute, and 1 hour candles enter their engines only at `bucketEnd - 1
minute`, so final higher timeframe values cannot affect an earlier snapshot.

`runTo(timestamp)` resolves its target by binary search and continues from the
current cursor. `runToEnd()` is one sequential pass. Backward seeking resets
and deterministically replays because current engine state is not safely
serializable as compact checkpoints. Each step returns one compact snapshot
and newly emitted event deltas; it does not copy the candle or event prefix.
Dataset and configuration fingerprints prevent mixed sessions. Replay makes
no Finage calls, adds no dependency, and owns no UI state. Run `npm run
verify:replay` for real XAUUSD batch equivalence and `npm test` for range,
higher timeframe causality, reset, seek, identity, and future invariance.

## Phase 16 realistic execution backtest

**PHASE 16 — FROZEN.**

`runBacktest` and `runBacktestFromLedger` consume immutable Phase 13 signals;
they do not inspect candles to create or reject setups. The default execution
contract is `MARKET_AT_SIGNAL_CLOSE`, matching Phase 11's trigger close entry
and Phase 14's activation at that close. The signal candle's earlier OHLC
range is excluded. `NEXT_BAR_OPEN` and `LIMIT_AFTER_SIGNAL` are explicit
alternative execution scenarios. Limit entry starts on the first later candle
and defaults to conservative trade through. Same bar limit entry plus a stop or
target is `AMBIGUOUS_ENTRY_EXIT`.

Raw price results never claim historical spread knowledge. A separate
`CONFIGURED_FIXED` scenario applies deterministic adverse half spread and
slippage to both entry and exit. Stop gaps fill at the open; target limit gaps
remain at the target. When both boundaries occur in one OHLC candle the result
is `AMBIGUOUS_EXIT`, excluded from resolved metrics.

Active trades live in a Map and update MFE and MAE incrementally. There are no
post exit candle scans. Reports contain raw and explicitly configured metrics,
UTC calendar day frequency, family and direction breakdowns, and normalized
trade sequence drawdown. Strict half open evaluation is the only range policy;
open trades stay `OPEN_AT_DATA_END`. The result records dataset, strategy,
engine, execution, and range identities. Phase 16 creates no UI, network call,
dependency, position sizing, or account performance claim.

## Phase 17 chronological robustness certification

**PHASE 17 FRAMEWORK — FROZEN.** A historical certification may still return
`INSUFFICIENT_DATA` or `BLOCKED` when Phase 1 cannot provide clean complete
coverage; that is not a robustness pass.

`runValidation` reuses the Phase 15 replay and Phase 16 backtest engines.
Folds resolve timestamps to indices in the canonical candle array and support
expanding or rolling train windows, fixed test windows, an explicit optional
gap, pre-train warmup, and a separate final holdout. Training and warmup
signals are excluded from test cohorts. Phase 16 strict window semantics leave
test-end open trades unresolved.

Fixed-config OOS and fixed-config walk-forward are always available. Optional
walk-forward selection requires a declared owner/path/value whitelist,
objective, and maximum candidate count; candidates are deduplicated by replay
config hash and selected on train metrics only. Sensitivity uses only the
development range. Final holdout runs once with the frozen base config and
execution model. No run registry exists, so the report says
`HOLDOUT_REUSE_GUARD = NOT_PERSISTENT`.

Each report binds dataset, replay engine, strategy config, Phase 16 execution
config, validation config, and ranges. Local caches use the complete compatible
identity and are discarded after each validation. Aggregates preserve Phase 16
R, profit-factor, ambiguity, MFE/MAE, and drawdown semantics; intentionally
overlapping test ranges are deduplicated by signal ID. Explicit robustness
criteria produce auditable actual-versus-required gates. Without criteria,
certification is `NOT_PROVEN`; no thresholds are invented. Run
`npm run verify:validation` to fetch the configured long Finage XAUUSD history
and run the fixed-config chronological certification. Phase 17 adds no
strategy thresholds, provider, UI, dependencies, or account-level claims.

The 2026-10-04 real-data attempt requested 2025-01-01 through 2026-10-01.
Phase 1 returned 690,197 candles after 455 Finage calls but marked the result
`BLOCKED`; Phase 17 ran zero backtests on it. An earlier, longer 2024-start
request ended `FAILED` with `RESPONSE` after 146,034 candles. The observed
certification result is therefore `INSUFFICIENT_DATA`, pending a clean complete
Phase 1 XAUUSD dataset. These runs do not establish strategy performance.
