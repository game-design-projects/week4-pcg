// UI audit: finds text that overlaps other text, text hidden under a panel
// drawn after it, and text cut off at the edge, at several window sizes.
//
// For each window size it opens index.html from disk in Chromium and walks
// through the game: the title, Day 0 with the coach, Monday with the route
// guide, a Thursday hub, trains, the phone map, the timetable, help, pause,
// results, the shop and the week summary. On the canvas it records every
// piece of text drawn in a frame (by wrapping the game's own text helper) and
// every opaque panel; in the HTML overlays it measures every line of text.
//
//   node tools/ui-audit.mjs                       all sizes
//   node tools/ui-audit.mjs --sizes 1280x720      just one
//   node tools/ui-audit.mjs --shots DIR           save a screenshot of every audited moment
//   node tools/ui-audit.mjs --json FILE           write the findings as JSON
//
// Exits non-zero if anything is found. Needs Playwright.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const SIZES = opt('--sizes', '1280x720,1920x1080,1366x768,1024x768,800x600,2560x1080,844x390').split(',').map((s) => s.split('x').map(Number));
const shotsDir = args.includes('--shots') ? resolve(opt('--shots')) : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const url = pathToFileURL(resolve(here, '..', 'index.html')).href;

const issues = new Map(); // key -> {kind, where, a, b, sizes:Set}
function report(kind, where, a, b, size) {
  const key = `${kind}|${where}|${a}|${b || ''}`;
  if (!issues.has(key)) issues.set(key, { kind, where, a, b, sizes: new Set() });
  issues.get(key).sizes.add(size);
}

/** Installed in the page: wraps the text and panel helpers to record boxes in game units. */
function instrument() {
  const L = window.Late;
  const G = L.gfx;
  const game = window.__late;
  if (G.__audited) return;
  G.__audited = true;
  window.__rec = null;
  let order = 0;
  const alphaOf = (fill) => {
    if (!fill || typeof fill !== 'string') return 0;
    const m = fill.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((x) => parseFloat(x));
      return p.length > 3 ? p[3] : 1;
    }
    return fill.startsWith('#') ? (fill.length === 9 ? parseInt(fill.slice(7), 16) / 255 : 1) : 0;
  };
  const box = (ctx, x0, y0, x1, y1) => {
    const m = ctx.getTransform();
    const onGame = ctx.canvas.id === 'game';
    const base = onGame ? game.dpr * game.scale : 1;
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [(m.a * x + m.c * y + m.e) / base, (m.b * x + m.d * y + m.f) / base]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    // the game says which layer it is drawing: the scene ('world', station or train), the HUD over it,
    // or a modal on top of everything (the phone map)
    const layer = onGame ? game.drawLayer || 'world' : 'map';
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), layer };
  };
  const text = G.text;
  G.text = function (ctx, str, x, y, o = {}) {
    const w = text.apply(this, arguments);
    const rec = window.__rec;
    if (rec && ctx.canvas && (ctx.canvas.id === 'game' || ctx.canvas.__audit) && str !== undefined && String(str).trim() && ctx.globalAlpha > 0.2) {
      const size = o.size || 14;
      const align = o.align || 'left';
      const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      const base = o.baseline || 'alphabetic';
      const top = base === 'middle' ? y - size / 2 : base === 'top' ? y : y - size * 0.76;
      const bottom = base === 'middle' ? y + size / 2 : base === 'top' ? y + size : y + size * 0.2;
      rec.push({ t: 'text', s: String(str), n: order++, bd: !!o.backdrop, ...box(ctx, left, top, left + w, bottom) });
    }
    return w;
  };
  const rr = G.roundRect;
  G.roundRect = function (ctx, x, y, w, h, r, fill) {
    const out = rr.apply(this, arguments);
    const rec = window.__rec;
    if (rec && ctx.canvas && (ctx.canvas.id === 'game' || ctx.canvas.__audit) && alphaOf(fill) * ctx.globalAlpha >= 0.8 && w > 4 && h > 4) {
      // the game marks the clip rectangle when it clips (trains at the platform ends)
      const c = ctx.__clipRect;
      const x0 = c ? Math.max(x, c[0]) : x;
      const y0 = c ? Math.max(y, c[1]) : y;
      const x1 = c ? Math.min(x + w, c[2]) : x + w;
      const y1 = c ? Math.min(y + h, c[3]) : y + h;
      if (x1 - x0 > 4 && y1 - y0 > 4) rec.push({ t: 'panel', n: order++, ...box(ctx, x0, y0, x1, y1) });
    }
    return out;
  };
}

/** Record one rendered frame (with the game paused) and return the boxes. */
async function recordFrame(page) {
  return page.evaluate(
    () =>
      new Promise((done) => {
        const game = window.__late;
        const was = game.paused;
        game.paused = true;
        requestAnimationFrame(() => {
          window.__rec = [];
          requestAnimationFrame(() => {
            const rec = window.__rec;
            window.__rec = null;
            game.paused = was;
            done({ rec, W: game.W, H: game.H });
          });
        });
      }),
  );
}

const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const area = (a) => (a.x1 - a.x0) * (a.y1 - a.y0);

function analyseCanvas({ rec, W, H }, where, size) {
  const texts = rec.filter((r) => r.t === 'text');
  const panels = rec.filter((r) => r.t === 'panel');
  const onScreen = (r) => r.x1 > 0 && r.x0 < W && r.y1 > 0 && r.y0 < H;
  for (let i = 0; i < texts.length; i++) {
    const a = texts[i];
    if (!onScreen(a)) continue;
    if (a.layer === 'modal') continue; // the phone map covers everything on purpose
    if ((a.layer === 'hud' || a.layer === 'map') && (a.x0 < -1 || a.x1 > W + 1 || a.y0 < -1 || a.y1 > H + 1)) report('cut off at the screen edge', where, a.s, null, size);
    for (let j = i + 1; j < texts.length; j++) {
      const b = texts[j];
      if (a.layer !== b.layer || !onScreen(b)) continue;
      if (a.s === b.s && Math.abs(a.x0 - b.x0) < 1 && Math.abs(a.y0 - b.y0) < 1) continue; // drawn twice on purpose (outline)
      const o = inter(a, b);
      if (o > 6 && o > 0.08 * Math.min(area(a), area(b))) report('text overlaps text', where, a.s, b.s, size);
    }
    // a panel drawn later in the same layer that hides most of this text (wall plates behind trains are fine)
    if (a.bd) continue;
    for (const p of panels) {
      if (p.n <= a.n || p.layer !== a.layer) continue;
      if (inter(a, p) > 0.3 * area(a)) {
        const cover = texts.find((t) => t.n > p.n && inter(t, p) > 0.5 * area(t));
        report('text hidden under a panel', where, a.s, cover ? `panel of "${cover.s}"` : 'a panel', size);
      }
    }
  }
}

/** HTML overlays: lines of text that overlap, and text outside the stage. */
async function auditDom(page, where, size) {
  const found = await page.evaluate(() => {
    const out = [];
    const ov = document.getElementById('overlay');
    if (!ov || ov.hidden) return out;
    const stage = document.getElementById('stage').getBoundingClientRect();
    // a card taller than the screen must still start on screen, so the rest can be scrolled to
    const card = ov.firstElementChild;
    if (card && ov.scrollTop === 0 && card.getBoundingClientRect().top < ov.getBoundingClientRect().top - 1) out.push(['top of the card out of reach', card.className, null]);
    const lines = [];
    const walker = document.createTreeWalker(ov, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) lines.push({ s: n.textContent.trim().slice(0, 50), el, r });
    }
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i];
      // text wider than the stage (a horizontal scrollbar would be needed)
      if (a.r.left < stage.left - 1 || a.r.right > stage.right + 1) out.push(['cut off at the screen edge', a.s, null]);
      // text that spills out of its own element's box (clipped or overlapping the next element)
      const box = a.el.getBoundingClientRect();
      const cs = getComputedStyle(a.el);
      if (cs.overflow !== 'visible' && (a.r.right > box.right + 1 || a.r.bottom > box.bottom + 1)) out.push(['text clipped by its box', a.s, null]);
      for (let j = i + 1; j < lines.length; j++) {
        const b = lines[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 3) out.push(['text overlaps text', a.s, b.s]);
      }
    }
    return out;
  });
  for (const [kind, a, b] of found) report(kind, where, a, b, size);
  return found.length;
}

/** The metro map (briefing, result and phone sizes): station labels must not collide. */
async function auditMap(page, where, size) {
  const frames = await page.evaluate(() => {
    const out = [];
    for (const [w, h] of [[640, 430], [760, 480], [540, 360]]) {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      cv.__audit = true;
      window.__rec = [];
      window.Late.viewMap.drawMap(cv.getContext('2d'), window.__late.day, { x: 0, y: 0, w, h }, { labels: 'all' });
      out.push({ rec: window.__rec, W: w, H: h });
      window.__rec = null;
    }
    return out;
  });
  for (const f of frames) analyseCanvas(f, `${where} map at ${f.W}x${f.H}`, size);
}

let shotN = 0;
async function snap(page, label) {
  if (!shotsDir) return;
  shotN += 1;
  await page.screenshot({ path: `${shotsDir}/${String(shotN).padStart(3, '0')}-${label}.png` });
}

async function canvasAt(page, where, size) {
  const frame = await recordFrame(page);
  analyseCanvas(frame, where, size);
  await snap(page, `${size}-${where}`.replace(/[^\w.-]+/g, '_'));
}

async function screen(page) {
  return page.evaluate(() => window.__late.screen);
}

/** Drive the current day with the route guide (or the autopilot), stopping at interesting moments. */
async function playAndAudit(page, label, size, { driver = 'guide', moments }) {
  await page.evaluate((who) => {
    const g = window.__late;
    const L = window.Late;
    const K = L.sim.KEY;
    const codes = [[K.LEFT, 'ArrowLeft'], [K.RIGHT, 'ArrowRight'], [K.UP, 'ArrowUp'], [K.DOWN, 'ArrowDown'], [K.ACT, 'KeyE']];
    let held = 0;
    const input = who === 'guide' && g.guide ? L.guide.follow(g.day, g.sim, g.guide, { decide: 4 }) : (() => {
      const ap = L.autopilot.createAutopilot(g.day, g.sim);
      ap.replan();
      return () => ap.input();
    })();
    g.speedMul = 3;
    g.beforeTick = () => {
      const want = input();
      for (const [bit, code] of codes) {
        if (want & bit && !(held & bit)) window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        if (!(want & bit) && held & bit) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      }
      held = want;
    };
  }, driver);
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const st = await page.evaluate(() => {
      const g = window.__late;
      const s = g.sim && g.sim.state;
      if (!s) return { screen: g.screen };
      const stn = g.day.network.stations[s.st];
      const seg = g.day.interiors[stn.id].segs[s.seg];
      const sv = s.ride ? g.day.timetable.services[s.ride.service] : null;
      const pos = sv ? window.Late.timetable.tripPosition(sv, s.ride.trip, s.t) : null;
      return { screen: g.screen, paused: g.paused, mode: s.mode, kind: stn.kind, seg: seg.kind, lesson: g.coach && g.coach.current, train: pos && pos.state, st: s.st };
    });
    if (st.screen !== 'play') break;
    for (const m of moments) {
      const key = m.key(st);
      if (key && !seen.has(key)) {
        seen.add(key);
        if (m.before) await m.before(page);
        await canvasAt(page, `${label}: ${key}`, size);
        if (m.dom) await auditDom(page, `${label}: ${key}`, size);
        if (m.after) await m.after(page);
      }
    }
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => {
    window.__late.beforeTick = null;
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyE']) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  });
}

const press = (code) => async (page) => {
  await page.keyboard.press(code);
  await page.waitForTimeout(250);
};

async function auditSize(browser, [vw, vh]) {
  const size = `${vw}x${vh}`;
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__late && window.__late.screen === 'title', null, { timeout: 20000 });
  await page.evaluate(instrument);
  await page.waitForTimeout(400);
  await auditDom(page, 'consent card', size);
  if (await page.$('[data-testid="consent-decline"]')) await page.click('[data-testid="consent-decline"]');
  await page.waitForTimeout(200);
  await auditDom(page, 'title', size);
  await snap(page, `${size}-title`);

  // Day 0
  await page.click('[data-testid="tutorial"]');
  await page.waitForFunction(() => window.__late.screen === 'briefing', null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await auditDom(page, 'Day 0 briefing', size);
  if (size === '1280x720') await auditMap(page, 'Day 0', size);
  await snap(page, `${size}-day0-briefing`);
  await page.click('[data-testid="leave-home"]');
  await page.waitForFunction(() => window.__late.screen === 'play');
  await playAndAudit(page, 'Day 0', size, {
    moments: [
      { key: (s) => s.lesson && `coach "${s.lesson}"` },
      { key: (s) => s.lesson === 'map' && 'phone map', before: press('KeyM'), after: press('KeyM') },
      { key: (s) => s.lesson === 'timetable' && 'timetable card', before: press('KeyT'), dom: true, after: press('KeyT') },
      { key: (s) => s.lesson === 'platform' && 'help card', before: press('KeyH'), dom: true, after: async (p) => p.evaluate(() => window.__late.resume()) },
      { key: (s) => s.mode === 'train' && s.train === 'between' && 'riding', dom: false },
      { key: (s) => s.lesson === 'exit' && 'pause card', before: press('Escape'), dom: true, after: async (p) => p.evaluate(() => window.__late.resume()) },
    ],
  });
  await page.waitForFunction(() => window.__late.screen === 'result', null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await auditDom(page, 'Day 0 result', size);
  await snap(page, `${size}-day0-result`);

  // Monday with the route guide (a fixed week, so every run audits the same days)
  await page.evaluate(() => window.__late.startWeek('AUDIT-WEEK'));
  await page.waitForFunction(() => window.__late.screen === 'briefing', null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await auditDom(page, 'Monday briefing', size);
  if (size === '1280x720') await auditMap(page, 'Monday', size);
  await page.click('[data-testid="leave-home"]');
  await page.waitForFunction(() => window.__late.screen === 'play');
  await playAndAudit(page, 'Monday', size, {
    moments: [
      { key: (s) => s.mode === 'walk' && `station ${s.st} ${s.seg}` },
      { key: (s) => s.mode === 'train' && `train ${s.train}` },
    ],
  });
  await page.waitForFunction(() => window.__late.screen === 'result', null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await auditDom(page, 'Monday result', size);
  await snap(page, `${size}-monday-result`);
  await page.click('[data-testid="next-day"]');
  await page.waitForFunction(() => window.__late.screen === 'shop');
  await auditDom(page, 'shop', size);
  await snap(page, `${size}-shop`);

  // a Thursday with a hub, with the autopilot
  await page.evaluate(() => window.__late.startCustom('AUDIT-HUB', 3));
  await page.waitForFunction(() => window.__late.screen === 'briefing', null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await auditDom(page, 'Thursday briefing', size);
  if (size === '1280x720') await auditMap(page, 'Thursday', size);
  await snap(page, `${size}-thursday-briefing`);
  await page.click('[data-testid="leave-home"]');
  await page.waitForFunction(() => window.__late.screen === 'play');
  await playAndAudit(page, 'Thursday', size, {
    driver: 'autopilot',
    moments: [
      { key: (s) => s.mode === 'walk' && `station ${s.st} ${s.seg}` },
      { key: (s) => s.mode === 'train' && `train ${s.train}` },
    ],
  });
  await page.waitForFunction(() => window.__late.screen === 'result', null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await auditDom(page, 'Thursday result', size);
  await snap(page, `${size}-thursday-result`);

  // the week summary, from a finished week
  await page.evaluate(() => {
    const g = window.__late;
    g.week = { seed: 'AUDIT', weekday: 5, wage: 1234, aids: [], version: 'g3', history: [0, 1, 2, 3, 4].map((wd) => ({ weekday: wd, margin: wd === 3 ? -95 : 240, arrival: 32000 + wd * 60, earned: wd === 3 ? 370 : 400 })) };
    g.mode = 'week';
    window.Late.screens.weekSummary(g);
  });
  await page.waitForTimeout(300);
  await auditDom(page, 'week summary', size);
  await snap(page, `${size}-week`);
  await page.close();
  return errors;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const allErrors = [];
try {
  for (const s of SIZES) {
    const t0 = Date.now();
    const errs = await auditSize(browser, s);
    allErrors.push(...errs);
    console.log(`${s.join('x')}: audited in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
} finally {
  await browser.close();
}

const list = [...issues.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.where.localeCompare(b.where));
for (const i of list) console.log(`- ${i.kind} · ${i.where} · "${i.a}"${i.b ? ` ↔ "${i.b}"` : ''} · at ${[...i.sizes].join(', ')}`);
if (opt('--json')) writeFileSync(resolve(opt('--json')), JSON.stringify(list.map((i) => ({ ...i, sizes: [...i.sizes] })), null, 1));
if (allErrors.length) console.log('page errors:', allErrors);
console.log(list.length || allErrors.length ? `FAIL — ${list.length} issue(s)` : 'PASS — no overlapping or cut-off text at any size');
process.exit(list.length || allErrors.length ? 1 : 0);
