// Late — one generated day: the whole pipeline from a seed and difficulty
// params to a checked, winnable commute.
//
//   1 network skeleton      lines, stations, interchanges, the hub
//   2 station interiors     floors, gates, stairs/escalators/lifts, passages
//                           (corridor types), hubs from linked blocks
//   3 timetables            headways, regular or irregular
//   4 home and office       a pair whose best route has the wanted shape
//   5 checkpoints/closures  placed on the best route, one at a time
//   6 timing                the latest start that still makes clock-in
//                           with the day's slack
//   7 checks                winnable with worst-case waits, no traps;
//                           otherwise the attempt is thrown away and the
//                           next attempt (same seed, next attempt number) runs
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./rules.js'), require('./rng.js'), require('./network.js'), require('./interior.js'),
      require('./timetable.js'), require('./solver.js'), require('./difficulty.js'),
    );
  } else {
    const L = (root.Late = root.Late || {});
    L.day = factory(L.rules, L.rng, L.network, L.interior, L.timetable, L.solver, L.difficulty);
  }
})(typeof self !== 'undefined' ? self : this, function (R, RNG, NET, INT, TT, SOLVER, DIFF) {
  'use strict';

  const GEN_VERSION = 'g1';
  const { RULES } = R;
  const NOMINAL = 8 * 3600; // time used while shaping the day, before the real start is known
  const graphs = new WeakMap();

  function graphOf(day) {
    let g = graphs.get(day);
    if (!g) {
      g = SOLVER.buildGraph(day);
      graphs.set(day, g);
    }
    return g;
  }

  function stationIndex(day, id) {
    return day.network.stations.findIndex((s) => s.id === id);
  }

  function endNodes(day, graph) {
    const home = SOLVER.nodeAt(graph, day.home.station, 0, day.home.x);
    const office = SOLVER.nodeAt(graph, day.office.station, 0, day.office.x);
    return { home, office };
  }

  function bestRoute(day, graph, t0, checkWait = 'max') {
    const { home, office } = endNodes(day, graph);
    const res = SOLVER.solve(day, graph, home, t0, { target: office, checkWait });
    const hops = SOLVER.pathTo(res, office);
    if (!hops) return null;
    return { arrival: res.best[office], hops, stats: SOLVER.routeStats(day, graph, hops, t0) };
  }

  function routeShapeOk(stats, P) {
    if (stats.transfers < P.minTransfers || stats.transfers > P.maxTransfers) return 'transfers';
    if (P.hubOnRoute && !stats.hubsVisited.length) return 'hub-off-route';
    if (stats.total < P.minTrip) return 'too-short';
    if (stats.total > P.maxTrip) return 'too-long';
    return null;
  }

  // ------------------------------------------------------------ step 4

  function chooseEnds(day, graph, rng, P) {
    const st = day.network.stations;
    const homes = rng.shuffle(st.filter((s) => s.kind === 'plain'));
    const offices = rng.shuffle(st.filter((s) => s.kind !== 'hub'));
    let tries = 0;
    for (const h of homes) {
      for (const o of offices) {
        if (o.id === h.id || o.lines.some((l) => h.lines.includes(l))) continue;
        if (++tries > 45) return null;
        const hi = day.interiors[h.id];
        const oi = day.interiors[o.id];
        const hd = rng.pick(hi.doors.filter((d) => d.kind === 'end'));
        const odoors = oi.doors.filter((d) => d.kind === 'exit');
        if (!odoors.length) continue;
        const od = rng.pick(odoors);
        day.home = { station: h.id, seg: 0, x: hd.x };
        day.office = { station: o.id, seg: 0, x: od.x, exit: od.exit };
        const r = bestRoute(day, graph, NOMINAL);
        if (r && !routeShapeOk(r.stats, P)) return r;
      }
    }
    return null;
  }

  // ------------------------------------------------------------ step 5

  function segKind(day, stIdx, segId) {
    return day.interiors[day.network.stations[stIdx].id].segs[segId].kind;
  }

  function placeCheckpoints(day, graph, rng, P) {
    const placed = [];
    for (let c = 0; c < P.checkpoints; c++) {
      const r = bestRoute(day, graph, NOMINAL);
      if (!r) return placed;
      const cands = [];
      for (let i = 1; i < r.hops.length; i++) {
        const e = r.hops[i].how;
        if (e.type !== 'link' || e.link.axis !== 'h' || e.link.check || e.link.closedUntil) continue;
        const from = e.way === 'ab' ? e.link.a : e.link.b;
        const to = e.way === 'ab' ? e.link.b : e.link.a;
        const fk = segKind(day, e.st, from.seg);
        const tk = segKind(day, e.st, to.seg);
        let w = 0;
        let label = 'ID check';
        if (e.link.kind === 'gate' && fk === 'unpaid' && tk === 'paid') {
          const I = day.interiors[day.network.stations[e.st].id];
          w = I.splitGate === e.link.id ? 5 : 2;
          label = I.splitGate === e.link.id ? 'Re-entry security' : 'Security check';
        } else if (e.link.kind === 'joint' && fk !== 'unpaid') {
          w = 3;
          label = 'ID check';
        }
        if (w) cands.push([{ e, label, st: e.st }, w]);
      }
      if (!cands.length) return placed;
      const pick = rng.weighted(cands);
      const wmin = P.checkWait[0] + rng.int(0, 15);
      const wmax = Math.max(wmin + 30, P.checkWait[1] + rng.int(0, 45));
      pick.e.link.check = { dir: pick.e.way === 'ab' ? 1 : -1, wmin, wmax, label: pick.label, id: placed.length };
      placed.push({ station: day.network.stations[pick.st].id, link: pick.e.link.id, label: pick.label, wmin, wmax });
    }
    return placed;
  }

  function placeDisruptions(day, graph, rng, P) {
    const placed = [];
    const { home, office } = endNodes(day, graph);
    for (let d = 0; d < P.disruptions; d++) {
      const r = bestRoute(day, graph, NOMINAL);
      if (!r) return placed;
      const cands = [];
      for (let i = 1; i < r.hops.length; i++) {
        const e = r.hops[i].how;
        if (e.type !== 'link' || e.link.check || e.link.closedUntil || e.link.exit) continue;
        if (e.link.kind === 'joint' || e.link.kind === 'escalator' || e.link.kind === 'stairs') cands.push(e);
      }
      let done = false;
      for (const e of rng.shuffle(cands)) {
        const L = e.link;
        L.closedUntil = Infinity;
        const again = bestRoute(day, graph, NOMINAL);
        const trap = SOLVER.trapCheck(day, graph, home, office);
        if (again && trap.ok && again.stats.total <= P.maxTrip) {
          L.closure = L.kind === 'joint' ? 'Passage closed for works' : L.kind === 'escalator' ? 'Escalator out of service' : 'Stairs closed';
          placed.push({ station: day.network.stations[e.st].id, link: L.id, kind: L.kind, reason: L.closure, cost: again.arrival - r.arrival });
          done = true;
          break;
        }
        delete L.closedUntil;
      }
      if (!done) return placed;
    }
    return placed;
  }

  // ------------------------------------------------------------ step 6

  function latestStart(day, graph, want) {
    const { home, office } = endNodes(day, graph);
    const arr = (T) => SOLVER.solve(day, graph, home, T, { target: office, checkWait: 'max' }).best[office];
    let lo = RULES.CLOCK_IN - 3 * 3600;
    let hi = RULES.CLOCK_IN - 5 * 60;
    if (!(arr(lo) <= want)) return null;
    while (hi - lo > 5) {
      const mid = Math.floor((lo + hi) / 10) * 5;
      if (arr(mid) <= want) lo = mid;
      else hi = mid;
    }
    return Math.floor(lo / 60) * 60;
  }

  // ------------------------------------------------------------ pipeline

  function tryDay(seed, P, attempt) {
    const rng = RNG.makeRng(`${GEN_VERSION}|${seed}|${attempt}`);
    const network = NET.generateNetwork(rng.fork('network'), P);
    if (!network) return { reason: 'network' };
    for (const st of network.stations) if (st.kind === 'hub') st.flavor = rng.fork(`flavor:${st.id}`).pick(P.hubFlavors);
    const interiors = {};
    for (const st of network.stations) {
      try {
        interiors[st.id] = INT.buildInterior(st, rng.fork(`interior:${st.id}`), P);
      } catch (e) {
        return { reason: `interior (${e.message})` };
      }
    }
    const timetable = TT.generateTimetable(rng.fork('timetable'), network, P);
    const day = { version: GEN_VERSION, seed, params: P, attempt, network, interiors, timetable, clockIn: RULES.CLOCK_IN };
    const graph = graphOf(day);

    const first = chooseEnds(day, graph, rng.fork('ends'), P);
    if (!first) return { reason: 'no home/office pair with the wanted route' };
    day.checkpoints = placeCheckpoints(day, graph, rng.fork('checkpoints'), P);
    day.disruptions = placeDisruptions(day, graph, rng.fork('disruptions'), P);

    const want = RULES.CLOCK_IN - P.slack;
    const start = latestStart(day, graph, want);
    if (start === null) return { reason: 'cannot make clock-in from any start' };
    day.startTime = start;

    // ---- the checks
    const worst = bestRoute(day, graph, start, 'max');
    if (!worst) return { reason: 'office unreachable' };
    const spare = RULES.CLOCK_IN - worst.arrival;
    if (spare < P.minSpare) return { reason: 'not winnable with worst-case waits' };
    const { home, office } = endNodes(day, graph);
    const trap = SOLVER.trapCheck(day, graph, home, office);
    if (!trap.ok) return { reason: `trap (${trap.traps.length} dead-end places)` };
    const shape = routeShapeOk(worst.stats, P);
    if (shape) return { reason: `route shape after checkpoints: ${shape}` };
    if (day.checkpoints.length < P.checkpoints) return { reason: 'could not place every checkpoint' };

    const typical = bestRoute(day, graph, start, 'mean');
    day.par = {
      arrival: worst.arrival,
      spare,
      typicalArrival: typical ? typical.arrival : worst.arrival,
      transfers: worst.stats.transfers,
      lines: worst.stats.lines,
      hubs: worst.stats.hubsVisited,
      checks: worst.stats.checks,
      walking: worst.stats.walking,
      riding: worst.stats.riding,
    };
    day.checks = { winnable: true, trapFree: true, spare, placesChecked: graph.nodes.length };
    return { day };
  }

  /**
   * Generate the day for `seed` under params `P`. Deterministic: the same
   * seed and params always return the same day (including how many attempts
   * were thrown away on the way).
   */
  function generateDay(seed, P, opts = {}) {
    const params = { ...DIFF.BASE, ...P };
    const rejected = [];
    const max = opts.maxAttempts || 60;
    for (let attempt = 0; attempt < max; attempt++) {
      const res = tryDay(String(seed), params, attempt);
      if (res.day) {
        res.day.rejected = rejected;
        return res.day;
      }
      rejected.push(res.reason);
    }
    const err = new Error(`no winnable day for seed ${seed} after ${max} attempts`);
    err.rejected = rejected;
    throw err;
  }

  // ------------------------------------------------------------ lookups used by the sim and UI

  function lookups(day) {
    if (day._lk) return day._lk;
    const stations = new Map(day.network.stations.map((s) => [s.id, s]));
    const lines = new Map(day.network.lines.map((l) => [l.id, l]));
    const service = new Map(day.timetable.services.map((s) => [`${s.line}|${s.dir}`, s]));
    const lk = { stations, lines, service };
    Object.defineProperty(day, '_lk', { value: lk, enumerable: false });
    return lk;
  }

  return { GEN_VERSION, generateDay, graphOf, bestRoute, endNodes, stationIndex, lookups, NOMINAL };
});
