import type { Candle, DataStatus, HistoricalResult } from "../data/types.ts";
import type { Signal, SignalDecisionResult, SetupFamily } from "./signal-decision.ts";

export type LifecycleStatus = "PENDING" | "ACTIVE" | "TP_HIT" | "SL_HIT" |
  "AMBIGUOUS_EXIT" | "EXPIRED" | "CANCELLED";
export type LifecycleEventType = "ACTIVATED" | "TP_HIT" | "SL_HIT" |
  "AMBIGUOUS_EXIT" | "EXPIRED" | "CANCELLED";
export type LifecycleEvent = Readonly<{
  id: string;
  signalId: string;
  type: LifecycleEventType;
  createdAt: number;
  availableAt: number;
  price: number | null;
  tpTouched: boolean;
  slTouched: boolean;
  reason: "TRIGGER_CLOSE_ENTRY" | "PRICE_BOUNDARY" |
    "OHLC_SEQUENCE_UNKNOWN" | "POLICY_EXPIRY" | "POLICY_CANCELLATION";
}>;
export type ImmutableSignal = Readonly<Omit<Signal, "reasons" | "lineage"> & {
  reasons: readonly Signal["reasons"][number][];
  lineage: Readonly<Signal["lineage"]>;
}>;
export type LifecycleView = Readonly<{ status: LifecycleStatus;
  availableAt: number; activatedAt: number | null; exitPrice: number | null }>;
export type SignalRecord = Readonly<{ signal: ImmutableSignal;
  lifecycle: LifecycleView; events: readonly LifecycleEvent[] }>;
export type SignalHistoryItem = Readonly<{
  signalId: string; availableAt: number; direction: Signal["direction"];
  setupFamily: SetupFamily; entryPrice: number; stopLoss: number;
  takeProfit: number; rr: number; lifecycleStatus: LifecycleStatus;
  lifecycleAvailableAt: number; lineageIds: Readonly<Signal["lineage"]>;
}>;
export type SignalChartItem = Readonly<{
  signalId: string; timestamp: number; direction: Signal["direction"];
  setupFamily: SetupFamily; entryPrice: number; stopLoss: number;
  takeProfit: number; lifecycleStatus: LifecycleStatus;
}>;
export type LedgerDiagnostics = {
  signalsReceived: number; uniqueSignals: number; duplicateInsertions: number;
  candlesProcessed: number; active: number; pending: number; tpHit: number;
  slHit: number; ambiguousExit: number; expired: number; cancelled: number;
  terminalRecords: number; maxSimultaneousActive: number;
  errorCode?: string; errorIndex?: number;
};
export type LedgerTimings = { signalInsertMs: number; lifecycleUpdateMs: number;
  historyQueryMs: number; asOfQueryMs: number; totalMs: number };
export type SignalLedgerResult = { status: DataStatus; symbol: "XAUUSD";
  ledger: SignalLedger; diagnostics: LedgerDiagnostics; timings: LedgerTimings };

type StoredRecord = { signal: ImmutableSignal; status: LifecycleStatus;
  statusAt: number; activatedAt: number; exitPrice: number | null;
  events: LifecycleEvent[] };
type ActiveTracker = { index: number; barsActive: number;
  lastProcessedTimestamp: number };
function diagnostics(): LedgerDiagnostics {
  return { signalsReceived: 0, uniqueSignals: 0, duplicateInsertions: 0,
    candlesProcessed: 0, active: 0, pending: 0, tpHit: 0, slHit: 0,
    ambiguousExit: 0, expired: 0, cancelled: 0, terminalRecords: 0,
    maxSimultaneousActive: 0 };
}
function timings(): LedgerTimings {
  return { signalInsertMs: 0, lifecycleUpdateMs: 0,
    historyQueryMs: 0, asOfQueryMs: 0, totalMs: 0 };
}
function freezeSignal(signal: Signal): ImmutableSignal {
  return Object.freeze({ ...signal, reasons: Object.freeze([...signal.reasons]),
    lineage: Object.freeze({ ...signal.lineage }) });
}
function event(signalId: string, type: LifecycleEventType, at: number,
  price: number | null, tpTouched: boolean, slTouched: boolean,
  reason: LifecycleEvent["reason"]): LifecycleEvent {
  return Object.freeze({ id: `${signalId}:${type}:${at}`, signalId, type,
    createdAt: at, availableAt: at, price, tpTouched, slTouched, reason });
}
/** Returns first index whose timestamp is >= time, or > time when strict. */
function timeBound<T>(items: readonly T[], time: number,
  timestamp: (item: T) => number, strict = false): number {
  let left = 0; let right = items.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (strict ? timestamp(items[middle]) <= time :
        timestamp(items[middle]) < time) left = middle + 1;
    else right = middle;
  }
  return left;
}
function validSignal(signal: Signal): boolean {
  return !!signal && !!signal.id && signal.symbol === "XAUUSD" &&
    signal.timeframe === "1m" && signal.status === "ACTIVE" &&
    Number.isSafeInteger(signal.createdAt) &&
    Number.isSafeInteger(signal.availableAt) &&
    signal.createdAt <= signal.availableAt &&
    Number.isFinite(signal.entryPrice) && signal.entryPrice > 0 &&
    Number.isFinite(signal.stopLoss) && signal.stopLoss > 0 &&
    Number.isFinite(signal.takeProfit) && signal.takeProfit > 0 &&
    Number.isFinite(signal.rr) && signal.rr > 0 &&
    Number.isFinite(signal.rawRR) && signal.rawRR > 0 &&
    Array.isArray(signal.reasons) && !!signal.lineage &&
    (signal.direction === "BUY" ?
      signal.stopLoss < signal.entryPrice &&
        signal.entryPrice < signal.takeProfit :
      signal.direction === "SELL" && signal.takeProfit < signal.entryPrice &&
        signal.entryPrice < signal.stopLoss);
}
function validCandle(candle: Candle): boolean {
  return !!candle && candle.symbol === "XAUUSD" && candle.timeframe === "1m" &&
    Number.isSafeInteger(candle.timestamp) &&
    [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.low > 0 && candle.low <= candle.open && candle.low <= candle.close &&
    candle.high >= candle.open && candle.high >= candle.close;
}
export class SignalLedgerInputError extends Error {
  constructor(readonly code: "INPUT_ORDER" | "INVALID_CANDLE" |
    "INVALID_SIGNAL" | "LATE_SIGNAL" | "DUPLICATE_CONFLICT" |
    "SIGNAL_WITHOUT_CANDLE") { super(code); }
}

/** One event-time ledger run; persistence is intentionally outside this module. */
export class SignalLedger {
  readonly diagnostics = diagnostics();
  readonly timings = timings();
  private readonly records: StoredRecord[] = [];
  private readonly indexById = new Map<string, number>();
  private readonly active = new Map<string, ActiveTracker>();
  private readonly lifecycleTimeline: LifecycleEvent[] = [];
  private lastCandleAt = -Infinity;
  private lastSignalAt = -Infinity;
  private lastSignalId = "";

  /** Closed candle first, then new signals available at its close. */
  push(input: { candle: Candle; newSignals?: readonly Signal[] }): void {
    const started = performance.now();
    const candle = input.candle;
    if (!validCandle(candle)) throw new SignalLedgerInputError("INVALID_CANDLE");
    if (candle.timestamp <= this.lastCandleAt) {
      throw new SignalLedgerInputError("INPUT_ORDER");
    }
    const newSignals = [...(input.newSignals ?? [])].sort((a, b) =>
      a.availableAt - b.availableAt || a.id.localeCompare(b.id));
    const inTick = new Map<string, Signal>();
    for (const signal of newSignals) {
      if (!validSignal(signal)) throw new SignalLedgerInputError("INVALID_SIGNAL");
      const prior = this.indexById.get(signal.id);
      const known = prior === undefined ? inTick.get(signal.id) :
        this.records[prior].signal;
      if (known) {
        if (JSON.stringify(known) !== JSON.stringify(signal)) {
          throw new SignalLedgerInputError("DUPLICATE_CONFLICT");
        }
        continue;
      }
      if (signal.availableAt !== candle.timestamp ||
          signal.availableAt < this.lastSignalAt ||
          (signal.availableAt === this.lastSignalAt && signal.id < this.lastSignalId)) {
        throw new SignalLedgerInputError("LATE_SIGNAL");
      }
      inTick.set(signal.id, signal);
    }
    this.diagnostics.signalsReceived += newSignals.length;
    const lifecycleStarted = performance.now();
    for (const [id, tracker] of this.active) {
      const record = this.records[tracker.index];
      if (candle.timestamp <= record.signal.availableAt) continue;
      const tpTouched = record.signal.direction === "BUY" ?
        candle.high >= record.signal.takeProfit :
        candle.low <= record.signal.takeProfit;
      const slTouched = record.signal.direction === "BUY" ?
        candle.low <= record.signal.stopLoss :
        candle.high >= record.signal.stopLoss;
      tracker.barsActive++;
      tracker.lastProcessedTimestamp = candle.timestamp;
      if (!tpTouched && !slTouched) continue;
      const type: LifecycleEventType = tpTouched && slTouched ?
        "AMBIGUOUS_EXIT" : tpTouched ? "TP_HIT" : "SL_HIT";
      const price = type === "AMBIGUOUS_EXIT" ? null :
        type === "TP_HIT" ? record.signal.takeProfit : record.signal.stopLoss;
      const outcome = event(id, type, candle.timestamp, price, tpTouched,
        slTouched, type === "AMBIGUOUS_EXIT" ?
          "OHLC_SEQUENCE_UNKNOWN" : "PRICE_BOUNDARY");
      record.events.push(outcome);
      record.status = type;
      record.statusAt = candle.timestamp;
      record.exitPrice = price;
      this.lifecycleTimeline.push(outcome);
      this.active.delete(id);
      this.diagnostics.terminalRecords++;
      if (type === "TP_HIT") this.diagnostics.tpHit++;
      else if (type === "SL_HIT") this.diagnostics.slHit++;
      else this.diagnostics.ambiguousExit++;
    }
    this.diagnostics.active = this.active.size;
    this.timings.lifecycleUpdateMs += performance.now() - lifecycleStarted;
    const insertStarted = performance.now();
    for (const signal of newSignals) {
      if (this.indexById.has(signal.id)) {
        this.diagnostics.duplicateInsertions++;
        continue;
      }
      const immutable = freezeSignal(signal);
      const activation = event(signal.id, "ACTIVATED", signal.availableAt,
        signal.entryPrice, false, false, "TRIGGER_CLOSE_ENTRY");
      const index = this.records.length;
      this.records.push({ signal: immutable, status: "ACTIVE",
        statusAt: signal.availableAt, activatedAt: signal.availableAt,
        exitPrice: null, events: [activation] });
      this.indexById.set(signal.id, index);
      this.active.set(signal.id, { index, barsActive: 0,
        lastProcessedTimestamp: signal.availableAt });
      this.lifecycleTimeline.push(activation);
      this.lastSignalAt = signal.availableAt;
      this.lastSignalId = signal.id;
      this.diagnostics.uniqueSignals++;
    }
    this.diagnostics.active = this.active.size;
    this.diagnostics.maxSimultaneousActive = Math.max(
      this.diagnostics.maxSimultaneousActive, this.active.size);
    this.timings.signalInsertMs += performance.now() - insertStarted;
    this.lastCandleAt = candle.timestamp;
    this.diagnostics.candlesProcessed++;
    this.timings.totalMs += performance.now() - started;
  }

  get signalCount(): number { return this.records.length; }
  get lifecycleEventCount(): number { return this.lifecycleTimeline.length; }

  private snapshot(record: StoredRecord, asOf: number): SignalRecord {
    const count = timeBound(record.events, asOf, (item) => item.availableAt, true);
    const known = record.events.slice(0, count);
    const latest = known.at(-1);
    if (!latest) throw new RangeError("Signal unavailable at requested time");
    const status: LifecycleStatus = latest.type === "ACTIVATED" ?
      "ACTIVE" : latest.type;
    return Object.freeze({ signal: record.signal,
      lifecycle: Object.freeze({ status, availableAt: latest.availableAt,
        activatedAt: record.activatedAt,
        exitPrice: latest.type === "TP_HIT" || latest.type === "SL_HIT" ?
          latest.price : null }),
      events: Object.freeze(known) });
  }

  getById(id: string, asOf = Infinity): SignalRecord | null {
    const started = performance.now();
    const index = this.indexById.get(id);
    const record = index === undefined ? null : this.records[index];
    const result = record && record.signal.availableAt <= asOf ?
      this.snapshot(record, asOf) : null;
    this.timings.asOfQueryMs += performance.now() - started;
    return result;
  }

  getLatestSignal(asOf = Infinity): SignalRecord | null {
    const started = performance.now();
    const end = timeBound(this.records, asOf,
      (item) => item.signal.availableAt, true);
    const result = end ? this.snapshot(this.records[end - 1], asOf) : null;
    this.timings.asOfQueryMs += performance.now() - started;
    return result;
  }

  getPreviousSignal(signalId: string, asOf = Infinity): SignalRecord | null {
    const started = performance.now();
    const index = this.indexById.get(signalId);
    const record = index !== undefined && index > 0 &&
      this.records[index].signal.availableAt <= asOf ? this.records[index - 1] : null;
    const result = record && record.signal.availableAt <= asOf ?
      this.snapshot(record, asOf) : null;
    this.timings.asOfQueryMs += performance.now() - started;
    return result;
  }

  getSignalsInRange(start: number, end: number,
    asOf = Infinity): SignalRecord[] {
    const started = performance.now();
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start >= end) throw new RangeError("Invalid half-open signal range");
    const from = timeBound(this.records, start,
      (item) => item.signal.availableAt);
    const to = Math.min(timeBound(this.records, end,
      (item) => item.signal.availableAt),
    timeBound(this.records, asOf, (item) => item.signal.availableAt, true));
    const result: SignalRecord[] = [];
    for (let i = from; i < to; i++) result.push(this.snapshot(this.records[i], asOf));
    this.timings.historyQueryMs += performance.now() - started;
    return result;
  }

  getSignalEventsThrough(asOf: number): readonly ImmutableSignal[] {
    const end = timeBound(this.records, asOf,
      (item) => item.signal.availableAt, true);
    return Object.freeze(this.records.slice(0, end).map((item) => item.signal));
  }

  getLifecycleEventsThrough(asOf: number): readonly LifecycleEvent[] {
    const end = timeBound(this.lifecycleTimeline, asOf,
      (item) => item.availableAt, true);
    return Object.freeze(this.lifecycleTimeline.slice(0, end));
  }

  /** Incremental presentation cursor; avoids copying prior lifecycle history. */
  getLifecycleEventsSince(cursor: number, asOf = Infinity): readonly LifecycleEvent[] {
    if (!Number.isSafeInteger(cursor) || cursor < 0 ||
        cursor > this.lifecycleTimeline.length) {
      throw new RangeError("Invalid lifecycle cursor");
    }
    const end = timeBound(this.lifecycleTimeline, asOf,
      (item) => item.availableAt, true);
    if (cursor > end) throw new RangeError("Lifecycle cursor is ahead of as-of time");
    return Object.freeze(this.lifecycleTimeline.slice(cursor, end));
  }

  getHistoryItemsInRange(start: number, end: number,
    asOf = Infinity): SignalHistoryItem[] {
    return this.getSignalsInRange(start, end, asOf).map(({ signal, lifecycle }) =>
      Object.freeze({ signalId: signal.id, availableAt: signal.availableAt,
        direction: signal.direction, setupFamily: signal.setupFamily,
        entryPrice: signal.entryPrice, stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit, rr: signal.rr,
        lifecycleStatus: lifecycle.status,
        lifecycleAvailableAt: lifecycle.availableAt,
        lineageIds: signal.lineage }));
  }

  getChartItemsInRange(start: number, end: number,
    asOf = Infinity): SignalChartItem[] {
    return this.getHistoryItemsInRange(start, end, asOf).map((item) =>
      Object.freeze({ signalId: item.signalId, timestamp: item.availableAt,
        direction: item.direction, setupFamily: item.setupFamily,
        entryPrice: item.entryPrice, stopLoss: item.stopLoss,
        takeProfit: item.takeProfit, lifecycleStatus: item.lifecycleStatus }));
  }
}

export function createSignalLedger(): SignalLedger { return new SignalLedger(); }

export function analyzeHistoricalSignalLedger(historical: HistoricalResult,
  signals: SignalDecisionResult): SignalLedgerResult {
  const started = performance.now();
  const ledger = createSignalLedger();
  const blocked = (code: string, index?: number): SignalLedgerResult => {
    const empty = createSignalLedger();
    empty.diagnostics.errorCode = code;
    if (index !== undefined) empty.diagnostics.errorIndex = index;
    empty.timings.totalMs = performance.now() - started;
    return { status: "BLOCKED", symbol: "XAUUSD", ledger: empty,
      diagnostics: empty.diagnostics, timings: empty.timings };
  };
  if ([historical.status, signals.status].some((status) =>
    status === "BLOCKED" || status === "FAILED")) return blocked("UPSTREAM_DATA_STATUS");
  const ordered = [...signals.signals].sort((a, b) =>
    a.availableAt - b.availableAt || a.id.localeCompare(b.id));
  let cursor = 0;
  const seenIds = new Set<string>();
  try {
    for (let i = 0; i < historical.candles1m.length; i++) {
      const candle = historical.candles1m[i];
      const arriving: Signal[] = [];
      while (cursor < ordered.length &&
          ordered[cursor].availableAt <= candle.timestamp) {
        if (ordered[cursor].availableAt !== candle.timestamp &&
            !seenIds.has(ordered[cursor].id)) {
          throw new SignalLedgerInputError("SIGNAL_WITHOUT_CANDLE");
        }
        seenIds.add(ordered[cursor].id);
        arriving.push(ordered[cursor++]);
      }
      ledger.push({ candle, newSignals: arriving });
    }
    if (cursor !== ordered.length) return blocked("SIGNAL_WITHOUT_CANDLE",
      historical.candles1m.length);
    ledger.timings.totalMs = performance.now() - started;
    return { status: [historical.status, signals.status].includes("WARN") ?
      "WARN" : "READY", symbol: "XAUUSD", ledger,
      diagnostics: ledger.diagnostics, timings: ledger.timings };
  } catch (error) {
    if (error instanceof SignalLedgerInputError) {
      return blocked(error.code, ledger.diagnostics.candlesProcessed);
    }
    throw error;
  }
}
