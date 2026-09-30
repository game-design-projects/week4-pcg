// Late — anonymous playtest telemetry and the daily leaderboard.
// A tiny Cloudflare Worker + D1 database, following our Week 3 collector.
//
// ANONYMITY BY DESIGN: this worker never reads or stores the caller's IP
// address, User-Agent, or any Cloudflare geo/bot metadata (`request.cf`,
// `cf-connecting-ip`, ... are never touched). The only identifier is the
// random player id the game makes in the browser.
//
// Routes:
//   POST   /v1/sessions            one session (text/plain or JSON), only sent after opt-in → 204
//   GET    /v1/sessions?since=&limit=   Bearer READ_TOKEN → {schema, exportedAt, sessions}
//   POST   /v1/scores              {playerId, nickname, board, genVersion, inputs} → {rank, total, improved, best}
//   GET    /v1/scores?board=&limit=&player=   → {board, total, entries, player}
//   DELETE /v1/scores/:id          Bearer READ_TOKEN → moderation
//   GET    /health                 → "ok"
//
// Importable from plain Node (no cloudflare:* imports) so node --test can
// run it against a D1 stand-in built on node:sqlite (test/worker.test.mjs).
import { MAX_SCORE_BODY_BYTES, cleanNickname, compareScores, replaySubmission } from './scores.js';
import Late from '../../src/core/index.js';

const MAX_BODY_BYTES = 128 * 1024;
const PLAYER_ID_RE = /^p_[0-9a-f]{16}$/;
const SESSION_ID_RE = /^s_[0-9a-f]{16}$/;
const SCORE_ID_RE = /^sc_[0-9a-f]{16}$/;
const MODES = ['week', 'daily', 'custom'];

function cors(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    ...extra,
  };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: cors({ 'content-type': 'application/json', 'cache-control': 'no-store' }) });
const empty = (status) => new Response(null, { status, headers: cors() });

function authorized(request, env) {
  const [scheme, token] = (request.headers.get('authorization') || '').split(' ');
  return scheme === 'Bearer' && !!token && !!env.READ_TOKEN && token === env.READ_TOKEN;
}

async function readBody(request, max) {
  if (Number(request.headers.get('content-length') || '0') > max) return { tooBig: true };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > max) return { tooBig: true };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { bad: true };
  }
}

function randomId(prefix) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ------------------------------------------------------------------ telemetry

export function isValidIncoming(s) {
  return (
    !!s && typeof s === 'object' && !Array.isArray(s) &&
    s.schema === 1 &&
    typeof s.id === 'string' && SESSION_ID_RE.test(s.id) &&
    typeof s.playerId === 'string' && PLAYER_ID_RE.test(s.playerId) &&
    MODES.includes(s.mode) &&
    typeof s.seed === 'string' && s.seed.length <= 40 &&
    typeof s.startedAt === 'string'
  );
}

async function submitSession(request, env) {
  const { body, tooBig, bad } = await readBody(request, MAX_BODY_BYTES);
  if (tooBig) return empty(413);
  if (bad) return json({ error: 'invalid JSON body' }, 400);
  if (!isValidIncoming(body)) return json({ error: 'session failed structural validation' }, 400);
  const r = body.result || {};
  await env.DB.prepare(
    `INSERT OR REPLACE INTO sessions (id, player_id, mode, seed, weekday, gen_version, app_version, result, margin, started_at, received_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(body.id, body.playerId, body.mode, body.seed, Number.isInteger(body.weekday) ? body.weekday : null, body.genVersion ?? null, body.appVersion ?? null, r.how ?? null, Number.isFinite(r.margin) ? Math.round(r.margin) : null, body.startedAt, new Date().toISOString(), JSON.stringify(body))
    .run();
  console.log(`[telemetry] stored ${body.id} ${body.mode} ${body.seed} ${r.how ?? '-'}`);
  return empty(204);
}

async function exportSessions(request, env, url) {
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
  const since = url.searchParams.get('since');
  const lim = Number(url.searchParams.get('limit'));
  const limit = Number.isInteger(lim) && lim > 0 ? Math.min(lim, 5000) : 500;
  const stmt = since
    ? env.DB.prepare('SELECT raw_json FROM sessions WHERE started_at >= ? ORDER BY started_at ASC LIMIT ?').bind(since, limit)
    : env.DB.prepare('SELECT raw_json FROM sessions ORDER BY started_at ASC LIMIT ?').bind(limit);
  const { results } = await stmt.all();
  return json({ schema: 1, exportedAt: new Date().toISOString(), sessions: results.map((x) => JSON.parse(x.raw_json)) });
}

// ------------------------------------------------------------------ leaderboard

const rowScore = (r) => ({ id: r.id, margin: r.margin, createdAt: r.created_at });
const publicEntry = (r, rank, withId) => ({ ...(withId ? { id: r.id } : {}), rank, nickname: r.nickname, margin: r.margin, arrival: r.arrival, createdAt: r.created_at });

async function ownRow(env, playerId, board) {
  return env.DB.prepare('SELECT id, nickname, margin, arrival, created_at FROM scores WHERE player_id = ? AND board = ? AND gen_version = ?').bind(playerId, board, Late.day.GEN_VERSION).first();
}

async function rankOf(env, board, row) {
  const r = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM scores WHERE board = ? AND gen_version = ? AND (margin > ? OR (margin = ? AND created_at < ?) OR (margin = ? AND created_at = ? AND id < ?))',
  )
    .bind(board, Late.day.GEN_VERSION, row.margin, row.margin, row.created_at, row.margin, row.created_at, row.id)
    .first();
  return (r ? r.n : 0) + 1;
}

async function boardTotal(env, board) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE board = ? AND gen_version = ?').bind(board, Late.day.GEN_VERSION).first();
  return r ? r.n : 0;
}

async function submitScore(request, env, now) {
  const { body, tooBig, bad } = await readBody(request, MAX_SCORE_BODY_BYTES);
  if (tooBig) return json({ error: 'Body too large.', code: 'too-large' }, 413);
  if (bad) return json({ error: 'Invalid JSON body.', code: 'bad-json' }, 400);
  if (!body || typeof body.playerId !== 'string' || !PLAYER_ID_RE.test(body.playerId)) return json({ error: 'Missing or malformed playerId.', code: 'bad-player' }, 400);
  const nick = cleanNickname(body.nickname);
  if (!nick.ok) return json({ error: nick.error, code: nick.code }, nick.status);
  const t0 = Date.now();
  const score = replaySubmission(body, now);
  if (!score.ok) return json({ error: score.error, code: score.code }, score.status);
  const before = await ownRow(env, body.playerId, score.board);
  const created = new Date().toISOString();
  const improved = !before || score.margin > before.margin;
  await env.DB.prepare(
    `INSERT INTO scores (id, player_id, nickname, board, gen_version, margin, arrival, ticks, inputs_json, app_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (player_id, board, gen_version) DO UPDATE SET
       nickname = excluded.nickname, margin = excluded.margin, arrival = excluded.arrival, ticks = excluded.ticks,
       inputs_json = excluded.inputs_json, app_version = excluded.app_version, created_at = excluded.created_at
     WHERE excluded.margin > scores.margin`,
  )
    .bind(randomId('sc'), body.playerId, nick.nickname, score.board, Late.day.GEN_VERSION, score.margin, score.arrival, score.ticks, JSON.stringify(body.inputs), body.appVersion ?? null, created)
    .run();
  if (before && !improved && before.nickname !== nick.nickname) {
    await env.DB.prepare('UPDATE scores SET nickname = ? WHERE player_id = ? AND board = ? AND gen_version = ?').bind(nick.nickname, body.playerId, score.board, Late.day.GEN_VERSION).run();
  }
  const best = await ownRow(env, body.playerId, score.board);
  const rank = await rankOf(env, score.board, best);
  const total = await boardTotal(env, score.board);
  console.log(`[scores] ${improved ? 'stored' : 'kept'} ${best.id} ${score.board} margin=${Math.round(score.margin)} rank ${rank}/${total} (${Date.now() - t0} ms)`);
  return json({ rank, total, improved, best: publicEntry(best, rank, false), submitted: { arrival: score.arrival, margin: score.margin } });
}

async function listScores(request, env, url) {
  const board = url.searchParams.get('board') || '';
  if (!/^daily-\d{4}-\d{2}-\d{2}$/.test(board)) return json({ error: 'Unknown board.', code: 'bad-board' }, 400);
  const lim = Number(url.searchParams.get('limit'));
  const limit = Number.isInteger(lim) && lim > 0 ? Math.min(lim, 100) : 20;
  const withId = authorized(request, env);
  const { results } = await env.DB.prepare('SELECT id, nickname, margin, arrival, created_at FROM scores WHERE board = ? AND gen_version = ? ORDER BY margin DESC, created_at ASC, id ASC LIMIT ?')
    .bind(board, Late.day.GEN_VERSION, limit)
    .all();
  const entries = results.map((r, i) => publicEntry(r, i + 1, withId));
  let player = null;
  const pid = url.searchParams.get('player');
  if (pid && PLAYER_ID_RE.test(pid)) {
    const row = await ownRow(env, pid, board);
    if (row) player = publicEntry(row, await rankOf(env, board, row), withId);
  }
  return json({ board, genVersion: Late.day.GEN_VERSION, total: await boardTotal(env, board), entries, player });
}

async function deleteScore(request, env, path) {
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
  const id = decodeURIComponent(path.slice('/v1/scores/'.length));
  if (!SCORE_ID_RE.test(id)) return json({ error: 'Bad score id.' }, 400);
  const res = await env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(id).run();
  const n = (res && res.meta && res.meta.changes) || 0;
  return n ? json({ deleted: id }) : json({ error: 'not found' }, 404);
}

// ------------------------------------------------------------------ router

export async function handleRequest(request, env, now = new Date()) {
  const url = new URL(request.url);
  const path = url.pathname;
  const m = request.method;
  if (m === 'OPTIONS') return empty(204);
  if (m === 'GET' && path === '/health') return new Response('ok', { status: 200, headers: cors() });
  if (path === '/v1/sessions' && m === 'POST') return submitSession(request, env);
  if (path === '/v1/sessions' && m === 'GET') return exportSessions(request, env, url);
  if (path === '/v1/scores' && m === 'POST') return submitScore(request, env, now);
  if (path === '/v1/scores' && m === 'GET') return listScores(request, env, url);
  if (path.startsWith('/v1/scores/') && m === 'DELETE') return deleteScore(request, env, path);
  return json({ error: 'not found' }, 404);
}

export { compareScores };
export default { fetch: (request, env) => handleRequest(request, env) };
