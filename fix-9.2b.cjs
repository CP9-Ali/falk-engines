const fs = require('fs');
const path = 'src/backtest/execution.ts';
let src = fs.readFileSync(path, 'utf8');
const before = src;

// Only the return-object key (trailing comma) matches this ? declaration has '=' and assignment has '= true;'
src = src.replace('openPosition_at_end,', 'open_position_at_end: openPosition_at_end,');

if (src === before) {
  console.log('  [ERR] pattern not matched');
  process.exit(1);
}
fs.writeFileSync(path, src, 'utf8');
console.log('  [OK] return object now maps snake_case key -> camelCase variable');
