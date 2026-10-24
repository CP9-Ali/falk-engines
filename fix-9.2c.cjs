const fs = require('fs');
const path = 'src/tests/backtest-execution.test.ts';
let src = fs.readFileSync(path, 'utf8');
const before = src;

// BUY exit: 2010 * 0.999 = 2007.99 (was incorrectly 2008.99)
src = src.replace(
  "expect(r.trades[0]!.exit_price).toBeCloseTo(2008.99, 2);",
  "expect(r.trades[0]!.exit_price).toBeCloseTo(2007.99, 2);"
);
// SELL exit: 1990 * 1.001 = 1991.99 (was incorrectly 1990.99)
src = src.replace(
  "expect(r.trades[0]!.exit_price).toBeCloseTo(1990.99, 2);",
  "expect(r.trades[0]!.exit_price).toBeCloseTo(1991.99, 2);"
);

if (src === before) {
  console.log('  [ERR] patterns not matched');
  process.exit(1);
}
fs.writeFileSync(path, src, 'utf8');
console.log('  [OK] corrected expected exit prices: 2007.99 (BUY), 1991.99 (SELL)');
