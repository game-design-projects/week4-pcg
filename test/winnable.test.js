// The winnable check: every generated day can be won by a perfect player with
// time to spare even with the longest checkpoint queues, nobody can get
// trapped, and days that fail the check are thrown away and regenerated.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Late = require('../src/core/index.js');

const { RULES } = Late.rules;
const P = (wd) => Late.difficulty.paramsFor(wd);

test('every generated day passes the winnable check (sample over the week)', () => {
  for (let wd = 0; wd < 5; wd++) {
    const params = P(wd);
    for (let i = 0; i < 6; i++) {
      const day = Late.day.generateDay(`WIN-${wd}-${i}`, params);
      assert.ok(day.checks.winnable && day.checks.trapFree, `${day.seed}`);
      assert.ok(day.par.arrival <= RULES.CLOCK_IN - params.minSpare, `${day.seed}: best route arrives ${day.par.arrival}`);
      assert.ok(RULES.CLOCK_IN - day.par.arrival >= params.slack - 1, `${day.seed}: spare below the day's slack`);
      const g = Late.day.graphOf(day);
      const { home, office } = Late.day.endNodes(day, g);
      assert.ok(Late.solver.trapCheck(day, g, home, office).ok, `${day.seed}: trap`);
    }
  }
});

test('the check is honest: a perfect player in the real simulation arrives by the promised time', () => {
  for (let wd = 0; wd < 5; wd++) {
    for (let i = 0; i < 3; i++) {
      const day = Late.day.generateDay(`HONEST-${wd}-${i}`, P(wd));
      const st = Late.autopilot.playDay(day);
      assert.equal(st.result.how, 'office', day.seed);
      assert.ok(st.result.arrival <= day.par.arrival + 0.001, `${day.seed}: sim ${st.result.arrival} > promised ${day.par.arrival}`);
      assert.ok(!st.result.late, day.seed);
    }
  }
});

test('an impossible brief is rejected attempt after attempt, deterministically, with reasons', () => {
  const impossible = { ...P(0), maxTrip: 60 }; // no commute is a one-minute trip
  let err = null;
  try {
    Late.day.generateDay('IMPOSSIBLE', impossible, { maxAttempts: 4 });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'expected the generator to give up');
  assert.equal(err.rejected.length, 4);
  let err2 = null;
  try {
    Late.day.generateDay('IMPOSSIBLE', impossible, { maxAttempts: 4 });
  } catch (e) {
    err2 = e;
  }
  assert.deepEqual(err2.rejected, err.rejected);
});

test('rejected attempts are regenerated: the accepted day records the attempts thrown away', () => {
  let sawRejection = false;
  for (let i = 0; i < 25 && !sawRejection; i++) {
    const day = Late.day.generateDay(`REGEN-${i}`, P(4));
    if (day.rejected.length) {
      sawRejection = true;
      assert.equal(day.attempt, day.rejected.length);
      assert.ok(day.rejected.every((r) => typeof r === 'string' && r.length > 0));
    }
  }
  assert.ok(sawRejection, 'expected at least one Friday seed to need a second attempt');
});

test('the trap check catches a one-way dead end', () => {
  const day = Late.day.generateDay('TRAP', P(0));
  const g0 = Late.day.graphOf(day);
  const ends = Late.day.endNodes(day, g0);
  assert.ok(Late.solver.trapCheck(day, g0, ends.home, ends.office).ok);
  // make the home station's platform one-way towards its left end: walk left past the
  // stairs and you can never come back
  const I = day.interiors[day.home.station];
  const plat = I.segs.find((s) => s.kind === 'platform');
  plat.flow = 'one-way';
  plat.dir = -1;
  const g = Late.solver.buildGraph(day);
  const home = Late.solver.nodeAt(g, day.home.station, 0, day.home.x);
  const office = Late.solver.nodeAt(g, day.office.station, 0, day.office.x);
  const res = Late.solver.trapCheck(day, g, home, office);
  assert.equal(res.ok, false);
  assert.ok(res.traps.length > 0);
});

test('closing the only way out makes the office unreachable, and the check says so', () => {
  const day = Late.day.generateDay('CLOSED', P(0));
  const I = day.interiors[day.office.station];
  for (const l of I.links) if (l.exit) l.closedUntil = Infinity;
  const g = Late.solver.buildGraph(day);
  const home = Late.solver.nodeAt(g, day.home.station, 0, day.home.x);
  const office = Late.solver.nodeAt(g, day.office.station, 0, day.office.x);
  const res = Late.solver.trapCheck(day, g, home, office);
  assert.equal(res.reachable, false);
  const r = Late.solver.solve(day, g, home, day.startTime, { target: office });
  assert.equal(r.best[office], Infinity);
});

test('the solver is exact on waiting: leaving later never arrives earlier', () => {
  const day = Late.day.generateDay('FIFO', P(3));
  const g = Late.day.graphOf(day);
  const { home, office } = Late.day.endNodes(day, g);
  let prev = -Infinity;
  for (let t = day.startTime - 600; t <= day.startTime + 600; t += 37) {
    const a = Late.solver.solve(day, g, home, t, { target: office }).best[office];
    assert.ok(a >= prev - 1e-9, `arrival went down leaving at ${t}`);
    prev = a;
  }
});
