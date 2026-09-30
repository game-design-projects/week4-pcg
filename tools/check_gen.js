// Run the generator over many seeds and levels and report how often the
// fairness check rejects a cave, why, and what the accepted caves look like.
// Usage: node tools/check_gen.js [seedsPerLevel=200] [maxLevel=9]
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'rng.js'));
const Gen = require(path.join(__dirname, '..', 'src', 'gen.js'));

const perLevel = Number(process.argv[2] || 200);
const maxLevel = Number(process.argv[3] || 9);

// Determinism: the same seed and level must give the same cave.
const a = Gen.generate('DETERMINISM', 4), b = Gen.generate('DETERMINISM', 4);
let same = a.W === b.W && a.attempts === b.attempts && a.open.length === b.open.length;
for (let i = 0; same && i < a.open.length; i++) if (a.open[i] !== b.open[i] || a.deposit[i] !== b.deposit[i]) same = false;
console.log('deterministic:', same ? 'yes' : 'NO');

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
console.log('\nlevel | first-try pass | attempts (mean/max) | line m | penetration m | max depth m | tight m | leads | lined | gas to goal | ms');
const reasons = {};
for (let L = 0; L <= maxLevel; L++) {
  const rows = [];
  let failed = 0;
  const t0 = Date.now();
  for (let s = 0; s < perLevel; s++) {
    try {
      const d = Gen.generate('S' + s, L);
      rows.push(d);
      for (const r of d.rejected) reasons[r] = (reasons[r] || 0) + 1;
    } catch (e) {
      failed++;
    }
  }
  const ms = (Date.now() - t0) / perLevel;
  const m = (f) => mean(rows.map((d) => d.measures[f])).toFixed(0);
  console.log([
    L,
    `${((rows.filter((d) => d.attempts === 1).length / perLevel) * 100).toFixed(0)}%`,
    `${mean(rows.map((d) => d.attempts)).toFixed(2)}/${Math.max(...rows.map((d) => d.attempts))}`,
    m('lineLength'), m('penetration'), m('maxDepth'), m('tightMetres'), m('branches'), m('linedBranches'), m('gasToGoal'),
    ms.toFixed(0) + (failed ? ` (${failed} gave up)` : ''),
  ].join(' | '));
}
console.log('\nrejection reasons:', reasons);
