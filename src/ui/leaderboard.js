// Late — the daily-commute leaderboard client (the Week 3 pattern). A score
// is never sent unless the player presses Submit, and what is sent is only
// the day's seed and the list of key presses: the Worker regenerates the day
// and replays them with the game's own rules to work out the arrival time.
// Submitting is its own consent, separate from telemetry.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});
  const { fmtClock, fmtDuration } = L.rules;
  const NICK_KEY = 'late.nickname.v1';
  const BEST_KEY = 'late.dailybest.v1';

  const endpoint = () => (L.config && L.config.LEADERBOARD_ENDPOINT) || null;

  function boardOf(day) {
    const m = /^DAILY-(\d{4}-\d{2}-\d{2})$/.exec(day.seed);
    return m ? `daily-${m[1]}` : null;
  }

  function buildSubmission(game, result, nickname) {
    return {
      playerId: L.telemetry ? L.telemetry.playerId : null,
      nickname,
      board: boardOf(game.day),
      genVersion: game.day.version,
      appVersion: L.telemetry ? L.telemetry.APP_VERSION : null,
      inputs: result.inputs,
    };
  }

  async function request(url, init) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
      const res = await fetch(url, { ...init, signal: ctrl && ctrl.signal });
      let body = null;
      try {
        body = await res.json();
      } catch (e) {
        body = null;
      }
      if (res.ok && body) return body;
      throw new Error((body && body.error) || `The leaderboard answered ${res.status}.`);
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('Could not reach the leaderboard.');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function submit(sub) {
    // text/plain keeps it a CORS "simple request" (no preflight)
    return request(endpoint(), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(sub) });
  }

  function fetchBoard(board, player) {
    const u = new URL(endpoint());
    u.search = new URLSearchParams({ board, limit: '10', ...(player ? { player } : {}) }).toString();
    return request(u.toString(), { method: 'GET' });
  }

  function localBest(board, margin) {
    try {
      const all = JSON.parse(root.localStorage.getItem(BEST_KEY) || '{}');
      if (margin !== undefined && (all[board] === undefined || margin > all[board])) {
        all[board] = margin;
        root.localStorage.setItem(BEST_KEY, JSON.stringify(all));
      }
      return all[board];
    } catch (e) {
      return margin;
    }
  }

  function table(S, body) {
    const rows = body.entries.map((e) => S.h('tr', { class: body.player && body.player.rank === e.rank ? 'me' : '' }, S.h('td', {}, `#${e.rank}`), S.h('td', {}, e.nickname), S.h('td', {}, fmtClock(e.arrival, true)), S.h('td', {}, `${e.margin >= 0 ? '+' : '−'}${fmtDuration(e.margin)}`)));
    return S.h('table', {}, ...rows);
  }

  /** The block shown on the result screen of a daily commute. */
  function submitBlock(game, result) {
    const S = L.screens;
    const board = boardOf(game.day);
    if (!board) return null;
    const best = localBest(board, result.margin);
    if (!endpoint()) {
      return S.h('div', { class: 'lb' }, S.h('h4', {}, `Daily commute ${board.slice(6)}`), S.h('p', { class: 'dim' }, `Leaderboard not deployed yet — your best today on this device: ${best >= 0 ? '+' : '−'}${fmtDuration(best)}.`));
    }
    let nick = '';
    try {
      nick = root.localStorage.getItem(NICK_KEY) || '';
    } catch (e) {
      /* ignore */
    }
    const input = S.h('input', { class: 'nick-in', value: nick, maxlength: 20, placeholder: 'Nickname', 'aria-label': 'Nickname' });
    const status = S.h('span', { class: 'dim' }, 'Submitting publishes your nickname and your key presses for this seed.');
    const out = S.h('div', {});
    const go = S.btn('Submit to the daily board', async () => {
      go.disabled = true;
      status.textContent = 'Replaying your commute on the server…';
      try {
        try {
          root.localStorage.setItem(NICK_KEY, input.value);
        } catch (e) {
          /* ignore */
        }
        const r = await submit(buildSubmission(game, result, input.value));
        status.textContent = `#${r.rank} of ${r.total}${r.improved ? '' : ' (your earlier best was kept)'}`;
        const b = await fetchBoard(board, L.telemetry && L.telemetry.playerId);
        out.innerHTML = '';
        out.appendChild(table(S, b));
      } catch (e) {
        status.textContent = e.message;
        go.disabled = false;
      }
    }, 'small', { dataset: { testid: 'submit-score' } });
    return S.h('div', { class: 'lb' }, S.h('h4', {}, `Daily commute ${board.slice(6)}`), S.h('div', { class: 'lb-row' }, input, go, status), out);
  }

  L.leaderboard = { submitBlock, buildSubmission, boardOf, fetchBoard, submit };
})(typeof self !== 'undefined' ? self : this);
