-- Late: one row per finished (or abandoned) commute a player chose to share,
-- and each player's best replay-validated arrival per daily board.
-- No IP, User-Agent or geo columns on purpose (see src/index.js).
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- 's_' + 16 hex, made by the client
  player_id TEXT NOT NULL,       -- 'p_' + 16 hex, random, made in the browser
  mode TEXT NOT NULL,            -- week | daily | custom
  seed TEXT NOT NULL,            -- with weekday + adjust + gen_version this regenerates the day
  weekday INTEGER,
  gen_version TEXT,
  app_version TEXT,
  result TEXT,                   -- office | gave-up | abandoned
  margin INTEGER,                -- seconds early (+) or late (-)
  started_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_seed ON sessions (seed, gen_version);

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,           -- 'sc_' + 16 hex; the moderation handle
  player_id TEXT NOT NULL,       -- never returned by GET
  nickname TEXT NOT NULL,
  board TEXT NOT NULL,           -- daily-YYYY-MM-DD
  gen_version TEXT NOT NULL,
  margin REAL NOT NULL,          -- from the server's replay, never from the client
  arrival REAL NOT NULL,
  ticks INTEGER NOT NULL,
  inputs_json TEXT NOT NULL,     -- the submitted key presses, so any row can be re-checked
  app_version TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (player_id, board, gen_version)
);
CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (board, gen_version, margin DESC, created_at, id);
