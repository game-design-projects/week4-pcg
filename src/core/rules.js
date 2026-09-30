// Late — the movement and timing rules shared by the generator, the solver,
// the simulation and (later) the leaderboard Worker. Pure functions, no DOM.
//
// Loads as a classic <script> (fills window.Late.rules) so index.html works
// straight from disk, and as a CommonJS module under Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Late = root.Late || {}).rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULES = Object.freeze({
    DT: 0.25, //                 game seconds per simulation tick
    WALK: 1.5, //                m/s on any walkable floor
    AGAINST: 0.45, //            m/s when pushing against an opposing lane's flow
    LANE_SWITCH: 1.0, //         s to step across into the other lane
    GATE: 2.0, //                s to tap through a fare gate (either way)
    STAIRS_DOWN: 12, //          s per level
    STAIRS_UP: 16, //            s per level
    ESCALATOR: 9, //             s per level, only in the direction it is running
    LIFT_TRAVEL: 5, //           s per level
    LIFT_DWELL: 8, //            s the lift doors stay open at each end
    DWELL: 30, //                s a train stands at a platform with its doors open
    BOARD_MARGIN: 2, //          s the solver keeps in hand before a departure
    ALIGHT: 2, //                s to step off a train
    REACH: 0.9, //               m from a stair/escalator/lift end to use it
    DOOR_REACH: 1.6, //          m from a train door to board
    OFFICE_REACH: 1.0, //        m from the office door to clock in
    TRAIN_LEN: 120, //           m
    DOORS: Object.freeze([12, 36, 60, 84, 108]), // door centres, m from the train's left end
    RUN_PER_LEVEL: 7, //         m of horizontal run for stairs/escalators per level
    CLOCK_IN: 9 * 3600, //       09:00:00
    GIVE_UP_AFTER: 45 * 60, //   the day ends this long after clock-in
  });

  /**
   * Corridor rule. Speed (m/s) for moving in direction `dir` (+1 right, -1 left)
   * along a floor segment, in `lane` (0 near, 1 far).
   *   two-way   both directions at walking speed, lanes do not matter
   *   one-way   only along seg.dir; the other way is blocked (speed 0)
   *   opposing  two lanes: the near lane flows along seg.dir, the far lane the
   *             other way; with the flow is walking speed, against it is slow
   */
  function walkSpeed(seg, lane, dir) {
    if (seg.flow === 'one-way') return dir === seg.dir ? RULES.WALK : 0;
    if (seg.flow === 'opposing') {
      const flow = lane === 1 ? -seg.dir : seg.dir;
      return dir === flow ? RULES.WALK : RULES.AGAINST;
    }
    return RULES.WALK;
  }

  const lanesOf = (seg) => (seg.flow === 'opposing' ? 2 : 1);

  /** Escalator direction at time t: +1 runs down (a→b), -1 runs up (b→a). */
  function escalatorDir(esc, t) {
    if (!esc.period) return esc.dir0;
    const k = Math.floor((t - esc.phase) / esc.period);
    return ((k % 2) + 2) % 2 === 0 ? esc.dir0 : -esc.dir0;
  }

  /** First time >= t at which the escalator runs in `want` (+1 down, -1 up); Infinity if never. */
  function escalatorReady(esc, want, t) {
    if (escalatorDir(esc, t) === want) return t;
    if (!esc.period) return Infinity;
    const k = Math.floor((t - esc.phase) / esc.period);
    return esc.phase + (k + 1) * esc.period;
  }

  /**
   * Lift cycle for a two-stop lift (a = top, b = bottom). The car opens at a
   * for LIFT_DWELL, travels, opens at b for LIFT_DWELL, travels back.
   * Returns when a passenger who reaches `from` at t gets off at the other end.
   */
  function liftArrival(lift, from, t) {
    const travel = RULES.LIFT_TRAVEL * lift.levels;
    const period = 2 * (RULES.LIFT_DWELL + travel);
    const offset = from === 'a' ? 0 : RULES.LIFT_DWELL + travel;
    const base = lift.phase + offset;
    // doors open at `from` during [base + n*period, base + n*period + DWELL)
    let n = Math.floor((t - base) / period);
    if (base + n * period + RULES.LIFT_DWELL <= t) n += 1;
    const open = base + n * period;
    return { board: Math.max(t, open), depart: open + RULES.LIFT_DWELL, arrive: open + RULES.LIFT_DWELL + travel };
  }

  /** Is the lift car standing at `from` with doors open at time t? */
  function liftOpenAt(lift, from, t) {
    const travel = RULES.LIFT_TRAVEL * lift.levels;
    const period = 2 * (RULES.LIFT_DWELL + travel);
    const offset = from === 'a' ? 0 : RULES.LIFT_DWELL + travel;
    const phase = (((t - lift.phase - offset) % period) + period) % period;
    return phase < RULES.LIFT_DWELL;
  }

  /** Seconds to go through link `link` in direction `way` ('ab' or 'ba') when starting at t (not counting waits). */
  function linkBaseTime(link, way) {
    switch (link.kind) {
      case 'stairs':
        return (way === 'ab' ? RULES.STAIRS_DOWN : RULES.STAIRS_UP) * link.levels;
      case 'escalator':
        return RULES.ESCALATOR * link.levels;
      case 'gate':
        return RULES.GATE;
      default:
        return 0; // doors and passage joints
    }
  }

  /** Is this horizontal link checked (a queue) when crossed this way? */
  function isChecked(link, way) {
    return !!link.check && ((link.check.dir === 1 && way === 'ab') || (link.check.dir === -1 && way === 'ba'));
  }

  function fmtClock(t, withSeconds) {
    const s = Math.max(0, Math.floor(t));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return withSeconds ? `${hm}:${String(sec).padStart(2, '0')}` : hm;
  }

  function fmtDuration(sec) {
    const s = Math.round(Math.abs(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
  }

  return { RULES, walkSpeed, lanesOf, escalatorDir, escalatorReady, liftArrival, liftOpenAt, linkBaseTime, isChecked, fmtClock, fmtDuration };
});
