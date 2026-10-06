const res = await fetch('http://localhost:3000/?tf=1m&from=2026-09-28&to=2026-10-04');
const html = await res.text();

const start = html.indexOf('\\"candles\\":[');
if (start !== -1) {
  const end = html.indexOf('],\\"overlays\\"', start);
  const jsonStr = html.slice(start + 11, end + 1).replace(/\\"/g, '"');
  const candles = JSON.parse(jsonStr);
  console.log('Candles count:', candles.length);
  console.log('First candle:', candles[0]);
  console.log('Last candle:', candles[candles.length - 1]);

  let invalid = 0, outOfOrder = 0, duplicates = 0, prevTime = -1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const timeSec = Math.floor(c.timestamp / 1000);
    if (c.high < c.low || c.high < c.open || c.high < c.close || c.low > c.open || c.low > c.close) {
      invalid++;
    }
    if (timeSec < prevTime) outOfOrder++;
    else if (timeSec === prevTime) duplicates++;
    prevTime = timeSec;
  }
  console.log('Invalid:', invalid, 'OutOfOrder:', outOfOrder, 'Duplicates:', duplicates);
}
