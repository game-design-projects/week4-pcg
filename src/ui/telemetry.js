// Late — anonymous, opt-in playtest telemetry (the Week 3 pattern).
//
// Local first: every finished (or abandoned) day is saved in localStorage as
//   { schema: 1, playerId, sessions: Session[] }
// and can be exported by hand. Only if the player agrees on the first-run
// card AND an endpoint is configured is each session also POSTed to our
// Cloudflare Worker (server/). The only identifier is a random id made in
// the browser; no name, no IP, no cookies. A session carries the seed and
// the settings, so the day can be regenerated and studied later.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});

  // Where the Worker lives once deployed (see server/README section in the
  // project README). null = nothing is ever sent; the game works the same.
  const CONFIG = (L.config = L.config || {
    TELEMETRY_ENDPOINT: null, // e.g. 'https://late-telemetry.<account>.workers.dev/v1/sessions'
    LEADERBOARD_ENDPOINT: null, // e.g. 'https://late-telemetry.<account>.workers.dev/v1/scores'
  });

  const APP_VERSION = '0.4.1';
  const KEY = 'late.telemetry.v1';
  const SETTINGS_KEY = 'late.settings.v1';
  const MAX_SESSIONS = 300;
  const SCHEMA = 1;

  function randomId(prefix) {
    const bytes = new Uint8Array(8);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
    return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  function storage() {
    try {
      return root.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function readJSON(key) {
    const s = storage();
    if (!s) return null;
    try {
      return JSON.parse(s.getItem(key) || 'null');
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, value) {
    const s = storage();
    if (!s) return false;
    try {
      s.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------ settings + store

  const settings = { consent: 'unset', nickname: '' };
  let data = { schema: SCHEMA, playerId: null, sessions: [] };

  function load() {
    const st = readJSON(SETTINGS_KEY);
    if (st && typeof st === 'object') Object.assign(settings, st);
    const d = readJSON(KEY);
    if (d && d.schema === SCHEMA && Array.isArray(d.sessions)) data = d;
    if (!data.playerId) data.playerId = randomId('p');
    writeJSON(KEY, data);
  }

  function setConsent(c) {
    settings.consent = c;
    writeJSON(SETTINGS_KEY, settings);
  }

  function isValidSession(s) {
    return !!s && s.schema === SCHEMA && typeof s.id === 'string' && typeof s.seed === 'string' && ['week', 'daily', 'custom', 'tutorial'].includes(s.mode) && typeof s.startedAt === 'string';
  }

  function send(url, body) {
    try {
      const nav = root.navigator;
      if (nav && nav.sendBeacon && nav.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
      root.fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
    } catch (e) {
      /* offline: the session is still saved locally */
    }
  }

  function save(session) {
    if (!isValidSession(session)) return false;
    data.sessions.push(session);
    if (data.sessions.length > MAX_SESSIONS) data.sessions = data.sessions.slice(-MAX_SESSIONS);
    if (!writeJSON(KEY, data)) {
      // quota: drop the oldest half and try once more
      data.sessions = data.sessions.slice(Math.floor(data.sessions.length / 2));
      writeJSON(KEY, data);
    }
    if (settings.consent === 'granted' && CONFIG.TELEMETRY_ENDPOINT) send(CONFIG.TELEMETRY_ENDPOINT, JSON.stringify(session));
    return true;
  }

  // ------------------------------------------------------------------ recorder

  function baseRecord(game) {
    const day = game.day;
    return {
      schema: SCHEMA,
      id: randomId('s'),
      playerId: data.playerId,
      appVersion: APP_VERSION,
      genVersion: day.version,
      mode: game.mode,
      seed: day.seed,
      weekday: game.weekday,
      adjust: game.adjust || null, // the Director's nudge; with seed + weekday this regenerates the day
      attempt: day.attempt,
      rejected: day.rejected.length,
      policy: game.policy.day,
      aids: game.mode === 'week' ? (game.week.aids || []).slice() : [],
      startedAt: game.startedAt || new Date().toISOString(),
      endedAt: new Date().toISOString(),
      startTime: day.startTime,
      par: { arrival: day.par.arrival, tolerance: Math.round(day.par.tolerance || 0) },
      hub: day.network.stations.find((s) => s.id === day.network.hubId).flavor,
      checkpoints: day.checkpoints.length,
      disruptions: day.disruptions.length,
    };
  }

  function summarise(state) {
    const counts = {};
    for (const e of state.log) counts[e.type] = (counts[e.type] || 0) + 1;
    return {
      stats: { ...state.stats },
      events: counts,
      checkpointWaits: state.log.filter((e) => e.type === 'checkpoint').map((e) => Math.round(e.wait)),
      stationsVisited: [...new Set(state.log.map((e) => e.st))].length,
      ticks: state.tick,
      inputs: state.inputs.slice(0, 4000), // with the seed, enough to replay the whole day offline
    };
  }

  function recordDay(game, result) {
    const s = game.sim.state;
    const rec = {
      ...baseRecord(game),
      result: { how: result.how, arrival: result.arrival, margin: Math.round(result.margin), late: result.late },
      glancesLeft: game.glances === Infinity ? null : game.glances,
      realSeconds: Math.round(game.playSeconds || 0),
      ...summarise(s),
    };
    save(rec);
    return rec;
  }

  function recordAbandon(game) {
    if (!game.sim || !game.day || game.sim.state.done) return null;
    const s = game.sim.state;
    const rec = { ...baseRecord(game), result: { how: 'abandoned', arrival: null, margin: Math.round(L.rules.RULES.CLOCK_IN - s.t), late: null }, realSeconds: Math.round(game.playSeconds || 0), ...summarise(s) };
    save(rec);
    return rec;
  }

  function exportJSON() {
    return JSON.stringify({ schema: SCHEMA, playerId: data.playerId, exportedAt: new Date().toISOString(), appVersion: APP_VERSION, sessions: data.sessions }, null, 1);
  }

  function download() {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `late-playtest-${data.playerId}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function clear() {
    data.sessions = [];
    writeJSON(KEY, data);
  }

  // ------------------------------------------------------------------ UI: consent card + privacy settings

  const SHARED = ['The seed and settings of each day you play', 'What happened: arrival, waits, trains, keys pressed', 'Your display settings and aids', 'A random player id made in this browser'];
  const NOT_SHARED = ['Your name or any account', 'Your IP address or location', 'Cookies or cross-site tracking'];

  function consentCard(game, onDone) {
    const S = L.screens;
    const list = (title, items) => S.h('div', {}, S.h('h4', {}, title), S.h('ul', {}, ...items.map((t) => S.h('li', {}, t))));
    S.show(
      S.h('div', { class: 'card consent', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'consent-title' },
        S.h('p', { class: 'kicker' }, 'Before your first commute'),
        S.h('h2', { id: 'consent-title' }, 'Share anonymous playtest data?'),
        S.h('p', { class: 'lead' }, 'It tells us whether our generated days are too easy, unfair or dull — the numbers our generator is tuned by. The game works exactly the same either way.'),
        S.h('div', { class: 'consent-lists' }, list('We share', SHARED), list('We never share', NOT_SHARED)),
        S.h('div', { class: 'consent-actions' },
          S.btn('Share anonymous data', () => {
            setConsent('granted');
            onDone();
          }, '', { dataset: { testid: 'consent-accept' } }),
          S.btn('Keep it on this device', () => {
            setConsent('denied');
            onDone();
          }, '', { dataset: { testid: 'consent-decline' } })),
        S.h('p', { class: 'fine' }, CONFIG.TELEMETRY_ENDPOINT ? 'Change this any time from Privacy on the title screen.' : 'Our collector is not deployed yet, so for now everything stays on this device either way. Change this any time from Privacy on the title screen.')));
  }

  function maybeConsent(game) {
    if (settings.consent === 'unset') consentCard(game, () => L.screens.title(game));
  }

  function showSettings(game) {
    const S = L.screens;
    S.show(S.h('div', { class: 'card small-card' },
      S.h('h2', {}, 'Privacy'),
      S.h('p', { class: 'lead' }, `Anonymous playtest data: `, S.h('b', {}, settings.consent === 'granted' ? 'shared' : 'kept on this device'), '.'),
      S.h('p', { class: 'dim' }, `${data.sessions.length} day(s) recorded on this device · player id ${data.playerId}`),
      S.h('p', { class: 'dim' }, CONFIG.TELEMETRY_ENDPOINT ? `Collector: ${CONFIG.TELEMETRY_ENDPOINT}` : 'Collector: not deployed (nothing is sent).'),
      S.h('div', { class: 'menu' },
        S.btn(settings.consent === 'granted' ? 'Stop sharing' : 'Share anonymous data', () => {
          setConsent(settings.consent === 'granted' ? 'denied' : 'granted');
          showSettings(game);
        }),
        S.btn('Export my data (JSON)', () => download()),
        S.btn('Delete my data on this device', () => {
          clear();
          showSettings(game);
        }),
        S.btn('Back', () => S.title(game), 'primary'))));
  }

  function init(game) {
    load();
    game.telemetry = { get playerId() { return data.playerId; } };
  }

  L.telemetry = { init, recordDay, recordAbandon, maybeConsent, showSettings, exportJSON, settings, CONFIG, APP_VERSION, get playerId() { return data.playerId; }, get sessions() { return data.sessions.slice(); } };
})(typeof self !== 'undefined' ? self : this);
