// Late — DOM screens over the canvas: title, morning briefing, pause, help,
// timetable, result, the shop between days and the week summary.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});
  const { fmtClock, fmtDuration, RULES } = L.rules;
  const TT = L.timetable;

  let overlay = null;
  let timers = [];

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }

  function show(...kids) {
    overlay = overlay || document.getElementById('overlay');
    clearTimers();
    overlay.innerHTML = '';
    overlay.hidden = false;
    for (const k of kids) overlay.appendChild(k);
    const first = overlay.querySelector('button.primary, button');
    if (first) first.focus({ preventScroll: true });
  }

  function clearTimers() {
    for (const t of timers) clearInterval(t);
    timers = [];
  }

  function hideAll() {
    overlay = overlay || document.getElementById('overlay');
    clearTimers();
    overlay.innerHTML = '';
    overlay.hidden = true;
  }

  const btn = (label, onclick, cls = '', extra = {}) => h('button', { class: `btn ${cls}`, type: 'button', onclick: () => { L.audio.click(); onclick(); }, ...extra }, label);

  function lineChip(line) {
    return h('span', { class: 'chip', style: `background:${line.color}` }, String(line.num));
  }

  const stationById = (day, id) => day.network.stations.find((s) => s.id === id);

  function mapCanvas(cls, w, hgt, draw) {
    const cv = h('canvas', { class: cls, width: w * 2, height: hgt * 2, style: `aspect-ratio:${w}/${hgt}` });
    const ctx = cv.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const paint = () => draw(ctx, w, hgt);
    paint();
    if (!L.gfx.atlas.ready) setTimeout(paint, 400);
    return { cv, paint };
  }

  // ------------------------------------------------------------------ title

  function title(game) {
    const w = game.week;
    const canContinue = w && w.weekday <= 4 && w.history.length > 0;
    const wd = canContinue ? L.difficulty.WEEK[w.weekday] : null;
    const seedIn = h('input', { class: 'seed-in', placeholder: 'SEED e.g. K7Q2-M4XP', maxlength: 24, 'aria-label': 'Seed' });
    const daySel = h('select', { class: 'seed-day', 'aria-label': 'Weekday difficulty' }, ...L.difficulty.WEEK.map((d, i) => h('option', { value: i }, `${d.day} ${d.zh}`)));
    const custom = h('div', { class: 'custom', hidden: true }, seedIn, daySel, btn('Play ▸', () => game.startCustom(seedIn.value, Number(daySel.value)), 'small'));
    show(
      h(
        'div',
        { class: 'title-card' },
        h('h1', { class: 'logo' }, 'Late', h('span', { class: 'logo-zh' }, '迟到')),
        h('p', { class: 'tagline' }, 'A subway transfer maze. Every morning the city is generated again — get to the office before 09:00.'),
        h(
          'div',
          { class: 'menu' },
          btn(canContinue ? `Continue the week — ${wd.day} ${wd.zh}` : 'Start the week (Mon–Fri)', () => (canContinue ? game.continueWeek() : game.startWeek()), 'primary', { dataset: { testid: 'start-week' } }),
          canContinue ? btn('Start a new week', () => game.startWeek(), '') : null,
          btn('Daily commute · same city for everyone', () => game.startDaily(), '', { dataset: { testid: 'daily' } }),
          btn('Play a seed…', () => {
            custom.hidden = !custom.hidden;
            if (!custom.hidden) seedIn.focus();
          }),
          custom,
        ),
        h(
          'div',
          { class: 'title-foot' },
          btn('How to play', () => help(game, false), 'ghost small'),
          btn(L.audio.muted ? 'Sound: off' : 'Sound: on', function () {
            L.audio.setMuted(!L.audio.muted);
            title(game);
          }, 'ghost small'),
          L.telemetry ? btn('Privacy', () => L.telemetry.showSettings(game), 'ghost small') : null,
        ),
        h('p', { class: 'fine' }, 'NYU Game Design · Week 4 PCG prototype · Abdulla Alfalasi, Naxin Chen, Steven Li'),
      ),
    );
    if (L.telemetry) L.telemetry.maybeConsent(game);
  }

  function loading(msg) {
    show(h('div', { class: 'card small-card' }, h('div', { class: 'spinner' }), h('p', {}, msg)));
  }

  function error(msg) {
    show(h('div', { class: 'card small-card' }, h('p', {}, msg), btn('Back', () => L.game.toTitle(), 'primary')));
  }

  // ------------------------------------------------------------------ briefing

  function departuresFrom(day, stationId, t0, count) {
    const out = [];
    for (const sv of day.timetable.services) {
      const k = sv.stopIndex.get(stationId);
      if (k === undefined || k === sv.stops.length - 1) continue;
      const j = TT.nextTrip(sv, k, t0);
      const times = [];
      for (let q = 0; q < count && j >= 0 && j + q < sv.deps.length; q++) times.push(TT.depAt(sv, j + q, k));
      out.push({ sv, times, term: stationById(day, sv.stops[sv.stops.length - 1]) });
    }
    return out;
  }

  function routeRides(day, steps) {
    const rides = [];
    for (const st of steps) {
      if (st.type !== 'ride') continue;
      const sv = day.timetable.services[st.service];
      const last = rides[rides.length - 1];
      if (last && last.line === sv.line && last.to === sv.stops[st.from]) last.to = sv.stops[st.to];
      else rides.push({ line: sv.line, from: sv.stops[st.from], to: sv.stops[st.to] });
    }
    return rides;
  }

  function briefing(game, onGo) {
    const day = game.day;
    const p = game.policy;
    const lines = game.lines;
    const home = stationById(day, day.home.station);
    const office = stationById(day, day.office.station);
    const wk = L.difficulty.WEEK[game.weekday];
    const bestRides = game.best ? routeRides(day, game.best.stats.steps) : [];
    const mapW = 640;
    const mapH = 430;
    let hidden = false;
    const map = mapCanvas('mapcv', mapW, mapH, (ctx, w, hh) => {
      ctx.clearRect(0, 0, w, hh);
      L.viewMap.drawMap(ctx, day, { x: 0, y: 0, w, h: hh }, {
        labels: 'all',
        routes: p.routeHint ? [{ rides: bestRides, color: 'rgba(255,122,41,0.9)', width: 5, dash: [2, 9], glow: 'rgba(255,122,41,0.8)' }] : [],
      });
    });
    const cover = h('div', { class: 'map-cover', hidden: true }, h('p', {}, '📵 The app crashed.'), h('p', { class: 'dim' }, 'Hope you remembered the way.'));
    const countdown = h('div', { class: 'map-timer', hidden: !p.briefingSeconds });
    const notes = [];
    notes.push(`Phone map during the commute: ${p.phoneGlances === Infinity ? 'any time (M)' : p.phoneGlances === 0 ? 'none — battery dead' : `${p.phoneGlances} glance${p.phoneGlances > 1 ? 's' : ''} of ${p.glanceSeconds} s (M)`}`);
    notes.push(p.timetable === 'always' ? 'Timetable: in your pocket (T)' : p.timetable === 'briefing' ? 'Timetable: only here — memorise it' : 'Timetable: none today');
    if (p.boards < 1) notes.push(`Platform boards: ${Math.round((1 - p.boards) * 100)}% out of service`);
    if (p.staleSigns > 0) notes.push(`Signs: some out of date${p.signs < 1 ? ', some missing' : ''}`);
    if (!p.escalatorTimers) notes.push('Escalator reversal timers: not shown');
    if (!p.minimap) notes.push('No station minimap');
    if (day.checkpoints.length) notes.push(`${day.checkpoints.length} checkpoint${day.checkpoints.length > 1 ? 's' : ''} reported on the network`);
    if (game.weekday <= 2) for (const d of day.disruptions) notes.push(`⚠ ${d.reason} at ${stationById(day, d.station).name.en}`);
    const adj = game.adjust;
    const memo = adj && adj.mood !== 'steady' && game.mode === 'week'
      ? h('div', { class: 'memo' }, adj.mood === 'easing' ? 'HR memo: “Rough week. Trains should be kinder today.”' : 'Manager: “You have been early. Let’s see you do it again.”', h('span', { class: 'dim' }, ` (Director: ${adj.mood}, slack ${adj.slack >= 0 ? '+' : ''}${adj.slack}s)`))
      : null;
    const deps = departuresFrom(day, home.id, day.startTime, 4);
    const ttCard = p.timetable === 'none'
      ? h('div', { class: 'tt empty' }, 'No timetable today.')
      : h('div', { class: 'tt' }, h('h4', {}, `Departures from ${home.name.en} ${home.name.zh}`),
        ...deps.map((d) => h('div', { class: 'tt-row' }, lineChip(lines.get(d.sv.line)), h('span', { class: 'tt-term' }, `→ ${d.term.name.en}`), h('span', { class: 'tt-times' }, d.times.map((t) => fmtClock(t)).join('  ')))),
        h('div', { class: 'tt-foot' }, ...day.network.lines.map((ln) => {
          const sv = day.timetable.services.find((s) => s.line === ln.id);
          return h('span', { class: 'tt-hw' }, lineChip(ln), sv.irregular ? ` irregular ~${Math.round(sv.headway / 60)} min` : ` every ${Math.round(sv.headway / 60)} min`);
        })));
    const hint = p.routeHint
      ? h('div', { class: 'hint' }, h('b', {}, 'Nav app suggests: '), ...bestRides.flatMap((r, i) => [i ? ' → ' : '', lineChip(lines.get(r.line)), ` ${stationById(day, r.to).name.en}`]), p.exitHint ? `, exit ${day.office.exit}` : '')
      : p.exitHint ? h('div', { class: 'hint' }, `The office is by exit ${day.office.exit}.`) : null;
    const go = btn('Leave home ▸', () => {
      clearTimers();
      onGo();
    }, 'primary big', { dataset: { testid: 'leave-home' } });
    show(
      h(
        'div',
        { class: 'card briefing' },
        h('div', { class: 'brief-map' }, map.cv, cover, countdown),
        h(
          'div',
          { class: 'brief-side' },
          h('p', { class: 'kicker' }, `${wk.day} ${wk.zh} · ${game.mode === 'daily' ? 'Daily commute' : game.mode === 'custom' ? 'Seed' : `Week ${game.week.seed}`} · day ${day.seed}`),
          h('h2', {}, `Leave home ${fmtClock(day.startTime)}`),
          h('p', { class: 'lead' }, 'Clock in by ', h('b', {}, '09:00'), ' at Daka Tech, ', h('b', {}, `${office.name.zh} ${office.name.en}`), '. You live by ', h('b', {}, `${home.name.en}`), '.'),
          memo,
          hint,
          ttCard,
          h('ul', { class: 'notes' }, ...notes.map((n) => h('li', {}, n))),
          go,
          h('p', { class: 'fine' }, `Generated in ${Math.round(game.genMs)} ms · ${day.rejected.length} rejected attempt${day.rejected.length === 1 ? '' : 's'} before this one passed the winnable check · a perfect commuter arrives ${fmtClock(day.par.arrival, true)} even with the longest queues`),
        ),
      ),
    );
    if (p.briefingSeconds) {
      let left = p.briefingSeconds;
      countdown.textContent = `Map visible for ${left}s`;
      timers.push(setInterval(() => {
        left -= 1;
        countdown.textContent = left > 0 ? `Map visible for ${left}s` : 'Map gone';
        if (left <= 0 && !hidden) {
          hidden = true;
          cover.hidden = false;
          map.cv.classList.add('gone');
          clearTimers();
        }
      }, 1000));
    }
  }

  // ------------------------------------------------------------------ in-game overlays

  function pause(game) {
    show(h('div', { class: 'card small-card' }, h('h2', {}, 'Paused'), h('p', { class: 'dim' }, `Clock stopped at ${fmtClock(game.sim.state.t, true)}`),
      h('div', { class: 'menu' }, btn('Resume', () => game.resume(), 'primary'), btn('Restart this day', () => game.retryDay()), btn('How to play', () => help(game, true)), btn('Quit to title', () => game.toTitle()))));
  }

  function help(game, fromPlay) {
    const back = fromPlay ? btn('Back to the commute', () => game.resume(), 'primary') : btn('Back', () => title(game), 'primary');
    show(h('div', { class: 'card help' },
      h('h2', {}, 'How to commute'),
      h('div', { class: 'help-grid' },
        h('div', {}, h('h4', {}, 'Controls'), h('ul', {},
          h('li', {}, h('kbd', {}, '← →'), ' walk'),
          h('li', {}, h('kbd', {}, '↑'), ' board the train behind the platform · take stairs/escalator/lift up · far lane'),
          h('li', {}, h('kbd', {}, '↓'), ' board the train in front · go down · near lane'),
          h('li', {}, h('kbd', {}, '↑'), ' / ', h('kbd', {}, 'E'), ' get off the train at a stop'),
          h('li', {}, h('kbd', {}, 'Space'), ' hold to let time pass while you wait'),
          h('li', {}, h('kbd', {}, 'M'), ' phone map (limited later in the week) · ', h('kbd', {}, 'T'), ' timetable · ', h('kbd', {}, 'Esc'), ' pause'))),
        h('div', {}, h('h4', {}, 'The rules'), h('ul', {},
          h('li', {}, h('b', {}, 'Opposing lanes: '), 'passages have two lanes flowing opposite ways. Walk against the crowd and you crawl — switch lanes.'),
          h('li', {}, h('b', {}, 'One-way corridors: '), 'marked 单向通行. There is always another way back.'),
          h('li', {}, h('b', {}, 'Escalators '), 'only run one way, and some reverse every few minutes. Stairs always work but are slower.'),
          h('li', {}, h('b', {}, 'Checkpoints '), '(安检 / ID check) make you queue a random time.'),
          h('li', {}, h('b', {}, 'Gates: '), 'leaving the paid area and coming back costs a fare. Split hubs make you do it.'),
          h('li', {}, h('b', {}, 'Doors: '), 'you get off where you got on — pick the car near the exit you need.'),
        ))),
      h('p', { class: 'dim' }, 'Each day is generated from a seed and checked by a solver: a perfect commuter can always make it with time to spare, even with the longest queues.'),
      back));
  }

  function timetable(game) {
    const s = game.sim.state;
    const st = game.day.network.stations[s.st];
    const deps = departuresFrom(game.day, st.id, s.t, 5);
    show(h('div', { class: 'card small-card tt-card' }, h('h2', {}, `${st.name.zh} ${st.name.en}`), h('p', { class: 'dim' }, `Now ${fmtClock(s.t, true)}`),
      h('div', { class: 'tt' }, ...deps.map((d) => h('div', { class: 'tt-row' }, lineChip(game.lines.get(d.sv.line)), h('span', { class: 'tt-term' }, `→ ${d.term.name.en}`), h('span', { class: 'tt-times' }, d.times.map((t) => fmtClock(t)).join('  '))))),
      btn('Back (T)', () => game.resume(), 'primary')));
    const onKey = (e) => {
      if (e.code === 'KeyT' || e.code === 'Escape') {
        root.removeEventListener('keydown', onKey);
        game.resume();
      }
    };
    root.addEventListener('keydown', onKey);
  }

  // ------------------------------------------------------------------ result

  function result(game, r) {
    const day = game.day;
    const onTime = !r.late;
    const lines = game.lines;
    const yourRides = [];
    let cur = null;
    for (const e of r.log) {
      if (e.type === 'board') cur = { line: e.line, from: e.st };
      if (e.type === 'alight' && cur) {
        yourRides.push({ ...cur, to: e.at });
        cur = null;
      }
    }
    const bestRides = game.best ? routeRides(day, game.best.stats.steps) : [];
    const map = mapCanvas('mapcv result-map', 560, 360, (ctx, w, hh) => {
      L.viewMap.drawMap(ctx, day, { x: 0, y: 0, w, h: hh }, {
        labels: 'ends',
        routes: [
          { rides: bestRides, color: 'rgba(40,120,255,0.85)', width: 9 },
          { rides: yourRides, color: 'rgba(255,122,41,0.95)', width: 4, dash: [8, 6] },
        ],
      });
    });
    const marginTxt = r.arrival === null ? 'You gave up and called in sick.' : onTime ? `${fmtDuration(r.margin)} early` : `${fmtDuration(-r.margin)} late`;
    const s = r.stats;
    const stat = (k, v2) => h('div', { class: 'stat' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v2));
    const bestArr = game.best ? game.best.arrival : day.par.arrival;
    const chat = r.excuse
      ? h('div', { class: 'chat' }, h('div', { class: 'bubble me' }, r.excuse.text), h('div', { class: 'bubble boss' }, h('b', {}, 'Boss: '), r.excuse.reply))
      : h('div', { class: 'chat' }, h('div', { class: 'bubble boss' }, h('b', {}, 'Boss: '), r.margin > 300 ? 'Early bird! 👀' : 'Morning.'));
    const week = game.mode === 'week';
    const nextLabel = week ? (game.week.weekday > 4 ? 'See the week ▸' : `Next: ${L.difficulty.WEEK[game.week.weekday].day} ▸`) : 'Back to title';
    const share = `${location.origin === 'null' ? '' : location.origin}${location.pathname}?seed=${encodeURIComponent(day.seed)}&wd=${r.weekday}`;
    const lb = L.leaderboard && game.mode === 'daily' && r.how === 'office' ? L.leaderboard.submitBlock(game, r) : null;
    show(h('div', { class: 'card result' },
      h('div', { class: `stamp ${onTime ? 'ok' : 'bad'}` }, onTime ? '准时 ON TIME' : '迟到 LATE'),
      h('h2', {}, r.arrival === null ? 'Day over' : `Clocked in ${fmtClock(r.arrival, true)}`, h('span', { class: `margin ${onTime ? 'ok' : 'bad'}` }, ` · ${marginTxt}`)),
      h('div', { class: 'result-grid' },
        h('div', { class: 'result-map' }, map.cv, h('div', { class: 'legend' }, h('span', { class: 'lg best' }, 'best route'), h('span', { class: 'lg you' }, 'your route'))),
        h('div', { class: 'stats' },
          stat('Best possible', fmtClock(bestArr, true)),
          stat('You vs best', r.arrival === null ? '—' : `+${fmtDuration(r.arrival - bestArr)}`),
          stat('Walking', fmtDuration(s.walk)),
          stat('Riding', fmtDuration(s.ride)),
          stat('Queueing', fmtDuration(s.queue)),
          stat('Standing about', fmtDuration(s.idle)),
          stat('Against the crowd', fmtDuration(s.against)),
          stat('Trains boarded', String(s.boards)),
          stat('Pay today', `${r.earned >= 0 ? '+' : ''}¥${r.earned}${r.fine ? ` (fine ¥${r.fine})` : ''}${r.fares ? ` (fares ¥${r.fares})` : ''}`),
          week ? stat('Wage this week', `¥${game.week.wage}`) : null,
          chat)),
      lb,
      h('div', { class: 'actions' },
        btn(nextLabel, () => game.nextDay(), 'primary', { dataset: { testid: 'next-day' } }),
        btn('Retry this day', () => game.retryDay()),
        btn('Watch the best route', () => game.watchBest()),
        btn('Copy replay link', () => {
          try {
            navigator.clipboard.writeText(share);
          } catch (e) {
            /* ignore */
          }
        }, 'ghost')),
      h('p', { class: 'fine' }, `Seed ${day.seed} · generator ${day.version} · ${r.policy} display`)));
  }

  // ------------------------------------------------------------------ between days

  function shop(game, onDone) {
    const wd = L.difficulty.WEEK[game.week.weekday];
    const render = () => {
      const items = L.display.AIDS.map((a) => {
        const owned = game.week.aids.includes(a.id);
        return h('div', { class: `aid ${owned ? 'owned' : ''}` }, h('h4', {}, `${a.name} `, h('span', { class: 'dim' }, a.zh)), h('p', {}, a.blurb),
          btn(owned ? 'Bought' : `¥${a.price}`, () => {
            if (game.buyAid(a.id)) render();
          }, owned ? 'ghost small' : 'small', { disabled: owned || game.week.wage < a.price }));
      });
      show(h('div', { class: 'card shop' }, h('p', { class: 'kicker' }, `Evening · tomorrow is ${wd.day} ${wd.zh}`), h('h2', {}, 'Convenience store 便利店'),
        h('p', { class: 'lead' }, `Wage so far ¥${game.week.wage}. Aids only change what you are shown tomorrow — the city is still generated the same way.`),
        h('div', { class: 'aids' }, ...items), btn(`Sleep → ${wd.day} ▸`, onDone, 'primary', { dataset: { testid: 'sleep' } })));
    };
    render();
  }

  function weekSummary(game) {
    const w = game.week;
    const lateDays = w.history.filter((d) => d.margin < 0).length;
    const rating = lateDays === 0 ? ['本月之星', 'Employee of the Month'] : lateDays === 1 ? ['还行', 'A solid week'] : lateDays <= 3 ? ['谈谈吧', 'HR would like a word'] : ['远程办公?', 'Have you considered remote work?'];
    show(h('div', { class: 'card small-card week' }, h('p', { class: 'kicker' }, `Week ${w.seed}`), h('h2', {}, `${rating[0]} · ${rating[1]}`),
      h('table', { class: 'week-table' }, h('tr', {}, h('th', {}, 'Day'), h('th', {}, 'Clock-in'), h('th', {}, 'Margin'), h('th', {}, 'Pay')),
        ...w.history.map((d) => h('tr', { class: d.margin < 0 ? 'bad' : 'ok' }, h('td', {}, L.difficulty.WEEK[d.weekday].day), h('td', {}, d.arrival ? fmtClock(d.arrival, true) : '—'), h('td', {}, d.margin >= 0 ? `+${fmtDuration(d.margin)}` : `−${fmtDuration(-d.margin)}`), h('td', {}, `¥${d.earned}`)))),
      h('p', { class: 'lead' }, `Take-home pay: ¥${w.wage}`),
      h('div', { class: 'menu' }, btn('Start a new week', () => game.startWeek(), 'primary'), btn('Title', () => game.toTitle()))));
  }

  L.screens = { h, show, hideAll, btn, title, loading, error, briefing, pause, help, timetable, result, shop, weekSummary, lineChip, mapCanvas, routeRides };
})(typeof self !== 'undefined' ? self : this);
