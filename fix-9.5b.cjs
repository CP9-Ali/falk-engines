const fs = require('fs');
const path = 'src/tests/backtest-cli.test.ts';
let src = fs.readFileSync(path, 'utf8');
const before = src;

// Replace the flat-uptrend data with: 30 flat @ 100 ? 30 rising +2
// In flat phase: fast == slow == 100
// At first rising bar: fast > slow ? genuine cross up ? OPEN_LONG fires
const oldBlock = `  // Uptrend: 100 ? 200 (60 hourly candles) so SMA20 crosses SMA50 quickly.
  const candles = [];
  for (let i = 0; i < 60; i++) {
    const iso = new Date(Date.UTC(2026, 0, 1, i)).toISOString();
    candles.push(mkCandle(iso, 100 + i * 2));
  }`;

const newBlock = `  // 30 flat candles @ 100 (SMA5 == SMA10 == 100), then 30 rising +2/bar.
  // The transition produces a genuine SMA5 > SMA10 cross ? OPEN_LONG fires.
  const candles = [];
  for (let i = 0; i < 30; i++) {
    const iso = new Date(Date.UTC(2026, 0, 1, i)).toISOString();
    candles.push(mkCandle(iso, 100));
  }
  for (let i = 0; i < 30; i++) {
    const iso = new Date(Date.UTC(2026, 0, 2, i)).toISOString();
    candles.push(mkCandle(iso, 100 + (i + 1) * 2));
  }`;

if (src === before) { console.log('  [ERR] block not matched'); process.exit(1); }
src = src.replace(oldBlock, newBlock);

if (src === before) { console.log('  [ERR] block not matched'); process.exit(1); }
fs.writeFileSync(path, src, 'utf8');
console.log('  [OK] test data: 30 flat + 30 rising (real SMA cross at transition)');
