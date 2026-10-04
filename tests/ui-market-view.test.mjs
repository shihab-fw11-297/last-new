import assert from "node:assert/strict";
import test from "node:test";

import { chartAsOfTimestamp } from "../lib/traderbrain/ui/as-of.ts";

const MINUTE_MS = 60_000;

test("historical chart selections stop replay at the selected candle close", () => {
  const chartTimestamp = Date.UTC(2026, 2, 2, 10, 0);
  const lastSourceTimestamp = Date.UTC(2026, 2, 2, 12, 0);

  assert.equal(chartAsOfTimestamp("1m", chartTimestamp, lastSourceTimestamp), chartTimestamp);
  assert.equal(
    chartAsOfTimestamp("5m", chartTimestamp, lastSourceTimestamp),
    chartTimestamp + 4 * MINUTE_MS,
  );
  assert.equal(
    chartAsOfTimestamp("15m", chartTimestamp, lastSourceTimestamp),
    chartTimestamp + 14 * MINUTE_MS,
  );
  assert.equal(
    chartAsOfTimestamp("1h", chartTimestamp, lastSourceTimestamp),
    chartTimestamp + 59 * MINUTE_MS,
  );
});

test("the selected bucket close cannot move replay beyond available source data", () => {
  const chartTimestamp = Date.UTC(2026, 2, 2, 10, 0);
  const lastSourceTimestamp = chartTimestamp + 7 * MINUTE_MS;

  assert.equal(
    chartAsOfTimestamp("1h", chartTimestamp, lastSourceTimestamp),
    lastSourceTimestamp,
  );
});

test("unsafe chart timestamps are rejected", () => {
  assert.throws(
    () => chartAsOfTimestamp("1m", Number.POSITIVE_INFINITY, 1),
    /safe integers/,
  );
});
