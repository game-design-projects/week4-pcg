// Play and test locally with the real Worker code, without Cloudflare:
// serves the game and runs server/src/index.js against an in-memory SQLite
// database (node:sqlite, Node 22+) behind a small D1 stand-in. The game's
// src/config.js is served pointing at this server, so telemetry (after
// consent) and the daily leaderboard work end to end. Nothing is kept after
// the server stops.
// Usage: node tools/local_server.mjs [port=8787]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../server/src/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || 8787);
const TOKEN = 'local-read-token';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(join(ROOT, 'server/migrations/0001_init.sql'), 'utf8'));
const D1 = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() { return { meta: { changes: Number(stmt.run(...args).changes) } }; },
    };
    return api;
  },
};
const env = { DB: D1, READ_TOKEN: TOKEN };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/v1/') || url.pathname === '/health') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const out = await handleRequest(new Request(url, { method: req.method, headers: req.headers, body }), env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  if (url.pathname === '/src/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(`window.CaveConfig = window.CaveConfig || { TELEMETRY_ENDPOINT: '${url.origin}/v1/sessions', LEADERBOARD_ENDPOINT: '${url.origin}/v1/scores' };\n`);
    return;
  }
  const path = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`Cave Diving with a local collector and leaderboard: http://localhost:${PORT}`);
  console.log(`Export sessions: curl -H "authorization: Bearer ${TOKEN}" http://localhost:${PORT}/v1/sessions`);
});
