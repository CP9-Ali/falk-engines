const fs = require('fs');
const path = 'src/dashboard/public/app.js';
let src = fs.readFileSync(path, 'utf8');

const needle = "    const sens = !!r.sensitive_use_blocked;";
if (!src.includes(needle)) {
  console.log('  [ERR] needle not found');
  process.exit(1);
}

const repl = `    // If the report doesn't carry the flag, derive it from conflict_status (?8.1).
    const sens = typeof r.sensitive_use_blocked === 'boolean'
      ? r.sensitive_use_blocked
      : (r.conflict_status !== 'CONSISTENT' && r.conflict_status !== 'SKIPPED');`;

src = src.replace(needle, repl);
fs.writeFileSync(path, src, 'utf8');
console.log('  [OK] frontend derives sensitive_use_blocked when missing');
