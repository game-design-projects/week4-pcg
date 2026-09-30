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

  const GEN_VERSION = 'g3';
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

  /** null if the route has the day's wanted shape; `extra` loosens the transfer ceiling after trouble is placed. */
  function routeShapeOk(stats, P, extra = 0) {
    if (stats.transfers < P.minTransfers || stats.transfers > P.maxTransfers + extra) return 'transfers';
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

  /**
   * Checkpoints go on the best route at the day's real start time, one at a
   * time (re-timing the day after each). Candidates are scored by how hard
   * they are to walk around: we close each one in turn and see how much later
   * the best route gets. The hardest to avoid are the most likely picks, so a
   * checkpoint either has to be queued at or costs a real detour.
   */
  function placeCheckpoints(day, graph, rng, P) {
    const placed = [];
    const { home } = endNodes(day, graph);
    for (let c = 0; c < P.checkpoints; c++) {
      const worst = bestRoute(day, graph, day.startTime);
      if (!worst) return placed;
      const typical = bestRoute(day, graph, day.startTime, 'mean');
      const ldOpen = humanDeadlines(day, graph, P)[home];
      // candidate spots on the worst-case route and on the route a typical
      // commuter (average queues) takes; spots on both count double
      const seen = new Map();
      for (const [route, bonus] of [[worst, 1], [typical, 1]]) {
        if (!route) continue;
        for (let i = 1; i < route.hops.length; i++) {
          const e = route.hops[i].how;
          if (e.type !== 'link' || e.link.check || e.link.closedUntil) continue;
          if (e.link.axis !== 'h' && (e.link.kind !== 'stairs' || e.link.exit)) continue;
          const key = `${e.st}:${e.link.id}:${e.way}`;
          if (seen.has(key)) {
            seen.get(key).both += bonus;
            continue;
          }
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
          } else if (e.link.kind === 'stairs' && fk !== 'unpaid' && tk !== 'unpaid') {
            w = 1.5;
            label = 'Transfer ID check';
          }
          if (w) seen.set(key, { e, label, st: e.st, w, both: 0 });
        }
      }
      const cands = [...seen.values()];
      if (!cands.length) return placed;
      for (const cd of cands) {
        // how much earlier would you have to leave home if this spot were blocked?
        cd.e.link.closedUntil = Infinity;
        const ldClosed = humanDeadlines(day, graph, P)[home];
        delete cd.e.link.closedUntil;
        cd.avoid = ldClosed > -Infinity ? Math.max(0, ldOpen - ldClosed) : 3600;
      }
      const wmin = P.checkWait[0] + rng.int(0, 15);
      const wmax = Math.max(wmin + 30, P.checkWait[1] + rng.int(0, 45));
      // prefer spots a typical commuter would rather queue at than walk around
      const mean = (wmin + wmax) / 2;
      const hard = cands.filter((cd) => cd.avoid >= mean);
      let pool = (hard.length ? hard : cands).map((cd) => [cd, cd.w * (1 + cd.both) * (1 + Math.min(cd.avoid, 600) / 60)]);
      // Try up to six candidates in weighted order. Keep the first that leaves
      // the day's route shape intact AND is still met by a typical commuter
      // once the day is re-timed; failing that, the first that keeps the shape.
      let chosen = null;
      let fallback = null;
      for (let k = 0; k < 6 && pool.length && !chosen; k++) {
        const pick = rng.weighted(pool);
        pool = pool.filter(([cd]) => cd !== pick);
        const L = pick.e.link;
        L.check = { dir: pick.e.way === 'ab' ? 1 : -1, wmin, wmax, label: pick.label, id: placed.length };
        const t = timeDay(day, graph, P);
        // the day's shape is judged on the route a typical commuter takes
        // (average queues); the worst-case route is only the guarantee
        const typ = t === null ? null : bestRoute(day, graph, t, 'mean');
        if (typ && !routeShapeOk(typ.stats, P, 1)) {
          if (typ.stats.checks > 0) chosen = { pick, t };
          else if (!fallback) fallback = { pick, t };
        }
        delete L.check;
      }
      const use = chosen || fallback;
      if (!use) return placed;
      const L = use.pick.e.link;
      L.check = { dir: use.pick.e.way === 'ab' ? 1 : -1, wmin, wmax, label: use.pick.label, id: placed.length };
      day.startTime = use.t;
      placed.push({ station: day.network.stations[use.pick.st].id, link: L.id, label: use.pick.label, wmin, wmax, avoid: Math.round(Math.min(use.pick.avoid, 3600)) });
    }
    return placed;
  }

  function placeDisruptions(day, graph, rng, P) {
    const placed = [];
    const { home, office } = endNodes(day, graph);
    for (let d = 0; d < P.disruptions; d++) {
      const r = bestRoute(day, graph, day.startTime);
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
        const trap = SOLVER.trapCheck(day, graph, home, office);
        const t = trap.ok ? timeDay(day, graph, P) : null;
        const again = t === null ? null : bestRoute(day, graph, t, 'mean');
        // keep a closure only if the typical route still has (roughly) the wanted shape
        if (again && !routeShapeOk(again.stats, P, 1)) {
          L.closure = L.kind === 'joint' ? 'Passage closed for works' : L.kind === 'escalator' ? 'Escalator out of service' : 'Stairs closed';
          placed.push({ station: day.network.stations[e.st].id, link: L.id, kind: L.kind, reason: L.closure, cost: again.arrival - r.arrival });
          day.startTime = t;
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

  /**
   * The deadline map for a human-paced commuter (a pause at every stair and
   * gate, a few seconds' margin to step onto a train) with worst-case queues:
   * LD[n] is the latest time you can be at n and still clock in.
   */
  function humanDeadlines(day, graph, P) {
    const { office } = endNodes(day, graph);
    return SOLVER.latestDepartures(day, graph, office, RULES.CLOCK_IN, { checkWait: 'max', reaction: P.humanReaction });
  }

  /**
   * The day starts `slack` seconds before the latest moment a human-paced
   * commuter could leave home and still make it: that is exactly how much
   * time the player can lose (rounded down to the minute, never up).
   */
  function timeDay(day, graph, P) {
    const { home } = endNodes(day, graph);
    const LD = humanDeadlines(day, graph, P);
    if (!(LD[home] > -Infinity)) return null;
    const start = Math.floor((LD[home] - P.slack) / 60) * 60;
    return start >= TT.T_OPEN + 300 ? start : null;
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
    day.startTime = timeDay(day, graph, P);
    if (day.startTime === null) return { reason: 'cannot make clock-in from any start' };
    day.disruptions = placeDisruptions(day, graph, rng.fork('disruptions'), P);
    day.checkpoints = placeCheckpoints(day, graph, rng.fork('checkpoints'), P);
    const start = timeDay(day, graph, P);
    if (start === null) return { reason: 'cannot make clock-in from any start' };
    day.startTime = start;

    // ---- the checks
    const worst = bestRoute(day, graph, start, 'max');
    if (!worst) return { reason: 'office unreachable' };
    const spare = RULES.CLOCK_IN - worst.arrival;
    if (spare < P.minSpare) return { reason: 'not winnable with worst-case waits' };
    const { home, office } = endNodes(day, graph);
    const LD = humanDeadlines(day, graph, P);
    const tolerance = LD[home] - start;
    if (tolerance < P.minSpare) return { reason: 'a human-paced commuter would have no time to spare' };
    const trap = SOLVER.trapCheck(day, graph, home, office);
    if (!trap.ok) return { reason: `trap (${trap.traps.length} dead-end places)` };
    const typicalRoute = bestRoute(day, graph, start, 'mean');
    const shape = typicalRoute ? routeShapeOk(typicalRoute.stats, P, 1) : 'unreachable';
    if (shape) return { reason: `route shape after checkpoints: ${shape}` };
    if (day.checkpoints.length < P.checkpoints) return { reason: 'could not place every checkpoint' };

    const typical = typicalRoute;
    day.par = {
      arrival: worst.arrival,
      spare,
      tolerance,
      typicalArrival: typical ? typical.arrival : worst.arrival,
      transfers: worst.stats.transfers,
      lines: worst.stats.lines,
      hubs: worst.stats.hubsVisited,
      checks: worst.stats.checks,
      walking: worst.stats.walking,
      riding: worst.stats.riding,
    };
    day.checks = { winnable: true, trapFree: true, spare, tolerance, placesChecked: graph.nodes.length };
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

  return { GEN_VERSION, generateDay, graphOf, bestRoute, endNodes, stationIndex, lookups, humanDeadlines, NOMINAL };
});
