// What the generator builds: hubs from several linked blocks in each flavour,
// timetables and checkpoints, and a week that shows less and checks more.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Late = require('../src/core/index.js');

const P = (wd) => Late.difficulty.paramsFor(wd);

test('every day has at least one hub, built from three or more linked blocks', () => {
  for (let i = 0; i < 12; i++) {
    const day = Late.day.generateDay(`HUB-${i}`, P(i % 5));
    const hubs = day.network.stations.filter((s) => s.kind === 'hub');
    assert.ok(hubs.length >= 1, day.seed);
    for (const h of hubs) {
      const I = day.interiors[h.id];
      assert.ok(h.lines.length >= 3);
      assert.ok(I.blocks.length >= 3, `${day.seed} ${h.id} has ${I.blocks.length} blocks`);
      assert.ok(I.layout.startsWith('hub-'));
      // blocks sit side by side and are linked: passages or an underpass join them
      const bx = I.blocks.map((b) => b.bx);
      assert.deepEqual(bx, [...bx].sort((a, b) => a - b));
      assert.ok(I.segs.some((s) => s.kind === 'passage' || s.kind === 'underpass'));
    }
  }
});

function hubsOfFlavor(flavor, want = 2) {
  const found = [];
  for (let i = 0; i < 60 && found.length < want; i++) {
    const day = Late.day.generateDay(`FLAVOR-${flavor}-${i}`, { ...P(3), hubFlavors: [flavor] });
    for (const s of day.network.stations) if (s.kind === 'hub') found.push({ day, I: day.interiors[s.id] });
  }
  assert.ok(found.length >= 1, `no ${flavor} hub`);
  return found;
}

test('hub flavours build what they promise', () => {
  for (const { I } of hubsOfFlavor('sprawl')) {
    const passages = I.segs.filter((s) => s.kind === 'passage');
    const longest = Math.max(...passages.map((s) => s.x1 - s.x0));
    assert.ok(passages.reduce((a, s) => a + s.x1 - s.x0, 0) > 200, 'sprawl: long passages between blocks');
    assert.ok(longest > 30);
  }
  for (const { I } of hubsOfFlavor('maze')) {
    assert.ok(I.segs.filter((s) => s.flow === 'one-way').length >= 4, 'maze: paired one-way passages');
    assert.ok(new Set(I.segs.filter((s) => s.flow === 'one-way').map((s) => s.dir)).size === 2, 'maze: both directions exist');
  }
  for (const { I } of hubsOfFlavor('split')) {
    assert.ok(I.splitGate !== undefined, 'split: a re-entry gate');
    assert.ok(I.segs.some((s) => s.kind === 'underpass'), 'split: an unpaid underpass joins the halves');
  }
  for (const { I } of hubsOfFlavor('deep')) {
    assert.ok(I.segs.some((s) => s.kind === 'hall'), 'deep: transfer halls between levels');
    assert.ok(I.maxDepth >= 3, 'deep: platforms several levels down');
    assert.ok(I.links.some((l) => l.kind === 'lift'), 'deep: a lift');
  }
});

test('interiors have multiple levels, gates, escalators and platforms for every line', () => {
  const day = Late.day.generateDay('LEVELS', P(2));
  for (const st of day.network.stations) {
    const I = day.interiors[st.id];
    assert.ok(I.maxDepth >= 2, `${st.id} has a street, a concourse and platforms`);
    assert.ok(I.links.some((l) => l.kind === 'gate'));
    assert.ok(I.exits.length >= 1);
    for (const line of st.lines) {
      for (const dir of [0, 1]) {
        assert.ok(I.platforms.some((p) => ['far', 'near'].some((side) => p.tracks[side] && p.tracks[side].line === line && p.tracks[side].dir === dir)), `${st.id} ${line}/${dir}`);
      }
    }
  }
});

test('timetables: every line runs both ways all morning; some lines are irregular later in the week', () => {
  const mon = Late.day.generateDay('TT', P(0));
  for (const s of mon.timetable.services) {
    assert.ok(s.deps.length > 20);
    for (let j = 1; j < s.deps.length; j++) assert.ok(s.deps[j] > s.deps[j - 1]);
    assert.equal(s.irregular, false);
  }
  let irregular = 0;
  for (let i = 0; i < 6; i++) irregular += Late.day.generateDay(`TT-${i}`, P(4)).timetable.services.filter((s) => s.irregular).length;
  assert.ok(irregular > 0);
});

test('checkpoints increase through the week (generator parameter) and sit on the best route', () => {
  const avg = [];
  for (let wd = 0; wd < 5; wd++) {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const day = Late.day.generateDay(`CP-${wd}-${i}`, P(wd));
      n += day.checkpoints.length;
      for (const c of day.checkpoints) {
        const L = day.interiors[c.station].links[c.link];
        assert.ok(L.check && L.check.wmax > L.check.wmin);
      }
    }
    avg.push(n / 5);
  }
  for (let wd = 1; wd < 5; wd++) assert.ok(avg[wd] >= avg[wd - 1], `checkpoints ${avg.join(', ')}`);
  assert.equal(avg[0], 0);
  assert.ok(avg[4] >= 3);
});

test('less information is shown each weekday (display setting, not the generator)', () => {
  const scores = [0, 1, 2, 3, 4].map((wd) => Late.display.informationScore(Late.display.policyFor(wd)));
  for (let wd = 1; wd < 5; wd++) assert.ok(scores[wd] < scores[wd - 1], `information ${scores.join(', ')}`);
  // the policy is not a generator input: the same seed and params give the same day whatever is shown
  const params = P(2);
  const a = Late.day.generateDay('DISPLAY', params);
  const b = Late.day.generateDay('DISPLAY', params);
  assert.equal(JSON.stringify(a.par), JSON.stringify(b.par));
  assert.equal(Object.keys(params).some((k) => /board|sign|glance|briefing|phone/i.test(k)), false);
  // aids loosen the policy without touching the day
  const fri = Late.display.policyFor(4);
  const friAided = Late.display.policyFor(4, ['powerbank', 'app']);
  assert.ok(Late.display.informationScore(friAided) > Late.display.informationScore(fri));
});

test('the Director only nudges parameters', () => {
  const late = Late.difficulty.direct([{ margin: -400 }, { margin: -250 }]);
  const early = Late.difficulty.direct([{ margin: 500 }, { margin: 420 }]);
  assert.equal(late.mood, 'easing');
  assert.equal(early.mood, 'tightening');
  const eased = Late.difficulty.paramsFor(3, late);
  const tight = Late.difficulty.paramsFor(3, early);
  assert.ok(eased.slack > Late.difficulty.paramsFor(3).slack);
  assert.ok(tight.slack < Late.difficulty.paramsFor(3).slack);
  assert.ok(eased.checkWait[1] < tight.checkWait[1]);
});

test('wayfinding signs point along a shortest walk', () => {
  const day = Late.day.generateDay('SIGNS', P(1));
  const g = Late.day.graphOf(day);
  const signs = Late.wayfinding.stationSigns(day, g, day.network.hubId);
  assert.ok(signs.length > 10);
  for (const s of signs) for (const it of s.items) assert.ok(['left', 'right', 'up', 'down'].includes(it.arrow));
});

test('excuses are built from what went wrong', () => {
  const day = Late.day.generateDay('EXCUSE', P(4));
  const st = Late.autopilot.playDay(day);
  const ex = Late.excuses.excuseFor(day, st);
  assert.ok(ex.text.length > 20 && ex.reply.length > 1);
});
