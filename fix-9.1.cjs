const fs = require('fs');
const path = 'src/tests/backtest-event-loop.test.ts';
let src = fs.readFileSync(path, 'utf8');
const before = src;

src = src.replace(
  "mkCandle('2026-01-01T23:00:00Z', 100),",
  "mkCandle('2026-01-01T23:30:00Z', 100),"
);

if (src === before) {
  console.log('  [ERR] pattern not matched');
  process.exit(1);
}
fs.writeFileSync(path, src, 'utf8');
console.log('  [OK] fixed skipped_not_final test to 23:30 (closes 00:30 > configTo)');
