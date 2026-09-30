// Headless dive: follow the main line to the goal and back at a normal kick.
// Checks that the gas budget from the generator holds up in the simulation.
// Usage: node tools/autopilot.js [dives=30] [maxLevel=9]
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'rng.js'));
const Gen = require(path.join(__dirname, '..', 'src', 'gen.js'));
const { Game } = require(path.join(__dirname, '..', 'src', 'game.js'));

function run(seed, level, opts) {
  const d = Gen.generate(seed, level);
  const g = new Game(d, 'none');
  const line = d.lines[0];
  g.diver.x = line.pts[0].x; g.diver.y = line.pts[0].y;
  const dt = 1 / 60;
  let dir = 1, turnGas = null;
  for (let k = 0; k < 60 * 900 && !g.done; k++) {
    let x = 0, y = 0;
    if (g.hold) {
      const tan = g.lineTangent(g.d.lines[g.hold.line], g.hold.s);
      x = tan.x * dir; y = tan.y * dir;
      if (dir > 0 && g.goalTagged) {
        if (opts.waitForTurn && g.gas > d.budget.turn) { x = 0; y = 0; }   // linger at the end
        else { dir = -1; turnGas = g.gas; }
      }
      if (dir < 0 && g.hold.s <= 0.01) { g.hold = null; x = -1; y = -1; }
    } else if (dir < 0) { x = -1; y = -0.3; }
    g.update(dt, { x, y, hold: dir > 0 || g.hold !== null || g.t < 1, hard: !!opts.hard });
    // Worst case: the whole cave silted out from the moment the diver turns.
    if (opts.blind && dir < 0) g.silt.fill(3);
  }
  return { g, d, turnGas };
}

const dives = Number(process.argv[2] || 30), maxLevel = Number(process.argv[3] || 9);
const modes = [
  ['normal kick', {}],
  ['HARD kicking the whole way', { hard: true }],
  ['linger at the end until turn pressure, then zero visibility all the way out', { waitForTurn: true, blind: true }],
];
for (const [label, opts] of modes) {
  console.log(`\n${label}: level | exits | goal | gas at turn (mean) | gas left (mean/min) | zero-vis s (mean)`);
  for (let L = 0; L <= maxLevel; L += 3) {
    const res = [];
    for (let s = 0; s < dives; s++) res.push(run('A' + s, L, opts));
    const exits = res.filter((r) => r.g.done && r.g.done.outcome === 'exit');
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    console.log([L, `${exits.length}/${dives}`, res.filter((r) => r.g.goalTagged).length,
      mean(res.map((r) => r.turnGas || 0)).toFixed(0),
      `${mean(exits.map((r) => r.g.gas)).toFixed(0)}/${Math.min(...exits.map((r) => r.g.gas)).toFixed(0)}`,
      mean(res.map((r) => r.g.zeroVisTime)).toFixed(0)].join(' | '));
  }
}
