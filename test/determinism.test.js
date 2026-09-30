// Seed determinism: the same seed and params always give the same day, and a
// recorded play replays to the same result. The generator runs in plain Node.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Late = require('../src/core/index.js');

const P = (wd) => Late.difficulty.paramsFor(wd);

/** Everything the generator decides, in a stable JSON form. */
function fingerprint(day) {
  return JSON.stringify({
    version: day.version,
    attempt: day.attempt,
    rejected: day.rejected,
    lines: day.network.lines.map((l) => [l.id, l.points, l.stops, l.run]),
    stations: day.network.stations.map((s) => [s.id, s.name, s.kind, s.flavor, s.lines]),
    interiors: Object.values(day.interiors).map((I) => [I.layout, I.segs, I.links, I.platforms, I.doors, I.props]),
    timetable: day.timetable.services.map((s) => [s.line, s.dir, s.deps, s.headway, s.irregular]),
    home: day.home,
    office: day.office,
    start: day.startTime,
    checkpoints: day.checkpoints,
    disruptions: day.disruptions,
    par: day.par,
  });
}

test('the generator runs in plain Node, with no browser globals', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const day = Late.day.generateDay('NODE-ONLY', P(2));
  assert.ok(day.network.stations.length > 10);
});

test('same seed and params give the identical day', () => {
  for (const wd of [0, 2, 4]) {
    const a = Late.day.generateDay(`SAME-${wd}`, P(wd));
    const b = Late.day.generateDay(`SAME-${wd}`, P(wd));
    assert.equal(fingerprint(a), fingerprint(b), `weekday ${wd}`);
  }
});

test('different seeds give different days', () => {
  const prints = new Set();
  for (let i = 0; i < 6; i++) prints.add(fingerprint(Late.day.generateDay(`DIFF-${i}`, P(1))));
  assert.equal(prints.size, 6);
});

test('params are part of the day: the same seed on another weekday is a different day', () => {
  const mon = Late.day.generateDay('PARAMS', P(0));
  const fri = Late.day.generateDay('PARAMS', P(4));
  assert.notEqual(fingerprint(mon), fingerprint(fri));
  assert.ok(fri.network.lines.length > mon.network.lines.length);
});

test('rng forks are independent streams derived only from seed and label', () => {
  const a = Late.rng.makeRng('X').fork('station:S1');
  const b = Late.rng.makeRng('X').fork('station:S1');
  const c = Late.rng.makeRng('X').fork('station:S2');
  const seqA = Array.from({ length: 8 }, () => a.next());
  const seqB = Array.from({ length: 8 }, () => b.next());
  const seqC = Array.from({ length: 8 }, () => c.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  // drawing from one fork does not disturb another created from the same parent
  const parent = Late.rng.makeRng('Y');
  const f1 = parent.fork('one');
  f1.next();
  f1.next();
  assert.equal(parent.fork('two').next(), Late.rng.makeRng('Y').fork('two').next());
});

test('a recorded play replays to exactly the same arrival (what the leaderboard relies on)', () => {
  const day = Late.day.generateDay('REPLAY', P(3));
  const played = Late.autopilot.playDay(day);
  assert.equal(played.result.how, 'office');
  const again = Late.sim.replay(day, played.inputs);
  assert.equal(again.result.arrival, played.result.arrival);
  assert.equal(again.tick, played.tick);
  assert.deepEqual(again.stats, played.stats);
  // and a different input list gives a different outcome
  const lazy = Late.sim.replay(day, [[0, 0]]);
  assert.equal(lazy.result.how, 'gave-up');
});

test('checkpoint waits are random but seeded: same seed, same wait', () => {
  const day = Late.day.generateDay('WAITS', P(4));
  const a = Late.autopilot.playDay(day);
  const b = Late.autopilot.playDay(Late.day.generateDay('WAITS', P(4)));
  const wa = a.log.filter((e) => e.type === 'checkpoint').map((e) => e.wait);
  const wb = b.log.filter((e) => e.type === 'checkpoint').map((e) => e.wait);
  assert.deepEqual(wa, wb);
});
