// Late — timetables. Each line runs both directions from its termini with a
// headway; some lines are irregular (each gap jittered), which is what makes
// "memorise the timetable" worth anything. Trains never overtake, so a
// service's trips keep the same order at every stop.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else {
    const L = (root.Late = root.Late || {});
    L.timetable = factory(L.rules);
  }
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const { RULES } = R;
  const T_OPEN = 6 * 3600 + 30 * 60;
  const T_CLOSE = 11 * 3600;

  /**
   * @returns {{services: object[], open: number, close: number}}
   *   service = {id, line, dir, stops: stationId[], stopIndex: Map, arrOff[], depOff[], deps[], headway, irregular}
   *   A trip j is at stop k from deps[j] + arrOff[k] (doors open) to deps[j] + depOff[k] (doors close).
   */
  function generateTimetable(rng, network, P) {
    const services = [];
    for (const line of network.lines) {
      const r = rng.fork(`tt:${line.id}`);
      const headway = Math.round(r.int(P.headway[0], P.headway[1]) / 5) * 5;
      const irregular = r.chance(P.irregularShare);
      for (const dir of [0, 1]) {
        const stops = dir === 0 ? line.stops.slice() : line.stops.slice().reverse();
        const runs = dir === 0 ? line.run.slice() : line.run.slice().reverse();
        const arrOff = [-RULES.DWELL];
        const depOff = [0];
        for (let k = 1; k < stops.length; k++) {
          arrOff.push(depOff[k - 1] + runs[k - 1]);
          depOff.push(arrOff[k] + RULES.DWELL);
        }
        const deps = [];
        let t = T_OPEN + Math.round(r.int(0, headway - 1) / 5) * 5;
        while (t < T_CLOSE) {
          deps.push(t);
          const jitter = irregular ? r.float(-P.irregularity, P.irregularity) * headway : 0;
          t += Math.max(90, Math.round((headway + jitter) / 5) * 5);
        }
        const stopIndex = new Map(stops.map((s, k) => [s, k]));
        services.push({ id: services.length, line: line.id, dir, stops, stopIndex, arrOff, depOff, deps, headway, irregular });
      }
    }
    return { services, open: T_OPEN, close: T_CLOSE };
  }

  /** Index of the first trip leaving stop k at or after t, or -1. */
  function nextTrip(service, k, t) {
    const target = t - service.depOff[k];
    const d = service.deps;
    let lo = 0;
    let hi = d.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (d[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo < d.length ? lo : -1;
  }

  const arrAt = (service, j, k) => service.deps[j] + service.arrOff[k];
  const depAt = (service, j, k) => service.deps[j] + service.depOff[k];

  /** The trip standing at stop k at time t (doors open), or -1. */
  function tripAt(service, k, t) {
    const j = nextTrip(service, k, t + 1e-9);
    if (j >= 0 && arrAt(service, j, k) <= t) return j;
    return -1;
  }

  /** Where trip j is at time t: {stop, state: 'at'|'between', next, frac} or null before/after service. */
  function tripPosition(service, j, t) {
    const n = service.stops.length;
    for (let k = 0; k < n; k++) {
      const a = arrAt(service, j, k);
      const d = depAt(service, j, k);
      if (t < a) {
        if (k === 0) return null;
        const prevDep = depAt(service, j, k - 1);
        return { state: 'between', stop: k - 1, next: k, frac: (t - prevDep) / (a - prevDep) };
      }
      if (t < d) return { state: 'at', stop: k, next: k + 1 < n ? k + 1 : null, frac: 0 };
    }
    return null;
  }

  return { generateTimetable, nextTrip, tripAt, tripPosition, arrAt, depAt, T_OPEN, T_CLOSE };
});
