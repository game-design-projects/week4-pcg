// Headless dive through the maze: swim to the post, tie the reel in, follow
// the shortest route to the end chamber laying line, tie off, then follow the
// line home. Checks that the gas budget and the turn-pressure guarantee hold
// up in the simulation, and that each dive replays exactly from its inputs.
// Usage: node tools/autopilot.js [dives=30] [maxLevel=9]
'use strict';
const path = require('path');
const { Game } = require(path.join(__dirname, '..', 'src', 'game.js'));
const { run } = require('./pilot.js');

const dives = Number(process.argv[2] || 30), maxLevel = Number(process.argv[3] || 9);
const modes = [
  ['normal kick, in to the end chamber and straight back', {}],
  ['kicking hard all the way in', { hard: true }],
  ['lingering at the end until turn pressure, then zero visibility all the way out', { waitForTurn: true, blind: true }],
];
let replays = 0, mismatches = 0;
for (const [label, opts] of modes) {
  console.log(`\n${label}: level | got home | end tagged | gas at turn (mean) | gas left (mean/min) | line laid m (mean) | zero-vis s (mean)`);
  for (let L = 0; L <= maxLevel; L += 3) {
    const res = [];
    for (let s = 0; s < dives; s++) {
      const r = run('A' + s, L, opts);
      res.push(r);
      if (!opts.blind) {
        const p = Game.replay(r.d, r.g.inputs);
        replays++;
        if (p.tick !== r.g.tick || p.gas !== r.g.gas || p.done.outcome !== r.g.done.outcome) mismatches++;
      }
    }
    const exits = res.filter((r) => r.g.done && r.g.done.outcome === 'exit');
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    console.log([L, `${exits.length}/${dives}`, res.filter((r) => r.g.goalTagged).length,
      mean(res.map((r) => r.turnGas || 0)).toFixed(0),
      `${mean(exits.map((r) => r.g.gas)).toFixed(0)}/${Math.min(...exits.map((r) => r.g.gas)).toFixed(0)}`,
      mean(res.map((r) => r.g.laidMetres())).toFixed(0),
      mean(res.map((r) => r.g.zeroVisTime)).toFixed(0)].join(' | '));
  }
}
console.log(`\nreplayed from recorded inputs: ${replays - mismatches}/${replays} identical`);
