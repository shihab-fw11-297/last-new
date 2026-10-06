"use client";

import { useState, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { historicalHref, resolveHistoricalDateRange } from
  "@/lib/traderbrain/ui/date-range";
import type { Timeframe } from "@/lib/traderbrain/data/types";

export interface DateRangeSelectorProps {
  fromDate: string;
  toDate: string;
  timeframe: Timeframe;
  bars: number;
  maxDate: string;
  onLoadingChange?: (loading: boolean) => void;
  onOpenModal?: () => void;
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const parts = dateStr.split("-");
  const year = Number(parts[0]) || 2026;
  const month = Number(parts[1]) || 10;
  const day = Number(parts[2]) || 1;
  return { year, month, day };
}

function formatDateStr(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function countCalendarDays(from: string, to: string): number {
  try {
    const startMs = Date.parse(`${from}T00:00:00Z`);
    const endMs = Date.parse(`${to}T00:00:00Z`);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) return 0;
    return Math.round((endMs - startMs) / 86_400_000) + 1;
  } catch {
    return 0;
  }
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function DateRangeSelector({
  fromDate,
  toDate,
  timeframe,
  bars,
  maxDate,
  onLoadingChange,
  onOpenModal,
}: DateRangeSelectorProps) {
  const router = useRouter();
  const [from, setFrom] = useState(fromDate);
  const [to, setTo] = useState(toDate);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      resolveHistoricalDateRange(from, to);
      setError(null);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Invalid historical range.";
      setError(msg);
      setIsSubmitting(false);
      onLoadingChange?.(false);
      return;
    }

    const href = historicalHref({ timeframe, fromDate: from, toDate: to, bars });
    setIsSubmitting(true);
    onLoadingChange?.(true);

    try {
      router.push(href);
    } catch {
      if (typeof window !== "undefined") {
        window.location.assign(href);
      }
    }
  }

  function triggerPicker(ref: React.RefObject<HTMLInputElement | null>) {
    try {
      ref.current?.showPicker?.();
    } catch {
      ref.current?.focus();
    }
  }

  return (
    <form className="date-range" onSubmit={submit} aria-label="Historical UTC date range">
      {onOpenModal && (
        <button
          type="button"
          onClick={onOpenModal}
          className="min-h-[28px] px-2 py-0.5 rounded bg-[#16253b] hover:bg-[#20334d] border border-[#243249] text-[11px] text-[#d3a85c] flex items-center gap-1 font-mono cursor-pointer"
          title="Open visual calendar picker"
        >
          <span>📅</span>
          <span className="hidden lg:inline text-[#c7d5e6]">Calendar</span>
        </button>
      )}

      <label className="relative flex items-center gap-1">
        <span>FROM</span>
        <input
          ref={fromRef}
          type="date"
          name="from"
          value={from}
          max={maxDate}
          disabled={isSubmitting}
          style={{ colorScheme: "dark" }}
          onChange={(event) => setFrom(event.target.value)}
          onClick={() => triggerPicker(fromRef)}
          required
        />
      </label>

      <label className="relative flex items-center gap-1">
        <span>TO</span>
        <input
          ref={toRef}
          type="date"
          name="to"
          value={to}
          max={maxDate}
          disabled={isSubmitting}
          style={{ colorScheme: "dark" }}
          onChange={(event) => setTo(event.target.value)}
          onClick={() => triggerPicker(toRef)}
          required
        />
      </label>

      <span className="utc-label">UTC</span>

      <button type="submit" disabled={isSubmitting} className="flex items-center gap-1.5">
        {isSubmitting ? (
          <>
            <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-[#142033] border-t-transparent animate-spin" />
            <span>LOADING...</span>
          </>
        ) : (
          "LOAD"
        )}
      </button>

      {error ? (
        <span className="range-error font-medium" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}

export interface DateRangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  fromDate: string;
  toDate: string;
  timeframe: Timeframe;
  bars: number;
  maxDate: string;
  onLoadingChange?: (loading: boolean) => void;
}

export function DateRangeModal({
  isOpen,
  onClose,
  fromDate,
  toDate,
  timeframe,
  bars,
  maxDate,
  onLoadingChange,
}: DateRangeModalProps) {
  const router = useRouter();
  const [from, setFrom] = useState(fromDate);
  const [to, setTo] = useState(toDate);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeField, setActiveField] = useState<"from" | "to">("from");

  // Visual calendar view coordinates
  const initialParts = parseDateParts(to || fromDate);
  const [viewYear, setViewYear] = useState(initialParts.year);
  const [viewMonth, setViewMonth] = useState(initialParts.month);

  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const totalDays = countCalendarDays(from, to);

  function applyRange(newFrom: string, newTo: string) {
    setFrom(newFrom);
    setTo(newTo);
    setError(null);
    const parts = parseDateParts(newFrom);
    setViewYear(parts.year);
    setViewMonth(parts.month);
  }

  function applyPreset(days: number) {
    try {
      const maxMs = Date.parse(`${maxDate}T00:00:00Z`);
      const fromMs = maxMs - (days - 1) * 86_400_000;
      const newFrom = new Date(fromMs).toISOString().slice(0, 10);
      applyRange(newFrom, maxDate);
    } catch {
      // ignore
    }
  }

  function goToPrevMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    const maxParts = parseDateParts(maxDate);
    const canGoNext = viewYear < maxParts.year || (viewYear === maxParts.year && viewMonth < maxParts.month);
    if (!canGoNext) return;

    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function handleDayClick(dayStr: string) {
    if (maxDate && dayStr > maxDate) return;

    if (activeField === "from") {
      setFrom(dayStr);
      // If start date is placed after current end date, advance end date as well
      if (dayStr > to) {
        setTo(dayStr);
      }
      setActiveField("to");
      setError(null);
    } else {
      // activeField is "to"
      if (dayStr < from) {
        // User clicked a day before the start date: set start date to this day
        setFrom(dayStr);
        setActiveField("to");
        setError(null);
      } else {
        setTo(dayStr);
        setError(null);
      }
    }
  }

  function handleManualFromChange(value: string) {
    setFrom(value);
    if (value) {
      const parts = parseDateParts(value);
      if (parts.year && parts.month) {
        setViewYear(parts.year);
        setViewMonth(parts.month);
      }
    }
  }

  function handleManualToChange(value: string) {
    setTo(value);
    if (value) {
      const parts = parseDateParts(value);
      if (parts.year && parts.month) {
        setViewYear(parts.year);
        setViewMonth(parts.month);
      }
    }
  }

  function triggerPicker(ref: React.RefObject<HTMLInputElement | null>) {
    try {
      ref.current?.showPicker?.();
    } catch {
      ref.current?.focus();
    }
  }

  function handleFetch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    try {
      resolveHistoricalDateRange(from, to);
      setError(null);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Invalid historical range.";
      setError(msg);
      setIsSubmitting(false);
      onLoadingChange?.(false);
      return;
    }

    const href = historicalHref({ timeframe, fromDate: from, toDate: to, bars });
    setIsSubmitting(true);
    onLoadingChange?.(true);
    onClose();

    try {
      router.push(href);
    } catch {
      if (typeof window !== "undefined") {
        window.location.assign(href);
      }
    }
  }

  // Calendar calculations for viewYear & viewMonth
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();
  const firstDayOfWeek = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay();

  const maxParts = parseDateParts(maxDate);
  const canGoNextMonth = viewYear < maxParts.year || (viewYear === maxParts.year && viewMonth < maxParts.month);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="Select Historical Date Range"
    >
      {/* Backdrop tap to close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[#0b1422] border-t sm:border border-[#202b3e] rounded-t-3xl sm:rounded-2xl shadow-2xl p-4 sm:p-5 z-10 max-h-[92vh] flex flex-col overflow-hidden pb-safe">
        {/* Mobile Drag Handle Affordance */}
        <div className="w-12 h-1.5 bg-[#2a3a50] rounded-full mx-auto mb-2.5 sm:hidden shrink-0" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#202b3e] shrink-0">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-[#e1e9f4] flex items-center gap-2">
              <span>📅</span>
              <span>Historical Calendar Range</span>
            </h3>
            <p className="text-[11px] text-[#8491a5]">XAUUSD · UTC Midnight [start, end) Boundary</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-[#8491a5] hover:text-white hover:bg-[#1a283c] active:bg-[#20324c] transition-colors"
            title="Close"
          >
            <span className="text-base">✕</span>
          </button>
        </div>

        {/* Scrollable Container for Calendar & Controls */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-3.5 pr-0.5">
          {/* Step 1 & 2: Active Field Selector Tabs */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-bold text-[#7f8fa5] uppercase tracking-wider mb-1.5">
              <span>Range Boundaries</span>
              <span className="text-[#d3a85c] font-mono normal-case">
                {activeField === "from" ? "👉 Tap a day for START" : "👉 Tap a day for END"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveField("from");
                  const parts = parseDateParts(from);
                  setViewYear(parts.year);
                  setViewMonth(parts.month);
                }}
                className={`min-h-[48px] p-2 rounded-xl border text-left transition-all flex flex-col justify-center ${
                  activeField === "from"
                    ? "bg-[#1f2814] border-[#86efac] text-white ring-2 ring-[#22c55e]/40 shadow-sm"
                    : "bg-[#111e2d] border-[#243249] text-[#9aaac0] hover:text-[#e1e9f4] hover:bg-[#162539]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#86efac]">
                    ● FROM (Start Date)
                  </span>
                  {activeField === "from" && (
                    <span className="text-[9px] bg-[#22c55e] text-[#0d1624] px-1.5 py-0.2 rounded font-black">
                      ACTIVE
                    </span>
                  )}
                </div>
                <span className="text-sm font-mono font-bold text-white mt-0.5">{from || "YYYY-MM-DD"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveField("to");
                  const parts = parseDateParts(to);
                  setViewYear(parts.year);
                  setViewMonth(parts.month);
                }}
                className={`min-h-[48px] p-2 rounded-xl border text-left transition-all flex flex-col justify-center ${
                  activeField === "to"
                    ? "bg-[#2a1d0b] border-[#fde047] text-white ring-2 ring-[#d3a85c]/40 shadow-sm"
                    : "bg-[#111e2d] border-[#243249] text-[#9aaac0] hover:text-[#e1e9f4] hover:bg-[#162539]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#fde047]">
                    ■ TO (End Date)
                  </span>
                  {activeField === "to" && (
                    <span className="text-[9px] bg-[#d3a85c] text-[#0d1624] px-1.5 py-0.2 rounded font-black">
                      ACTIVE
                    </span>
                  )}
                </div>
                <span className="text-sm font-mono font-bold text-white mt-0.5">{to || "YYYY-MM-DD"}</span>
              </button>
            </div>
          </div>

          {/* Quick Presets for Fast Tap */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-bold text-[#7f8fa5] uppercase tracking-wider mb-1.5">
              <span>Quick Presets</span>
              <span className="text-[10px] text-[#6d7e94] normal-case">1-Tap selection</span>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
              <button
                type="button"
                onClick={() => applyRange("2026-09-28", "2026-10-04")}
                className="min-h-[38px] px-1.5 py-1 rounded-lg bg-[#241f12] hover:bg-[#342b1a] active:bg-[#443722] border border-[#a98953] text-[11px] font-bold text-[#f2cb7c] flex items-center justify-center text-center col-span-2"
                title="Prompt target: 2026-09-28 to 2026-10-04"
              >
                ⭐ Sep 28 – Oct 04
              </button>
              <button
                type="button"
                onClick={() => applyPreset(3)}
                className="min-h-[38px] px-1.5 py-1 rounded-lg bg-[#111e2d] hover:bg-[#1c2c3e] active:bg-[#253950] border border-[#243249] text-[11px] font-semibold text-[#c7d5e6] hover:text-white flex items-center justify-center"
              >
                3 Days
              </button>
              <button
                type="button"
                onClick={() => applyPreset(7)}
                className="min-h-[38px] px-1.5 py-1 rounded-lg bg-[#111e2d] hover:bg-[#1c2c3e] active:bg-[#253950] border border-[#243249] text-[11px] font-semibold text-[#c7d5e6] hover:text-white flex items-center justify-center"
              >
                7 Days
              </button>
              <button
                type="button"
                onClick={() => applyPreset(14)}
                className="min-h-[38px] px-1.5 py-1 rounded-lg bg-[#111e2d] hover:bg-[#1c2c3e] active:bg-[#253950] border border-[#243249] text-[11px] font-semibold text-[#c7d5e6] hover:text-white flex items-center justify-center hidden sm:flex"
              >
                14 Days
              </button>
            </div>
          </div>

          {/* Interactive Visual Monthly Calendar Grid */}
          <div className="bg-[#0f1a2a] border border-[#243449] rounded-2xl p-3 sm:p-3.5 shadow-inner">
            {/* Calendar Month Navigation Header */}
            <div className="flex items-center justify-between mb-3 px-1">
              <button
                type="button"
                onClick={goToPrevMonth}
                className="min-w-[42px] min-h-[42px] rounded-xl bg-[#142337] hover:bg-[#203652] active:bg-[#274265] text-[#dce5f1] flex items-center justify-center text-sm font-bold transition-colors"
                title="Previous Month"
                aria-label="Previous Month"
              >
                ◀
              </button>

              <div className="text-center">
                <span className="text-sm sm:text-base font-bold text-white tracking-wide">
                  {MONTH_NAMES[viewMonth - 1]} {viewYear}
                </span>
                <span className="block text-[10px] font-mono text-[#8293aa]">UTC Calendar</span>
              </div>

              <button
                type="button"
                onClick={goToNextMonth}
                disabled={!canGoNextMonth}
                className={`min-w-[42px] min-h-[42px] rounded-xl flex items-center justify-center text-sm font-bold transition-colors ${
                  canGoNextMonth
                    ? "bg-[#142337] hover:bg-[#203652] active:bg-[#274265] text-[#dce5f1]"
                    : "bg-[#0f1722] text-[#3d4b5c] cursor-not-allowed"
                }`}
                title="Next Month"
                aria-label="Next Month"
              >
                ▶
              </button>
            </div>

            {/* Days of Week Header */}
            <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] font-bold text-[#64748b] mb-1.5 py-1 border-b border-[#1f2e42]">
              {DAY_LABELS.map((lbl) => (
                <div key={lbl} className="py-0.5">
                  {lbl}
                </div>
              ))}
            </div>

            {/* Calendar Days Matrix */}
            <div className="grid grid-cols-7 gap-1 text-center select-none">
              {/* Empty leading slots */}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`blank-${i}`} className="h-10 sm:h-11" />
              ))}

              {/* Days in Month */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const dayStr = formatDateStr(viewYear, viewMonth, dayNum);

                const isStart = dayStr === from;
                const isEnd = dayStr === to;
                const isSingleDay = isStart && isEnd;
                const isInRange = dayStr > from && dayStr < to;
                const isFuture = maxDate ? dayStr > maxDate : false;

                let cellClass =
                  "h-10 sm:h-11 rounded-lg text-xs font-mono font-medium flex items-center justify-center transition-all cursor-pointer relative ";

                if (isFuture) {
                  cellClass += "opacity-25 text-[#49576b] cursor-not-allowed bg-transparent";
                } else if (isSingleDay) {
                  cellClass += "bg-[#d3a85c] text-[#0b1422] font-black ring-2 ring-[#e8c382] shadow-md z-10";
                } else if (isStart) {
                  cellClass +=
                    "bg-[#22c55e] text-[#0a1e12] font-black rounded-l-lg rounded-r-none shadow-md z-10";
                } else if (isEnd) {
                  cellClass +=
                    "bg-[#d3a85c] text-[#0d1624] font-black rounded-r-lg rounded-l-none shadow-md z-10";
                } else if (isInRange) {
                  cellClass +=
                    "bg-[#292212] text-[#f2cb7c] border-y border-[#a98953]/30 rounded-none font-semibold";
                } else {
                  cellClass +=
                    "bg-[#132032] hover:bg-[#1f324c] active:bg-[#284061] text-[#dce5f1]";
                }

                return (
                  <button
                    key={dayStr}
                    type="button"
                    disabled={isFuture}
                    onClick={() => handleDayClick(dayStr)}
                    className={cellClass}
                    title={`${dayStr} (UTC)`}
                  >
                    <span>{dayNum}</span>
                    {isStart && !isSingleDay && (
                      <span className="absolute -top-1 left-0.5 text-[8px] leading-none text-[#22c55e] font-sans font-bold">
                        ▲
                      </span>
                    )}
                    {isEnd && !isSingleDay && (
                      <span className="absolute -bottom-1 right-0.5 text-[8px] leading-none text-[#d3a85c] font-sans font-bold">
                        ▼
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fallback Direct Inputs with Native Pickers */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="relative">
              <label className="block text-[10px] font-bold text-[#7f8fa5] uppercase tracking-wider mb-1">
                FROM Date (UTC)
              </label>
              <div className="relative flex items-center">
                <input
                  ref={fromInputRef}
                  type="date"
                  value={from}
                  max={maxDate}
                  disabled={isSubmitting}
                  style={{ colorScheme: "dark" }}
                  onChange={(e) => handleManualFromChange(e.target.value)}
                  onClick={() => triggerPicker(fromInputRef)}
                  required
                  className="w-full h-11 min-h-[44px] px-3 pr-8 rounded-xl border border-[#243249] bg-[#111e2d] text-white text-[15px] sm:text-xs font-mono focus:border-[#22c55e] focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => triggerPicker(fromInputRef)}
                  className="absolute right-2 text-base text-[#8491a5] hover:text-white"
                  title="Open date picker"
                >
                  📅
                </button>
              </div>
            </div>

            <div className="relative">
              <label className="block text-[10px] font-bold text-[#7f8fa5] uppercase tracking-wider mb-1">
                TO Date (UTC)
              </label>
              <div className="relative flex items-center">
                <input
                  ref={toInputRef}
                  type="date"
                  value={to}
                  max={maxDate}
                  disabled={isSubmitting}
                  style={{ colorScheme: "dark" }}
                  onChange={(e) => handleManualToChange(e.target.value)}
                  onClick={() => triggerPicker(toInputRef)}
                  required
                  className="w-full h-11 min-h-[44px] px-3 pr-8 rounded-xl border border-[#243249] bg-[#111e2d] text-white text-[15px] sm:text-xs font-mono focus:border-[#d3a85c] focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => triggerPicker(toInputRef)}
                  className="absolute right-2 text-base text-[#8491a5] hover:text-white"
                  title="Open date picker"
                >
                  📅
                </button>
              </div>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-xl bg-[#240e12] border border-[#5e1e24] text-[#fca5a5] text-xs font-mono" role="alert">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>

        {/* Modal Bottom Action Bar */}
        <div className="pt-3 border-t border-[#202b3e] mt-2 shrink-0">
          {/* Selected Summary Info */}
          <div className="flex items-center justify-between text-xs mb-2.5 px-1 font-mono">
            <span className="text-[#8491a5]">Range:</span>
            <span className="text-[#e1e9f4] font-semibold">
              <span className="text-[#86efac]">{from}</span>
              <span className="text-[#64748b] mx-1.5">→</span>
              <span className="text-[#fde047]">{to}</span>
              <span className="ml-2 px-1.5 py-0.5 rounded bg-[#16253b] text-[#d3a85c] text-[10px]">
                {totalDays} {totalDays === 1 ? "day" : "days"}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 h-12 min-h-[48px] rounded-xl border border-[#243249] bg-[#111e2d] text-[#c7d5e6] font-semibold text-xs sm:text-sm hover:bg-[#1a283c] active:bg-[#20324c] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleFetch()}
              disabled={isSubmitting || !from || !to}
              className="flex-[2] h-12 min-h-[48px] rounded-xl bg-[#d3a85c] hover:bg-[#e0b56b] active:scale-[0.98] text-[#142033] font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg shadow-[#d3a85c]/10 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-[#142033] border-t-transparent animate-spin" />
                  <span>FETCHING CANDLES...</span>
                </>
              ) : (
                <span>FETCH CANDLES ({totalDays > 0 ? `${totalDays}D` : "LOAD"})</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
