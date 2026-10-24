const fs = require('fs');
const path = 'src/backtest/execution.ts';
let src = fs.readFileSync(path, 'utf8');
const before = src;

src = src.replace('open_position_at_end,', 'openPosition_at_end,');

if (src === before) {
  console.log('  [ERR] pattern not matched');
  process.exit(1);
}
fs.writeFileSync(path, src, 'utf8');
console.log('  [OK] typo fixed: open_position_at_end -> openPosition_at_end');
