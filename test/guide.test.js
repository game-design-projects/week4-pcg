// The route guide and Day 0. The guide is only worth showing if doing what it
// says gets you to work, from wherever you are; the tutorial day has to be
// small, forgiving and full of the things the coach teaches.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Late = require('../src/core/index.js');

const { RULES } = Late.rules;
const HUMAN = Late.difficulty.BASE.humanReaction;

/** Play a day by doing only what the guide says; `before(sim)` may take over the keys first. */
function followGuide(day, { decide = 10, before = null } = {}) {
  const sim = Late.sim.createSim(day);
  const guide = Late.guide.createGuide(day, { dm: Late.analysis.deadlineMap(day), reaction: HUMAN });
  const input = Late.guide.follow(day, sim, guide, { decide });
  const events = [];
  while (!sim.state.done && sim.state.tick < Late.sim.MAX_TICKS) {
    const mask = before ? before(sim, guide) : null;
    events.push(...sim.step(mask === null || mask === undefined ? input() : mask));
  }
  return { state: sim.state, guide, events };
}

test('doing what the route guide says gets a human-paced player to work on time', () => {
  for (const wd of [0, 1]) {
    for (let i = 0; i < 5; i++) {
      const day = Late.day.generateDay(`FOLLOW-${wd}-${i}`, Late.difficulty.paramsFor(wd));
      const { state } = followGuide(day, { decide: 10 });
      assert.equal(state.result.how, 'office', `${day.seed}: ${state.result.how}`);
      assert.ok(!state.result.late, `${day.seed}: ${state.result.margin} s`);
    }
  }
});

test('the guide starts again from wherever you go: walk the wrong way first, then follow it', () => {
  const day = Late.day.generateDay('FOLLOW-WRONG', Late.difficulty.paramsFor(0));
  let firstDir = 0;
  const { state, guide } = followGuide(day, {
    before(sim, g) {
      // for the first 40 game seconds walk away from where the guide points
      if (sim.state.t - day.startTime >= 40) return null;
      const nav = g.update(sim.state);
      if (!firstDir) firstDir = nav && nav.dir ? nav.dir : 1;
      return firstDir > 0 ? Late.sim.KEY.LEFT : Late.sim.KEY.RIGHT;
    },
  });
  assert.equal(state.result.how, 'office');
  assert.ok(!state.result.late, `${state.result.margin} s`);
  assert.ok(guide.replans >= 2);
});

test('the guide speaks in the player\'s terms: keys, lines, stops and cars', () => {
  const day = Late.day.generateDay('FOLLOW-WORDS', Late.difficulty.paramsFor(0));
  const kinds = new Set();
  const texts = [];
  const sim = Late.sim.createSim(day);
  const guide = Late.guide.createGuide(day, { dm: Late.analysis.deadlineMap(day), reaction: HUMAN });
  const input = Late.guide.follow(day, sim, guide, { decide: 0 });
  while (!sim.state.done) {
    const g = guide.update(sim.state);
    if (g && !g.busy) {
      kinds.add(g.kind);
      if (texts[texts.length - 1] !== g.text) texts.push(g.text);
      if (g.kind === 'ride' || g.kind === 'alight') {
        const sv = day.timetable.services[sim.state.ride.service];
        assert.ok(g.stopIndex > sim.state.ride.from && g.stopIndex < sv.stops.length, 'gets off ahead on this line');
        assert.ok(g.door >= 0 && g.door < RULES.DOORS.length);
      }
    }
    sim.step(input());
  }
  for (const k of ['walk', 'link', 'board', 'ride', 'alight', 'office']) assert.ok(kinds.has(k), `no ${k} instruction`);
  // what the signs light up for: the first line to take, not the entrance you go down
  const first = Late.guide.createGuide(day, { reaction: HUMAN }).update(Late.sim.createSim(day).state);
  const firstLine = sim.state.log.find((e) => e.type === 'board').line;
  assert.deepEqual(first.target, { line: firstLine });
  // and the exit at the end is the office's
  const exits = texts.filter((t) => /Take exit [A-Z] up to the street/.test(t));
  assert.ok(exits.length && exits.every((t) => t.includes(`exit ${day.office.exit} `)), exits.join(' | '));
  assert.ok(texts.some((t) => /^[↑↓] Board Line \d+ → /.test(t)), texts.join(' | '));
  assert.ok(texts.some((t) => /^Ride to .+ \(\d+ stops?\)/.test(t)));
  assert.ok(texts.some((t) => /^Get off here at /.test(t)));
});

test('how much of the guide you see is a display setting that fades over the week', () => {
  const guideOf = (wd, aids) => Late.display.policyFor(wd, aids).guide;
  assert.deepEqual([0, 1, 2, 3, 4].map((wd) => guideOf(wd)), ['path', 'signs', 'none', 'none', 'none']);
  assert.equal(guideOf(4, ['app']), 'signs', 'the transit app lights up the signs again');
  assert.equal(guideOf(0, ['app']), 'path', 'an aid never takes help away');
  for (const p of [Late.difficulty.paramsFor(0), Late.difficulty.tutorialParams()]) {
    assert.ok(!Object.keys(p).some((k) => /guide|coach|hint/i.test(k)), 'the guide is not a generator input');
  }
});

test('Day 0 is one fixed, small and forgiving day', () => {
  const P = Late.difficulty.tutorialParams();
  const a = Late.day.generateDay(Late.difficulty.TUTORIAL_SEED, P);
  const b = Late.day.generateDay(Late.difficulty.TUTORIAL_SEED, P);
  assert.equal(JSON.stringify(a.par), JSON.stringify(b.par));
  assert.equal(a.startTime, b.startTime);
  assert.equal(a.network.lines.length, 3);
  assert.equal(a.checkpoints.length, 0);
  assert.equal(a.disruptions.length, 0);
  assert.ok(a.par.tolerance >= 15 * 60, `a quarter of an hour to lose, got ${a.par.tolerance} s`);
  const T = Late.display.TUTORIAL;
  assert.ok(T.coach && T.guide === 'path');
  assert.ok(Late.display.informationScore(T) >= Late.display.informationScore(Late.display.POLICY[0]));
});

test('following the guide through Day 0 meets everything the coach teaches', () => {
  const day = Late.day.generateDay(Late.difficulty.TUTORIAL_SEED, Late.difficulty.tutorialParams());
  const sim = Late.sim.createSim(day);
  const guide = Late.guide.createGuide(day, { dm: Late.analysis.deadlineMap(day), reaction: HUMAN });
  const input = Late.guide.follow(day, sim, guide, { decide: 10 });
  const met = { stairs: 0, gates: 0, twoLane: 0, platform: 0 };
  while (!sim.state.done) {
    const s = sim.state;
    const seg = day.interiors[day.network.stations[s.st].id].segs[s.seg];
    if (s.mode === 'walk' && Late.rules.lanesOf(seg) === 2 && seg.kind !== 'street') met.twoLane += 1;
    if (s.mode === 'walk' && seg.platform !== null) met.platform += 1;
    for (const e of sim.step(input())) {
      if (e.type === 'link' && e.kind === 'gate') met.gates += 1;
      if (e.type === 'link' && (e.kind === 'stairs' || e.kind === 'escalator')) met.stairs += 1;
    }
  }
  const boards = sim.state.log.filter((e) => e.type === 'board').map((e) => e.line);
  assert.equal(sim.state.result.how, 'office');
  assert.ok(!sim.state.result.late);
  assert.equal(new Set(boards).size, 2, 'one change of line');
  for (const [k, n] of Object.entries(met)) assert.ok(n > 0, `never met: ${k}`);
});
