const fs = require('fs');
const path = 'src/data-fusion/independence.ts';
let src = fs.readFileSync(path, 'utf8');
const before = src;

src = src.replace(
  /export function independentPairCount[\s\S]*?\n}\n/,
  `export function independentPairCount(groups: ReadonlyArray<IndependenceGroup>): number {
  const n = groups.length;
  if (n < 2) return 0;
  return (n * (n - 1)) / 2;
}
`
);

if (src === before) {
  console.log('  [ERR] pattern not matched ? inspect file manually');
  process.exit(1);
}
fs.writeFileSync(path, src, 'utf8');
console.log('  [OK] independentPairCount guarded against -0');
