// Late — what the player is SHOWN each weekday. This is a display setting,
// not part of the generator: the same generated day can be played with any
// policy. Through the week the player gets less and less help:
//   Mon  full map any time, a route hint, the timetable, every board works
//   Tue  no route hint
//   Wed  the phone map is rationed; escalator timers disappear; a few signs are stale
//   Thu  the map shows for a moment in the morning, then one glance; boards
//        half broken; no exit hint; more stale signs
//   Fri  a brief look at the map and nothing else: no phone, no timetable,
//        boards mostly dark, signs sparse and often wrong
// Aids bought between days loosen a policy (they only change what is shown).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng.js'));
  else {
    const L = (root.Late = root.Late || {});
    L.display = factory(L.rng);
  }
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  const POLICY = [
    { day: 'Mon', briefingMap: true, briefingSeconds: 0, phoneGlances: Infinity, glanceSeconds: Infinity, routeHint: true, exitHint: true, timetable: 'always', boards: 1, signs: 1, staleSigns: 0, escalatorTimers: true, minimap: true, stripTransfers: true },
    { day: 'Tue', briefingMap: true, briefingSeconds: 0, phoneGlances: Infinity, glanceSeconds: Infinity, routeHint: false, exitHint: true, timetable: 'always', boards: 1, signs: 1, staleSigns: 0, escalatorTimers: true, minimap: true, stripTransfers: true },
    { day: 'Wed', briefingMap: true, briefingSeconds: 0, phoneGlances: 3, glanceSeconds: 8, routeHint: false, exitHint: true, timetable: 'briefing', boards: 0.85, signs: 0.9, staleSigns: 0.1, escalatorTimers: false, minimap: true, stripTransfers: true },
    { day: 'Thu', briefingMap: true, briefingSeconds: 25, phoneGlances: 1, glanceSeconds: 6, routeHint: false, exitHint: false, timetable: 'briefing', boards: 0.5, signs: 0.8, staleSigns: 0.2, escalatorTimers: false, minimap: false, stripTransfers: true },
    { day: 'Fri', briefingMap: true, briefingSeconds: 12, phoneGlances: 0, glanceSeconds: 0, routeHint: false, exitHint: false, timetable: 'none', boards: 0.2, signs: 0.6, staleSigns: 0.3, escalatorTimers: false, minimap: false, stripTransfers: false },
  ];

  const AIDS = [
    { id: 'powerbank', name: 'Power bank', zh: '充电宝', price: 60, blurb: '+2 glances at the phone map (6 s each).', apply: (p) => ({ ...p, phoneGlances: p.phoneGlances + 2, glanceSeconds: Math.max(p.glanceSeconds, 6) }) },
    { id: 'app', name: 'Transit app', zh: '乘车码 App', price: 80, blurb: 'Every platform board works, and escalator timers show.', apply: (p) => ({ ...p, boards: 1, escalatorTimers: true }) },
    { id: 'paper', name: 'Paper map', zh: '纸质地图', price: 50, blurb: 'Take as long as you like over the map in the morning.', apply: (p) => ({ ...p, briefingSeconds: 0, timetable: p.timetable === 'none' ? 'briefing' : p.timetable }) },
    { id: 'regular', name: 'A regular\'s memory', zh: '老乘客', price: 90, blurb: 'Stale signs are fixed and missing ones come back.', apply: (p) => ({ ...p, signs: 1, staleSigns: 0 }) },
  ];

  /** The policy for weekday 0..4 with any aids bought for that day. */
  function policyFor(weekday, aids) {
    let p = { ...POLICY[Math.max(0, Math.min(4, weekday))] };
    for (const id of aids || []) {
      const aid = AIDS.find((a) => a.id === id);
      if (aid) p = aid.apply(p);
    }
    return p;
  }

  /**
   * One number for "how much the player is told", used by tests to prove the
   * week gets stingier. Each item is worth 1 when fully shown.
   */
  function informationScore(p) {
    const glances = p.phoneGlances === Infinity ? 1 : Math.min(1, p.phoneGlances / 4);
    return (
      (p.briefingMap ? (p.briefingSeconds === 0 ? 1 : Math.min(0.9, p.briefingSeconds / 40)) : 0) +
      glances +
      (p.routeHint ? 1 : 0) +
      (p.exitHint ? 1 : 0) +
      (p.timetable === 'always' ? 1 : p.timetable === 'briefing' ? 0.5 : 0) +
      p.boards +
      p.signs * (1 - p.staleSigns) +
      (p.escalatorTimers ? 1 : 0) +
      (p.minimap ? 1 : 0) +
      (p.stripTransfers ? 1 : 0)
    );
  }

  /**
   * Which boards and signs are broken or stale is decided per day from the
   * seed, so two players on the same seed see the same broken board.
   */
  function isBoardWorking(policy, seed, key) {
    return RNG.hash01('board', seed, key) < policy.boards;
  }
  function signState(policy, seed, key) {
    const u = RNG.hash01('sign', seed, key);
    if (u >= policy.signs) return 'missing';
    if (RNG.hash01('stale', seed, key) < policy.staleSigns) return 'stale';
    return 'ok';
  }

  return { POLICY, AIDS, policyFor, informationScore, isBoardWorking, signState };
});
