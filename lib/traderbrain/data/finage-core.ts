import { normalizeRows } from "./candles.ts";
import { PROVIDER_LIMIT, type Candle, type Interval } from "./types.ts";

export type FetchStats = { actualApiCalls: number; retryCount: number; providerRows: number; normalizeMs: number; invalidCandleCount: number };
export type Chunk = { candles: Candle[]; truncationReason?: string };

export class ProviderError extends Error {
  constructor(public readonly code: "RANGE" | "AUTH" | "HTTP" | "NETWORK" | "CANCELLED" | "RESPONSE",
    public readonly status?: number) {
    super(`Finage ${code.toLowerCase()} error`);
  }
}

export type FinageOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ProviderError("CANCELLED")); return; }
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", cancel); resolve(); }
    function cancel() { clearTimeout(timer); reject(new ProviderError("CANCELLED")); }
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function retryDelay(retryAfter: string | null, attempt: number, random: () => number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const date = Date.parse(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : NaN;
    if (Number.isFinite(delay)) return Math.min(30_000, Math.max(0, delay));
  }
  return Math.min(30_000, 500 * 2 ** attempt + Math.floor(random() * 250));
}

export class FinageClient {
  private readonly inFlight = new Map<string, Promise<Chunk>>();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly apiKey: string, options: FinageOptions = {}) {
    if (!apiKey) throw new ProviderError("AUTH");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 ||
        !Number.isSafeInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 10) {
      throw new RangeError("Invalid Finage retry or timeout configuration");
    }
  }

  fetchChunk(range: Interval, stats: FetchStats, signal?: AbortSignal): Promise<Chunk> {
    const key = `${range.start}:${range.end}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.request(range, stats, signal);
    this.inFlight.set(key, promise);
    void promise.finally(() => { if (this.inFlight.get(key) === promise) this.inFlight.delete(key); }).catch(() => {});
    return promise;
  }

  private async request(range: Interval, stats: FetchStats, signal?: AbortSignal): Promise<Chunk> {
    // Finage path parameters are UTC calendar dates; date_format=ts affects the response only.
    // Request every date touched by [start, end), then trim to the exact interval upstream.
    const from = new Date(range.start).toISOString().slice(0, 10);
    const to = new Date(Math.floor((range.end - 1) / 86_400_000) * 86_400_000 + 86_400_000)
      .toISOString().slice(0, 10);
    const url = new URL(`https://api.finage.co.uk/agg/forex/XAUUSD/1/minute/${from}/${to}`);
    url.searchParams.set("apikey", this.apiKey);
    url.searchParams.set("limit", String(PROVIDER_LIMIT));
    url.searchParams.set("sort", "asc");
    url.searchParams.set("date_format", "ts");
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal?.aborted) throw new ProviderError("CANCELLED");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let retryAfter: string | null = null;
      try {
        stats.actualApiCalls++;
        const response = await this.fetchImpl(url, { signal: combined, cache: "no-store" });
        if (!response.ok) {
          retryAfter = response.headers.get("retry-after");
          if (response.status === 401 || response.status === 403) throw new ProviderError("AUTH");
          if (response.status === 413) throw new ProviderError("RANGE");
          if (response.status === 400 || response.status === 422) {
            // Inspect the error only to classify range rejection; never emit provider text.
            const body = (await response.text()).slice(0, 2_000);
            if (/range|window|period|date|limit|maximum|too (?:long|large)/i.test(body)) throw new ProviderError("RANGE");
          }
          if (response.status !== 429 && response.status < 500) throw new ProviderError("HTTP", response.status);
          if (attempt === this.maxRetries) throw new ProviderError("HTTP", response.status);
        } else {
          let body: unknown;
          try { body = await response.json(); }
          catch { throw new ProviderError("RESPONSE"); }
          if (!body || typeof body !== "object") throw new ProviderError("RESPONSE");
          const payload = body as Record<string, unknown>;
          if (!Array.isArray(payload.results)) throw new ProviderError("RESPONSE");
          stats.providerRows += payload.results.length;
          const started = performance.now();
          const normalized = normalizeRows(payload.results);
          stats.normalizeMs += performance.now() - started;
          stats.invalidCandleCount += normalized.invalidCount;
          let firstInRange: number | undefined;
          let lastInRange: number | undefined;
          for (const candle of normalized.candles) {
            if (candle.timestamp < range.start) continue;
            if (candle.timestamp >= range.end) break;
            firstInRange ??= candle.timestamp;
            lastInRange = candle.timestamp;
          }
          const total = typeof payload.totalResults === "number" ? payload.totalResults : undefined;
          let truncationReason: string | undefined;
          if (payload.results.length >= PROVIDER_LIMIT || (total !== undefined && total >= PROVIDER_LIMIT)) truncationReason = "RESULT_LIMIT";
          else if (total !== undefined && total > payload.results.length) truncationReason = "INCOMPLETE_RESULT";
          else if (payload.has_more === true || payload.hasMore === true || payload.next_url || payload.nextUrl) truncationReason = "PAGINATED_RESULT";
          else if (firstInRange !== undefined && lastInRange !== undefined &&
            range.end - range.start > 86_400_000 &&
            (firstInRange - range.start > 12 * 3_600_000 ||
             range.end - lastInRange > 12 * 3_600_000)) truncationReason = "SUSPICIOUS_EDGE_COVERAGE";
          // Finage accepts calendar dates and may include both endpoint dates.
          // Keep each adaptive child half-open so boundary rows from neighboring
          // requests cannot leak into the merged result as conflicting duplicates.
          const candles = normalized.candles.filter((candle) =>
            candle.timestamp >= range.start && candle.timestamp < range.end);
          return { candles, truncationReason };
        }
      } catch (error) {
        if (signal?.aborted) throw new ProviderError("CANCELLED");
        if (error instanceof ProviderError && error.code !== "NETWORK") throw error;
        if (attempt === this.maxRetries) throw new ProviderError("NETWORK");
      } finally {
        clearTimeout(timer);
      }
      stats.retryCount++;
      await this.sleep(retryDelay(retryAfter, attempt, this.random), signal);
    }
    throw new ProviderError("HTTP");
  }
}
