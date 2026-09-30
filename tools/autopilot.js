// Headless dive through the maze: tie the reel in at the pool, swim the
// shortest route to the end chamber laying line, tie off, then follow the line
// home. Checks that the gas budget and the turn-pressure guarantee hold up in
// the simulation.
// Usage: node tools/autopilot.js [dives=30] [maxLevel=9]
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'rng.js'));
const Gen = require(path.join(__dirname, '..', 'src', 'gen.js'));
const { Game } = require(path.join(__dirname, '..', 'src', 'game.js'));

function run(seed, level, opts) {
  const d = Gen.generate(seed, level);
  const g = new Game(d, 'none');
  g.diver.x = d.anchor.x; g.diver.y = d.anchor.y;
  g.toggleReel();
  const dt = 1 / 60, route = d.route;
  let j = 0, phase = 'in', turnGas = null, lastJ = 0, lastProgress = 0;
  for (let k = 0; k < 60 * 1500 && !g.done; k++) {
    let x = 0, y = 0, hold = false;
    if (phase === 'in') {
      while (j < route.length - 1 && Math.hypot(route[j].x - g.diver.x, route[j].y - g.diver.y) < 1.5) j++;
      if (j > lastJ) { lastJ = j; lastProgress = k; }
      // Aim a little ahead; if progress stalls, aim straight at the next waypoint.
      const t = route[Math.min(j + (k - lastProgress > 60 ? 0 : 3), route.length - 1)];
      const dx = t.x - g.diver.x, dy = t.y - g.diver.y, l = Math.hypot(dx, dy) || 1;
      x = dx / l; y = dy / l;
      if (g.goalTagged) phase = 'linger';
    }
    if (phase === 'linger') {
      if (!opts.waitForTurn || g.gas <= d.budget.turn) {
        if (g.reel.active !== null) g.toggleReel();
        phase = 'out'; turnGas = g.gas;
      }
    }
    if (phase === 'out') {
      hold = true;
      if (g.hold) {
        const tan = g.lineTangent(g.lines[g.hold.line], g.hold.s);
        x = -tan.x; y = -tan.y;
      }
      // Worst case: the whole cave silted out from the moment the diver turns.
      if (opts.blind) g.silt.fill(3);
    }
    g.update(dt, { x, y, hold, hard: !!opts.hard && phase === 'in' });
  }
  return { g, d, turnGas };
}

const dives = Number(process.argv[2] || 30), maxLevel = Number(process.argv[3] || 9);
const modes = [
  ['normal kick, in to the end chamber and straight back', {}],
  ['kicking hard all the way in', { hard: true }],
  ['lingering at the end until turn pressure, then zero visibility all the way out', { waitForTurn: true, blind: true }],
];
for (const [label, opts] of modes) {
  console.log(`\n${label}: level | got home | end tagged | gas at turn (mean) | gas left (mean/min) | line laid m (mean) | zero-vis s (mean)`);
  for (let L = 0; L <= maxLevel; L += 3) {
    const res = [];
    for (let s = 0; s < dives; s++) res.push(run('A' + s, L, opts));
    const exits = res.filter((r) => r.g.done && r.g.done.outcome === 'exit');
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    console.log([L, `${exits.length}/${dives}`, res.filter((r) => r.g.goalTagged).length,
      mean(res.map((r) => r.turnGas || 0)).toFixed(0),
      `${mean(exits.map((r) => r.g.gas)).toFixed(0)}/${Math.min(...exits.map((r) => r.g.gas)).toFixed(0)}`,
      mean(res.map((r) => r.g.laidMetres())).toFixed(0),
      mean(res.map((r) => r.g.zeroVisTime)).toFixed(0)].join(' | '));
  }
}
