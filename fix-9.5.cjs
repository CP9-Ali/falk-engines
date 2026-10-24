const fs = require('fs');
const path = 'package.json';
let raw = fs.readFileSync(path, 'utf8');
const before = raw.length;

// Remove trailing literal "\n" (backslash + n as two characters) if present.
raw = raw.replace(/\\n\s*$/, '');

// Trim trailing whitespace, then ensure a proper newline + parse check
raw = raw.trimEnd() + '\n';

// Verify JSON parses
try { JSON.parse(raw); } catch (e) {
  console.log('  [ERR] package.json still invalid: ' + e.message);
  console.log('  --- first 200 chars ---');
  console.log(raw.slice(0, 200));
  process.exit(1);
}

// Ensure scripts.backtest exists
const pkg = JSON.parse(raw);
if (!pkg.scripts) pkg.scripts = {};
if (!pkg.scripts.backtest) {
  pkg.scripts.backtest = 'npx tsx src/backtest/cli-entry.ts';
  console.log('  [OK] re-added scripts.backtest');
} else {
  console.log('  [OK] scripts.backtest already present: ' + pkg.scripts.backtest);
}

fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('  [OK] package.json rewritten cleanly (' + before + ' -> ' + raw.length + ' chars)');
