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
const Late = require('../src/core/index.js');
const { handleRequest, isValidIncoming } = await import('../server/src/index.js');

const TOKEN = 'test-read-token';
const BASE = 'https://late.example';
const P1 = 'p_1111111111111111';
const P2 = 'p_2222222222222222';
const NOW = new Date('2026-09-30T08:00:00Z');
const BOARD = 'daily-2026-09-30';

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
  return { schema: 1, id: 's_0123456789abcdef', playerId: P1, mode: 'week', seed: 'K7Q2-M4XP-1', weekday: 0, genVersion: Late.day.GEN_VERSION, startedAt: '2026-09-30T08:00:00.000Z', result: { how: 'office', margin: 120 }, ...over };
}

/** A real, winning daily commute: the autopilot plays the board's day and we keep its key presses. */
let winning = null;
function winningInputs() {
  if (!winning) {
    const day = Late.day.generateDay('DAILY-2026-09-30', Late.difficulty.paramsFor(2));
    const st = Late.autopilot.playDay(day);
    winning = { inputs: st.inputs, arrival: st.result.arrival };
  }
  return winning;
}

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
  assert.ok(isValidIncoming(session({ mode: 'tutorial' })));
  assert.equal(isValidIncoming(session({ playerId: 'p_nothex' })), false);
  assert.equal(isValidIncoming(session({ mode: 'hack' })), false);
  assert.equal(isValidIncoming({ ...session(), schema: 2 }), false);
});

test('sessions: store, refuse junk, export only with the token', { skip }, async () => {
  const e = env();
  assert.equal((await handleRequest(post('/v1/sessions', session()), e)).status, 204);
  assert.equal((await handleRequest(post('/v1/sessions', '{nope'), e)).status, 400);
  assert.equal((await handleRequest(post('/v1/sessions', session({ id: 'x' })), e)).status, 400);
  assert.equal((await handleRequest(post('/v1/sessions', session({ pad: 'x'.repeat(140 * 1024) })), e)).status, 413);
  assert.equal((await handleRequest(get('/v1/sessions'), e)).status, 401);
  const res = await handleRequest(get('/v1/sessions', { authorization: `Bearer ${TOKEN}` }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sessions.length, 1);
  assert.equal(body.sessions[0].seed, 'K7Q2-M4XP-1');
  // no IP-ish columns exist at all
  const cols = e.DB.db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  assert.ok(!cols.some((c) => /ip|agent|geo|country/i.test(c)));
});

test('scores: the server replays the key presses and computes the arrival itself', { skip }, async () => {
  const e = env();
  const w = winningInputs();
  const res = await handleRequest(post('/v1/scores', { playerId: P1, nickname: 'Steven', board: BOARD, genVersion: Late.day.GEN_VERSION, inputs: w.inputs }), e, NOW);
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.rank, 1);
  assert.equal(body.total, 1);
  assert.equal(body.submitted.arrival, w.arrival);
  // a client cannot claim a better time: there is nothing to claim, only inputs
  const list = await (await handleRequest(get(`/v1/scores?board=${BOARD}&player=${P1}`), e)).json();
  assert.equal(list.entries[0].arrival, w.arrival);
  assert.equal(list.player.rank, 1);
  assert.equal(list.entries[0].id, undefined, 'score ids only with the moderation token');
  assert.equal(JSON.stringify(list).includes(P1), false, 'player ids are never returned');
});

test('scores: tampered, stale or incomplete submissions are refused', { skip }, async () => {
  const e = env();
  const w = winningInputs();
  const base = { playerId: P1, nickname: 'Steven', board: BOARD, genVersion: Late.day.GEN_VERSION, inputs: w.inputs };
  const status = async (b) => (await handleRequest(post('/v1/scores', b), e, NOW)).status;
  assert.equal(await status({ ...base, inputs: w.inputs.slice(0, 5) }), 422, 'stops before the office');
  assert.equal(await status({ ...base, inputs: [[0, 99]] }), 400, 'malformed mask');
  assert.equal(await status({ ...base, inputs: [[5, 1], [5, 2]] }), 400, 'ticks must increase');
  assert.equal(await status({ ...base, genVersion: 'g0' }), 409, 'old generator');
  assert.equal(await status({ ...base, board: 'daily-2025-01-01' }), 400, 'closed board');
  assert.equal(await status({ ...base, board: 'weekly-1' }), 400, 'unknown board');
  assert.equal(await status({ ...base, nickname: '<b>' }), 400, 'html nickname');
  assert.equal(await status({ ...base, playerId: 'me' }), 400, 'bad player id');
});

test('scores: best only per player, ranking by arrival, moderation delete', { skip }, async () => {
  const e = env();
  const w = winningInputs();
  // P2 plays it like a hesitant human: a real, slower run of the same day
  const day = Late.day.generateDay('DAILY-2026-09-30', Late.difficulty.paramsFor(2));
  const human = Late.autopilot.playDay(day, { reaction: Late.difficulty.BASE.humanReaction });
  assert.ok(human.result.arrival > w.arrival);
  const slower = human.inputs;
  const r2 = await handleRequest(post('/v1/scores', { playerId: P2, nickname: 'Naxin', board: BOARD, genVersion: Late.day.GEN_VERSION, inputs: slower }), e, NOW);
  assert.equal(r2.status, 200, await r2.clone().text());
  const r1 = await (await handleRequest(post('/v1/scores', { playerId: P1, nickname: 'Steven', board: BOARD, genVersion: Late.day.GEN_VERSION, inputs: w.inputs }), e, NOW)).json();
  assert.equal(r1.rank, 1);
  // a worse run by P1 keeps the best but renames
  const again = await (await handleRequest(post('/v1/scores', { playerId: P1, nickname: 'Steven L', board: BOARD, genVersion: Late.day.GEN_VERSION, inputs: slower }), e, NOW)).json();
  assert.equal(again.improved, false);
  assert.equal(again.best.nickname, 'Steven L');
  const list = await (await handleRequest(get(`/v1/scores?board=${BOARD}`, { authorization: `Bearer ${TOKEN}` }), e)).json();
  assert.deepEqual(list.entries.map((x) => x.nickname), ['Steven L', 'Naxin']);
  assert.ok(list.entries[0].margin > list.entries[1].margin);
  const id = list.entries[1].id;
  assert.equal((await handleRequest(new Request(`${BASE}/v1/scores/${id}`, { method: 'DELETE' }), e)).status, 401);
  assert.equal((await handleRequest(new Request(`${BASE}/v1/scores/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } }), e)).status, 200);
  const after = await (await handleRequest(get(`/v1/scores?board=${BOARD}`), e)).json();
  assert.equal(after.total, 1);
});

test('the game core is what the Worker imports: same generator version, same rules', () => {
  const w = winningInputs();
  const day = Late.day.generateDay('DAILY-2026-09-30', Late.difficulty.paramsFor(2));
  assert.equal(Late.sim.replay(day, w.inputs).result.arrival, w.arrival);
});
