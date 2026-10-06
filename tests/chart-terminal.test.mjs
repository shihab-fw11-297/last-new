import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  toChartTime,
  isValidChartCandle,
  transformCandlesForChart,
} from "../lib/traderbrain/ui/chart-adapter.ts";

test("client chart-view and terminal contain no Finage endpoint or process.env access", async () => {
  const chartSource = await readFile(new URL("../app/chart-view.tsx", import.meta.url), "utf8");
  const terminalSource = await readFile(new URL("../app/terminal.tsx", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  const loadingSource = await readFile(new URL("../app/loading.tsx", import.meta.url), "utf8");

  for (const source of [chartSource, terminalSource, pageSource, loadingSource]) {
    assert.doesNotMatch(source, /FINAGE_API_KEY|api\.finage\.co\.uk|process\.env/);
  }
});

test("chart view uses lightweight-charts createChart, autoSize, and shows loading/error states", async () => {
  const chartSource = await readFile(new URL("../app/chart-view.tsx", import.meta.url), "utf8");
  assert.match(chartSource, /createChart/);
  assert.match(chartSource, /CandlestickSeries/);
  assert.match(chartSource, /autoSize:\s*true/);
  assert.match(chartSource, /subscribeCrosshairMove/);
  assert.match(chartSource, /Fetching Market Data/);
  assert.match(chartSource, /Backend Request Failed/);
  assert.match(chartSource, /\[CHART_RENDER_DIAGNOSTIC\]/);
});

test("terminal renders header, chart container, opportunity radar, and signal strip with loading hooks", async () => {
  const terminalSource = await readFile(new URL("../app/terminal.tsx", import.meta.url), "utf8");
  assert.match(terminalSource, /TraderBrain/);
  assert.match(terminalSource, /Opportunity Radar/);
  assert.match(terminalSource, /LATEST SIGNAL/);
  assert.match(terminalSource, /terminal-fullscreen/);
  assert.match(terminalSource, /FETCHING DATA\.\.\./);
});

test("toChartTime converts Unix ms to UTC seconds exactly once and preserves seconds", () => {
  const msTimestamp = Date.parse("2026-09-28T00:00:00Z"); // 1790553600000
  const chartTime = toChartTime(msTimestamp);
  assert.equal(chartTime, 1790553600);
  assert.equal(new Date(chartTime * 1000).toISOString(), "2026-09-28T00:00:00.000Z");

  // Does not divide an already-seconds timestamp again
  const alreadySeconds = 1790553600;
  assert.equal(toChartTime(alreadySeconds), 1790553600);
});

test("isValidChartCandle validates OHLC constraints and finite numbers", () => {
  const valid = { timestamp: 1790553600000, open: 2600, high: 2605, low: 2595, close: 2602, complete: true };
  assert.equal(isValidChartCandle(valid), true);

  // High lower than open/close
  assert.equal(isValidChartCandle({ ...valid, high: 2599 }), false);
  // Low higher than open/close
  assert.equal(isValidChartCandle({ ...valid, low: 2603 }), false);
  // Non-finite values
  assert.equal(isValidChartCandle({ ...valid, close: NaN }), false);
  assert.equal(isValidChartCandle({ ...valid, open: Infinity }), false);
  assert.equal(isValidChartCandle({ ...valid, timestamp: undefined }), false);
});

test("transformCandlesForChart produces strictly ascending unique timestamps and counts defects", () => {
  const START = Date.parse("2026-09-28T00:00:00Z");
  const rawCandles = [
    { timestamp: START, open: 100, high: 105, low: 95, close: 102, complete: true },
    { timestamp: START + 60000, open: 102, high: 106, low: 101, close: 105, complete: true },
    // Duplicate timestamp:
    { timestamp: START + 60000, open: 102, high: 106, low: 101, close: 105, complete: true },
    // Out of order:
    { timestamp: START - 60000, open: 98, high: 101, low: 97, close: 100, complete: true },
    // Malformed:
    { timestamp: START + 120000, open: 105, high: 100, low: 110, close: 102, complete: true },
  ];

  const result = transformCandlesForChart(rawCandles);
  assert.equal(result.duplicateTimeCount, 1);
  assert.equal(result.outOfOrderCount, 1);
  assert.equal(result.malformedCount, 1);
  assert.equal(result.chartData.length, 3);

  // Check strictly ascending order
  for (let i = 1; i < result.chartData.length; i++) {
    assert.ok(Number(result.chartData[i].time) > Number(result.chartData[i - 1].time));
  }
});
