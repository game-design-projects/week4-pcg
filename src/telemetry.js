// Anonymous, opt-in playtest telemetry (the Week 3 and Late pattern).
//
// Local first: every finished or abandoned dive is saved in localStorage as
//   { schema: 1, playerId, sessions: Session[] }
// and can be exported by hand from the Privacy screen. Only if the player
// agrees on the first-run card AND an endpoint is configured (src/config.js)
// is each dive also POSTed to this game's Cloudflare Worker (server/). The
// only identifier is a random id made in the browser: no name, no IP, no
// cookies. A session carries the seed, level, map setting and generator
// version, so the cave can be regenerated and the dive studied later.
(function (root) {
  'use strict';
  const CONFIG = root.CaveConfig || {};
  const Gen = root.CaveGen, C = Gen.C;
  const APP_VERSION = '0.2.0';
  const KEY = 'caveDiving.telemetry.v1';
  const SETTINGS_KEY = 'caveDiving.settings.v1';
  const MAX_SESSIONS = 200;
  const MAX_INPUTS = 8000;
  const SCHEMA = 1;

  function randomId(prefix) {
    const bytes = new Uint8Array(8);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
    return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  function readJSON(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ settings and the local store
  const settings = { consent: 'unset' };   // unset | granted | denied
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

  function send(url, body) {
    try {
      const nav = root.navigator;
      // text/plain keeps it a CORS "simple request": no preflight.
      if (nav && nav.sendBeacon && nav.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
      root.fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
    } catch (e) { /* offline: the dive is still saved on this device */ }
  }

  function save(session) {
    data.sessions.push(session);
    if (data.sessions.length > MAX_SESSIONS) data.sessions = data.sessions.slice(-MAX_SESSIONS);
    if (!writeJSON(KEY, data)) {
      // Storage full: drop the oldest half and try once more.
      data.sessions = data.sessions.slice(Math.floor(data.sessions.length / 2));
      writeJSON(KEY, data);
    }
    if (settings.consent === 'granted' && CONFIG.TELEMETRY_ENDPOINT) send(CONFIG.TELEMETRY_ENDPOINT, JSON.stringify(session));
  }

  // ------------------------------------------------------------------ the record of one dive
  const r1 = (v) => Math.round(v * 10) / 10;
  const OUTCOME = { exit: 'home', out_of_gas: 'out_of_gas', abort: 'abandoned' };

  // plan: { seed, level, mapMode, board, choices, startedAt } from main.js.
  function build(game, plan, outcome) {
    const dive = game.d, log = game.log, B = dive.budget;
    const turned = log.filter((e) => e.type === 'turned').pop();
    const tp = log.find((e) => e.type === 'turn_pressure');
    const events = {};
    for (const e of log) events[e.type] = (events[e.type] || 0) + 1;
    const anchored = game.lines.some((l) => l.anchored);
    const session = {
      schema: SCHEMA,
      id: randomId('s'),
      playerId: data.playerId,
      appVersion: APP_VERSION,
      genVersion: Gen.GEN_VERSION,
      seed: plan.seed,
      level: plan.level,
      mapMode: plan.mapMode,
      board: plan.board || null,
      choices: plan.choices,            // how the level and map were picked: auto, set by hand, or daily
      attempts: dive.attempts,
      rejected: dive.rejected.slice(),
      startedAt: plan.startedAt,
      endedAt: new Date().toISOString(),
      result: {
        outcome,
        goal: game.goalTagged,
        gas: r1(game.gas),
        time: r1(game.t),
        ticks: game.tick,
        score: game.done ? game.done.score : 0,
        maxPen: r1(game.maxPen.m),
        deadEnds: game.deadEndsSeen.size,
        bumps: game.bumps,
        // Where the diver turned for home: metres in, gas then, and position in metres.
        turn: turned ? { t: r1(turned.t), pen: turned.pen, gas: turned.gas, x: r1(turned.x * C.CELL_M), y: r1(turned.y * C.CELL_M), afterTurnPressure: turned.late ? r1(turned.after) : 0 } : null,
        turnPressure: tp ? { t: r1(tp.t), pen: tp.pen } : null,
        siltOuts: game.siltOuts,
        zeroVisSeconds: r1(game.zeroVisTime),
        line: {
          use: anchored ? 'from_pool' : game.lines.length ? 'loose' : 'none',
          tiedIn: game.lines.length > 0,
          lines: game.lines.length,
          laidMetres: r1(game.laidMetres()),
          reelLeftMetres: r1(Math.max(0, game.reel.left) * C.CELL_M),
          heldSeconds: r1(game.heldTicks / 60),
        },
        tutorialStep: game.tutorial ? game.tutorial.step : null,
      },
      cave: { measures: dive.measures, budget: { turn: r1(B.turn), reserve: r1(B.reserve), k: Math.round(B.k * 1e4) / 1e4 } },
      events,
    };
    // With the seed, the inputs replay the whole dive offline (Game.replay).
    if (game.inputs.length <= MAX_INPUTS) session.inputs = game.inputs.slice();
    else session.inputsDropped = game.inputs.length;
    return session;
  }

  // Record a dive once, when it ends or is abandoned.
  function record(game, plan) {
    if (!game || game.recorded) return null;
    game.recorded = true;
    const outcome = game.done ? OUTCOME[game.done.outcome] : 'abandoned';
    const s = build(game, plan, outcome);
    save(s);
    return s;
  }

  // ------------------------------------------------------------------ export and delete
  function exportJSON() {
    return JSON.stringify({ schema: SCHEMA, playerId: data.playerId, exportedAt: new Date().toISOString(), appVersion: APP_VERSION, sessions: data.sessions }, null, 1);
  }
  function download() {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cave-diving-playtest-${data.playerId}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function clear() {
    data.sessions = [];
    writeJSON(KEY, data);
  }

  // ------------------------------------------------------------------ consent card and Privacy screen
  const $ = (id) => document.getElementById(id);

  function fillConsent() {
    $('consent-fine').textContent = CONFIG.TELEMETRY_ENDPOINT
      ? 'You can change this any time under Privacy on the title screen.'
      : 'Our collector is not deployed yet, so for now everything stays on this device either way. You can change this any time under Privacy on the title screen.';
  }

  function fillPrivacy() {
    $('privacy-status').textContent = settings.consent === 'granted' ? 'shared' : 'kept on this device';
    $('privacy-count').textContent = `${data.sessions.length} ${data.sessions.length === 1 ? 'dive' : 'dives'} recorded on this device. Player id: ${data.playerId}`;
    $('privacy-collector').textContent = CONFIG.TELEMETRY_ENDPOINT ? `Collector: ${CONFIG.TELEMETRY_ENDPOINT}` : 'Collector: not deployed, so nothing is sent.';
    $('privacy-toggle').textContent = settings.consent === 'granted' ? 'Stop sharing' : 'Share anonymous data';
  }

  load();
  root.CaveTelemetry = {
    APP_VERSION, settings, setConsent, record, exportJSON, download, clear, fillConsent, fillPrivacy,
    get needsConsent() { return settings.consent === 'unset'; },
    get playerId() { return data.playerId; },
    get sessions() { return data.sessions.slice(); },
  };
})(window);
