// Late — reading a commute against the deadline map. For any moment of a
// play (standing on a floor, halfway up the stairs, queueing, riding a train)
// we can say how many seconds the player still has in hand: how late they
// could be there and still clock in by 09:00 playing perfectly from now on.
// The game shows it live on easy days, and after a late day it finds the
// moment the day was lost.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rules.js'), require('./timetable.js'), require('./solver.js'), require('./day.js'), require('./sim.js'));
  } else {
    const L = (root.Late = root.Late || {});
    L.analysis = factory(L.rules, L.timetable, L.solver, L.day, L.sim);
  }
})(typeof self !== 'undefined' ? self : this, function (R, TT, SOLVER, DAY, SIM) {
  'use strict';

  const { RULES, walkSpeed, lanesOf, linkBaseTime } = R;

  /** Deadline map for display: a perfect player with typical (mean) queue times. */
  function deadlineMap(day, opts = {}) {
    const graph = DAY.graphOf(day);
    const { office } = DAY.endNodes(day, graph);
    const LD = SOLVER.latestDepartures(day, graph, office, RULES.CLOCK_IN, { checkWait: opts.checkWait || 'mean' });
    return { graph, LD };
  }

  /** Latest time you could be at (seg, x, lane) of station st and still make it. */
  function ldAtPosition(day, dm, st, segId, x, lane) {
    const I = day.interiors[day.network.stations[st].id];
    const seg = I.segs[segId];
    const ln = Math.min(lane || 0, lanesOf(seg) - 1);
    const ids = dm.graph.segNodes[st][segId][ln];
    let best = -Infinity;
    for (const id of ids) {
      const n = dm.graph.nodes[id];
      const dir = n.x > x ? 1 : n.x < x ? -1 : 0;
      if (dir === 0) {
        best = Math.max(best, dm.LD[id]);
        continue;
      }
      const v = walkSpeed(seg, ln, dir);
      if (v <= 0) continue;
      best = Math.max(best, dm.LD[id] - Math.abs(n.x - x) / v);
    }
    return best;
  }

  /** Seconds in hand right now (negative: the day is already lost). */
  function budget(day, dm, s) {
    const t = s.t;
    if (s.done) return s.result && s.result.arrival !== null ? RULES.CLOCK_IN - s.result.arrival : -Infinity;
    const I = day.interiors[day.network.stations[s.st].id];
    if (s.mode === 'train' && s.ride) {
      const sv = day.timetable.services[s.ride.service];
      let bestB = -Infinity;
      for (let m = s.ride.from + 1; m < sv.stops.length; m++) {
        const arr = TT.arrAt(sv, s.ride.trip, m);
        if (arr + RULES.ALIGHT < t) continue;
        for (let d2 = 0; d2 < RULES.DOORS.length; d2++) {
          const walk = Math.abs(RULES.DOORS[d2] - s.ride.pos) / RULES.CAR_WALK;
          if (walk > Math.max(0, arr - t)) continue;
          const node = dm.graph.alightNode(sv, m, d2);
          bestB = Math.max(bestB, dm.LD[node] - (arr + RULES.ALIGHT));
        }
      }
      return bestB;
    }
    if (s.mode === 'alight' && s.alightTo) {
      const sv = day.timetable.services.find((x) => x.line === s.alightTo.line && x.dir === s.alightTo.dir);
      const node = dm.graph.alightNode(sv, sv.stopIndex.get(s.alightTo.station), s.alightTo.door);
      return dm.LD[node] - (t + s.timer);
    }
    if ((s.mode === 'link' || s.mode === 'queue' || (s.mode === 'lift' && s.liftRiding)) && s.link) {
      const to = s.way === 'ab' ? s.link.b : s.link.a;
      const rest = s.mode === 'queue' ? s.timer + linkBaseTime(s.link, s.way) : s.timer;
      return ldAtPosition(day, dm, s.st, to.seg, to.x, 0) - (t + Math.max(0, rest));
    }
    const wait = s.mode === 'lane' ? Math.max(0, s.timer) : 0;
    return ldAtPosition(day, dm, s.st, s.seg, s.x, s.lane) - (t + wait);
  }

  /**
   * Replay a play and trace the seconds in hand every `every` game seconds.
   * @returns {{samples: [{t, b}], lostAt: {t, st, seg, mode, b} | null}}
   */
  function trace(day, inputs, opts = {}) {
    const dm = opts.dm || deadlineMap(day, opts);
    const every = Math.max(1, Math.round((opts.every || 5) / RULES.DT));
    const sim = SIM.createSim(day);
    const samples = [];
    let lostAt = null;
    let i = 0;
    let mask = 0;
    while (!sim.state.done && sim.state.tick < SIM.MAX_TICKS) {
      while (i < inputs.length && inputs[i][0] === sim.state.tick) {
        mask = inputs[i][1];
        i += 1;
      }
      if (sim.state.tick % every === 0) {
        const s = sim.state;
        const b = budget(day, dm, s);
        samples.push({ t: s.t, b: Number.isFinite(b) ? Math.round(b) : -3600 });
        if (!lostAt && b < 0) lostAt = { t: s.t, st: day.network.stations[s.st].id, seg: s.seg, mode: s.mode, line: s.ride ? day.timetable.services[s.ride.service].line : null, b };
      }
      sim.step(mask);
    }
    return { samples, lostAt, result: sim.state.result };
  }

  return { deadlineMap, ldAtPosition, budget, trace };
});
