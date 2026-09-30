// Late — the Day 0 coach. The tutorial is a real generated day with the
// route guide on; the coach adds short lessons, each shown the first time
// its situation comes up (the first stairs, the first platform, the first
// train) and kept on screen until the player has done the thing once.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});
  const G = L.gfx;
  const { lanesOf } = L.rules;

  const LESSONS = [
    {
      id: 'walk',
      title: 'Walking',
      text: '← → walk. The yellow arrows on the floor show the way, and the NAV line at the top says what to do next.',
      when: () => true,
      done: (c, s) => s.stats.walk >= 5,
    },
    {
      id: 'stairs',
      title: 'Stairs and escalators',
      text: 'At the end of a staircase, ↓ goes down and ↑ goes up. Escalators only run one way; stairs always work but are slower.',
      when: (c, s, x) => x.nav && x.nav.kind === 'link' && !x.nav.dir,
      done: (c) => c.vlinks >= 1,
    },
    {
      id: 'gates',
      title: 'Fare gates',
      text: 'Walk through the fare gates into the paid area. If you leave it and come back in, you pay the fare again.',
      when: (c, s, x) => x.seg.kind === 'unpaid' || (x.nav && x.nav.kind === 'link' && x.nav.dir !== 0 && /gates/.test(x.nav.text)),
      done: (c) => c.gates >= 1,
    },
    {
      id: 'lanes',
      title: 'Two lanes',
      text: 'This passage has two streams of people. Walk against the crowd and you crawl: ↑ and ↓ switch lanes. The arrows on the floor show which way each lane flows.',
      when: (c, s, x) => lanesOf(x.seg) === 2 && x.seg.kind !== 'street',
      done: (c, s) => s.stats.lanes >= 1 || c.leftTwoLane,
    },
    {
      id: 'platform',
      title: 'Boarding',
      text: 'Trains stop on both sides of the platform. Stand at a door: ↑ boards the train behind the platform, ↓ the one in front. The board says where each goes. Hold Space to make the wait pass faster.',
      when: (c, s, x) => x.seg.platform !== null && s.mode === 'walk',
      done: (c, s) => s.stats.boards >= 1,
    },
    {
      id: 'train',
      title: 'On the train',
      text: '← → walks through the carriages. The yellow door is the one nearest your way out. When the doors open at your stop, press ↑ or E.',
      when: (c, s) => s.mode === 'train',
      done: (c) => c.alights >= 1,
    },
    {
      id: 'map',
      title: 'Phone map',
      text: 'Press M to look at the map on your phone. From Wednesday you only get a few glances, so make them count.',
      when: (c, s) => c.alights >= 1 && s.mode === 'walk',
      done: (c) => c.map,
    },
    {
      id: 'timetable',
      title: 'Timetable',
      text: 'Press T on a platform to see the next trains from this station. After Tuesday the timetable stays at home.',
      when: (c, s, x) => c.alights >= 1 && x.seg.platform !== null && s.mode === 'walk',
      done: (c, s) => c.timetable || s.stats.boards >= 2,
    },
    {
      id: 'exit',
      title: 'Your stop',
      text: 'This is your stop. Take the exit up to the street; the office is by exit {exit}.',
      when: (c, s, x) => s.st === x.officeIdx && s.mode === 'walk',
      done: (c, s) => s.done,
    },
  ];

  function create(game) {
    const day = game.day;
    const officeIdx = day.network.stations.findIndex((x) => x.id === day.office.station);
    const c = { vlinks: 0, gates: 0, alights: 0, map: false, timetable: false, leftTwoLane: false, done: new Set(), current: null, flash: null };
    let prevSeg = null;

    function context() {
      const s = game.sim.state;
      const I = day.interiors[day.network.stations[s.st].id];
      return { seg: I.segs[s.seg], nav: game.nav, officeIdx };
    }

    /** Called every frame: finish lessons that are done, pick the one to show. */
    function update() {
      const s = game.sim.state;
      const x = context();
      const segKey = `${s.st}|${s.seg}`;
      if (prevSeg && prevSeg.key !== segKey && prevSeg.twoLane && c.current && c.current.id === 'lanes') c.leftTwoLane = true;
      prevSeg = { key: segKey, twoLane: lanesOf(x.seg) === 2 };
      for (const l of LESSONS) {
        if (c.done.has(l.id) || !l.done(c, s, x)) continue;
        // a lesson only counts once it has been shown (or its situation came up)
        if (c.current && c.current.id === l.id) {
          c.done.add(l.id);
          c.flash = { text: `✓ ${l.title}`, life: 2.2 };
          c.current = null;
          if (L.audio && L.audio.chime) L.audio.chime();
        }
      }
      // show the first unfinished lesson whose situation is here; keep the
      // current one while nothing else applies (so it does not blink out on stairs)
      const stale = !c.current || c.done.has(c.current.id);
      if (stale || !c.current.when(c, s, x)) {
        const next = LESSONS.find((l) => !c.done.has(l.id) && l.when(c, s, x)) || null;
        if (next || stale) c.current = next;
      }
    }

    function observe(evs) {
      for (const e of evs) {
        if (e.type === 'link') {
          if (e.kind === 'gate') c.gates += 1;
          else if (e.kind === 'stairs' || e.kind === 'escalator' || e.kind === 'lift') c.vlinks += 1;
        }
        if (e.type === 'alight') c.alights += 1;
      }
    }

    function note(what) {
      if (what === 'map') c.map = true;
      if (what === 'timetable') c.timetable = true;
    }

    function wrap(ctx, text, width, size) {
      const words = text.split(' ');
      const out = [];
      let line = '';
      for (const w of words) {
        const tryLine = line ? `${line} ${w}` : w;
        if (G.measure(ctx, tryLine, size, 600, 'cjk') > width && line) {
          out.push(line);
          line = w;
        } else line = tryLine;
      }
      if (line) out.push(line);
      return out;
    }

    function render(ctx, v, dt) {
      if (c.flash) c.flash.life -= dt || 0.016;
      const l = c.current;
      const w = 340;
      const x = v.W - 14 - w;
      const y = v.sim.mode === 'train' ? 252 : 204;
      let bottom = y;
      if (l) {
        const body = l.text.replace('{exit}', day.office.exit);
        const lines = wrap(ctx, body, w - 28, 14);
        const h = 50 + lines.length * 20;
        bottom = y + h + 8;
        G.roundRect(ctx, x, y, w, h, 10, 'rgba(11,13,17,0.92)', '#ffd166', 2);
        G.text(ctx, `教练 COACH · ${c.done.size + 1}/${LESSONS.length}`, x + 14, y + 20, { size: 10, weight: 800, color: '#ffd166', family: 'cjk' });
        G.text(ctx, l.title, x + w - 14, y + 20, { size: 12, weight: 800, align: 'right', color: '#ffe7a8' });
        lines.forEach((ln, i) => G.text(ctx, ln, x + 14, y + 44 + i * 20, { size: 14, weight: 600, color: '#eef1f5', family: 'cjk' }));
      }
      if (c.flash && c.flash.life > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, c.flash.life / 0.4);
        const fw = G.measure(ctx, c.flash.text, 14, 800) + 30;
        G.roundRect(ctx, x + w - fw, bottom, fw, 28, 14, 'rgba(48,164,108,0.95)');
        G.text(ctx, c.flash.text, x + w - fw / 2, bottom + 19, { size: 14, weight: 800, align: 'center' });
        ctx.restore();
      }
    }

    return {
      update,
      observe,
      note,
      render,
      get learned() {
        return LESSONS.filter((l) => c.done.has(l.id)).map((l) => l.title);
      },
      get missed() {
        return LESSONS.filter((l) => !c.done.has(l.id)).map((l) => l.title);
      },
      get current() {
        return c.current ? c.current.id : null;
      },
    };
  }

  L.coach = { create, LESSONS };
})(typeof self !== 'undefined' ? self : this);
