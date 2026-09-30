// Late — a "perfect commuter" that plays the real rules. It asks the solver
// for the best route from wherever it stands and presses the same keys a
// player would. Tests use it to prove the winnable check is honest (the
// route the generator promised can actually be walked in the simulation),
// the game uses it for the "best route" ghost, and the headless playtest
// uses it to play a day in the browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rules.js'), require('./solver.js'), require('./day.js'), require('./sim.js'));
  } else {
    const L = (root.Late = root.Late || {});
    L.autopilot = factory(L.rules, L.solver, L.day, L.sim);
  }
})(typeof self !== 'undefined' ? self : this, function (R, SOLVER, DAY, SIM) {
  'use strict';

  const { KEY } = SIM;
  const EPS = 0.2;

  /**
   * @param day
   * @param sim     createSim(day) instance to drive
   * @param opts.checkWait  what the planner assumes at checkpoints ('max' | 'mean')
   */
  function createAutopilot(day, sim, opts = {}) {
    const graph = DAY.graphOf(day);
    const office = SOLVER.nodeAt(graph, day.office.station, 0, day.office.x);
    let plan = [];
    let idx = 0;
    let lastProgressTick = 0;
    let lastKey = '';
    let lastMode = 'walk';
    let replans = 0;
    const decide = (opts.reaction && opts.reaction.decide) || 0;
    let hesitating = -1;
    let hesitateUntil = 0;

    function replan() {
      const s = sim.state;
      const res = SOLVER.solve(day, graph, -1, s.t, {
        startPos: { st: s.st, seg: s.seg, x: s.x, lane: s.lane },
        target: office,
        checkWait: opts.checkWait || 'max',
        reaction: opts.reaction || null,
      });
      const hops = SOLVER.pathTo(res, office);
      plan = hops ? SOLVER.stepsOf(day, graph, hops) : [];
      idx = 0;
      hesitating = -1;
      replans += 1;
      return res.best[office];
    }

    const linkOf = (st, id) => day.interiors[day.network.stations[st].id].links[id];

    /** Key mask for this tick. */
    function input() {
      const s = sim.state;
      if (s.done) return 0;
      const key = `${s.mode}|${s.st}|${s.seg}|${Math.round(s.x * 4)}|${s.lane}|${idx}`;
      if (key !== lastKey) {
        lastKey = key;
        lastProgressTick = s.tick;
      }
      if (s.mode === 'train') {
        const step = plan[idx];
        if (!step || step.type !== 'ride') return 0;
        // walk through the carriages to the door the plan gets off at
        const want = R.RULES.DOORS[step.doorOut ?? step.door];
        const dx = want - s.ride.pos;
        if (Math.abs(dx) > EPS) return dx > 0 ? KEY.RIGHT : KEY.LEFT;
        if (s.ride.at === step.to && !(s.prev & KEY.ACT)) {
          idx += 1;
          return KEY.ACT;
        }
        return 0;
      }
      const arrived = s.mode === 'walk' && lastMode !== 'walk';
      lastMode = s.mode;
      if (s.mode !== 'walk') return 0;
      // re-plan whenever a leg ends: actual queue waits are often shorter than the worst case
      if (!plan.length || arrived || s.tick - lastProgressTick > 2400) replan();
      for (let guard = 0; guard < 8 && idx < plan.length; guard++) {
        const step = plan[idx];
        if (step.type === 'walk') {
          if (step.st !== s.st || step.seg !== s.seg) {
            replan();
            continue;
          }
          if (step.lane !== s.lane) return step.lane === 1 ? KEY.UP : KEY.DOWN;
          const dx = step.x - s.x;
          if (Math.abs(dx) > EPS) return dx > 0 ? KEY.RIGHT : KEY.LEFT;
          idx += 1;
          continue;
        }
        if (step.type === 'lane') {
          if (s.lane !== step.lane) return step.lane === 1 ? KEY.UP : KEY.DOWN;
          idx += 1;
          continue;
        }
        if (step.type === 'link') {
          const L = linkOf(step.st, step.link);
          const from = step.way === 'ab' ? L.a : L.b;
          const to = step.way === 'ab' ? L.b : L.a;
          if (s.st === step.st && s.seg === to.seg && Math.abs(s.x - to.x) < 0.5 && s.seg !== from.seg) {
            idx += 1; // already through (joints are instant)
            continue;
          }
          if (s.st !== step.st || s.seg !== from.seg) {
            replan();
            continue;
          }
          // a hesitant (human-like) commuter stops to read the signs before every link
          if (decide > 0) {
            if (hesitating !== idx) {
              hesitating = idx;
              hesitateUntil = s.t + decide;
            }
            if (s.t < hesitateUntil - 1e-9) return 0;
          }
          if (L.axis === 'h') return step.way === 'ab' ? KEY.RIGHT : KEY.LEFT;
          if (Math.abs(s.x - from.x) > R.RULES.REACH * 0.8) return s.x < from.x ? KEY.RIGHT : KEY.LEFT;
          // escalator running the wrong way right now: wait for it
          if (L.kind === 'escalator' && R.escalatorDir(L.esc, s.t) !== (step.way === 'ab' ? 1 : -1)) return 0;
          idx += 1;
          return step.way === 'ab' ? KEY.DOWN : KEY.UP;
        }
        if (step.type === 'ride') {
          // stand at the door holding the key: boards the first train that opens here
          return step.side === 'far' ? KEY.UP : KEY.DOWN;
        }
      }
      if (idx >= plan.length) replan();
      return 0;
    }

    /** Run the sim to the end. Returns the final state. */
    function run(maxTicks = SIM.MAX_TICKS) {
      replan();
      while (!sim.state.done && sim.state.tick < maxTicks) sim.step(input());
      return sim.state;
    }

    return {
      input,
      run,
      replan,
      get plan() {
        return plan;
      },
      get replans() {
        return replans;
      },
    };
  }

  /** Convenience: play a whole day perfectly and return the sim state. */
  function playDay(day, opts) {
    const sim = SIM.createSim(day);
    const ap = createAutopilot(day, sim, opts);
    const state = ap.run();
    state.replans = ap.replans;
    return state;
  }

  return { createAutopilot, playDay };
});
