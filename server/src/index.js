// Cave Diving: anonymous playtest telemetry and the daily maze leaderboard.
// A small Cloudflare Worker + D1 database of its own, following Late and our
// Week 3 collector (nothing is shared with either).
//
// ANONYMITY BY DESIGN: this worker never reads or stores the caller's IP
// address, User-Agent, or any Cloudflare geo/bot metadata (`request.cf`,
// `cf-connecting-ip`, ... are never touched). The only identifier is the
// random player id the game makes in the browser.
//
// Routes:
//   POST   /v1/sessions            one dive (text/plain or JSON), only sent after opt-in → 204
//   GET    /v1/sessions?since=&limit=   Bearer READ_TOKEN → {schema, exportedAt, sessions}
//   POST   /v1/scores              {playerId, nickname, board, seed, level, mapMode, genVersion, inputs} → {rank, total, improved, best}
//   GET    /v1/scores?board=&limit=&player=   → {board, total, entries, player}
//   DELETE /v1/scores/:id          Bearer READ_TOKEN → moderation
//   GET    /health                 → "ok"
//
// Importable from plain Node (no cloudflare:* imports) so node --test can
// run it against a D1 stand-in built on node:sqlite (test/worker.test.mjs).
import { MAX_SCORE_BODY_BYTES, GEN_VERSION, cleanNickname, compareScores, replaySubmission } from './scores.js';
import Daily from '../../src/daily.js';

const MAX_BODY_BYTES = 256 * 1024;
const PLAYER_ID_RE = /^p_[0-9a-f]{16}$/;
const SESSION_ID_RE = /^s_[0-9a-f]{16}$/;
const SCORE_ID_RE = /^sc_[0-9a-f]{16}$/;
const MAP_MODES = ['full', 'entrance', 'none'];
const OUTCOMES = ['home', 'out_of_gas', 'abandoned'];
const LINE_USE = ['from_pool', 'loose', 'none'];

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

const num = (v) => (Number.isFinite(v) ? v : null);

// ------------------------------------------------------------------ telemetry

export function isValidIncoming(s) {
  const r = s && s.result;
  return (
    !!s && typeof s === 'object' && !Array.isArray(s) &&
    s.schema === 1 &&
    typeof s.id === 'string' && SESSION_ID_RE.test(s.id) &&
    typeof s.playerId === 'string' && PLAYER_ID_RE.test(s.playerId) &&
    typeof s.seed === 'string' && s.seed.length >= 1 && s.seed.length <= 40 &&
    Number.isInteger(s.level) && s.level >= 0 && s.level <= 20 &&
    MAP_MODES.includes(s.mapMode) &&
    (s.board === null || s.board === undefined || Daily.BOARD_RE.test(s.board)) &&
    typeof s.startedAt === 'string' && s.startedAt.length <= 40 &&
    !!r && typeof r === 'object' && OUTCOMES.includes(r.outcome)
  );
}

async function submitSession(request, env) {
  const { body, tooBig, bad } = await readBody(request, MAX_BODY_BYTES);
  if (tooBig) return empty(413);
  if (bad) return json({ error: 'invalid JSON body' }, 400);
  if (!isValidIncoming(body)) return json({ error: 'session failed structural validation' }, 400);
  const r = body.result, line = r.line || {};
  const lineUse = LINE_USE.includes(line.use) ? line.use : null;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO sessions (id, player_id, seed, level, map_mode, board, gen_version, app_version, outcome, goal, gas, turn_pen, silt_outs, line, started_at, received_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(body.id, body.playerId, body.seed, body.level, body.mapMode, body.board ?? null, typeof body.genVersion === 'string' ? body.genVersion.slice(0, 20) : null,
      typeof body.appVersion === 'string' ? body.appVersion.slice(0, 20) : null, r.outcome, r.goal ? 1 : 0, num(r.gas),
      r.turn && typeof r.turn === 'object' ? num(r.turn.pen) : null, Number.isInteger(r.siltOuts) ? r.siltOuts : null, lineUse,
      body.startedAt, new Date().toISOString(), JSON.stringify(body))
    .run();
  console.log(`[telemetry] stored ${body.id} ${body.seed} L${body.level} ${r.outcome}`);
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

const publicEntry = (r, rank, withId) => ({ ...(withId ? { id: r.id } : {}), rank, nickname: r.nickname, gas: r.gas, time: Math.round((r.ticks / 60) * 10) / 10, createdAt: r.created_at });

async function ownRow(env, playerId, board) {
  return env.DB.prepare('SELECT id, nickname, gas, ticks, created_at FROM scores WHERE player_id = ? AND board = ? AND gen_version = ?').bind(playerId, board, GEN_VERSION).first();
}

// Same order as compareScores: more gas, then fewer ticks, then earlier, then id.
async function rankOf(env, board, row) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scores WHERE board = ? AND gen_version = ? AND (gas > ? OR (gas = ? AND ticks < ?)
       OR (gas = ? AND ticks = ? AND created_at < ?) OR (gas = ? AND ticks = ? AND created_at = ? AND id < ?))`,
  )
    .bind(board, GEN_VERSION, row.gas, row.gas, row.ticks, row.gas, row.ticks, row.created_at, row.gas, row.ticks, row.created_at, row.id)
    .first();
  return (r ? r.n : 0) + 1;
}

async function boardTotal(env, board) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE board = ? AND gen_version = ?').bind(board, GEN_VERSION).first();
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
  const improved = !before || score.gas > before.gas || (score.gas === before.gas && score.ticks < before.ticks);
  await env.DB.prepare(
    `INSERT INTO scores (id, player_id, nickname, board, gen_version, gas, ticks, inputs_json, app_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (player_id, board, gen_version) DO UPDATE SET
       nickname = excluded.nickname, gas = excluded.gas, ticks = excluded.ticks,
       inputs_json = excluded.inputs_json, app_version = excluded.app_version, created_at = excluded.created_at
     WHERE excluded.gas > scores.gas OR (excluded.gas = scores.gas AND excluded.ticks < scores.ticks)`,
  )
    .bind(randomId('sc'), body.playerId, nick.nickname, score.board, GEN_VERSION, score.gas, score.ticks, JSON.stringify(body.inputs),
      typeof body.appVersion === 'string' ? body.appVersion.slice(0, 20) : null, created)
    .run();
  if (before && !improved && before.nickname !== nick.nickname) {
    await env.DB.prepare('UPDATE scores SET nickname = ? WHERE player_id = ? AND board = ? AND gen_version = ?').bind(nick.nickname, body.playerId, score.board, GEN_VERSION).run();
  }
  const best = await ownRow(env, body.playerId, score.board);
  const rank = await rankOf(env, score.board, best);
  const total = await boardTotal(env, score.board);
  console.log(`[scores] ${improved ? 'stored' : 'kept'} ${best.id} ${score.board} gas=${score.gas} rank ${rank}/${total} (${Date.now() - t0} ms)`);
  return json({ rank, total, improved, best: publicEntry(best, rank, false), submitted: { gas: score.gas, time: score.time } });
}

async function listScores(request, env, url) {
  const board = url.searchParams.get('board') || '';
  if (!Daily.parse(board)) return json({ error: 'Unknown board.', code: 'bad-board' }, 400);
  const lim = Number(url.searchParams.get('limit'));
  const limit = Number.isInteger(lim) && lim > 0 ? Math.min(lim, 100) : 20;
  const withId = authorized(request, env);
  const { results } = await env.DB.prepare('SELECT id, nickname, gas, ticks, created_at FROM scores WHERE board = ? AND gen_version = ? ORDER BY gas DESC, ticks ASC, created_at ASC, id ASC LIMIT ?')
    .bind(board, GEN_VERSION, limit)
    .all();
  const entries = results.map((r, i) => publicEntry(r, i + 1, withId));
  let player = null;
  const pid = url.searchParams.get('player');
  if (pid && PLAYER_ID_RE.test(pid)) {
    const row = await ownRow(env, pid, board);
    if (row) player = publicEntry(row, await rankOf(env, board, row), withId);
  }
  return json({ board, genVersion: GEN_VERSION, total: await boardTotal(env, board), entries, player });
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
