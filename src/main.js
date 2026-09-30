// Screens, input, the game loop, and the between-dive difficulty director.
(function () {
  'use strict';
  const Gen = window.CaveGen, { Game } = window.CaveGame, { Renderer, loadArt, renderSurvey } = window.CaveRender;
  const Daily = window.CaveDaily, Telemetry = window.CaveTelemetry, Leaderboard = window.CaveLeaderboard;
  const $ = (id) => document.getElementById(id);
  const STORE = 'caveDiving.progress.v1';

  // ------------------------------------------------------------------ progress and the director
  function loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE));
      if (p && typeof p.level === 'number') return p;
    } catch (e) { /* storage unavailable: start fresh */ }
    return { dive: 1, level: 0, history: [] };
  }
  function saveProgress() {
    try { localStorage.setItem(STORE, JSON.stringify(progress)); } catch (e) { /* ignore */ }
  }
  let progress = loadProgress();

  // Between dives only: finishing the tutorial unlocks level 1; after that,
  // success tightens the next maze and running out of gas eases it. Turning
  // back safely without the goal keeps the level where it is.
  function direct(result) {
    const before = progress.level;
    if (current.level === 0) { if (result.outcome === 'exit') progress.level = Math.max(progress.level, 1); }
    else if (result.outcome === 'exit' && result.goal) progress.level = Math.min(12, progress.level + 1);
    else if (result.outcome === 'out_of_gas') progress.level = Math.max(1, progress.level - 1);
    progress.dive += 1;
    progress.history.push({ seed: current.seed, level: current.level, outcome: result.outcome, goal: result.goal, gas: Math.round(result.gas) });
    progress.history = progress.history.slice(-30);
    saveProgress();
    return progress.level - before;
  }

  // Less information as the diver improves: full survey, then entrance only, then none.
  const autoMap = (level) => (level <= 2 ? 'full' : level <= 4 ? 'entrance' : 'none');

  // ------------------------------------------------------------------ state
  const canvas = $('game');
  let renderer = null, game = null, current = null;
  let mode = 'title';          // title | brief | dive | pause | result
  const ui = { showMap: false, showHelp: true, diveNo: 1 };
  const keys = new Set();
  let pendingReel = false;
  const params = new URLSearchParams(location.search);
  if (params.get('seed')) $('opt-seed').value = params.get('seed');
  if (params.get('level')) $('opt-level').value = params.get('level');
  if (params.get('map')) $('opt-map').value = params.get('map');

  function show(id) {
    for (const s of ['title', 'consent', 'privacy', 'brief', 'pause', 'result']) $(s).classList.toggle('hidden', s !== id);
    mode = id || 'dive';
  }
  function updateTitle() {
    $('progress').textContent = progress.level === 0 ? 'Starts with the tutorial' : `Dive ${progress.dive} · level ${progress.level}`;
  }

  // choices records how the level and map were picked (auto, set, or daily), for telemetry.
  function plan(seed, level, mapMode, board, choices) {
    const t0 = performance.now();
    const dive = Gen.generate(seed, level);
    current = { seed, level, mapMode, board: board || null, choices, dive, genMs: Math.round(performance.now() - t0) };
    showBrief();
  }

  function planFromOptions(seedIn) {
    const seed = (seedIn !== undefined ? seedIn : $('opt-seed').value.trim().toUpperCase()) || CaveRNG.randomSeed();
    const lv = $('opt-level').value, level = lv === 'auto' ? progress.level : Number(lv);
    const mv = $('opt-map').value, mapMode = mv === 'auto' ? autoMap(level) : mv;
    plan(seed, level, mapMode, null, { level: lv === 'auto' ? 'auto' : 'set', map: mv === 'auto' ? 'auto' : 'set' });
  }

  function planDaily() {
    const b = Daily.parse(Daily.boardFor(new Date()));
    plan(b.seed, b.level, b.mapMode, b.board, { level: 'daily', map: 'daily' });
  }

  function fact(value, label) { return `<div class="fact"><b>${value}</b><span>${label}</span></div>`; }

  function showBrief() {
    const d = current.dive, m = d.measures, B = d.budget;
    $('brief-title').textContent = current.board ? `Daily maze ${current.board.slice(6)}` : d.tutorial ? 'Level 0: laying a guideline' : `Dive ${progress.dive}: plan`;
    const mapText = { full: 'full survey', entrance: 'survey at the entrance only', none: 'no survey' }[current.mapMode];
    $('brief-meta').textContent = `Seed ${d.seed} \u00b7 level ${d.level}${d.tutorial ? ' (tutorial)' : ''} \u00b7 ${mapText}`;
    $('brief-facts').innerHTML = (d.tutorial ? [
      fact(`${B.P0} bar`, 'starting gas'),
      fact(`${Math.round(B.turn)} bar`, 'turn pressure'),
      fact(`${m.reelLength} m`, 'line on the reel'),
      fact('R', 'tie in, tie off'),
      fact('Space', 'hold the line'),
    ] : [
      fact(`${B.P0} bar`, 'starting gas'),
      fact(`${Math.round(B.turn)} bar`, 'turn pressure'),
      fact(`${m.reelLength} m`, 'line on the reel'),
      fact(`${m.junctions}`, 'junctions'),
      fact(`${m.deadEnds}`, 'dead ends'),
      fact(`${Math.round(d.params.visibility * Gen.C.CELL_M)} m`, 'lamp reach'),
    ]).join('');
    const box = $('brief-map');
    box.innerHTML = '';
    if (current.mapMode === 'none') {
      $('brief-note').textContent = 'No survey for this cave. Lay your line from the post in the pool and find the way through.';
    } else {
      box.appendChild(renderSurvey(d, 4));
      $('brief-note').textContent = d.tutorial
        ? 'A short cave to learn the reel: tie in at the post in the pool, lay line to the end chamber, tie off, then follow the line out when the cave silts up.'
        : current.mapMode === 'full'
          ? 'You carry this survey: press M in the water to check it. It shows the passages, not the way through, and reading it costs time.'
          : 'Study the survey now. It stays at the entrance: once you leave the pool, you have your line, your lamp and your memory.';
    }
    if (current.board) $('brief-note').textContent += ' Everyone dives this same maze today. Tag the end chamber and get home to go on the board, ranked by gas left.';
    $('brief-gen').textContent = `Generated in ${current.genMs} ms${d.attempts > 1 ? `, after ${d.attempts - 1} rejected ${d.attempts === 2 ? 'cave' : 'caves'} (${d.rejected.join('; ')})` : '. It passed the fairness check first time'}.`;
    show('brief');
  }

  function descend() {
    game = new Game(current.dive, current.mapMode);
    current.startedAt = new Date().toISOString();
    pendingReel = false;
    renderer.setDive(game);
    ui.showMap = false;
    ui.showHelp = true;
    ui.helpHidden = false;
    ui.diveNo = progress.dive;
    show(null);
    // A clicked button keeps focus even when hidden; Space would press it again.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function showResult() {
    const res = game.done, pm = game.postMortem();
    const titles = { exit: res.goal ? 'Dive complete' : 'Turned back, home safe', out_of_gas: 'Out of gas', abort: 'Dive ended' };
    $('result-title').textContent = res.tutorial && res.outcome === 'exit' ? 'Tutorial complete' : titles[res.outcome];
    $('result-headline').textContent = pm.headline;
    $('result-stats').innerHTML = [
      fact(pm.stats.time, 'dive time'),
      fact(`${pm.stats.gas} bar`, 'gas left'),
      fact(`${pm.stats.maxPen} m`, 'furthest in'),
      fact(`${pm.stats.laid} m`, 'line laid'),
      fact(`${res.deadEnds}`, 'dead ends'),
      fact(`${pm.stats.zeroVis} s`, 'zero visibility'),
      fact(pm.stats.score, 'score'),
    ].join('');
    $('result-notes').innerHTML = pm.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('');
    $('result-notes-box').hidden = !pm.notes.length;
    $('result-cols').classList.toggle('single', !pm.notes.length);
    $('result-log').innerHTML = pm.timeline.map((e) => `<li><time>${e.t}</time><span>${escapeHtml(e.text)}</span></li>`).join('');
    Telemetry.record(game, current);
    Leaderboard.showBlock(game, current);
    let next = '';
    if (res.outcome !== 'abort' && current.board) {
      progress.dive += 1;
      saveProgress();
      next = 'The daily maze leaves your level where it is.';
    } else if (res.outcome !== 'abort' && $('opt-level').value !== 'auto') {
      progress.dive += 1;
      saveProgress();
      next = `The level is set by hand to ${current.level} in the dive options.`;
    } else if (res.outcome !== 'abort') {
      const change = direct(res);
      next = current.level === 0 ? (res.outcome === 'exit' ? 'Next: level 1, your first maze.' : 'Try the tutorial again.')
        : change > 0 ? `Next maze: level ${progress.level}, bigger, deeper and siltier.`
        : change < 0 ? `Next maze: level ${progress.level}, a little easier.` : `Next maze stays at level ${progress.level}.`;
      const was = autoMap(progress.level - change), now = autoMap(progress.level);
      if ($('opt-map').value === 'auto' && was !== now) next += now === 'full' ? ' You get the full survey back.' : now === 'entrance' ? ' From now on the survey stays at the entrance.' : ' From now on there is no survey at all.';
    }
    $('result-next').textContent = next;
    updateTitle();
    show('result');
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ------------------------------------------------------------------ input
  const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (MOVE[e.code] || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (mode === 'dive') {
      if (e.code === 'Escape' || e.code === 'KeyP') show('pause');
      else if (e.code === 'KeyR') pendingReel = true;   // applied on the next step, so it is recorded
      else if (e.code === 'KeyH') ui.showHelp = !ui.showHelp;
      else if (e.code === 'KeyM') {
        if (ui.showMap) ui.showMap = false;
        else if (game.mapAllowed()) ui.showMap = true;
        else game.toast(game.mapMode === 'none' ? 'There is no survey for this cave.' : 'The survey stayed at the entrance.');
      }
    } else if (mode === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) show(null);
    // Enter on a focused button presses that button instead.
    else if (e.code === 'Enter' && e.target.tagName === 'BUTTON') return;
    else if (mode === 'brief' && e.code === 'Enter') descend();
    else if (mode === 'result' && e.code === 'Enter') $('next').click();
    else if (mode === 'title' && e.code === 'Enter') planFromOptions();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); if (mode === 'dive') show('pause'); });
  window.addEventListener('resize', () => renderer && renderer.resize());

  function readInput() {
    let x = 0, y = 0;
    for (const [code, [dx, dy]] of Object.entries(MOVE)) if (keys.has(code)) { x += dx; y += dy; }
    return { x: Math.sign(x), y: Math.sign(y), hard: keys.has('ShiftLeft') || keys.has('ShiftRight'), hold: keys.has('Space') };
  }

  // ------------------------------------------------------------------ buttons
  $('start').onclick = () => planFromOptions();
  $('daily').onclick = planDaily;
  $('descend').onclick = descend;
  $('brief-back').onclick = () => { updateTitle(); show('title'); };
  $('resume').onclick = () => show(null);
  $('end-dive').onclick = () => { game.abort(); showResult(); };
  $('next').onclick = () => { $('opt-seed').value = ''; planFromOptions(''); };
  $('replay').onclick = () => plan(current.seed, current.level, current.mapMode, current.board, current.choices);
  $('to-title').onclick = () => { updateTitle(); show('title'); };
  $('reset').onclick = () => { progress = { dive: 1, level: 0, history: [] }; saveProgress(); updateTitle(); };

  // Telemetry: the first-run consent card, the Privacy screen, and abandoned dives.
  const choose = (c) => () => { Telemetry.setConsent(c); updateTitle(); show('title'); };
  $('consent-yes').onclick = choose('granted');
  $('consent-no').onclick = choose('denied');
  const openPrivacy = () => { Telemetry.fillPrivacy(); show('privacy'); };
  $('privacy-open').onclick = openPrivacy;
  $('privacy-toggle').onclick = () => { Telemetry.setConsent(Telemetry.settings.consent === 'granted' ? 'denied' : 'granted'); openPrivacy(); };
  $('privacy-export').onclick = () => Telemetry.download();
  $('privacy-clear').onclick = () => { Telemetry.clear(); openPrivacy(); };
  $('privacy-back').onclick = () => show('title');
  // Closing the tab mid-dive records it as abandoned (sent only with consent).
  window.addEventListener('pagehide', () => { if (game && !game.done && current) Telemetry.record(game, current); });

  // ------------------------------------------------------------------ loop
  const STEP = 1 / 60;
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (mode === 'dive' && game) {
      acc += dt;
      const input = readInput();
      while (acc >= STEP && !game.done) {
        input.reel = pendingReel;
        pendingReel = false;
        game.update(STEP, input);
        acc -= STEP;
      }
      if (game.t > 25 && !ui.helpHidden) { ui.helpHidden = true; ui.showHelp = false; }
      renderer.draw(dt, ui);
      if (game.done) { acc = 0; showResult(); }
    } else if (game && (mode === 'pause' || mode === 'result')) {
      renderer.draw(0, ui);
    }
    requestAnimationFrame(frame);
  }

  updateTitle();
  if (Telemetry.needsConsent) { Telemetry.fillConsent(); show('consent'); }
  loadArt('resources/sprites', (art) => {
    renderer = new Renderer(canvas, art);
    window.__cave = { get game() { return game; }, get renderer() { return renderer; }, get current() { return current; }, plan, planDaily, descend };
    requestAnimationFrame(frame);
  });
})();
