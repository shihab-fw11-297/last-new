// Enhanced diagnostic script that reports per-chunk status including split reason details
// Used to pinpoint exactly which chunk/range causes BLOCKED

import { FinageClient, ProviderError } from "../lib/traderbrain/data/finage-core.ts";
import { planRanges, splitRange } from "../lib/traderbrain/data/intervals.ts";
import { utcMillis, validateInterval } from "../lib/traderbrain/data/types.ts";

const [from = "2025-01-01", to = "2026-01-01"] = process.argv.slice(2);
const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable");

const client = new FinageClient(key, { maxRetries: 3, timeoutMs: 20_000 });

const fromMs = utcMillis(from);
const toMs = utcMillis(to);
validateInterval(fromMs, toMs);

const MAX_SPLIT_DEPTH = 8;
const chunks = planRanges({ start: fromMs, end: toMs });
const results = [];

async function fetchAdaptiveVerbose(range, depth = 0, parentIndex = null) {
  const rangeLabel = `[${new Date(range.start).toISOString().slice(0,16)}, ${new Date(range.end).toISOString().slice(0,16)})`;
  const rangeDays = ((range.end - range.start) / 86_400_000).toFixed(2);
  
  let chunk;
  let fetchError = null;
  const stats = { actualApiCalls: 0, retryCount: 0, providerRows: 0, normalizeMs: 0, invalidCandleCount: 0 };
  
  try {
    chunk = await client.fetchChunk(range, stats);
  } catch (err) {
    fetchError = err;
  }
  
  const record = {
    depth,
    parent: parentIndex,
    range: rangeLabel,
    rangeDays,
    start: range.start,
    end: range.end,
  };

  if (fetchError) {
    record.status = "ERROR";
    record.errorCode = fetchError instanceof ProviderError ? fetchError.code : "UNKNOWN";
    record.errorStatus = fetchError.status ?? null;
    record.apiCalls = stats.actualApiCalls;
    record.retries = stats.retryCount;
    
    // Check if this was a server error that should split
    if (fetchError instanceof ProviderError && fetchError.code === "HTTP" && 
        fetchError.status >= 500 && range.end - range.start > 86_400_000) {
      record.splitReason = "PROVIDER_SERVER_WINDOW";
      if (depth < MAX_SPLIT_DEPTH) {
        const halves = splitRange(range);
        if (halves) {
          record.status = "SPLIT_PSW";
          results.push(record);
          const idx = results.length - 1;
          await fetchAdaptiveVerbose(halves[0], depth + 1, idx);
          await fetchAdaptiveVerbose(halves[1], depth + 1, idx);
          return;
        }
      }
      record.status = "EXHAUSTED_PSW";
    } else if (fetchError instanceof ProviderError && fetchError.code === "RANGE") {
      record.splitReason = "PROVIDER_RANGE_REJECTION";
      if (depth < MAX_SPLIT_DEPTH) {
        const halves = splitRange(range);
        if (halves) {
          record.status = "SPLIT_RANGE";
          results.push(record);
          const idx = results.length - 1;
          await fetchAdaptiveVerbose(halves[0], depth + 1, idx);
          await fetchAdaptiveVerbose(halves[1], depth + 1, idx);
          return;
        }
      }
      record.status = "EXHAUSTED_RANGE";
    } else {
      record.status = "TERMINAL_ERROR";
    }
    results.push(record);
    return;
  }
  
  // Fetch succeeded
  record.status = "OK";
  record.apiCalls = stats.actualApiCalls;
  record.retries = stats.retryCount;
  record.providerRows = stats.providerRows;
  record.resultRows = chunk.candles.length;
  record.truncationReason = chunk.truncationReason ?? null;
  record.invalidCount = stats.invalidCandleCount;
  record.firstTs = chunk.candles[0]?.timestamp ?? null;
  record.lastTs = chunk.candles[chunk.candles.length - 1]?.timestamp ?? null;
  
  // Check for truncation (limit hit or suspicious edge coverage)
  if (chunk.truncationReason) {
    if (depth < MAX_SPLIT_DEPTH) {
      const halves = splitRange(range);
      if (halves) {
        record.status = "SPLIT_" + chunk.truncationReason;
        results.push(record);
        const idx = results.length - 1;
        await fetchAdaptiveVerbose(halves[0], depth + 1, idx);
        await fetchAdaptiveVerbose(halves[1], depth + 1, idx);
        return;
      }
    }
    record.status = "EXHAUSTED_" + chunk.truncationReason;
    results.push(record);
    return;
  }
  
  // Success with no truncation
  if (record.invalidCount > 0) {
    record.status = "INVALID_CANDLES";
  }
  
  results.push(record);
}

console.error(`Starting chunk-level forensics for ${from} → ${to}`);
console.error(`Planned chunks: ${chunks.length}`);

for (let i = 0; i < chunks.length; i++) {
  console.error(`Processing chunk ${i+1}/${chunks.length}: ${new Date(chunks[i].start).toISOString().slice(0,10)} → ${new Date(chunks[i].end).toISOString().slice(0,10)}`);
  await fetchAdaptiveVerbose(chunks[i], 0, null);
}

// Summary
const terminalErrors = results.filter(r => r.status === "TERMINAL_ERROR" || r.status.startsWith("EXHAUSTED"));
const invalidCandles = results.filter(r => r.invalidCount > 0);
const successChunks = results.filter(r => r.status === "OK" || r.status === "INVALID_CANDLES");

console.log(JSON.stringify({
  from, to,
  plannedChunks: chunks.length,
  totalRecords: results.length,
  terminalErrors: terminalErrors.map(r => ({ depth: r.depth, range: r.range, status: r.status, errorCode: r.errorCode })),
  invalidCandleChunks: invalidCandles.map(r => ({ range: r.range, depth: r.depth, invalidCount: r.invalidCount })),
  deepSplits: results.filter(r => r.depth >= 4).map(r => ({ depth: r.depth, range: r.range, status: r.status, reason: r.truncationReason ?? r.splitReason ?? r.errorCode })),
  summary: {
    totalApiCalls: results.reduce((s, r) => s + (r.apiCalls ?? 0), 0),
    totalRetries: results.reduce((s, r) => s + (r.retries ?? 0), 0),
    totalProviderRows: results.reduce((s, r) => s + (r.providerRows ?? 0), 0),
    totalValidCandles: results.reduce((s, r) => s + (r.resultRows ?? 0), 0),
    totalInvalidCandles: results.reduce((s, r) => s + (r.invalidCount ?? 0), 0),
    splitsPSW: results.filter(r => r.status === "SPLIT_PSW").length,
    splitsSuspicious: results.filter(r => r.status === "SPLIT_SUSPICIOUS_EDGE_COVERAGE").length,
    splitsRange: results.filter(r => r.status === "SPLIT_RANGE").length,
    terminalErrorCount: terminalErrors.length,
    successCount: successChunks.length,
  }
}, null, 2));
