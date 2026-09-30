// The daily maze: one shared seed per UTC day, with fixed settings, so every
// player dives the same cave and the leaderboard can compare them. Plain JS,
// shared by the game and the leaderboard Worker.
(function (root) {
  'use strict';
  const LEVEL = 4;               // a mid-size maze with dead ends and loops
  const MAP_MODE = 'entrance';   // the survey stays at the entrance
  const BOARD_RE = /^daily-(\d{4})-(\d{2})-(\d{2})$/;

  // Today's board, e.g. "daily-2026-09-30" (UTC, so everyone shares the day).
  function boardFor(date) { return `daily-${(date || new Date()).toISOString().slice(0, 10)}`; }

  // Everything needed to regenerate a board's cave, or null for an unknown board.
  function parse(board) {
    const m = BOARD_RE.exec(typeof board === 'string' ? board : '');
    if (!m) return null;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    return { board, date, seed: `DAILY-${date}`, level: LEVEL, mapMode: MAP_MODE };
  }

  const api = { LEVEL, MAP_MODE, BOARD_RE, boardFor, parse };
  root.CaveDaily = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
