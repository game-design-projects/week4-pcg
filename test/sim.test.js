// The generator and the dive simulation run in plain Node (no DOM), and a
// dive replayed from its recorded inputs ends exactly as the live one did.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Gen = require('../src/gen.js');
const { Game, STEP, encode, decode } = require('../src/game.js');
const Daily = require('../src/daily.js');
const { run } = require('../tools/pilot.js');

test('the same seed and level give the same maze', () => {
  const a = Gen.generate('SAME', 3), b = Gen.generate('SAME', 3);
  assert.equal(a.W, b.W);
  assert.deepEqual(Array.from(a.open), Array.from(b.open));
  assert.deepEqual(a.route, b.route);
  assert.equal(a.budget.k, b.budget.k);
});

test('inputs are 8 directions plus hard, hold and reel bits', () => {
  assert.equal(encode({ x: 0.9, y: -0.2 }), 2);
  assert.equal(encode({ x: -0.7, y: 0.7, hard: true }), 1 | 8 | 16);
  assert.equal(encode({ hold: true, reel: true }), 32 | 64);
  assert.deepEqual(decode(1 | 8 | 32), { x: -1, y: 1, hard: false, hold: true, reel: false });
});

test('a dive replays exactly from its recorded inputs', () => {
  for (const [seed, level, opts] of [['REPLAY', 0, {}], ['REPLAY', 3, { hard: true }], ['REPLAY', 5, { waitForTurn: true }]]) {
    const live = run(seed, level, opts).g;
    assert.ok(live.done, `${seed} L${level} finished`);
    const again = Game.replay(Gen.generate(seed, level), live.inputs);
    assert.equal(again.tick, live.tick);
    assert.equal(again.gas, live.gas);
    assert.equal(again.done.outcome, live.done.outcome);
    assert.equal(again.done.goal, live.done.goal);
    assert.equal(again.laidMetres(), live.laidMetres());
  }
});

test('the live game and the replay step at the same fixed rate', () => {
  const d = Gen.generate('RATE', 1);
  const g = new Game(d, 'none');
  for (let i = 0; i < 30; i++) g.update(0.1, { x: 1 });   // a long frame is still one step
  assert.equal(g.tick, 30);
  assert.ok(Math.abs(g.t - 30 * STEP) < 1e-9);
});

test('recorded inputs are validated before a replay', () => {
  assert.ok(Game.validInputs([[0, 2], [10, 0]]));
  assert.equal(Game.validInputs([[0, 128]]), false);
  assert.equal(Game.validInputs([[5, 1], [5, 2]]), false);
  assert.equal(Game.validInputs([[0.5, 1]]), false);
  assert.equal(Game.validInputs('nope'), false);
});

test('daily boards map to one shared seed with fixed settings', () => {
  assert.equal(Daily.boardFor(new Date('2026-09-30T23:59:00Z')), 'daily-2026-09-30');
  assert.deepEqual(Daily.parse('daily-2026-09-30'), { board: 'daily-2026-09-30', date: '2026-09-30', seed: 'DAILY-2026-09-30', level: Daily.LEVEL, mapMode: Daily.MAP_MODE });
  assert.equal(Daily.parse('weekly-1'), null);
});

test('game code has no DOM or browser dependencies', () => {
  const fs = require('node:fs');
  for (const f of ['rng.js', 'gen.js', 'game.js', 'daily.js']) {
    const code = fs.readFileSync(require.resolve(`../src/${f}`), 'utf8');
    assert.doesNotMatch(code, /\bdocument\.|\blocalStorage\b|\bperformance\.now\b|\brequestAnimationFrame\b/, f);
  }
});

test('the simulation avoids engine-dependent math', () => {
  const fs = require('node:fs');
  for (const f of ['gen.js', 'game.js']) {
    const code = fs.readFileSync(require.resolve(`../src/${f}`), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /Math\.(sin|cos|tan|atan2?|exp|log|pow|hypot|random)\b/, f);
  }
});

test('the tutorial keeps its steps in order', () => {
  // Swim straight to the end chamber without tying in: it doesn't count yet.
  const d = Gen.generate('5N6K3G', 0);
  const g = new Game(d, 'full');
  const said = [], toast = g.toast.bind(g);
  g.toast = (text, secs) => { said.push(text); toast(text, secs); };
  const steer = (t) => { const dx = t.x - g.diver.x, dy = t.y - g.diver.y, l = Math.hypot(dx, dy) || 1; g.update(STEP, { x: dx / l, y: dy / l }); };
  for (let i = 0; i < 400; i++) steer(d.anchor);
  let j = 0;
  for (let i = 0; i < 60 * 120 && Math.hypot(d.goal.x - g.diver.x, d.goal.y - g.diver.y) > 1.5; i++) {
    while (j < d.route.length - 1 && Math.hypot(d.route[j].x - g.diver.x, d.route[j].y - g.diver.y) < 1.5) j++;
    steer(d.route[Math.min(j + 3, d.route.length - 1)]);
  }
  assert.ok(Math.hypot(d.goal.x - g.diver.x, d.goal.y - g.diver.y) <= 1.5, 'reached the end chamber');
  assert.equal(g.goalTagged, false);
  assert.equal(g.tutorial.step, 0);
  assert.ok(said.some((t) => /Tie your reel in first/.test(t)), 'reminded to tie in');
  // Played in order, the tutorial completes.
  const { g: ok } = run('5N6K3G', 0, {});
  assert.equal(ok.done.outcome, 'exit');
  assert.equal(ok.tutorial.step, ok.tutorial.steps.length - 1);
});
