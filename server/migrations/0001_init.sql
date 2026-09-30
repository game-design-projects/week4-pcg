-- Cave Diving: one row per finished (or abandoned) dive a player chose to
-- share, and each player's best replay-checked dive per daily board.
-- No IP, User-Agent or geo columns on purpose (see src/index.js).
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- 's_' + 16 hex, made by the client
  player_id TEXT NOT NULL,       -- 'p_' + 16 hex, random, made in the browser
  seed TEXT NOT NULL,            -- with level + gen_version this regenerates the cave
  level INTEGER NOT NULL,
  map_mode TEXT NOT NULL,        -- full | entrance | none
  board TEXT,                    -- daily-YYYY-MM-DD for the daily maze, else NULL
  gen_version TEXT,
  app_version TEXT,
  outcome TEXT NOT NULL,         -- home | out_of_gas | abandoned
  goal INTEGER,                  -- 1 if the end chamber was tagged
  gas REAL,                      -- bar left at the end
  turn_pen REAL,                 -- metres in when the diver turned for home
  silt_outs INTEGER,             -- times visibility dropped to nothing
  line TEXT,                     -- from_pool | loose | none: how the guideline was used
  started_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_seed ON sessions (seed, level, gen_version);

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,           -- 'sc_' + 16 hex; the moderation handle
  player_id TEXT NOT NULL,       -- never returned by GET
  nickname TEXT NOT NULL,
  board TEXT NOT NULL,           -- daily-YYYY-MM-DD
  gen_version TEXT NOT NULL,
  gas REAL NOT NULL,             -- bar left back in the pool, from the server's replay
  ticks INTEGER NOT NULL,        -- dive length in 1/60 s steps, from the same replay
  inputs_json TEXT NOT NULL,     -- the submitted inputs, so any row can be re-checked
  app_version TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (player_id, board, gen_version)
);
CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (board, gen_version, gas DESC, ticks, created_at, id);
