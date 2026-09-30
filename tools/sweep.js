// Late — the improvement loop's measuring stick. Generates many seeded days
// per weekday, runs them through the solver, the deadline map, the perfect
// autopilot and a hesitant "human" autopilot, and flags days that look
// trivial, unfair or dull. The seeds are fixed, so two versions of the
// generator can be compared day for day.
//
//   node tools/sweep.js                       40 seeds per weekday, summary to stdout
//   node tools/sweep.js --n 80 --out docs/sweeps/0.2.md --json docs/sweeps/0.2.json
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Late = require('../src/core/index.js');

const { RULES, fmtClock } = Late.rules;
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const N = Number(opt('--n', 40));
const OUT = opt('--out', null);
const JSON_OUT = opt('--json', null);
const LABEL = opt('--label', `generator ${Late.day.GEN_VERSION}`);
const HUMAN = { decide: 10, board: 8 }; // game seconds: ~0.8 s to read a sign, ~0.7 s to step in, at 12x

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pct = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};
const share = (a) => (a.length ? a.filter(Boolean).length / a.length : 0);

function analyse(day, genMs) {
  const P = day.params;
  const g = Late.day.graphOf(day);
  const { home, office } = Late.day.endNodes(day, g);
  const best = Late.day.bestRoute(day, g, day.startTime, 'max');
  const st = best.stats;
  // deadline map for the perfect player with worst-case queues
  const LD = Late.solver.latestDepartures(day, g, office, RULES.CLOCK_IN, { checkWait: 'max' });
  const tolStart = LD[home] - day.startTime;
  // the same for a human-paced commuter (what the generator aims its slack at)
  const LDh = Late.solver.latestDepartures(day, g, office, RULES.CLOCK_IN, { checkWait: 'max', reaction: HUMAN });
  const tolHuman = LDh[home] - day.startTime;
  const typical = Late.day.bestRoute(day, g, day.startTime, 'mean');
  let bottleneck = Infinity;
  let knife = 0;
  for (const h of best.hops) {
    const tol = LD[h.node] - h.t;
    bottleneck = Math.min(bottleneck, tol);
    if (tol < 10) knife += 1;
  }
  // corridor exposure on the best route
  let opposing = 0;
  let oneway = 0;
  let escalators = 0;
  let lifts = 0;
  let hubTransfer = 0;
  const steps = st.steps;
  for (const s of steps) {
    const I = day.interiors[day.network.stations[s.st].id];
    if (s.type === 'walk') {
      const seg = I.segs[s.seg];
      if (seg.flow === 'opposing') opposing += 1;
      if (seg.flow === 'one-way') oneway += 1;
    }
    if (s.type === 'link' && s.kind === 'escalator') escalators += 1;
    if (s.type === 'link' && s.kind === 'lift') lifts += 1;
  }
  // time spent inside a hub between getting off and getting on
  const rides = steps.filter((s) => s.type === 'ride');
  for (let i = 1; i < rides.length; i++) {
    const sv = day.timetable.services[rides[i].service];
    const stId = sv.stops[rides[i].from];
    if (day.network.stations.find((x) => x.id === stId).kind === 'hub') hubTransfer = Math.max(hubTransfer, rides[i].dep - rides[i - 1].t);
  }
  // effect of the checkpoints: best arrival without them
  const saved = [];
  for (const I of Object.values(day.interiors)) for (const l of I.links) if (l.check) {
    saved.push([l, l.check]);
    delete l.check;
  }
  const noChecks = Late.day.bestRoute(day, g, day.startTime, 'max');
  for (const [l, c] of saved) l.check = c;
  const checkCost = noChecks ? best.arrival - noChecks.arrival : 0;
  // play it: perfect and hesitant
  const perfect = Late.autopilot.playDay(day);
  const human = Late.autopilot.playDay(day, { reaction: HUMAN });
  const total = st.total;
  return {
    seed: day.seed,
    attempts: day.attempt + 1,
    rejected: day.rejected,
    genMs: Math.round(genMs),
    slack: P.slack,
    spare: Math.round(RULES.CLOCK_IN - best.arrival),
    tolStart: Math.round(tolStart),
    tolHuman: Math.round(tolHuman),
    checksOnTypical: typical ? typical.stats.checks : 0,
    checkAvoid: day.checkpoints.map((c) => c.avoid ?? null),
    bottleneck: Math.round(bottleneck),
    knife,
    trip: Math.round(total),
    transfers: st.transfers,
    reboards: st.reboards,
    lines: st.lines.join('>'),
    hub: st.hubsVisited.length > 0,
    hubTransfer: Math.round(hubTransfer),
    checksOnRoute: st.checks,
    checkpoints: day.checkpoints.length,
    checkCost: Math.round(checkCost),
    disruptions: day.disruptions.length,
    walkShare: +(st.walking / total).toFixed(3),
    rideShare: +(st.riding / total).toFixed(3),
    opposing,
    oneway,
    escalators,
    lifts,
    perfectArrival: perfect.result.arrival,
    perfectDiff: perfect.result.arrival === null ? null : +(perfect.result.arrival - best.arrival).toFixed(2),
    humanMargin: Math.round(human.result.margin),
    humanLate: human.result.late,
  };
}

function flags(r) {
  const f = [];
  if (r.tolHuman > r.slack + 120) f.push('trivial:loose-start');
  if (r.tolHuman < r.slack - 1) f.push('unfair:tight-start');
  if (r.checkpoints > 0 && r.checksOnRoute === 0 && r.checksOnTypical === 0) f.push('trivial:checkpoints-never-met');
  if (r.humanLate) f.push('unfair:human-late');
  if (r.bottleneck < 10) f.push('unfair:knife-edge');
  if (r.perfectDiff === null || r.perfectDiff > 0.5) f.push('unfair:sim-slower-than-promised');
  if (r.reboards > 0) f.push('odd:car-change-reboard');
  if (r.rideShare > 0.7) f.push('dull:mostly-riding');
  if (r.opposing + r.oneway === 0) f.push('dull:no-special-corridor');
  if (r.hub && r.hubTransfer < 90) f.push('dull:easy-hub');
  return f;
}

function main() {
  const rows = [];
  const t0 = Date.now();
  for (let wd = 0; wd < 5; wd++) {
    const P = Late.difficulty.paramsFor(wd);
    for (let i = 0; i < N; i++) {
      const seed = `SWEEP-${i}`;
      const g0 = Date.now();
      let day;
      try {
        day = Late.day.generateDay(seed, P);
      } catch (e) {
        rows.push({ weekday: wd, seed, failed: e.message, flags: ['broken:no-day'] });
        continue;
      }
      const r = analyse(day, Date.now() - g0);
      r.weekday = wd;
      r.flags = flags(r);
      rows.push(r);
    }
    process.stderr.write(`${Late.difficulty.WEEK[wd].day} done\n`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const lines = [];
  lines.push(`# Sweep — ${LABEL}`);
  lines.push('');
  lines.push(`${N} seeds per weekday (SWEEP-0 … SWEEP-${N - 1}), ${rows.length} days, ${secs} s. Human model: ${HUMAN.decide} s pause before every link, ${HUMAN.board} s extra margin to board.`);
  lines.push('');
  const cols = [
    ['attempts (mean)', (rs) => (rs.reduce((a, r) => a + r.attempts, 0) / rs.length).toFixed(2)],
    ['gen ms (median)', (rs) => median(rs.map((r) => r.genMs))],
    ['target slack s', (rs) => rs[0].slack],
    ['time a human-paced player can lose, s (p10 / median / p90)', (rs) => `${pct(rs.map((r) => r.tolHuman), 10)} / ${median(rs.map((r) => r.tolHuman))} / ${pct(rs.map((r) => r.tolHuman), 90)}`],
    ['time a perfect player can lose, s (p10 / median / p90)', (rs) => `${pct(rs.map((r) => r.tolStart), 10)} / ${median(rs.map((r) => r.tolStart))} / ${pct(rs.map((r) => r.tolStart), 90)}`],
    ['route bottleneck s (median)', (rs) => median(rs.map((r) => r.bottleneck))],
    ['knife-edge days', (rs) => `${Math.round(share(rs.map((r) => r.bottleneck < 10)) * 100)}%`],
    ['hesitant human late', (rs) => `${Math.round(share(rs.map((r) => r.humanLate)) * 100)}%`],
    ['trip min (median)', (rs) => (median(rs.map((r) => r.trip)) / 60).toFixed(1)],
    ['transfers (mean)', (rs) => (rs.reduce((a, r) => a + r.transfers, 0) / rs.length).toFixed(2)],
    ['car-change reboards', (rs) => `${Math.round(share(rs.map((r) => r.reboards > 0)) * 100)}%`],
    ['route via hub', (rs) => `${Math.round(share(rs.map((r) => r.hub)) * 100)}%`],
    ['hub transfer s (median, hub days)', (rs) => median(rs.filter((r) => r.hub).map((r) => r.hubTransfer))],
    ['checkpoints (mean)', (rs) => (rs.reduce((a, r) => a + r.checkpoints, 0) / rs.length).toFixed(2)],
    ['checkpoints on best route (mean)', (rs) => (rs.reduce((a, r) => a + r.checksOnRoute, 0) / rs.length).toFixed(2)],
    ['checkpoints on typical-wait route (mean)', (rs) => (rs.reduce((a, r) => a + r.checksOnTypical, 0) / rs.length).toFixed(2)],
    ['detour around a checkpoint s (median)', (rs) => median(rs.flatMap((r) => (r.checkAvoid || []).filter((v) => v !== null && v !== undefined)))],
    ['cost of checkpoints s (median)', (rs) => median(rs.map((r) => r.checkCost))],
    ['riding share (median)', (rs) => median(rs.map((r) => r.rideShare)).toFixed(2)],
    ['route walks an opposing/one-way corridor', (rs) => `${Math.round(share(rs.map((r) => r.opposing + r.oneway > 0)) * 100)}%`],
    ['perfect autopilot later than promised', (rs) => `${Math.round(share(rs.map((r) => r.perfectDiff === null || r.perfectDiff > 0.5)) * 100)}%`],
  ];
  lines.push(`| metric | ${Late.difficulty.WEEK.map((w) => w.day).join(' | ')} |`);
  lines.push(`|---|${Late.difficulty.WEEK.map(() => '---').join('|')}|`);
  const byDay = [0, 1, 2, 3, 4].map((wd) => rows.filter((r) => r.weekday === wd && !r.failed));
  for (const [name, fn] of cols) lines.push(`| ${name} | ${byDay.map((rs) => (rs.length ? fn(rs) : '—')).join(' | ')} |`);
  lines.push('');
  const allFlags = {};
  for (const r of rows) for (const f of r.flags) {
    allFlags[f] = allFlags[f] || [0, 0, 0, 0, 0];
    allFlags[f][r.weekday] += 1;
  }
  lines.push('## Flags (days out of each weekday\'s sample)');
  lines.push('');
  lines.push(`| flag | ${Late.difficulty.WEEK.map((w) => w.day).join(' | ')} |`);
  lines.push(`|---|${Late.difficulty.WEEK.map(() => '---').join('|')}|`);
  for (const [f, counts] of Object.entries(allFlags).sort()) lines.push(`| ${f} | ${counts.join(' | ')} |`);
  lines.push('');
  const reasons = {};
  for (const r of rows) for (const why of r.rejected || []) {
    const k = why.replace(/\(.*\)/, '').trim();
    reasons[k] = (reasons[k] || 0) + 1;
  }
  lines.push('## Why attempts were thrown away');
  lines.push('');
  for (const [k, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${n}`);
  if (!Object.keys(reasons).length) lines.push('- none');
  lines.push('');
  lines.push('## Worst offenders');
  lines.push('');
  const worst = rows.filter((r) => r.flags.some((f) => f.startsWith('unfair'))).slice(0, 8);
  for (const r of worst) lines.push(`- ${Late.difficulty.WEEK[r.weekday].day} ${r.seed}: ${r.flags.join(', ')} (human can lose ${r.tolHuman} s, perfect ${r.tolStart} s, bottleneck ${r.bottleneck} s, human margin ${r.humanMargin} s)`);
  if (!worst.length) lines.push('- none');
  const report = lines.join('\n');
  console.log(report);
  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${report}\n`);
  }
  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
  }
}

main();
