// A scripted diver that plays through the game's own input path, so every
// dive it makes can be replayed from its recorded inputs. Used by
// tools/autopilot.js and by the tests to produce real winning dives.
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'rng.js'));
const Gen = require(path.join(__dirname, '..', 'src', 'gen.js'));
const { Game, STEP } = require(path.join(__dirname, '..', 'src', 'game.js'));

const hyp = (x, y) => Math.sqrt(x * x + y * y);

// Swim from the surface to the post, tie in (R), follow the shortest route to
// the end chamber laying line, tie off (R), then hold the line and follow it home.
// opts: hard (kick hard on the way in), waitForTurn (linger at the end until
// turn pressure), blind (silt the whole cave out after turning; not replayable).
function run(seed, level, opts, dive) {
  opts = opts || {};
  const d = dive || Gen.generate(seed, level);
  const g = new Game(d, 'none');
  const route = d.route;
  let j = 0, phase = 'anchor', turnGas = null, lastJ = 0, lastProgress = 0;
  for (let k = 0; k < 60 * 1500 && !g.done; k++) {
    let x = 0, y = 0, hold = false, reel = false;
    if (phase === 'anchor') {
      const dx = d.anchor.x - g.diver.x, dy = d.anchor.y - g.diver.y, l = hyp(dx, dy);
      if (l < 1.2) { reel = true; phase = 'in'; lastProgress = k; }
      else { x = dx / l; y = dy / l; }
    } else if (phase === 'in') {
      while (j < route.length - 1 && hyp(route[j].x - g.diver.x, route[j].y - g.diver.y) < 1.5) j++;
      if (j > lastJ) { lastJ = j; lastProgress = k; }
      // Aim a little ahead; if progress stalls, aim straight at the next waypoint.
      const t = route[Math.min(j + (k - lastProgress > 60 ? 0 : 3), route.length - 1)];
      const dx = t.x - g.diver.x, dy = t.y - g.diver.y, l = hyp(dx, dy) || 1;
      x = dx / l; y = dy / l;
      if (g.goalTagged) phase = 'linger';
    }
    if (phase === 'linger' && (!opts.waitForTurn || g.gas <= d.budget.turn)) {
      phase = 'out'; turnGas = g.gas;
      if (g.reel.active !== null) reel = true;
    } else if (phase === 'out') {
      hold = true;
      if (g.hold) {
        const tan = g.lineTangent(g.lines[g.hold.line], g.hold.s);
        x = -tan.x; y = -tan.y;
      }
      // Worst case: the whole cave silted out from the moment the diver turns.
      if (opts.blind) g.fillSilt(3);
    }
    g.update(STEP, { x, y, hold, reel, hard: !!opts.hard && phase === 'in' });
  }
  return { g, d, turnGas };
}

module.exports = { run };
