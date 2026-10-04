const key = process.env.FINAGE_API_KEY;
if (!key) throw new Error("FINAGE_API_KEY is unavailable");
const ranges = [
  ["2026-03-02", "2026-03-03", false],
  ["2026-03-02", "2026-03-03", false],
  ["2026-03-02", "2026-03-03", true],
  ["2026-03-02", "2026-03-03", true],
  ["2026-03-02", "2026-03-14", false],
];
const target = Date.parse("2026-03-02T00:00:00Z");
const observations = [];
for (const [from, to, dailyFilter] of ranges) {
  const url = new URL(`https://api.finage.co.uk/agg/forex/XAUUSD/1/minute/${from}/${to}`);
  url.searchParams.set("apikey", key);
  url.searchParams.set("limit", "50000");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("date_format", "ts");
  if (dailyFilter) url.searchParams.set("dbt_filter", "true");
  const response = await fetch(url, { cache: "no-store" });
  let body;
  try { body = await response.json(); } catch { body = null; }
  const results = Array.isArray(body?.results) ? body.results : [];
  observations.push({ requestedPath: url.pathname, dailyFilter, httpStatus: response.status,
    symbol: body?.symbol ?? null, totalResults: body?.totalResults ?? null,
    resultsLength: results.length, firstTimestamp: results[0]?.t ?? null,
    lastTimestamp: results.at(-1)?.t ?? null,
    targetRow: results.find((row) => row?.t === target) ?? null });
}
console.log(JSON.stringify({ target, targetUtc: new Date(target).toISOString(), observations }, null, 2));
