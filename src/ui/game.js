// Late — the game: title → morning briefing → the commute → result, over a
// five-day week. Runs the deterministic simulation in real time (with
// fast-forward while waiting) and draws it.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});
  const G = L.gfx;
  const { RULES } = L.rules;
  const TT = L.timetable;

  const SPEED = { walk: 12, dwell: 6, ride: 40, wait: 60, queue: 36 };
  const DAILY_PAY = 400;
  const LATE_FINE_PER_MIN = 15;
  const FARE = 3;
  const STORE_KEY = 'late.week.v1';

  const game = {
    screen: 'title',
    canvas: null,
    ctx: null,
    W: 1280,
    H: 720,
    dpr: 1,
    week: null,
    mode: 'week',
    day: null,
    dayInfo: null,
    policy: null,
    sim: null,
    cam: { x: 0, y: 0 },
    acc: 0,
    clock: 0,
    prevX: null,
    prevSeg: null,
    toasts: [],
    glances: 0,
    phoneUntil: 0,
    blockedFor: 0,
    idleFor: 0,
    signs: new Map(),
    paused: false,
    attract: null,
    lastStation: -1,
    speed: 1,
    ffHeld: false,
  };

  // ------------------------------------------------------------------ persistence

  function saveWeek() {
    try {
      root.localStorage.setItem(STORE_KEY, JSON.stringify(game.week));
    } catch (e) {
      /* private mode: the week lives in memory only */
    }
  }

  function loadWeek() {
    try {
      const raw = root.localStorage.getItem(STORE_KEY);
      const w = raw && JSON.parse(raw);
      if (w && typeof w.seed === 'string' && Number.isInteger(w.weekday) && Array.isArray(w.history)) return w;
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function newWeek(seed) {
    game.week = { seed: seed || L.rng.randomSeedCode(), weekday: 0, history: [], wage: 0, aids: [], version: L.day.GEN_VERSION };
    saveWeek();
  }

  // ------------------------------------------------------------------ canvas

  function resize() {
    const vw = root.innerWidth;
    const vh = root.innerHeight;
    game.dpr = Math.min(2, root.devicePixelRatio || 1);
    game.H = 720;
    game.W = Math.round(Math.max(1000, Math.min(1720, (vw / vh) * 720)));
    const scale = Math.min(vw / game.W, vh / game.H);
    const cw = Math.round(game.W * scale);
    const ch = Math.round(game.H * scale);
    const stage = document.getElementById('stage');
    stage.style.width = `${cw}px`;
    stage.style.height = `${ch}px`;
    stage.style.setProperty('--ui-scale', String(scale));
    game.canvas.style.width = `${cw}px`;
    game.canvas.style.height = `${ch}px`;
    game.canvas.width = Math.round(cw * game.dpr);
    game.canvas.height = Math.round(ch * game.dpr);
    game.scale = scale;
  }

  // ------------------------------------------------------------------ day setup

  function paramsForToday() {
    if (game.mode === 'daily') return L.difficulty.paramsFor(2);
    if (game.mode === 'custom') return L.difficulty.paramsFor(game.custom.weekday);
    const adjust = L.difficulty.direct(game.week.history);
    game.adjust = adjust;
    return L.difficulty.paramsFor(game.week.weekday, adjust);
  }

  function daySeed() {
    if (game.mode === 'daily') return L.rng.dailySeed();
    if (game.mode === 'custom') return game.custom.seed;
    return `${game.week.seed}-${game.week.weekday + 1}`;
  }

  function weekdayNow() {
    if (game.mode === 'daily') return 2;
    if (game.mode === 'custom') return game.custom.weekday;
    return game.week.weekday;
  }

  function prepareDay() {
    const seed = daySeed();
    const params = paramsForToday();
    const t0 = performance.now();
    const day = L.day.generateDay(seed, params);
    const ms = performance.now() - t0;
    const wd = weekdayNow();
    game.day = day;
    game.weekday = wd;
    game.params = params;
    game.policy = L.display.policyFor(wd, game.mode === 'week' ? game.week.aids : []);
    game.signs = new Map();
    game.genMs = ms;
    const lk = L.day.lookups(day);
    game.lines = lk.lines;
    game.service = lk.service;
    game.officeIdx = day.network.stations.findIndex((s) => s.id === day.office.station);
    const best = L.day.bestRoute(day, L.day.graphOf(day), day.startTime, 'mean');
    game.best = best;
    return day;
  }

  function startPlay() {
    const day = game.day;
    game.sim = L.sim.createSim(day);
    game.dm = L.analysis.deadlineMap(day); // latest time you can be anywhere and still clock in
    game.glances = game.policy.phoneGlances;
    game.toasts = [];
    game.acc = 0;
    game.prevX = null;
    game.lastStation = -1;
    game.phoneUntil = 0;
    game.blockedFor = 0;
    game.idleFor = 0;
    game.paused = false;
    game.screen = 'play';
    game.startedAt = new Date().toISOString();
    game.playStart = performance.now();
    L.screens.hideAll();
    snapCamera();
    toast(`${game.weekdayLabel()} — leave home, clock in by 09:00`, '#2b6de0', 3);
  }

  game.weekdayLabel = () => {
    const w = L.difficulty.WEEK[game.day ? game.weekday : weekdayNow()];
    return `${w.day} ${w.zh}`;
  };

  // ------------------------------------------------------------------ helpers

  function toast(text, color, secs = 2) {
    if (game.toasts.some((t) => t.text === text)) return;
    game.toasts.push({ text, color, life: secs });
    if (game.toasts.length > 3) game.toasts.shift();
  }

  function stationView() {
    const s = game.sim.state;
    const st = game.day.network.stations[s.st];
    const I = game.day.interiors[st.id];
    if (!game.signs.has(st.id)) game.signs.set(st.id, L.wayfinding.stationSigns(game.day, L.day.graphOf(game.day), st.id));
    return { st, I };
  }

  function snapCamera() {
    const { st, I } = stationView();
    const v = { I, sim: game.sim.state, day: game.day };
    const p = L.viewStation.playerWorld(v);
    const target = camTarget(p, I);
    game.cam.x = target.x;
    game.cam.y = target.y;
    game.lastStation = game.sim.state.st;
    return st;
  }

  function camTarget(p, I) {
    const lay = p.lay;
    let x = p.x - game.W / 2;
    if (lay.width <= game.W) x = (lay.width - game.W) / 2;
    else x = Math.max(-40, Math.min(lay.width - game.W + 40, x));
    let y = p.y - game.H * 0.6;
    y = Math.max(-60, Math.min(Math.max(-60, lay.height - game.H + 90), y));
    return { x, y };
  }

  // ------------------------------------------------------------------ events from the sim

  function onEvents(evs) {
    const A = L.audio;
    for (const e of evs) {
      switch (e.type) {
        case 'blocked':
          game.blockedFor = 0.4;
          if (e.why === 'one-way') toast('单向通行 One way — not this way', '#b3261e', 1.2);
          else if (e.why === 'escalator') toast('Escalator is running the other way', '#b3261e', 1.2);
          else if (e.why === 'closed') toast(e.text || 'Closed', '#9a6a00', 1.5);
          else if (e.why === 'no-door') toast('Walk to a door first ← →', '#9a6a00', 1.2);
          A.blocked();
          break;
        case 'queue':
          toast(`${e.label}: queue ${Math.round(e.wait)} s`, '#9a6a00', 2);
          A.queue();
          break;
        case 'link':
          if (e.kind === 'gate') A.gate();
          else if (e.kind === 'escalator') A.escalator();
          break;
        case 'lane':
          A.lane();
          break;
        case 'board':
          A.board();
          toast(`上车 On ${e.line.replace('L', 'Line ')}`, game.lines.get(e.line).color, 1.5);
          break;
        case 'alight':
          A.chime();
          if (e.terminus) toast('终点站 Terminus — everybody off', '#6b3fa0', 2);
          break;
        case 'platform':
          snapCamera();
          break;
        case 'arrive':
        case 'gave-up':
          finishDay();
          break;
        default:
          break;
      }
    }
    const fares = game.sim.state.fares;
    if (fares > (game.faresSeen || 0)) {
      game.faresSeen = fares;
      toast(`Re-entry fare ¥${FARE}`, '#b3261e', 2);
    }
  }

  // ------------------------------------------------------------------ result

  function finishDay() {
    const s = game.sim.state;
    const r = s.result;
    L.audio[r.late ? 'late' : 'win']();
    const lateSecs = r.arrival === null ? RULES.GIVE_UP_AFTER : Math.max(0, r.arrival - RULES.CLOCK_IN);
    const fine = r.late ? Math.min(DAILY_PAY, Math.ceil(lateSecs / 60) * LATE_FINE_PER_MIN) : 0;
    const pay = r.how === 'office' ? DAILY_PAY - fine : 0;
    const fares = s.fares * FARE;
    const earned = pay - fares;
    let trace = null;
    try {
      trace = L.analysis.trace(game.day, s.inputs, { dm: game.dm });
    } catch (e) {
      trace = null;
    }
    const excuse = r.late ? L.excuses.excuseFor(game.day, s, trace && trace.lostAt) : null;
    const result = {
      weekday: game.weekday,
      seed: game.day.seed,
      margin: r.margin,
      arrival: r.arrival,
      late: r.late,
      how: r.how,
      par: game.day.par,
      earned,
      fine,
      fares,
      excuse,
      trace,
      stats: s.stats,
      log: s.log,
      inputs: s.inputs,
      ticks: s.tick,
      params: game.params,
      policy: game.policy.day,
      adjust: game.adjust || null,
    };
    game.lastResult = result;
    game.playSeconds = (performance.now() - (game.playStart || performance.now())) / 1000;
    if (game.mode === 'week') {
      game.week.history.push({ weekday: game.weekday, margin: r.margin, arrival: r.arrival, earned, seed: game.day.seed });
      game.week.wage += earned;
      game.week.aids = [];
      game.week.weekday += 1;
      saveWeek();
    }
    if (L.telemetry) L.telemetry.recordDay(game, result);
    game.screen = 'result';
    L.screens.result(game, result);
  }

  // ------------------------------------------------------------------ flow

  function goBriefing() {
    L.screens.loading('Generating today’s city…');
    setTimeout(() => {
      try {
        prepareDay();
      } catch (e) {
        L.screens.error(`Could not generate a day: ${e.message}`);
        return;
      }
      game.screen = 'briefing';
      L.screens.briefing(game, startPlay);
    }, 30);
  }

  game.startWeek = (seed) => {
    game.mode = 'week';
    newWeek(seed);
    goBriefing();
  };
  game.continueWeek = () => {
    game.mode = 'week';
    if (!game.week || game.week.weekday > 4) newWeek();
    goBriefing();
  };
  game.startDaily = () => {
    game.mode = 'daily';
    goBriefing();
  };
  game.startCustom = (seed, weekday) => {
    game.mode = 'custom';
    game.custom = { seed: L.rng.cleanSeed(seed) || L.rng.randomSeedCode(), weekday: Math.max(0, Math.min(4, weekday | 0)) };
    goBriefing();
  };
  game.retryDay = () => {
    if (game.screen === 'play' && L.telemetry) L.telemetry.recordAbandon(game);
    if (game.mode === 'week') {
      // a retry replays the same seed but does not change the week's record
      game.mode = 'custom';
      game.custom = { seed: game.day.seed, weekday: game.weekday };
    }
    goBriefing();
  };
  game.nextDay = () => {
    if (game.mode !== 'week') return game.toTitle();
    if (game.week.weekday > 4) {
      game.screen = 'week';
      L.screens.weekSummary(game);
      return;
    }
    game.screen = 'shop';
    L.screens.shop(game, () => goBriefing());
  };
  game.buyAid = (id) => {
    const aid = L.display.AIDS.find((a) => a.id === id);
    if (!aid || game.week.wage < aid.price || game.week.aids.includes(id)) return false;
    game.week.wage -= aid.price;
    game.week.aids.push(id);
    saveWeek();
    return true;
  };
  game.toTitle = () => {
    if (game.screen === 'play' && L.telemetry) {
      game.playSeconds = (performance.now() - (game.playStart || performance.now())) / 1000;
      L.telemetry.recordAbandon(game);
    }
    game.screen = 'title';
    game.sim = null;
    L.screens.title(game);
    startAttract();
  };
  game.watchBest = () => {
    game.screen = 'ghost';
    L.screens.hideAll();
    game.sim = L.sim.createSim(game.day);
    game.ghost = L.autopilot.createAutopilot(game.day, game.sim, { checkWait: 'max' });
    game.ghost.replan();
    game.glances = Infinity;
    game.toasts = [];
    game.acc = 0;
    snapCamera();
    toast('Best route replay — press Esc to stop', '#2b6de0', 3);
  };

  function startAttract() {
    try {
      const day = L.day.generateDay('LATE-TITLE', L.difficulty.paramsFor(2));
      const sim = L.sim.createSim(day);
      const ap = L.autopilot.createAutopilot(day, sim);
      ap.replan();
      game.attract = { day, sim, ap, acc: 0, cam: { x: 0, y: 0 }, lines: L.day.lookups(day).lines, service: L.day.lookups(day).service, signs: new Map() };
    } catch (e) {
      game.attract = null;
    }
  }

  // ------------------------------------------------------------------ loop

  function speedFor(s) {
    if (s.mode === 'train') {
      const sv = game.day.timetable.services[s.ride.service];
      const pos = TT.tripPosition(sv, s.ride.trip, s.t);
      if (pos && pos.state === 'between') return SPEED.ride;
      if (pos && pos.state === 'at' && pos.stop === s.ride.from) return L.input.is('wait') ? SPEED.ride : SPEED.walk;
      return SPEED.dwell;
    }
    if (s.mode === 'queue' || (s.mode === 'lift' && !s.liftRiding)) return SPEED.queue;
    if (game.ffHeld && s.mode === 'walk' && !(L.input.mask() & 3)) return SPEED.wait;
    return SPEED.walk;
  }

  /** Stop fast-forwarding when a train opens its doors on your platform. */
  function trainJustArrived(s) {
    if (s.mode !== 'walk') return false;
    const I = game.day.interiors[game.day.network.stations[s.st].id];
    const seg = I.segs[s.seg];
    if (seg.platform === null) return false;
    const p = I.platforms[seg.platform];
    for (const side of ['far', 'near']) {
      const tr = p.tracks[side];
      if (!tr) continue;
      const sv = game.service.get(`${tr.line}|${tr.dir}`);
      const k = sv.stopIndex.get(game.day.network.stations[s.st].id);
      const j = TT.tripAt(sv, k, s.t);
      if (j >= 0 && s.t - TT.arrAt(sv, j, k) < 1) return true;
    }
    return false;
  }

  function stepPlay(dt) {
    const s = game.sim.state;
    const keys = L.input.drain();
    for (const k of keys) {
      if (k === 'pause') {
        if (game.screen === 'ghost') return game.toTitleOrResult();
        game.paused = true;
        L.screens.pause(game);
        return;
      }
      if (k === 'help') {
        game.paused = true;
        L.screens.help(game, true);
        return;
      }
      if (k === 'map') openPhone();
      if (k === 'timetable') openTimetable();
      if (k === 'wait') game.ffHeld = true;
      if (['up', 'down', 'left', 'right', 'act'].includes(k)) L.audio.ensure();
    }
    if (!L.input.is('wait')) game.ffHeld = false;
    const phoneOpen = game.clock < game.phoneUntil;
    let speed = speedFor(s);
    if (phoneOpen) speed = SPEED.walk;
    game.speed = speed / SPEED.walk;
    game.acc += (dt * speed * (game.speedMul || 1)) / RULES.DT;
    let n = 0;
    while (game.acc >= 1 && n < 400 * (game.speedMul || 1) && !s.done) {
      game.prevX = s.x;
      game.prevSeg = s.seg;
      if (game.beforeTick) game.beforeTick(s); // test hook: the headless playtest drives the keyboard from here
      let mask = phoneOpen ? 0 : L.input.mask();
      if (game.screen === 'ghost') mask = game.ghost.input();
      const before = s.st;
      const evs = game.sim.step(mask);
      if (game.screen !== 'ghost') onEvents(evs);
      else if (evs.some((e) => e.type === 'arrive' || e.type === 'gave-up')) {
        toast('That was the best route. Esc to go back.', '#2b6de0', 5);
      } else if (evs.some((e) => e.type === 'platform')) snapCamera();
      if (s.st !== before) snapCamera();
      game.acc -= 1;
      n += 1;
      if (speed > SPEED.walk && trainJustArrived(s)) {
        game.acc = 0;
        game.ffHeld = false;
        L.audio.chime();
        break;
      }
      if (game.screen !== 'play' && game.screen !== 'ghost') break;
    }
    if (n >= 400 * (game.speedMul || 1)) game.acc = 0;
    // idle/blocked timers for animation
    game.blockedFor = Math.max(0, game.blockedFor - dt);
    game.idleFor = s.moving || s.mode !== 'walk' ? 0 : game.idleFor + dt;
    for (const t of game.toasts) t.life -= dt;
    game.toasts = game.toasts.filter((t) => t.life > 0);
    // footsteps
    if (s.moving && s.mode === 'walk') {
      game.stepAcc = (game.stepAcc || 0) + dt;
      if (game.stepAcc > 0.28) {
        game.stepAcc = 0;
        L.audio.step();
      }
    }
    // audio beds
    const inTrain = s.mode === 'train';
    L.audio.beds(inTrain ? 1 : 0, inTrain ? 0.2 : 0.8);
  }

  game.toTitleOrResult = () => {
    if (game.lastResult) {
      game.screen = 'result';
      L.screens.result(game, game.lastResult);
    } else game.toTitle();
  };

  function openPhone() {
    if (game.clock < game.phoneUntil) {
      game.phoneUntil = 0;
      return;
    }
    if (game.glances <= 0) {
      toast('Phone is dead 🔋 — no map today', '#b3261e', 1.6);
      return;
    }
    game.glances -= 1;
    game.phoneUntil = game.clock + (game.policy.glanceSeconds === Infinity ? 1e9 : game.policy.glanceSeconds);
    L.audio.phone();
  }

  function openTimetable() {
    if (game.policy.timetable !== 'always') {
      toast(game.policy.timetable === 'briefing' ? 'You did not write the timetable down' : 'No timetable today', '#6b3fa0', 1.6);
      return;
    }
    game.paused = true;
    L.screens.timetable(game);
  }

  game.resume = () => {
    game.paused = false;
    L.screens.hideAll();
  };

  function render() {
    const ctx = game.ctx;
    ctx.setTransform(game.dpr * game.scale, 0, 0, game.dpr * game.scale, 0, 0);
    ctx.clearRect(0, 0, game.W, game.H);
    if ((game.screen === 'play' || game.screen === 'ghost' || game.screen === 'result') && game.sim) {
      renderWorld(ctx, game.sim, game.day, game.cam, true);
    } else if (game.attract) {
      renderWorld(ctx, game.attract.sim, game.attract.day, game.attract.cam, false, game.attract);
      ctx.fillStyle = 'rgba(8,10,14,0.55)';
      ctx.fillRect(0, 0, game.W, game.H);
    } else {
      ctx.fillStyle = '#10131a';
      ctx.fillRect(0, 0, game.W, game.H);
    }
  }

  function renderWorld(ctx, sim, day, cam, withHud, alt) {
    const s = sim.state;
    const st = day.network.stations[s.st];
    const I = day.interiors[st.id];
    const src = alt || game;
    if (alt && !alt.signs.has(st.id)) alt.signs.set(st.id, L.wayfinding.stationSigns(day, L.day.graphOf(day), st.id));
    const t = s.t + (game.acc || 0) * RULES.DT * (s.done ? 0 : 1);
    const policy = alt ? L.display.policyFor(0) : game.policy;
    const v = {
      day,
      I,
      station: st,
      stIndex: s.st,
      lines: src.lines,
      service: src.service,
      sim: s,
      t,
      alpha: alt ? 0 : Math.min(1, game.acc || 0),
      prevX: alt ? null : game.prevX,
      prevSeg: alt ? null : game.prevSeg,
      policy,
      signs: src.signs.get(st.id),
      cam: { x: cam.x, y: cam.y, w: game.W, h: game.H },
      clock: game.clock,
      phoneOpen: !alt && game.clock < game.phoneUntil,
      blockedFor: alt ? 0 : game.blockedFor,
      idleFor: alt ? 0 : game.idleFor,
      W: game.W,
      H: game.H,
      officeIdx: day.network.stations.findIndex((x) => x.id === day.office.station),
    };
    if (s.mode === 'train') {
      L.viewTrain.render(ctx, v);
    } else {
      const p = L.viewStation.playerWorld(v);
      const target = camTarget(p, I);
      const k = 1 - Math.pow(0.0015, game.frameDt || 0.016);
      cam.x += (target.x - cam.x) * k;
      cam.y += (target.y - cam.y) * k;
      v.cam.x = cam.x;
      v.cam.y = cam.y;
      const out = L.viewStation.render(ctx, v);
      v.playerPx = out.playerPx;
      if (withHud && policy.minimap) L.viewStation.drawMinimap(ctx, v, out.lay, { x: game.W - 250, y: 84, w: 236, h: 110 });
    }
    if (withHud) {
      v.toasts = game.toasts;
      v.wage = game.mode === 'week' ? game.week.wage : 0;
      v.glances = game.glances;
      v.dayLabel = game.weekdayLabel();
      v.speed = game.speed || 1;
      v.budget = policy.budgetMeter && game.dm && !alt ? L.analysis.budget(day, game.dm, s) : null;
      L.hud.render(ctx, v);
      if (v.phoneOpen) drawPhone(ctx, v);
    }
  }

  function drawPhone(ctx, v) {
    const w = Math.min(760, game.W - 120);
    const h = 480;
    const x = (game.W - w) / 2;
    const y = 110;
    G.roundRect(ctx, x - 16, y - 34, w + 32, h + 62, 26, '#0c0f14', '#3a414d', 3);
    const left = game.phoneUntil - game.clock;
    G.text(ctx, left > 1e8 ? '地铁通 Metro · map' : `地铁通 Metro · battery low — ${Math.ceil(left)} s`, x + 8, y - 12, { size: 13, weight: 700, color: left < 3 ? '#ff8a80' : '#c9d1dc', family: 'cjk' });
    L.viewMap.drawMap(ctx, game.day, { x, y, w, h }, { labels: 'all', here: game.day.network.stations[game.sim.state.st].id, clock: game.clock });
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - (game.lastNow || now)) / 1000);
    game.lastNow = now;
    game.frameDt = dt;
    game.clock += dt;
    if ((game.screen === 'play' || game.screen === 'ghost') && !game.paused && game.sim && !game.sim.state.done) stepPlay(dt);
    else if (game.screen === 'ghost' && game.sim && game.sim.state.done) {
      for (const k of L.input.drain()) if (k === 'pause') game.toTitleOrResult();
    } else if (game.attract && game.screen !== 'play') {
      const a = game.attract;
      a.acc += (dt * 10) / RULES.DT;
      let n = 0;
      while (a.acc >= 1 && n < 200) {
        if (a.sim.state.done) {
          startAttract();
          break;
        }
        a.sim.step(a.ap.input());
        a.acc -= 1;
        n += 1;
      }
    }
    render();
    root.requestAnimationFrame(frame);
  }

  function init() {
    game.canvas = document.getElementById('game');
    game.ctx = game.canvas.getContext('2d');
    G.loadAtlas();
    L.input.init();
    L.input.mountTouch(document.getElementById('touch'));
    resize();
    root.addEventListener('resize', resize);
    game.week = loadWeek();
    if (L.telemetry) L.telemetry.init(game);
    const q = new URLSearchParams(root.location.search);
    if (q.get('seed')) {
      game.startCustom(q.get('seed'), Number(q.get('wd') || 0));
    } else game.toTitle();
    root.requestAnimationFrame(frame);
    root.__late = game; // for the headless playtest and debugging
  }

  L.game = game;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof self !== 'undefined' ? self : this);
