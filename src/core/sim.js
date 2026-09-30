// Late — the playable rules, as a deterministic fixed-step simulation.
//
// The browser feeds it one input mask per tick; the leaderboard Worker can
// feed it a recorded list of [tick, mask] changes and get exactly the same
// arrival time. No DOM, no clocks, no Math.random: checkpoint waits come from
// a hash of the day seed, the checkpoint and the visit number.
//
// Controls (bits of the mask):
//   LEFT/RIGHT  walk
//   UP/DOWN     context: board the far/near train at a door, take the
//               stairs/escalator/lift up/down, or step into the far/near lane
//   ACT         get off the train at this stop (UP/DOWN also work)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rules.js'), require('./rng.js'), require('./timetable.js'), require('./day.js'));
  } else {
    const L = (root.Late = root.Late || {});
    L.sim = factory(L.rules, L.rng, L.timetable, L.day);
  }
})(typeof self !== 'undefined' ? self : this, function (R, RNG, TT, DAY) {
  'use strict';

  const { RULES, walkSpeed, lanesOf, escalatorDir, liftOpenAt, liftArrival, linkBaseTime, isChecked } = R;
  const KEY = Object.freeze({ LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, ACT: 16 });
  const MAX_TICKS = Math.ceil((4 * 3600) / RULES.DT);

  function createSim(day) {
    const lk = DAY.lookups(day);
    const stations = day.network.stations;
    const services = day.timetable.services;
    const homeIdx = stations.findIndex((s) => s.id === day.home.station);
    const officeIdx = stations.findIndex((s) => s.id === day.office.station);

    const s = {
      tick: 0,
      t: day.startTime,
      mode: 'walk', // walk | lane | link | queue | lift | train | alight | done
      st: homeIdx,
      seg: 0,
      x: day.home.x,
      lane: 0,
      facing: 1,
      moving: 0,
      prev: 0,
      link: null,
      way: null,
      timer: 0,
      timerTotal: 0,
      liftRiding: false,
      ride: null,
      alightTo: null,
      done: false,
      result: null,
      fares: 0,
      exitedPaid: false,
      visits: {},
      stats: { walk: 0, idle: 0, ride: 0, queue: 0, link: 0, against: 0, blocked: 0, boards: 0, lanes: 0 },
      log: [], // notable events, for the result screen, excuses and telemetry
      inputs: [], // [tick, mask] whenever the mask changes: enough to replay the day
    };

    const interiorAt = (st) => day.interiors[stations[st].id];
    const segAt = () => interiorAt(s.st).segs[s.seg];

    function note(type, extra) {
      const e = { t: s.t, type, st: stations[s.st].id, ...extra };
      s.log.push(e);
      return e;
    }

    function finish(ev, how) {
      s.done = true;
      s.mode = 'done';
      const arrival = how === 'office' ? s.t : null;
      s.result = {
        how,
        arrival,
        margin: arrival === null ? -RULES.GIVE_UP_AFTER : RULES.CLOCK_IN - arrival,
        late: arrival === null || arrival > RULES.CLOCK_IN,
        fares: s.fares,
      };
      ev.push({ type: how === 'office' ? 'arrive' : 'gave-up' });
      note(how === 'office' ? 'arrive' : 'gave-up', {});
    }

    function checkOffice(ev) {
      if (s.st === officeIdx && s.seg === 0 && Math.abs(s.x - day.office.x) <= RULES.OFFICE_REACH) finish(ev, 'office');
    }

    function hlinkAtEnd(seg, side) {
      const I = interiorAt(s.st);
      for (const L of I.links) {
        if (L.axis !== 'h') continue;
        if (side > 0 && L.a.seg === seg.id) return L;
        if (side < 0 && L.b.seg === seg.id) return L;
      }
      return null;
    }

    function checkpointWait(L) {
      const n = (s.visits[L.id] = (s.visits[L.id] || 0) + 1);
      const u = RNG.hash01(day.seed, day.attempt, stations[s.st].id, L.id, n);
      const w = L.check.wmin + (L.check.wmax - L.check.wmin) * u;
      return Math.round(w / RULES.DT) * RULES.DT;
    }

    function moveOver(L, way) {
      const I = interiorAt(s.st);
      const from = I.segs[(way === 'ab' ? L.a : L.b).seg];
      const to = way === 'ab' ? L.b : L.a;
      const toSeg = I.segs[to.seg];
      s.seg = to.seg;
      s.x = to.x;
      s.lane = L.axis === 'h' && lanesOf(from) === 2 && lanesOf(toSeg) === 2 ? s.lane : 0;
      if (L.kind === 'gate') {
        if (from.kind === 'paid' && toSeg.kind === 'unpaid') s.exitedPaid = true;
        if (from.kind === 'unpaid' && toSeg.kind === 'paid' && s.exitedPaid) {
          s.fares += 1;
          note('fare', {});
        }
      }
    }

    // A timed action started by the player spends the current tick already
    // (`spent` = DT); one chained from another action (a gate after a queue)
    // starts with the next tick.
    function startTraverse(L, way, ev, spent) {
      const base = L.kind === 'escalator' ? RULES.ESCALATOR * L.levels : linkBaseTime(L, way);
      if (base <= 0) {
        moveOver(L, way);
        return;
      }
      s.mode = 'link';
      s.link = L;
      s.way = way;
      s.timerTotal = base;
      s.timer = base - spent;
      ev.push({ type: 'link', kind: L.kind, way });
    }

    function enterHLink(L, way, ev) {
      if (L.closedUntil && s.t < L.closedUntil) {
        ev.push({ type: 'blocked', why: 'closed', text: L.closure });
        s.stats.blocked += RULES.DT;
        return;
      }
      if (isChecked(L, way)) {
        s.mode = 'queue';
        s.link = L;
        s.way = way;
        s.timerTotal = checkpointWait(L);
        s.timer = s.timerTotal - RULES.DT;
        ev.push({ type: 'queue', label: L.check.label, wait: s.timer });
        note('checkpoint', { label: L.check.label, wait: s.timer });
        return;
      }
      startTraverse(L, way, ev, RULES.DT);
    }

    function startVLink(L, way, ev) {
      if (L.closedUntil && s.t < L.closedUntil) {
        ev.push({ type: 'blocked', why: 'closed', text: L.closure });
        return true;
      }
      if (L.kind === 'escalator' && escalatorDir(L.esc, s.t) !== (way === 'ab' ? 1 : -1)) {
        ev.push({ type: 'blocked', why: 'escalator' });
        s.stats.blocked += RULES.DT;
        return true;
      }
      if (L.kind === 'lift') {
        s.mode = 'lift';
        s.link = L;
        s.way = way;
        s.liftRiding = false;
        ev.push({ type: 'lift-wait' });
        return true;
      }
      startTraverse(L, way, ev, RULES.DT);
      return true;
    }

    function tryVertical(which, ev) {
      const I = interiorAt(s.st);
      const seg = segAt();
      const station = stations[s.st];
      if (seg.platform !== null) {
        const p = I.platforms[seg.platform];
        const side = which === 'up' ? 'far' : 'near';
        const tr = p.tracks[side];
        const k = p.doors.findIndex((x) => Math.abs(x - s.x) <= RULES.DOOR_REACH);
        if (tr && k >= 0) {
          const service = lk.service.get(`${tr.line}|${tr.dir}`);
          const stop = service.stopIndex.get(station.id);
          if (stop < service.stops.length - 1) {
            const j = TT.tripAt(service, stop, s.t);
            if (j >= 0 && s.t < TT.depAt(service, j, stop)) {
              s.mode = 'train';
              s.ride = { service: service.id, trip: j, from: stop, door: k, side, at: stop };
              s.stats.boards += 1;
              ev.push({ type: 'board', line: service.line, dir: service.dir });
              note('board', { line: service.line, dir: service.dir });
              return true;
            }
          }
          return false;
        }
      }
      for (const L of I.links) {
        if (L.axis !== 'v') continue;
        if (which === 'down' && L.a.seg === s.seg && Math.abs(L.a.x - s.x) <= RULES.REACH) return startVLink(L, 'ab', ev);
        if (which === 'up' && L.b.seg === s.seg && Math.abs(L.b.x - s.x) <= RULES.REACH) return startVLink(L, 'ba', ev);
      }
      if (lanesOf(seg) === 2) {
        const want = which === 'up' ? 1 : 0;
        if (s.lane !== want) {
          s.lane = want;
          s.mode = 'lane';
          s.timerTotal = RULES.LANE_SWITCH;
          s.timer = RULES.LANE_SWITCH - RULES.DT;
          s.stats.lanes += 1;
          ev.push({ type: 'lane', lane: want });
          return true;
        }
      }
      return false;
    }

    function walk(mask, ev) {
      const seg = segAt();
      const dir = (mask & KEY.RIGHT ? 1 : 0) - (mask & KEY.LEFT ? 1 : 0);
      s.moving = 0;
      if (mask & (KEY.UP | KEY.DOWN)) {
        if (tryVertical(mask & KEY.UP ? 'up' : 'down', ev)) return;
      }
      if (!dir) {
        s.stats.idle += RULES.DT;
        return;
      }
      s.facing = dir;
      const v = walkSpeed(seg, s.lane, dir);
      if (v === 0) {
        ev.push({ type: 'blocked', why: 'one-way' });
        s.stats.blocked += RULES.DT;
        return;
      }
      let nx = s.x + dir * v * RULES.DT;
      if (dir > 0 && nx >= seg.x1) {
        const L = hlinkAtEnd(seg, 1);
        if (L) {
          s.x = seg.x1;
          enterHLink(L, 'ab', ev);
          return;
        }
        nx = seg.x1;
      } else if (dir < 0 && nx <= seg.x0) {
        const L = hlinkAtEnd(seg, -1);
        if (L) {
          s.x = seg.x0;
          enterHLink(L, 'ba', ev);
          return;
        }
        nx = seg.x0;
      }
      s.moving = nx !== s.x ? dir : 0;
      s.x = nx;
      s.stats.walk += RULES.DT;
      if (v < RULES.WALK) s.stats.against += RULES.DT;
      checkOffice(ev);
    }

    function train(pressed, ev) {
      const sv = services[s.ride.service];
      const j = s.ride.trip;
      s.stats.ride += RULES.DT;
      let at = -1;
      for (let k = s.ride.from + 1; k < sv.stops.length; k++) {
        const a = TT.arrAt(sv, j, k);
        if (s.t < a) break;
        if (s.t < TT.depAt(sv, j, k)) {
          at = k;
          break;
        }
      }
      s.ride.at = at;
      if (at < 0) return;
      const terminus = at === sv.stops.length - 1;
      if (terminus || pressed & (KEY.UP | KEY.DOWN | KEY.ACT)) {
        s.mode = 'alight';
        s.timerTotal = RULES.ALIGHT;
        s.timer = RULES.ALIGHT - RULES.DT;
        s.alightTo = { station: sv.stops[at], line: sv.line, dir: sv.dir, door: s.ride.door };
        ev.push({ type: 'alight', terminus });
        note('alight', { line: sv.line, at: sv.stops[at], terminus });
      }
    }

    function finishAlight(ev) {
      const a = s.alightTo;
      const st = stations.findIndex((x) => x.id === a.station);
      const I = interiorAt(st);
      const p = I.platforms.find((pl) => ['far', 'near'].some((side) => pl.tracks[side] && pl.tracks[side].line === a.line && pl.tracks[side].dir === a.dir));
      s.st = st;
      s.seg = p.seg;
      s.x = p.doors[a.door];
      s.lane = 0;
      s.mode = 'walk';
      s.ride = null;
      s.alightTo = null;
      ev.push({ type: 'platform' });
    }

    /** Advance one tick with this input mask. Returns UI events. */
    function step(mask) {
      const ev = [];
      if (s.done) return ev;
      mask &= 31;
      if (mask !== s.prev) s.inputs.push([s.tick, mask]);
      const pressed = mask & ~s.prev;
      switch (s.mode) {
        case 'walk':
          walk(mask, ev);
          break;
        case 'lane':
          s.timer -= RULES.DT;
          if (s.timer <= 1e-9) s.mode = 'walk';
          break;
        case 'queue':
          s.timer -= RULES.DT;
          s.stats.queue += RULES.DT;
          if (s.timer <= 1e-9) {
            s.mode = 'walk';
            startTraverse(s.link, s.way, ev, 0);
          }
          break;
        case 'link':
          s.timer -= RULES.DT;
          s.stats.link += RULES.DT;
          if (s.timer <= 1e-9) {
            s.mode = 'walk';
            moveOver(s.link, s.way);
            s.link = null;
            ev.push({ type: 'link-done' });
          }
          break;
        case 'lift': {
          const L = s.link;
          const from = s.way === 'ab' ? 'a' : 'b';
          if (!s.liftRiding) {
            if (mask & (KEY.LEFT | KEY.RIGHT)) {
              s.mode = 'walk';
              s.link = null;
              break;
            }
            s.stats.idle += RULES.DT;
            if (liftOpenAt(L.lift, from, s.t)) {
              s.liftRiding = true;
              s.timerTotal = liftArrival(L.lift, from, s.t).arrive - s.t;
              s.timer = s.timerTotal - RULES.DT;
              ev.push({ type: 'link', kind: 'lift', way: s.way });
            }
          } else {
            s.timer -= RULES.DT;
            s.stats.link += RULES.DT;
            if (s.timer <= 1e-9) {
              s.mode = 'walk';
              moveOver(L, s.way);
              s.link = null;
              ev.push({ type: 'link-done' });
            }
          }
          break;
        }
        case 'train':
          train(pressed, ev);
          break;
        case 'alight':
          s.timer -= RULES.DT;
          if (s.timer <= 1e-9) finishAlight(ev);
          break;
        default:
          break;
      }
      s.prev = mask;
      s.tick += 1;
      s.t = day.startTime + s.tick * RULES.DT;
      if (!s.done && s.mode === 'walk') checkOffice(ev);
      if (!s.done && s.t >= RULES.CLOCK_IN + RULES.GIVE_UP_AFTER) finish(ev, 'gave-up');
      return ev;
    }

    return { state: s, step, day };
  }

  /** Replay recorded inputs from the start of the day. */
  function replay(day, inputs, maxTicks = MAX_TICKS) {
    const sim = createSim(day);
    let i = 0;
    let mask = 0;
    while (!sim.state.done && sim.state.tick < maxTicks) {
      while (i < inputs.length && inputs[i][0] === sim.state.tick) {
        mask = inputs[i][1];
        i += 1;
      }
      sim.step(mask);
    }
    return sim.state;
  }

  /** Structural check on a submitted input list (the server's first line of defence). */
  function validInputs(inputs) {
    if (!Array.isArray(inputs) || inputs.length > 40000) return false;
    let last = -1;
    for (const e of inputs) {
      if (!Array.isArray(e) || e.length !== 2) return false;
      const [tick, mask] = e;
      if (!Number.isInteger(tick) || !Number.isInteger(mask) || tick <= last || tick > MAX_TICKS || mask < 0 || mask > 31) return false;
      last = tick;
    }
    return true;
  }

  return { createSim, replay, validInputs, KEY, MAX_TICKS };
});
