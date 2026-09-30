// The daily maze leaderboard (the Week 3 and Late pattern). A score is never
// sent unless the player presses Submit, and what is sent is only the board's
// seed and settings and the list of inputs: the Worker regenerates the maze
// and replays the inputs with the game's own rules to work out the gas left.
// Submitting is its own consent, separate from telemetry.
(function (root) {
  'use strict';
  const CONFIG = root.CaveConfig || {};
  const Gen = root.CaveGen, { fmt } = root.CaveGame;
  const NICK_KEY = 'caveDiving.nickname.v1';
  const BEST_KEY = 'caveDiving.dailyBest.v1';
  const $ = (id) => document.getElementById(id);
  const endpoint = () => CONFIG.LEADERBOARD_ENDPOINT || null;

  async function request(url, init) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
      const res = await fetch(url, { ...init, signal: ctrl && ctrl.signal });
      let body = null;
      try { body = await res.json(); } catch (e) { body = null; }
      if (res.ok && body) return body;
      throw new Error((body && body.error) || `The leaderboard answered ${res.status}.`);
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('Could not reach the leaderboard.');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function submission(game, plan, nickname) {
    const T = root.CaveTelemetry;
    return {
      playerId: T ? T.playerId : null,
      nickname,
      board: plan.board,
      seed: plan.seed,
      level: plan.level,
      mapMode: plan.mapMode,
      genVersion: Gen.GEN_VERSION,
      appVersion: T ? T.APP_VERSION : null,
      inputs: game.inputs,
    };
  }

  // text/plain keeps it a CORS "simple request": no preflight.
  const submit = (sub) => request(endpoint(), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(sub) });

  function fetchBoard(board, player) {
    const u = new URL(endpoint());
    u.search = new URLSearchParams({ board, limit: '10', ...(player ? { player } : {}) }).toString();
    return request(u.toString(), { method: 'GET' });
  }

  function localBest(board, gas) {
    try {
      const all = JSON.parse(root.localStorage.getItem(BEST_KEY) || '{}');
      if (gas !== undefined && (all[board] === undefined || gas > all[board])) {
        all[board] = gas;
        root.localStorage.setItem(BEST_KEY, JSON.stringify(all));
      }
      return all[board];
    } catch (e) {
      return gas;
    }
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function table(body) {
    const mine = body.player && body.player.rank;
    const rows = body.entries.map((e) => `<tr${e.rank === mine ? ' class="me"' : ''}><td>${e.rank}</td><td>${esc(e.nickname)}</td><td>${Math.round(e.gas)} bar</td><td>${fmt(e.time)}</td></tr>`);
    if (mine && !body.entries.some((e) => e.rank === mine)) {
      const p = body.player;
      rows.push(`<tr class="me gap"><td>${p.rank}</td><td>${esc(p.nickname)}</td><td>${Math.round(p.gas)} bar</td><td>${fmt(p.time)}</td></tr>`);
    }
    if (!rows.length) return '<p class="muted">No dives on this board yet.</p>';
    return `<table class="board"><thead><tr><th>#</th><th>Diver</th><th>Gas left</th><th>Time</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  // Fill the leaderboard block on the result screen. Hidden unless this was the daily maze.
  function showBlock(game, plan) {
    const box = $('result-board');
    if (!plan.board) { box.hidden = true; return; }
    box.hidden = false;
    const res = game.done, counts = res.outcome === 'exit' && res.goal;
    const best = counts ? localBest(plan.board, Math.round(res.gas)) : localBest(plan.board);
    $('board-title').textContent = `Daily maze ${plan.board.slice(6)}`;
    const form = $('board-form'), status = $('board-status'), out = $('board-table');
    out.innerHTML = '';
    $('board-show').textContent = "Show today's board";
    const bestText = best !== undefined ? ` Your best today on this device: ${best} bar.` : '';
    if (!endpoint()) {
      form.hidden = true;
      $('board-show').hidden = true;
      status.textContent = `The leaderboard is not deployed yet.${bestText}`;
      return;
    }
    const show = async () => {
      try {
        out.innerHTML = table(await fetchBoard(plan.board, root.CaveTelemetry && root.CaveTelemetry.playerId));
        $('board-show').textContent = 'Refresh the board';
      } catch (e) {
        out.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
      }
    };
    $('board-show').onclick = show;
    if (!counts) {
      form.hidden = true;
      status.textContent = `Only dives that tag the end chamber and get back to the pool go on the board. It ranks by gas left.${bestText}`;
      $('board-show').hidden = false;
      return;
    }
    form.hidden = false;
    $('board-show').hidden = false;
    const input = $('board-nick'), go = $('board-submit');
    try { input.value = root.localStorage.getItem(NICK_KEY) || ''; } catch (e) { /* ignore */ }
    go.disabled = false;
    status.textContent = 'Submitting publishes your nickname and your inputs for this maze. The board ranks by gas left.';
    go.onclick = async () => {
      go.disabled = true;
      status.textContent = 'Replaying your dive on the server…';
      try {
        try { root.localStorage.setItem(NICK_KEY, input.value); } catch (e) { /* ignore */ }
        const r = await submit(submission(game, plan, input.value));
        status.textContent = `Replayed and ranked #${r.rank} of ${r.total} with ${Math.round(r.submitted.gas)} bar${r.improved ? '.' : '. Your earlier, better dive stays on the board.'}`;
        await show();
      } catch (e) {
        status.textContent = e.message;
        go.disabled = false;
      }
    };
  }

  root.CaveLeaderboard = { showBlock, submission, fetchBoard, submit };
})(window);
