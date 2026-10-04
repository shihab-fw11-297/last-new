"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { historicalHref, resolveHistoricalDateRange } from
  "@/lib/traderbrain/ui/date-range";
import type { Timeframe } from "@/lib/traderbrain/data/types";

export function DateRangeSelector({ fromDate, toDate, timeframe, bars, maxDate }: {
  fromDate: string;
  toDate: string;
  timeframe: Timeframe;
  bars: number;
  maxDate: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(fromDate);
  const [to, setTo] = useState(toDate);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      resolveHistoricalDateRange(from, to);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid historical range.");
      return;
    }
    const href = historicalHref({ timeframe, fromDate: from, toDate: to, bars });
    // App Router navigation is interruptible and the page has no client-owned
    // candle response state, so a superseded response cannot replace the latest URL.
    startTransition(() => router.push(href, { scroll: false }));
  }

  return <form className="date-range" onSubmit={submit} aria-label="Historical UTC date range">
    <label><span>FROM</span><input type="date" name="from" value={from}
      max={maxDate} onChange={(event) => setFrom(event.target.value)} required /></label>
    <label><span>TO</span><input type="date" name="to" value={to}
      max={maxDate} onChange={(event) => setTo(event.target.value)} required /></label>
    <span className="utc-label">UTC</span>
    <button type="submit" disabled={isPending}>{isPending ? "LOADING" : "LOAD"}</button>
    {error ? <span className="range-error" role="alert">{error}</span> : null}
  </form>;
}
