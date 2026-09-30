// The Cloudflare Worker (server/src) under plain node --test: real SQL from
// server/migrations against SQLite (node:sqlite) behind a small D1 stand-in.
// Skipped on Node versions without node:sqlite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sqlite = null;
try {
  sqlite = await import('node:sqlite');
} catch {
  sqlite = null;
}
const Gen = require('../src/gen.js');
const Daily = require('../src/daily.js');
const { run } = require('../tools/pilot.js');
const { handleRequest, isValidIncoming } = await import('../server/src/index.js');

const TOKEN = 'test-read-token';
const BASE = 'https://cave.example';
const P1 = 'p_1111111111111111';
const P2 = 'p_2222222222222222';
const NOW = new Date('2026-09-30T08:00:00Z');
const BOARD = 'daily-2026-09-30';
const DAY = Daily.parse(BOARD);

/** D1's prepare/bind/first/all/run on top of node:sqlite's DatabaseSync. */
function fakeD1() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../server/migrations/0001_init.sql', import.meta.url), 'utf8'));
  return {
    db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) {
          args = a;
          return api;
        },
        async first() {
          return stmt.get(...args) ?? null;
        },
        async all() {
          return { results: stmt.all(...args) };
        },
        async run() {
          const r = stmt.run(...args);
          return { meta: { changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
}

const env = () => ({ DB: fakeD1(), READ_TOKEN: TOKEN });
const post = (path, body, headers = {}) => new Request(`${BASE}${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'text/plain', ...headers } });
const get = (path, headers = {}) => new Request(`${BASE}${path}`, { headers });

function session(over = {}) {
  return {
    schema: 1, id: 's_0123456789abcdef', playerId: P1, seed: 'K7Q2ZP', level: 3, mapMode: 'entrance', board: null,
    genVersion: Gen.GEN_VERSION, appVersion: '0.2.0', startedAt: '2026-09-30T08:00:00.000Z',
    result: { outcome: 'home', goal: true, gas: 121.4, turn: { pen: 64, gas: 150 }, siltOuts: 2, line: { use: 'from_pool', laidMetres: 120 } },
    ...over,
  };
}

// Real dives of the daily maze: the scripted diver plays it and we keep its inputs.
const dives = {};
function dive(kind) {
  if (!dives[kind]) {
    const d = Gen.generate(DAY.seed, DAY.level);
    const { g } = run(DAY.seed, DAY.level, kind === 'slow' ? { waitForTurn: true } : {}, d);
    dives[kind] = { inputs: g.inputs, gas: Math.round(g.gas * 100) / 100, done: g.done };
  }
  return dives[kind];
}
const submission = (over = {}) => ({ playerId: P1, nickname: 'Steven', board: BOARD, seed: DAY.seed, level: DAY.level, mapMode: DAY.mapMode, genVersion: Gen.GEN_VERSION, inputs: dive('fast').inputs, ...over });

const skip = !sqlite && 'node:sqlite is not available in this Node version';

test('the collector never reads IP, User-Agent or geo', () => {
  for (const f of ['../server/src/index.js', '../server/src/scores.js']) {
    const code = readFileSync(new URL(f, import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    assert.doesNotMatch(code, /request\.cf\b/);
    assert.doesNotMatch(code, /headers\.get\(\s*['"](cf-connecting-ip|x-forwarded-for|x-real-ip|user-agent|cf-ipcountry)['"]/i);
  }
});

test('sessions: structural validation', () => {
  assert.ok(isValidIncoming(session()));
  assert.ok(isValidIncoming(session({ board: BOARD })));
  assert.equal(isValidIncoming(session({ playerId: 'p_nothex' })), false);
  assert.equal(isValidIncoming(session({ mapMode: 'satnav' })), false);
  assert.equal(isValidIncoming(session({ level: 2.5 })), false);
  assert.equal(isValidIncoming(session({ result: { outcome: 'won' } })), false);
  assert.equal(isValidIncoming({ ...session(), schema: 2 }), false);
});

test('sessions: store, refuse junk, export only with the token', { skip }, async () => {
  const e = env();
  assert.equal((await handleRequest(post('/v1/sessions', session()), e)).status, 204);
  assert.equal((await handleRequest(post('/v1/sessions', '{nope'), e)).status, 400);
  assert.equal((await handleRequest(post('/v1/sessions', session({ id: 'x' })), e)).status, 400);
  assert.equal((await handleRequest(post('/v1/sessions', session({ pad: 'x'.repeat(300 * 1024) })), e)).status, 413);
  assert.equal((await handleRequest(get('/v1/sessions'), e)).status, 401);
  const res = await handleRequest(get('/v1/sessions', { authorization: `Bearer ${TOKEN}` }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sessions.length, 1);
  assert.equal(body.sessions[0].seed, 'K7Q2ZP');
  const row = e.DB.db.prepare('SELECT outcome, goal, gas, turn_pen, silt_outs, line, level, map_mode FROM sessions').get();
  assert.deepEqual({ ...row }, { outcome: 'home', goal: 1, gas: 121.4, turn_pen: 64, silt_outs: 2, line: 'from_pool', level: 3, map_mode: 'entrance' });
  // no IP-ish columns exist at all
  const cols = e.DB.db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  assert.ok(!cols.some((c) => /ip|agent|geo|country/i.test(c)));
});

test('scores: the server replays the inputs and computes the gas left itself', { skip }, async () => {
  const e = env();
  const w = dive('fast');
  assert.equal(w.done.outcome, 'exit');
  const res = await handleRequest(post('/v1/scores', submission()), e, NOW);
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.rank, 1);
  assert.equal(body.total, 1);
  assert.equal(body.submitted.gas, w.gas);
  // a client cannot claim more gas: there is nothing to claim, only inputs
  const list = await (await handleRequest(get(`/v1/scores?board=${BOARD}&player=${P1}`), e)).json();
  assert.equal(list.entries[0].gas, w.gas);
  assert.equal(list.entries[0].nickname, 'Steven');
  assert.equal(list.player.rank, 1);
  assert.equal(list.entries[0].id, undefined, 'score ids only with the moderation token');
  assert.equal(JSON.stringify(list).includes(P1), false, 'player ids are never returned');
});

test('scores: tampered, stale or incomplete submissions are refused', { skip }, async () => {
  const e = env();
  const w = dive('fast');
  const status = async (b) => (await handleRequest(post('/v1/scores', b), e, NOW)).status;
  assert.equal(await status(submission({ inputs: w.inputs.slice(0, 5) })), 422, 'never gets home');
  assert.equal(await status(submission({ inputs: w.inputs.map(([t, m]) => [t, m & ~64]) })), 422, 'without the reel there is no line to follow home');
  assert.equal(await status(submission({ inputs: [[0, 200]] })), 400, 'malformed mask');
  assert.equal(await status(submission({ inputs: [[5, 1], [5, 2]] })), 400, 'ticks must increase');
  assert.equal(await status(submission({ genVersion: 'maze-0' })), 409, 'old generator');
  assert.equal(await status(submission({ level: 1 })), 400, 'the board fixes the level');
  assert.equal(await status(submission({ mapMode: 'full' })), 400, 'the board fixes the map');
  assert.equal(await status(submission({ seed: 'EASY' })), 400, 'the board fixes the seed');
  assert.equal(await status(submission({ board: 'daily-2025-01-01', seed: 'DAILY-2025-01-01' })), 400, 'closed board');
  assert.equal(await status(submission({ board: 'weekly-1' })), 400, 'unknown board');
  assert.equal(await status(submission({ nickname: '<b>' })), 400, 'html nickname');
  assert.equal(await status(submission({ playerId: 'me' })), 400, 'bad player id');
});

test('scores: best only per player, ranking by gas left, moderation delete', { skip }, async () => {
  const e = env();
  const fast = dive('fast'), slow = dive('slow');
  assert.equal(slow.done.outcome, 'exit');
  assert.ok(slow.gas < fast.gas, 'lingering at the end costs gas');
  const send = async (b) => (await handleRequest(post('/v1/scores', b), e, NOW)).json();
  const a = await send(submission({ playerId: P2, nickname: 'Slow Diver', inputs: slow.inputs }));
  assert.equal(a.rank, 1);
  const b = await send(submission());
  assert.equal(b.rank, 1);
  assert.equal(b.total, 2);
  // P1 submits a worse dive: the best is kept, the nickname still updates
  const c = await send(submission({ nickname: 'Steven L', inputs: slow.inputs }));
  assert.equal(c.improved, false);
  assert.equal(c.best.gas, fast.gas);
  const list = await (await handleRequest(get(`/v1/scores?board=${BOARD}`), e)).json();
  assert.deepEqual(list.entries.map((x) => [x.rank, x.nickname, x.gas]), [[1, 'Steven L', fast.gas], [2, 'Slow Diver', slow.gas]]);
  // moderation
  const withIds = await (await handleRequest(get(`/v1/scores?board=${BOARD}`, { authorization: `Bearer ${TOKEN}` }), e)).json();
  const id = withIds.entries[0].id;
  assert.match(id, /^sc_[0-9a-f]{16}$/);
  assert.equal((await handleRequest(new Request(`${BASE}/v1/scores/${id}`, { method: 'DELETE' }), e)).status, 401);
  assert.equal((await handleRequest(new Request(`${BASE}/v1/scores/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } }), e)).status, 200);
  const after = await (await handleRequest(get(`/v1/scores?board=${BOARD}`), e)).json();
  assert.deepEqual(after.entries.map((x) => x.nickname), ['Slow Diver']);
  assert.equal(after.total, 1);
});

test('health, CORS and unknown routes', { skip }, async () => {
  const e = env();
  const h = await handleRequest(get('/health'), e);
  assert.equal(await h.text(), 'ok');
  assert.equal(h.headers.get('access-control-allow-origin'), '*');
  assert.equal((await handleRequest(new Request(`${BASE}/v1/scores`, { method: 'OPTIONS' }), e)).status, 204);
  assert.equal((await handleRequest(get('/nope'), e)).status, 404);
  assert.equal((await handleRequest(get('/v1/scores?board=../etc'), e)).status, 400);
});
