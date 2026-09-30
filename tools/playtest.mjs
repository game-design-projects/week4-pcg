// Headless playtest: opens index.html straight from disk in Chromium and plays
// real days through the game's own keyboard handler. The "player" is the
// autopilot running inside the page; each tick it decides which keys should
// be down and the script dispatches keydown/keyup events, so the whole path
// (keyboard → input.js → simulation → rendering → result screen) is exercised.
//
//   node tools/playtest.mjs                 play Monday of a fresh week
//   node tools/playtest.mjs --week          play Monday to Friday, shop in between
//   node tools/playtest.mjs --late          dawdle until 09:00 first, expect a LATE result
//   node tools/playtest.mjs --tutorial      a new player: Day 0 with the coach, then Monday,
//                                           both played only by following the on-screen guide
//   node tools/playtest.mjs --shots DIR     save screenshots of every phase to DIR
//
// Needs Playwright (npm i -D playwright, or a global install on NODE_PATH).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const shotsDir = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const seedArg = args.includes('--seed') ? args[args.indexOf('--seed') + 1] : 'PLAYTEST-1';

const url = pathToFileURL(resolve(here, '..', 'index.html')).href;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const requests = [];
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith('file:') && !u.startsWith('data:') && !/fonts\.(googleapis|gstatic)\.com/.test(u)) requests.push(u);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/fonts\.googleapis|fonts\.gstatic|ERR_CERT|ERR_NAME|ERR_INTERNET|net::/.test(m.text())) errors.push(`console: ${m.text()}`);
});

let shotN = 0;
async function shot(name) {
  if (!shotsDir) return;
  shotN += 1;
  await page.screenshot({ path: `${shotsDir}/${String(shotN).padStart(2, '0')}-${name}.png` });
}

async function waitScreen(name, timeout = 240000) {
  await page.waitForFunction((n) => window.__late && window.__late.screen === n, name, { timeout, polling: 200 });
}

/**
 * Install the keyboard driver. `dawdleUntil`: stand still (holding Space) until that game time.
 * `driver`: 'autopilot' (the perfect commuter) or 'guide' (does only what the on-screen route guide says).
 */
async function drive(dawdleUntil, driver = 'autopilot') {
  await page.evaluate(([until, who]) => {
    const game = window.__late;
    const L = window.Late;
    const K = L.sim.KEY;
    const codes = [[K.LEFT, 'ArrowLeft'], [K.RIGHT, 'ArrowRight'], [K.UP, 'ArrowUp'], [K.DOWN, 'ArrowDown'], [K.ACT, 'KeyE']];
    let held = 0;
    let spaceDown = false;
    const send = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
    game.__ap = null;
    game.speedMul = 4;
    game.beforeTick = (s) => {
      if (until && s.t < until) {
        if (!spaceDown) {
          send('keydown', 'Space');
          spaceDown = true;
        }
        return;
      }
      if (spaceDown) {
        send('keyup', 'Space');
        spaceDown = false;
      }
      if (!game.__ap || game.__apSim !== game.sim) {
        if (who === 'guide') {
          if (!game.guide) throw new Error('no route guide on this day');
          game.__ap = { input: L.guide.follow(game.day, game.sim, game.guide, { decide: 8 }) };
        } else {
          game.__ap = L.autopilot.createAutopilot(game.day, game.sim);
          game.__ap.replan();
        }
        game.__apSim = game.sim;
      }
      const want = game.__ap.input();
      for (const [bit, code] of codes) {
        if (want & bit && !(held & bit)) send('keydown', code);
        if (!(want & bit) && held & bit) send('keyup', code);
      }
      held = want;
    };
  }, [dawdleUntil || 0, driver]);
}

async function playDay(label, { dawdle = false, driver = 'autopilot' } = {}) {
  await waitScreen('briefing');
  await page.waitForTimeout(600);
  await shot(`${label}-briefing`);
  const info = await page.evaluate(() => {
    const g = window.__late;
    return { seed: g.day.seed, start: g.day.startTime, par: g.day.par.arrival, weekday: g.weekday, checkpoints: g.day.checkpoints.length, policy: g.policy.day };
  });
  // a fresh start: no autopilot hook from the previous day, no keys held
  await page.evaluate(() => {
    const g = window.__late;
    g.beforeTick = null;
    g.speedMul = 1;
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyE', 'Space']) window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code }));
  });
  await page.click('[data-testid="leave-home"]');
  await waitScreen('play');
  // keyboard sanity check before the autopilot takes over: holding → must move the player
  const x0 = await page.evaluate(() => window.__late.sim.state.x);
  await page.keyboard.down(info.start ? 'ArrowRight' : 'ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  const x1 = await page.evaluate(() => window.__late.sim.state.x);
  if (x1 === x0) throw new Error('keyboard input did not move the player');
  await drive(dawdle ? 9 * 3600 + 60 : 0, driver);
  // screenshots along the way: in a station and on a train
  let sawTrain = false;
  let sawStation = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const st = await page.evaluate(() => ({ screen: window.__late.screen, mode: window.__late.sim && window.__late.sim.state.mode, t: window.__late.sim && window.__late.sim.state.t }));
    if (st.screen === 'result') break;
    if (st.mode === 'train' && !sawTrain) {
      await page.waitForTimeout(250);
      await shot(`${label}-train`);
      sawTrain = true;
    } else if (st.mode === 'walk' && sawTrain && !sawStation) {
      await page.waitForTimeout(200);
      await shot(`${label}-transfer`);
      sawStation = true;
    }
    await page.waitForTimeout(150);
  }
  await waitScreen('result', 10000);
  await page.waitForTimeout(700);
  await shot(`${label}-result`);
  const r = await page.evaluate(() => {
    const g = window.__late;
    const res = g.lastResult;
    const stamp = document.querySelector('.stamp');
    return { arrival: res.arrival, margin: res.margin, late: res.late, how: res.how, stamp: stamp && stamp.textContent, heading: document.querySelector('.result h2').textContent, ticks: res.ticks, inputs: res.inputs.length };
  });
  // the recorded inputs must replay to exactly the same arrival (what the leaderboard relies on)
  const replay = await page.evaluate(() => {
    const g = window.__late;
    const again = window.Late.sim.replay(g.day, g.lastResult.inputs);
    return again.result ? again.result.arrival : null;
  });
  const fmt = (t) => (t === null ? '—' : new Date(t * 1000).toISOString().slice(11, 19));
  console.log(`${label}: seed ${info.seed} (${info.policy}, ${info.checkpoints} checkpoints) left ${fmt(info.start)} → ${r.how} ${fmt(r.arrival)} (par ${fmt(info.par)}), margin ${Math.round(r.margin)} s, stamp "${r.stamp}", replay ${fmt(replay)}`);
  if (replay !== r.arrival) throw new Error(`replay mismatch: ${replay} vs ${r.arrival}`);
  return { ...r, info };
}

try {
  await page.goto(url);
  await waitScreen('title', 20000);
  await page.waitForTimeout(800);
  // first run: the telemetry consent card is up; keep data on this device
  if (await page.$('[data-testid="consent-decline"]')) {
    await shot('consent');
    await page.click('[data-testid="consent-decline"]');
  }
  await shot('title');
  const results = [];
  if (flag('--daily')) {
    await page.evaluate(() => window.__late.startDaily());
    const r = await playDay('daily');
    if (r.how !== 'office') throw new Error('expected to reach the office');
    const lb = await page.evaluate(() => (document.querySelector('.lb') || {}).textContent || '');
    console.log(`leaderboard block: ${lb.trim()}`);
    if (!/not deployed/i.test(lb)) throw new Error('expected the leaderboard to say it is not deployed');
    results.push(r);
  } else if (flag('--tutorial')) {
    // a new player: the title puts the tutorial first
    const first = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="tutorial"]');
      return !!b && b.classList.contains('primary');
    });
    if (!first) throw new Error('expected the tutorial to be the first choice for a new player');
    await page.click('[data-testid="tutorial"]');
    await waitScreen('briefing');
    await page.waitForTimeout(600);
    await shot('tutorial-briefing');
    await page.click('[data-testid="leave-home"]');
    await waitScreen('play');
    await drive(0, 'guide');
    const shown = [];
    let usedMap = false;
    let usedTimetable = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      const st = await page.evaluate(() => ({ screen: window.__late.screen, lesson: window.__late.coach && window.__late.coach.current }));
      if (st.screen !== 'play') break;
      if (st.lesson && !shown.includes(st.lesson)) {
        shown.push(st.lesson);
        await shot(`tutorial-${st.lesson}`);
      }
      // do what the coach asks
      if (st.lesson === 'map' && !usedMap) {
        usedMap = true;
        await page.keyboard.press('KeyM');
        await page.waitForTimeout(300);
        await page.keyboard.press('KeyM');
      }
      if (st.lesson === 'timetable' && !usedTimetable) {
        usedTimetable = true;
        await page.keyboard.press('KeyT');
        await page.waitForTimeout(300);
        await shot('tutorial-timetable-open');
        await page.keyboard.press('KeyT');
      }
      await page.waitForTimeout(100);
    }
    await waitScreen('result', 10000);
    await page.waitForTimeout(500);
    await shot('tutorial-result');
    const tr = await page.evaluate(() => ({ r: window.__late.lastResult, all: window.Late.coach.LESSONS.length, done: window.__late.tutorialDone() }));
    console.log(`tutorial: ${tr.r.how} ${Math.round(tr.r.margin)} s early · lessons shown ${shown.join(' → ')} · learned ${tr.r.learned.length}/${tr.all}`);
    if (tr.r.how !== 'office' || tr.r.late) throw new Error('expected to finish the tutorial on time');
    if (tr.r.learned.length !== tr.all) throw new Error(`lessons not learned: ${tr.r.missed.join(', ')}`);
    if (!tr.done) throw new Error('the tutorial should be remembered as done');
    results.push(tr.r);
    // straight on into the week: Monday, played by following the guide only
    await page.click('[data-testid="tutorial-start-week"]');
    const mon = await playDay('mon', { driver: 'guide' });
    if (mon.how !== 'office' || mon.late) throw new Error('expected Monday on time by following the guide');
    const guide = await page.evaluate(() => window.__late.policy.guide);
    if (guide !== 'path') throw new Error(`Monday should show the route guide, got ${guide}`);
    results.push(mon);
  } else if (flag('--late')) {
    await page.evaluate((seed) => window.__late.startCustom(seed, 1), seedArg);
    const r = await playDay('late', { dawdle: true });
    if (!r.late || !/LATE/.test(r.stamp)) throw new Error('expected a LATE result');
    results.push(r);
  } else {
    await page.evaluate((seed) => window.__late.startWeek(seed), seedArg);
    const days = flag('--week') ? 5 : 1;
    for (let d = 0; d < days; d++) {
      const r = await playDay(['mon', 'tue', 'wed', 'thu', 'fri'][d]);
      if (r.how !== 'office' || r.late || !/ON TIME/.test(r.stamp)) throw new Error(`expected an ON TIME arrival on day ${d + 1}`);
      results.push(r);
      if (d < days - 1) {
        await page.click('[data-testid="next-day"]');
        await waitScreen('shop');
        await shot(`shop-${d + 1}`);
        await page.click('[data-testid="sleep"]');
      }
    }
    if (days === 5) {
      await page.click('[data-testid="next-day"]');
      await waitScreen('week');
      await page.waitForTimeout(400);
      await shot('week-summary');
    }
  }
  const tele = await page.evaluate(() => ({ consent: window.Late.telemetry.settings.consent, sessions: window.Late.telemetry.sessions.length, endpoint: window.Late.config.TELEMETRY_ENDPOINT }));
  console.log(`telemetry: consent ${tele.consent}, ${tele.sessions} session(s) kept on this device, endpoint ${tele.endpoint}`);
  if (tele.sessions < results.length) throw new Error('expected every played day to be recorded locally');
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  if (requests.length) throw new Error(`unexpected network requests: ${requests.join(', ')}`);
  console.log(`PASS — ${results.length} day(s) played in the browser, no data left the page`);
} catch (e) {
  console.error('FAIL', e.message);
  if (errors.length) console.error(errors.join('\n'));
  await shot('failure');
  process.exitCode = 1;
} finally {
  await browser.close();
}
