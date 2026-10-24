const fs   = require('fs');
const path = require('path');
const ok   = (m) => console.log('  [OK]   ' + m);

// ?? 1) engine.ts : map conflictStatus literals only ?????????????
let eng = fs.readFileSync('src/data-fusion/engine.ts', 'utf8');
const engMap = {
  "'NONE'":                 "'CONSISTENT'",
  "'RESOLVED_BY_TOLERANCE'":"'CONSISTENT'",
  "'RESOLVED_BY_POLICY'":   "'CONSISTENT'",
  "'UNRESOLVED'":           "'UNRESOLVED_CONFLICT'",
  "'TIME_BLOCKED'":         "'INSUFFICIENT_COMPARABLE_DATA'",
};

// only lines where conflictStatus: 'X' or conflictStatus = 'X' or conflictStatus'] = 'X'
eng = eng.replace(
  /(\bconflictStatus\s*(?:['"]\])?\s*[:=]\s*)(['"][^'"]+['"])/g,
  (m, p, lit) => p + (engMap[lit] || lit),
);
fs.writeFileSync('src/data-fusion/engine.ts', eng);
ok('engine.ts conflictStatus literals mapped (reason strings untouched)');

// diagnostic: what reasons does engine emit?
const reasons = [...new Set((eng.match(/reason:\s*['"][^'"]+['"]/g) || []))];
console.log('  [DIAG] engine reason literals:', reasons.join(', ') || '(none)');

// ?? 2) appendix-b.ts ????????????????????????????????????????????
let ab = fs.readFileSync('src/scenarios/appendix-b.ts', 'utf8');
const abBefore = ab;
ab = ab.replace(/'\bUNRESOLVED\b'(?!_)/g, "'UNRESOLVED_CONFLICT'");
if (ab !== abBefore) { fs.writeFileSync('src/scenarios/appendix-b.ts', ab, 'utf8'); ok('appendix-b.ts fixed'); }
else                 { ok('appendix-b.ts had no legacy literal'); }

// ?? 3) Tests: revert blind reason-replacements ?????????????????
//     reason is descriptive, should stay 'TIME_BLOCKED'
const reasonFixes = [
  [/\.reason\)\.toBe\('INSUFFICIENT_COMPARABLE_DATA'\)/g, ".reason).toBe('TIME_BLOCKED')"],
  [/\.reason === 'INSUFFICIENT_COMPARABLE_DATA'/g,        ".reason === 'TIME_BLOCKED'"],
];
// ?? 4) Tests: update any conflictStatus comparisons ????????????
const testMap = {
  "'RESOLVED_BY_TOLERANCE'": "'CONSISTENT'",
  "'RESOLVED_BY_POLICY'":    "'CONSISTENT'",
  "'UNRESOLVED'":            "'UNRESOLVED_CONFLICT'",
  "'NONE'":                  "'CONSISTENT'",
};

for (const f of fs.readdirSync('src/tests')) {
  if (!f.endsWith('.ts')) continue;
  const p = path.join('src/tests', f);
  let t = fs.readFileSync(p, 'utf8');
  const before = t;

  for (const [re, repl] of reasonFixes) t = t.replace(re, repl);

  for (const [oldLit, newLit] of Object.entries(testMap)) {
    const escaped = oldLit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(conflictStatus[\\s\\S]{0,30}?)${escaped}`, 'g');
    t = t.replace(re, `$1${newLit}`);
  }

  if (t !== before) { fs.writeFileSync(p, t, 'utf8'); ok('patched ' + f); }
}

console.log('\nDONE.');
