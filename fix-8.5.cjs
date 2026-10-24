const fs = require('fs');
const path = 'src/data-fusion/enrich.ts';
let src = fs.readFileSync(path, 'utf8');
const before = src;

const needle = '      deltas = representatives.length >= 2 ? computePairwiseDeltas(representatives) : [];';
if (!src.includes(needle)) {
  console.log('  [ERR] needle not found');
  process.exit(1);
}

const replacement = `      // ?8.5 fix ? order representatives by priority before emitting deltas.
      representatives.sort((a, b) => {
        const ia = priorityIndex.get(a.sourceId);
        const ib = priorityIndex.get(b.sourceId);
        if (ia !== undefined && ib !== undefined) return ia - ib;
        if (ia !== undefined) return -1;
        if (ib !== undefined) return 1;
        return 0;
      });

      deltas = representatives.length >= 2 ? computePairwiseDeltas(representatives) : [];`;

src = src.replace(needle, replacement);
fs.writeFileSync(path, src, 'utf8');
console.log('  [OK] representatives now sorted by priorityByField before deltas');
