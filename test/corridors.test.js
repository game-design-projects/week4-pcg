// Corridor rules: two-way, one-way and opposing-lane passages, as the rule
// function, as solver edges, and as walked in the simulation.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Late = require('../src/core/index.js');

const { RULES, walkSpeed, escalatorDir, escalatorReady } = Late.rules;
const seg = (flow, dir = 1) => ({ flow, dir, x0: 0, x1: 100 });

test('two-way: walking speed both ways, lanes do not matter', () => {
  const s = seg('two-way');
  assert.equal(walkSpeed(s, 0, 1), RULES.WALK);
  assert.equal(walkSpeed(s, 0, -1), RULES.WALK);
});

test('one-way: only along the arrow, blocked against it', () => {
  const east = seg('one-way', 1);
  assert.equal(walkSpeed(east, 0, 1), RULES.WALK);
  assert.equal(walkSpeed(east, 0, -1), 0);
  const west = seg('one-way', -1);
  assert.equal(walkSpeed(west, 0, -1), RULES.WALK);
  assert.equal(walkSpeed(west, 0, 1), 0);
});

test('opposing lanes: the near lane flows with seg.dir, the far lane the other way; against the flow is slow', () => {
  const s = seg('opposing', 1);
  assert.equal(walkSpeed(s, 0, 1), RULES.WALK);
  assert.equal(walkSpeed(s, 0, -1), RULES.AGAINST);
  assert.equal(walkSpeed(s, 1, -1), RULES.WALK);
  assert.equal(walkSpeed(s, 1, 1), RULES.AGAINST);
  assert.ok(RULES.AGAINST < RULES.WALK / 2);
  const keepLeft = seg('opposing', -1);
  assert.equal(walkSpeed(keepLeft, 0, -1), RULES.WALK);
  assert.equal(walkSpeed(keepLeft, 1, 1), RULES.WALK);
});

test('escalators run one way at a time and reversible ones flip on their period', () => {
  const fixed = { dir0: 1, period: 0, phase: 0 };
  assert.equal(escalatorDir(fixed, 12345), 1);
  assert.equal(escalatorReady(fixed, -1, 100), Infinity);
  const rev = { dir0: -1, period: 300, phase: 50 };
  assert.equal(escalatorDir(rev, 60), -1);
  assert.equal(escalatorDir(rev, 360), 1);
  assert.equal(escalatorReady(rev, 1, 60), 350);
  assert.equal(escalatorReady(rev, -1, 60), 60);
});

/** Find a generated segment of the given flow and return {day, station, seg}. */
function findSeg(flow, wd) {
  for (let i = 0; i < 40; i++) {
    const day = Late.day.generateDay(`CORR-${flow}-${i}`, Late.difficulty.paramsFor(wd));
    for (const st of day.network.stations) {
      const I = day.interiors[st.id];
      const s = I.segs.find((x) => x.flow === flow && x.x1 - x.x0 > 20);
      if (s) return { day, st, I, s };
    }
  }
  throw new Error(`no ${flow} segment found`);
}

test('the generator produces all three corridor types', () => {
  const kinds = new Set();
  for (let i = 0; i < 10; i++) {
    const day = Late.day.generateDay(`KINDS-${i}`, Late.difficulty.paramsFor(3));
    for (const I of Object.values(day.interiors)) for (const s of I.segs) kinds.add(s.flow);
  }
  assert.deepEqual([...kinds].sort(), ['one-way', 'opposing', 'two-way']);
});

test('solver edges follow the corridor rules', () => {
  const { day, st, s } = findSeg('one-way', 3);
  const g = Late.day.graphOf(day);
  const si = g.stationIndex.get(st.id);
  const ids = g.segNodes[si][s.id][0];
  for (let i = 0; i + 1 < ids.length; i++) {
    const fwd = g.adj[ids[i]].find((e) => e.type === 'walk' && e.to === ids[i + 1]);
    const back = g.adj[ids[i + 1]].find((e) => e.type === 'walk' && e.to === ids[i]);
    if (s.dir === 1) {
      assert.ok(fwd && !back);
    } else {
      assert.ok(back && !fwd);
    }
  }
  const o = findSeg('opposing', 2);
  const og = Late.day.graphOf(o.day);
  const oi = og.stationIndex.get(o.st.id);
  const [lane0, lane1] = og.segNodes[oi][o.s.id];
  assert.ok(lane0 && lane1, 'opposing segments have two lanes of nodes');
  const dx = og.nodes[lane0[1]].x - og.nodes[lane0[0]].x;
  const with0 = og.adj[lane0[o.s.dir === 1 ? 0 : 1]].find((e) => e.to === lane0[o.s.dir === 1 ? 1 : 0]);
  const against0 = og.adj[lane0[o.s.dir === 1 ? 1 : 0]].find((e) => e.to === lane0[o.s.dir === 1 ? 0 : 1]);
  assert.ok(Math.abs(with0.cost - dx / RULES.WALK) <= RULES.DT);
  assert.ok(Math.abs(against0.cost - dx / RULES.AGAINST) <= RULES.DT);
  assert.ok(og.adj[lane0[0]].some((e) => e.type === 'lane' && e.to === lane1[0] && e.cost === RULES.LANE_SWITCH));
});

/** Put a fresh sim on a segment at x, facing nothing, and walk for n ticks. */
function walkOn(day, stId, segId, x, lane, mask, ticks) {
  const sim = Late.sim.createSim(day);
  const s = sim.state;
  s.st = day.network.stations.findIndex((q) => q.id === stId);
  s.seg = segId;
  s.x = x;
  s.lane = lane;
  const evs = [];
  for (let i = 0; i < ticks; i++) evs.push(...sim.step(mask));
  return { s, evs };
}

test('in the simulation a one-way corridor blocks the wrong direction', () => {
  const { day, st, s } = findSeg('one-way', 3);
  const K = Late.sim.KEY;
  const mid = (s.x0 + s.x1) / 2;
  const wrong = s.dir === 1 ? K.LEFT : K.RIGHT;
  const right = s.dir === 1 ? K.RIGHT : K.LEFT;
  const a = walkOn(day, st.id, s.id, mid, 0, wrong, 8);
  assert.equal(a.s.x, mid);
  assert.ok(a.evs.some((e) => e.type === 'blocked' && e.why === 'one-way'));
  const b = walkOn(day, st.id, s.id, mid, 0, right, 8);
  assert.ok(Math.abs(b.s.x - mid - s.dir * RULES.WALK * RULES.DT * 8) < 1e-9);
});

test('in the simulation walking against an opposing lane crawls, and switching lanes fixes it', () => {
  const { day, st, s } = findSeg('opposing', 2);
  const K = Late.sim.KEY;
  const mid = (s.x0 + s.x1) / 2;
  const against = s.dir === 1 ? K.LEFT : K.RIGHT; // lane 0 flows along s.dir
  const slow = walkOn(day, st.id, s.id, mid, 0, against, 8);
  const fast = walkOn(day, st.id, s.id, mid, 1, against, 8);
  assert.ok(Math.abs(Math.abs(slow.s.x - mid) - RULES.AGAINST * RULES.DT * 8) < 1e-9);
  assert.ok(Math.abs(Math.abs(fast.s.x - mid) - RULES.WALK * RULES.DT * 8) < 1e-9);
  assert.ok(slow.s.stats.against > 0 && fast.s.stats.against === 0);
  // Up switches to the far lane and takes LANE_SWITCH seconds
  const sw = walkOn(day, st.id, s.id, mid, 0, K.UP, 1);
  assert.equal(sw.s.lane, 1);
  assert.equal(sw.s.mode, 'lane');
  assert.ok(sw.evs.some((e) => e.type === 'lane'));
});

test('entering a two-lane floor puts you in the near lane, in the solver and the simulation alike', () => {
  const { day, st, I, s: seg } = findSeg('opposing', 2);
  const g = Late.day.graphOf(day);
  const si = g.stationIndex.get(st.id);
  for (const L of I.links) {
    const a = I.segs[L.a.seg];
    const b = I.segs[L.b.seg];
    const keep = L.axis === 'h' && Late.rules.lanesOf(a) === 2 && Late.rules.lanesOf(b) === 2;
    for (const e of g.adj.flatMap((list, u) => list.filter((x) => x.type === 'link' && x.link === L).map((x) => ({ ...x, from: u })))) {
      const to = g.nodes[e.to];
      const from = g.nodes[e.from];
      if (keep) assert.equal(to.lane, from.lane);
      else assert.equal(to.lane, 0, `link ${L.id} lands in lane ${to.lane}`);
    }
  }
  assert.ok(si >= 0 && seg);
});

test('riding a train you can walk through the carriages to another door', () => {
  const day = Late.day.generateDay('CARWALK', Late.difficulty.paramsFor(1));
  const K = Late.sim.KEY;
  // board the first train from home by autopilot, then walk right inside it
  const sim = Late.sim.createSim(day);
  const ap = Late.autopilot.createAutopilot(day, sim);
  ap.replan();
  while (sim.state.mode !== 'train' && !sim.state.done) sim.step(ap.input());
  const r = sim.state.ride;
  const pos0 = r.pos;
  const dir = pos0 < 60 ? K.RIGHT : K.LEFT;
  for (let i = 0; i < 40; i++) sim.step(dir);
  assert.ok(Math.abs(Math.abs(sim.state.ride.pos - pos0) - RULES.CAR_WALK * RULES.DT * 40) < 1e-9);
  // the solver may plan to get off at a different door than you got on at
  let different = 0;
  for (let i = 0; i < 12; i++) {
    const d = Late.day.generateDay(`CARWALK-${i}`, Late.difficulty.paramsFor(i % 5));
    const best = Late.day.bestRoute(d, Late.day.graphOf(d), d.startTime);
    different += best.stats.steps.filter((x) => x.type === 'ride' && x.doorOut !== x.door).length;
    assert.equal(best.stats.reboards, 0, 'no more hopping off to change cars');
  }
  assert.ok(different > 0);
});

test('a transfer ID check at the stairs makes you queue, then climb', () => {
  let found = null;
  for (let i = 0; i < 60 && !found; i++) {
    const day = Late.day.generateDay(`STAIRCHECK-${i}`, Late.difficulty.paramsFor(4));
    for (const c of day.checkpoints) {
      const L = day.interiors[c.station].links[c.link];
      if (L.axis === 'v' && L.kind === 'stairs') found = { day, c, L };
    }
  }
  assert.ok(found, 'expected some Friday seed to put a checkpoint on transfer stairs');
  const { day, c, L } = found;
  const K = Late.sim.KEY;
  const sim = Late.sim.createSim(day);
  const s = sim.state;
  s.st = day.network.stations.findIndex((q) => q.id === c.station);
  const from = L.check.dir === 1 ? L.a : L.b;
  const to = L.check.dir === 1 ? L.b : L.a;
  s.seg = from.seg;
  s.x = from.x;
  const evs = sim.step(L.check.dir === 1 ? K.DOWN : K.UP);
  assert.equal(s.mode, 'queue');
  assert.ok(evs.some((e) => e.type === 'queue'));
  const wait = s.timerTotal;
  assert.ok(wait >= L.check.wmin - RULES.DT && wait <= L.check.wmax + RULES.DT);
  let n = 0;
  while (s.mode !== 'walk' && n < 5000) {
    sim.step(0);
    n += 1;
  }
  assert.equal(s.seg, to.seg);
  assert.equal(s.x, to.x);
  const stairs = (L.check.dir === 1 ? RULES.STAIRS_DOWN : RULES.STAIRS_UP) * L.levels;
  assert.ok(Math.abs(n + 1 - (wait + stairs) / RULES.DT) <= 1, `took ${n + 1} ticks`);
});
