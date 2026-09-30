// Late — the route guide: from wherever the player stands, what to do next
// to reach the office ("Walk → to the escalator", "↑ Board Line 3 → Wufu",
// "Ride to Qingshui, walk to car 4"). It re-plans with the solver whenever the
// player changes floor, lane or train, so going the wrong way is fine: the
// guide just starts from the new place. It plans at a human pace (time to
// read the signs, a margin to step onto a train) with average queues.
//
// What the player is shown of it is the display policy's call (display.js):
// the full path on Monday, only the signs for the next line or exit on
// Tuesday, nothing later. Like the rest of src/core it has no DOM, so the
// tests can check that simply doing what the guide says gets you to work.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rules.js'), require('./timetable.js'), require('./solver.js'), require('./day.js'));
  } else {
    const L = (root.Late = root.Late || {});
    L.guide = factory(L.rules, L.timetable, L.solver, L.day);
  }
})(typeof self !== 'undefined' ? self : this, function (R, TT, SOLVER, DAY) {
  'use strict';

  const { RULES, escalatorDir } = R;
  const EPS = 0.3;
  const REPLAN_EVERY = 20; // game seconds: keeps the train choice current if you dawdle

  const lineName = (id) => id.replace('L', 'Line ');
  const level = (seg) => (seg.depth === 0 ? 'the street' : `B${seg.depth}`);

  /**
   * @param day
   * @param opts.dm        deadline map (analysis.deadlineMap), used to pick where to get off
   *                       a train the plan did not expect
   * @param opts.reaction  human pace for planning, e.g. difficulty.BASE.humanReaction
   * @param opts.checkWait queue times the plan assumes ('mean' | 'max')
   */
  function createGuide(day, opts = {}) {
    const graph = DAY.graphOf(day);
    const office = SOLVER.nodeAt(graph, day.office.station, 0, day.office.x);
    const stations = day.network.stations;
    const services = day.timetable.services;
    const officeIdx = stations.findIndex((s) => s.id === day.office.station);
    let plan = [];
    let anchor = '';
    let plannedAt = -Infinity;
    let replans = 0;
    let last = null;
    let rideChoice = null;

    const interior = (st) => day.interiors[stations[st].id];
    const stationName = (id) => stations.find((s) => s.id === id).name;

    function replan(s) {
      const res = SOLVER.solve(day, graph, -1, s.t, {
        startPos: { st: s.st, seg: s.seg, x: s.x, lane: s.lane },
        target: office,
        checkWait: opts.checkWait || 'mean',
        reaction: opts.reaction || null,
      });
      const hops = SOLVER.pathTo(res, office);
      plan = hops ? SOLVER.stepsOf(day, graph, hops) : [];
      // stepsOf starts after the first node; from between two nodes the walk
      // to that first node is part of the way too
      if (hops && hops[0].how && hops[0].how.type === 'startwalk') {
        const n = graph.nodes[hops[0].node];
        const first = plan[0];
        if (!(first && first.type === 'walk' && first.st === n.st && first.seg === n.seg && first.lane === n.lane)) {
          plan.unshift({ type: 'walk', st: n.st, seg: n.seg, lane: n.lane, x: n.x, t: hops[0].t });
        }
      }
      anchor = `${s.st}|${s.seg}|${s.lane}`;
      plannedAt = s.t;
      replans += 1;
    }

    /** The next line to board or exit to take at this station (for highlighting signs). */
    function targetFrom(i) {
      for (let k = i; k < plan.length; k++) {
        const p = plan[k];
        if (p.type === 'ride') return { line: services[p.service].line };
        if (p.type === 'link') {
          const L = interior(p.st).links[p.link];
          if (L.exit && p.way === 'ba') return { exit: L.exitLetter }; // leaving to the street, not coming in
        }
      }
      return { office: true };
    }

    function linkName(L) {
      if (L.exit) return `exit ${L.exitLetter}`;
      if (L.kind === 'escalator') return 'the escalator';
      if (L.kind === 'lift') return 'the lift';
      if (L.kind === 'gate') return 'the fare gates';
      if (L.check) return `the ${L.check.label}`;
      return L.axis === 'v' ? 'the stairs' : 'the passage';
    }

    /** "to the escalator down to B2", "to a door for Line 3 → Wufu", "to the office". */
    function describeNext(p, s) {
      if (!p) {
        const d = Math.abs(day.office.x - s.x);
        return `to the office (${Math.max(1, Math.round(d))} m)`;
      }
      if (p.type === 'lane') return `and switch to the ${p.lane === 1 ? 'far' : 'near'} lane`;
      if (p.type === 'ride') {
        const sv = services[p.service];
        return `to a door for ${lineName(sv.line)} → ${stationName(sv.stops[sv.stops.length - 1]).en}`;
      }
      const I = interior(p.st);
      const L = I.links[p.link];
      if (L.axis === 'h') return L.kind === 'gate' ? 'through the fare gates' : L.check ? `to the ${L.check.label}` : 'along the passage';
      const to = I.segs[(p.way === 'ab' ? L.b : L.a).seg];
      if (L.exit) return p.way === 'ab' ? `to entrance ${L.exitLetter}, down into the station` : `to exit ${L.exitLetter}, up to the street`;
      return `to ${linkName(L)} ${p.way === 'ab' ? 'down' : 'up'} to ${level(to)}`;
    }

    function walkInstruction(s) {
      let i = 0;
      while (i < plan.length) {
        const p = plan[i];
        if (p.type === 'walk' && p.st === s.st && p.seg === s.seg && p.lane === s.lane && Math.abs(p.x - s.x) <= EPS) i += 1;
        else if (p.type === 'lane' && p.st === s.st && p.seg === s.seg && p.lane === s.lane) i += 1;
        else break;
      }
      const target = targetFrom(i);
      const base = { st: s.st, seg: s.seg, lane: s.lane, target };
      if (i >= plan.length) {
        if (s.st === officeIdx && s.seg === 0) {
          const dir = Math.sign(day.office.x - s.x);
          return { ...base, kind: 'office', x: day.office.x, dir, key: dir > 0 ? '→' : '←', text: 'The office is right here' };
        }
        return { ...base, kind: 'lost', text: 'No route from here. Try another way.' };
      }
      const p = plan[i];
      if (p.type === 'walk') {
        const dir = Math.sign(p.x - s.x);
        const next = plan[i + 1];
        return { ...base, kind: next ? 'walk' : 'office', lane: p.lane, x: p.x, dir, key: dir > 0 ? '→' : '←', text: `Walk ${dir > 0 ? '→' : '←'} ${describeNext(next, s)}` };
      }
      if (p.type === 'lane') {
        const key = p.lane === 1 ? '↑' : '↓';
        return { ...base, kind: 'lane', lane: p.lane, x: s.x, key, text: `${key} Switch to the ${p.lane === 1 ? 'far' : 'near'} lane: that crowd walks your way` };
      }
      if (p.type === 'link') {
        const I = interior(p.st);
        const L = I.links[p.link];
        const from = p.way === 'ab' ? L.a : L.b;
        const to = p.way === 'ab' ? L.b : L.a;
        if (L.axis === 'h') {
          const dir = p.way === 'ab' ? 1 : -1;
          const key = dir > 0 ? '→' : '←';
          const what = L.kind === 'gate' ? 'through the fare gates' : L.check ? `into the ${L.check.label} queue` : 'on along the passage';
          return { ...base, kind: 'link', link: L.id, way: p.way, x: from.x, dir, key, text: `Walk ${key} ${what}` };
        }
        const key = p.way === 'ab' ? '↓' : '↑';
        const toSeg = I.segs[to.seg];
        const wrongWay = L.kind === 'escalator' && escalatorDir(L.esc, s.t) !== (p.way === 'ab' ? 1 : -1);
        let text = L.exit
          ? p.way === 'ab' ? `${key} Take entrance ${L.exitLetter} down into the station` : `${key} Take exit ${L.exitLetter} up to the street`
          : `${key} Take ${linkName(L)} ${p.way === 'ab' ? 'down' : 'up'} to ${level(toSeg)}`;
        if (L.check) text += ` (${L.check.label} first)`;
        if (wrongWay) text = `Wait: the escalator is running the other way (${key} when it turns)`;
        return { ...base, kind: 'link', link: L.id, way: p.way, x: from.x, dir: 0, key, wait: wrongWay, text };
      }
      // ride: we are at the door
      const sv = services[p.service];
      const key = p.side === 'far' ? '↑' : '↓';
      const wait = Math.ceil(p.dep - s.t);
      const term = stationName(sv.stops[sv.stops.length - 1]).en;
      return {
        ...base,
        kind: 'board',
        x: s.x,
        dir: 0,
        key,
        side: p.side,
        line: sv.line,
        text: `${key} Board ${lineName(sv.line)} → ${term}${wait > 1 ? `: next train in ${wait} s${wait > 20 ? ' (hold Space to wait)' : ''}` : ''}`,
      };
    }

    /** Where to get off this train: the plan's stop if this is the planned line, else the best stop on the deadline map. */
    function chooseAlight(s) {
      const key = `${s.ride.service}|${s.ride.trip}|${s.ride.from}`;
      if (rideChoice && rideChoice.key === key) return rideChoice;
      const sv = services[s.ride.service];
      const planned = plan.find((p) => p.type === 'ride' && p.service === s.ride.service && p.from === s.ride.from);
      let stop = sv.stops.length - 1;
      let door = RULES.DOORS.reduce((b, d, k) => (Math.abs(d - s.ride.pos) < Math.abs(RULES.DOORS[b] - s.ride.pos) ? k : b), 0);
      if (planned) {
        stop = planned.to;
        door = planned.doorOut ?? planned.door;
      } else if (opts.dm) {
        let best = -Infinity;
        for (let m = s.ride.from + 1; m < sv.stops.length; m++) {
          const arr = TT.arrAt(sv, s.ride.trip, m);
          for (let d = 0; d < RULES.DOORS.length; d++) {
            const walk = Math.abs(RULES.DOORS[d] - s.ride.pos) / RULES.CAR_WALK;
            if (walk > Math.max(0, arr - s.t)) continue;
            const val = opts.dm.LD[opts.dm.graph.alightNode(sv, m, d)] - (arr + RULES.ALIGHT);
            if (val > best + 1e-9) {
              best = val;
              stop = m;
              door = d;
            }
          }
        }
      }
      rideChoice = { key, stop, door };
      return rideChoice;
    }

    function trainInstruction(s) {
      const sv = services[s.ride.service];
      const { stop, door } = chooseAlight(s);
      const pos = TT.tripPosition(sv, s.ride.trip, s.t);
      const name = stationName(sv.stops[stop]);
      const doorX = RULES.DOORS[door];
      const dx = doorX - s.ride.pos;
      const dir = Math.abs(dx) > EPS ? Math.sign(dx) : 0;
      const base = { st: s.st, stop: sv.stops[stop], stopIndex: stop, door, doorX, dir, target: { station: sv.stops[stop] } };
      if (pos && pos.state === 'at' && pos.stop === stop) {
        const atDoor = RULES.DOORS.some((d) => Math.abs(d - s.ride.pos) <= RULES.DOOR_REACH);
        if (atDoor) return { ...base, kind: 'alight', key: '↑', text: `Get off here at ${name.en} ${name.zh}: ↑ or E` };
        return { ...base, kind: 'ride', key: dir > 0 ? '→' : '←', text: `Walk ${dir > 0 ? '→' : '←'} to a door and get off at ${name.en}` };
      }
      const left = stop - (pos ? (pos.state === 'at' ? pos.stop : pos.next - 1) : s.ride.from);
      const stopsTxt = `${left} stop${left === 1 ? '' : 's'}`;
      const walkTxt = dir ? ` · walk ${dir > 0 ? '→' : '←'} to car ${door + 1}, nearest your way out` : ` · car ${door + 1} is the right car`;
      return { ...base, kind: 'ride', key: dir ? (dir > 0 ? '→' : '←') : null, text: `Ride to ${name.en} (${stopsTxt})${walkTxt}` };
    }

    /** The instruction for this moment of the simulation state. */
    function update(s) {
      if (s.done) return null;
      if (s.mode === 'train' && s.ride) {
        last = trainInstruction(s);
        return last;
      }
      if (s.mode !== 'walk') return last ? { ...last, busy: true } : null;
      rideChoice = null;
      const nextRide = plan.find((p) => p.type === 'ride');
      if (anchor !== `${s.st}|${s.seg}|${s.lane}` || s.t - plannedAt > REPLAN_EVERY || (nextRide && nextRide.dep < s.t)) replan(s);
      last = walkInstruction(s);
      return last;
    }

    return {
      update,
      get plan() {
        return plan;
      },
      get replans() {
        return replans;
      },
    };
  }

  /**
   * A player who does exactly what the guide says (tests use it to show the
   * guide is right). `decide` adds a human pause before every stair or gate.
   */
  function follow(day, sim, guide, opts = {}) {
    const { KEY } = opts.KEY ? opts : { KEY: { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, ACT: 16 } };
    const decide = opts.decide || 0;
    let pauseFor = null;
    let pauseUntil = 0;
    return function input() {
      const s = sim.state;
      const g = guide.update(s);
      if (!g || g.busy) return 0;
      if (g.kind === 'alight') return s.prev & KEY.ACT ? 0 : KEY.ACT;
      if (g.kind === 'ride') return g.dir > 0 ? KEY.RIGHT : g.dir < 0 ? KEY.LEFT : 0;
      if (g.kind === 'board') return g.side === 'far' ? KEY.UP : KEY.DOWN;
      if (g.kind === 'lane') return g.lane === 1 ? KEY.UP : KEY.DOWN;
      if (g.kind === 'link') {
        const tag = `${s.st}|${g.link}|${g.way}`;
        if (decide > 0) {
          if (pauseFor !== tag) {
            pauseFor = tag;
            pauseUntil = s.t + decide;
          }
          if (s.t < pauseUntil) return 0;
        }
        if (g.wait) return 0;
        if (g.dir) return g.dir > 0 ? KEY.RIGHT : KEY.LEFT;
        return g.key === '↓' ? KEY.DOWN : KEY.UP;
      }
      if (g.kind === 'walk' || g.kind === 'office') return g.dir > 0 ? KEY.RIGHT : g.dir < 0 ? KEY.LEFT : 0;
      return 0;
    };
  }

  return { createGuide, follow };
});
