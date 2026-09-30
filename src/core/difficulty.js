// Late — generator difficulty for each weekday, and the Director that nudges
// it between days. These are GENERATOR parameters (what gets built). What the
// player is shown (map, timetable, signs) is a separate display setting: see
// display.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Late = root.Late || {}).difficulty = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE = Object.freeze({
    gridW: 20,
    gridH: 13,
    secPerUnit: 55, //         train running time per map grid unit
    secBase: 25,
    lines: 4,
    hubLines: 3, //            lines forced through the central hub
    hubFlavors: ['sprawl'],
    sprawlGap: [110, 220], //  m between hub blocks when sprawling
    headway: [150, 300], //    s between trains
    irregularShare: 0, //      share of lines with jittered gaps
    irregularity: 0.35, //     +- share of the headway
    reversibleShare: 0.25, //  escalators that flip direction on a timer
    escPeriod: [240, 540],
    escalatorShare: 0.8,
    escOnlyShare: 0.1,
    opposingShare: 0.8, //     passages with two opposing lanes
    keepLeftShare: 0.1, //     ...of which flow the "wrong" way round
    mazeTransferShare: 0.1, // two-block interchanges linked by one-way passages
    minTransfers: 1,
    maxTransfers: 2,
    hubOnRoute: false,
    checkpoints: 0,
    checkWait: [25, 110], //   s, random wait at a checkpoint
    disruptions: 0,
    slack: 360, //             s a human-paced commuter can lose and still clock in on time
    minSpare: 60, //           the winnable check: best route with worst waits must beat clock-in by this
    humanReaction: { decide: 10, board: 8 }, // s a real player needs at each stair/gate, and to step onto a train
    concourseOpposingShare: 0.5, // paid concourses at interchanges with two opposing lanes
    unpaidOpposingShare: 0.35, //   unpaid halls by the exits with the morning counterflow
    minTrip: 14 * 60,
    maxTrip: 55 * 60,
  });

  const WEEK = [
    { day: 'Mon', zh: '周一', lines: 4, hubFlavors: ['sprawl'], minTransfers: 1, maxTransfers: 1, checkpoints: 0, disruptions: 0, slack: 420, irregularShare: 0, reversibleShare: 0.15, mazeTransferShare: 0.1 },
    { day: 'Tue', zh: '周二', lines: 4, hubFlavors: ['sprawl', 'split'], minTransfers: 1, maxTransfers: 2, checkpoints: 1, disruptions: 0, slack: 330, irregularShare: 0.25, mazeTransferShare: 0.15 },
    { day: 'Wed', zh: '周三', lines: 5, hubFlavors: ['sprawl', 'split', 'maze'], minTransfers: 1, maxTransfers: 2, hubOnRoute: true, checkpoints: 2, disruptions: 1, slack: 270, irregularShare: 0.4, mazeTransferShare: 0.3 },
    { day: 'Thu', zh: '周四', lines: 5, hubFlavors: ['maze', 'split', 'deep'], minTransfers: 2, maxTransfers: 3, hubOnRoute: true, checkpoints: 3, disruptions: 1, slack: 210, irregularShare: 0.5, reversibleShare: 0.35, mazeTransferShare: 0.35 },
    { day: 'Fri', zh: '周五', lines: 6, hubFlavors: ['maze', 'deep', 'split'], minTransfers: 2, maxTransfers: 3, hubOnRoute: true, checkpoints: 4, disruptions: 2, slack: 180, irregularShare: 0.6, reversibleShare: 0.4, mazeTransferShare: 0.4 },
  ];

  /** Full generator params for weekday 0..4, plus optional Director adjustments. */
  function paramsFor(weekday, adjust) {
    const w = WEEK[Math.max(0, Math.min(4, weekday))];
    const p = { ...BASE, ...w };
    if (adjust) {
      p.slack = Math.max(120, Math.min(600, p.slack + (adjust.slack || 0)));
      const scale = adjust.checkScale || 1;
      p.checkWait = [Math.round(p.checkWait[0] * scale), Math.round(p.checkWait[1] * scale)];
      p.disruptions = Math.max(0, p.disruptions + (adjust.disruptions || 0));
    }
    return p;
  }

  /**
   * The Director: reads how the last days went and eases or tightens the next
   * one. It only changes parameters (slack, checkpoint waits, disruptions); it
   * never builds anything itself.
   * @param history [{margin}] margin = seconds early (+) or late (-)
   */
  function direct(history) {
    const adjust = { slack: 0, checkScale: 1, disruptions: 0, mood: 'steady' };
    if (!history.length) return adjust;
    const recent = history.slice(-2);
    const avg = recent.reduce((s, h) => s + h.margin, 0) / recent.length;
    if (avg < -180) Object.assign(adjust, { slack: 90, checkScale: 0.75, disruptions: -1, mood: 'easing' });
    else if (avg < 0) Object.assign(adjust, { slack: 45, checkScale: 0.9, mood: 'easing' });
    else if (avg > 300) Object.assign(adjust, { slack: -60, checkScale: 1.15, mood: 'tightening' });
    else if (avg > 150) Object.assign(adjust, { slack: -30, mood: 'tightening' });
    return adjust;
  }

  return { BASE, WEEK, paramsFor, direct };
});
