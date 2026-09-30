// Late — heads-up display: clock and time left, where you are, what the
// arrow keys would do right here, and short toasts.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});
  const G = L.gfx;
  const { RULES, fmtClock, escalatorDir, lanesOf, walkSpeed } = L.rules;
  const TT = L.timetable;

  const LEVEL_NAMES = { street: ['地面', 'Street'], unpaid: ['站厅', 'Concourse (unpaid)'], paid: ['站厅', 'Concourse'], platform: ['站台', 'Platform'], passage: ['通道', 'Passage'], hall: ['换乘厅', 'Transfer hall'], underpass: ['地下通道', 'Underpass'] };

  function stationName(day, id) {
    return day.network.stations.find((s) => s.id === id).name;
  }

  /** What the arrow keys would do here: {keys:[...], text, tone}. */
  function contextHint(v) {
    const s = v.sim;
    const day = v.day;
    if (s.mode === 'train') {
      const sv = day.timetable.services[s.ride.service];
      const pos = TT.tripPosition(sv, s.ride.trip, v.t);
      if (pos && pos.state === 'at' && pos.stop !== s.ride.from) {
        const n = stationName(day, sv.stops[pos.stop]);
        return { keys: ['↑', 'E'], text: `Get off at ${n.en} ${n.zh}`, tone: 'go' };
      }
      if (pos && pos.state === 'between') return { keys: ['Space'], text: `Next: ${stationName(day, sv.stops[pos.next]).en} · hold Space to speed up`, tone: 'info' };
      return { keys: [], text: 'Doors closing…', tone: 'info' };
    }
    if (s.mode === 'queue') return { keys: [], text: `${s.link.check.label}: ${Math.ceil(s.timer)} s`, tone: 'warn' };
    if (s.mode === 'lift') return { keys: ['←', '→'], text: s.liftRiding ? 'In the lift…' : 'Waiting for the lift (walk away to cancel)', tone: 'info' };
    if (s.mode !== 'walk') return null;
    const I = v.I;
    const seg = I.segs[s.seg];
    if (seg.platform !== null) {
      const p = I.platforms[seg.platform];
      const k = p.doors.findIndex((x) => Math.abs(x - s.x) <= RULES.DOOR_REACH);
      if (k >= 0) {
        const parts = [];
        for (const [side, key] of [['far', '↑'], ['near', '↓']]) {
          const tr = p.tracks[side];
          if (!tr) continue;
          const sv = v.service.get(`${tr.line}|${tr.dir}`);
          const stop = sv.stopIndex.get(v.station.id);
          const term = stationName(day, sv.stops[sv.stops.length - 1]);
          if (stop === sv.stops.length - 1) continue;
          const j = TT.tripAt(sv, stop, v.t);
          if (j >= 0) {
            const left = Math.ceil(TT.depAt(sv, j, stop) - v.t);
            parts.push({ keys: [key], text: `Board ${tr.line.replace('L', 'Line ')} → ${term.en} (${left}s)`, tone: 'go' });
          } else parts.push({ keys: [key], text: `Line ${tr.line.replace('L', '')} → ${term.en}: wait here`, tone: 'info' });
        }
        if (parts.length) return parts.length === 1 ? parts[0] : { keys: [], text: parts.map((p2) => `${p2.keys[0]} ${p2.text}`).join('   '), tone: parts.some((p2) => p2.tone === 'go') ? 'go' : 'info' };
      }
    }
    for (const Lk of I.links) {
      if (Lk.axis !== 'v') continue;
      const atTop = Lk.a.seg === s.seg && Math.abs(Lk.a.x - s.x) <= RULES.REACH;
      const atBottom = Lk.b.seg === s.seg && Math.abs(Lk.b.x - s.x) <= RULES.REACH;
      if (!atTop && !atBottom) continue;
      const other = I.segs[atTop ? Lk.b.seg : Lk.a.seg];
      const where = other.depth === 0 ? 'the street' : `B${other.depth}`;
      const key = atTop ? '↓' : '↑';
      const name = Lk.kind === 'escalator' ? 'Escalator' : Lk.kind === 'lift' ? 'Lift' : Lk.exit ? `Exit ${Lk.exitLetter}` : 'Stairs';
      if (Lk.closedUntil && v.t < Lk.closedUntil) return { keys: [], text: `${name}: ${Lk.closure || 'closed'}`, tone: 'bad' };
      if (Lk.kind === 'escalator' && escalatorDir(Lk.esc, v.t) !== (atTop ? 1 : -1)) {
        return { keys: [], text: `Escalator running ${atTop ? 'up' : 'down'} — ${v.policy.escalatorTimers && Lk.esc.period ? 'reverses soon' : 'use the stairs'}`, tone: 'bad' };
      }
      return { keys: [key], text: `${name} ${atTop ? 'down' : 'up'} to ${where}`, tone: 'go' };
    }
    if (lanesOf(seg) === 2) {
      const flow = s.lane === 1 ? -seg.dir : seg.dir;
      const against = s.facing !== flow && s.moving;
      return { keys: [s.lane === 1 ? '↓' : '↑'], text: against ? 'Against the crowd! Switch lane' : `Switch to the ${s.lane === 1 ? 'near' : 'far'} lane`, tone: against ? 'bad' : 'info' };
    }
    if (seg.flow === 'one-way' && walkSpeed(seg, 0, s.facing) === 0) return { keys: [], text: `One way ${seg.dir > 0 ? '→' : '←'}`, tone: 'bad' };
    if (s.st === v.officeIdx && seg.kind === 'street') {
      const d = day.office.x - s.x;
      return { keys: [d > 0 ? '→' : '←'], text: `Office ${Math.abs(Math.round(d))} m`, tone: 'go' };
    }
    return null;
  }

  function keycap(ctx, label, x, y) {
    const w = Math.max(24, G.measure(ctx, label, 13, 800) + 14);
    G.roundRect(ctx, x, y - 17, w, 24, 5, '#f4f5f7', '#9aa1ab', 1);
    ctx.fillStyle = '#c2c7cf';
    ctx.fillRect(x + 2, y + 4, w - 4, 2);
    G.text(ctx, label, x + w / 2, y, { size: 13, weight: 800, align: 'center', color: '#1b1f25' });
    return w;
  }

  function render(ctx, v) {
    const { W, H } = v;
    const t = v.t;
    const left = RULES.CLOCK_IN - t;
    const late = left < 0;
    // ---- clock panel
    G.roundRect(ctx, 14, 12, 250, 88, 10, 'rgba(11,13,17,0.86)', 'rgba(255,255,255,0.1)');
    G.sprite(ctx, 'ic_clock', 44, 64, { scale: 0.62 });
    const blink = late && Math.floor(v.clock * 2) % 2 === 0;
    G.text(ctx, fmtClock(t, true), 70, 55, { size: 34, weight: 700, family: 'pixel', color: late ? (blink ? '#ff5b4d' : '#ff9b8f') : '#f4f5f7' });
    const span = RULES.CLOCK_IN - v.day.startTime;
    const frac = Math.max(0, Math.min(1, left / span));
    const col = late ? '#e5484d' : left < 180 ? '#e5484d' : left < 600 ? '#f5a524' : '#30a46c';
    G.roundRect(ctx, 70, 66, 180, 8, 4, '#2a3038');
    G.roundRect(ctx, 70, 66, Math.max(8, 180 * frac), 8, 4, col);
    G.text(ctx, late ? `LATE +${L.rules.fmtDuration(-left)}` : `Clock-in 09:00 · ${Math.floor(left / 60)}m ${String(Math.floor(left % 60)).padStart(2, '0')}s left`, 70, 92, { size: 11, weight: 700, color: late ? '#ff8a80' : '#b9c2cf' });

    // ---- where
    const st = v.station;
    let where = '';
    if (v.sim.mode === 'train') {
      const sv = v.day.timetable.services[v.sim.ride.service];
      const term = stationName(v.day, sv.stops[sv.stops.length - 1]);
      where = `${sv.line.replace('L', 'Line ')} → ${term.en}`;
    } else {
      const seg = v.I.segs[v.sim.seg];
      const ln = LEVEL_NAMES[seg.kind] || ['', seg.kind];
      where = `${seg.depth === 0 ? 'G' : `B${seg.depth}`} · ${ln[1]}${seg.flow !== 'two-way' ? ` · ${seg.flow}` : ''}`;
    }
    const title = `${st.name.zh}  ${st.name.en}`;
    const lines = st.lines.map((id) => v.lines.get(id));
    const badgesW = lines.length * 22;
    const nameW = Math.max(G.measure(ctx, title, 20, 800, 'cjk') + badgesW, G.measure(ctx, where, 12, 600)) + 40;
    const nx = W / 2 - nameW / 2;
    G.roundRect(ctx, nx, 12, nameW, 62, 10, 'rgba(11,13,17,0.86)', 'rgba(255,255,255,0.1)');
    lines.forEach((ln, i) => G.badge(ctx, ln, nx + 28 + i * 22, 34, 9));
    G.text(ctx, title, nx + 20 + badgesW + (nameW - 40 - badgesW) / 2, 41, { size: 20, weight: 800, align: 'center', family: 'cjk' });
    G.text(ctx, where, W / 2, 62, { size: 12, weight: 600, align: 'center', color: '#b9c2cf' });

    // ---- day, wage, phone
    const rx = W - 14;
    G.roundRect(ctx, rx - 236, 12, 236, 62, 10, 'rgba(11,13,17,0.86)', 'rgba(255,255,255,0.1)');
    G.text(ctx, v.dayLabel, rx - 222, 38, { size: 16, weight: 800, family: 'cjk', color: '#ffd166' });
    G.text(ctx, `¥${v.wage.toLocaleString()}`, rx - 222, 62, { size: 14, weight: 700, color: '#d9e2ec', family: 'pixel' });
    const g = v.glances;
    const phoneTxt = g === Infinity ? '∞' : String(g);
    G.sprite(ctx, 'ic_phone', rx - 64, 58, { scale: 0.5, alpha: g === 0 ? 0.35 : 1 });
    G.text(ctx, g === 0 ? '✕' : phoneTxt, rx - 44, 50, { size: 16, weight: 800, color: g === 0 ? '#e5484d' : '#e8edf3' });
    G.text(ctx, 'M map', rx - 44, 66, { size: 9, weight: 700, color: '#8b95a3' });
    if (v.policy.timetable === 'always') G.text(ctx, 'T times', rx - 110, 66, { size: 9, weight: 700, color: '#8b95a3' });

    // ---- fast forward
    if (v.speed > 1.5) {
      G.roundRect(ctx, 14, 108, 92, 26, 6, 'rgba(255,209,102,0.92)');
      G.text(ctx, `⏩ ×${Math.round(v.speed)}`, 60, 126, { size: 14, weight: 800, align: 'center', color: '#1b1f25' });
    }

    // ---- context hint
    const hint = contextHint(v);
    if (hint) {
      const tw = G.measure(ctx, hint.text, 15, 700, 'cjk');
      let kw = 0;
      for (const k of hint.keys) kw += Math.max(24, G.measure(ctx, k, 13, 800) + 14) + 6;
      const w = tw + kw + 36;
      const x = W / 2 - w / 2;
      const y = H - 62;
      const bg = hint.tone === 'go' ? 'rgba(20,70,45,0.92)' : hint.tone === 'bad' ? 'rgba(90,24,24,0.92)' : hint.tone === 'warn' ? 'rgba(90,64,10,0.92)' : 'rgba(11,13,17,0.88)';
      G.roundRect(ctx, x, y, w, 40, 20, bg, 'rgba(255,255,255,0.14)');
      let cx = x + 16;
      for (const k of hint.keys) cx += keycap(ctx, k, cx, y + 27) + 6;
      G.text(ctx, hint.text, cx + 4, y + 26, { size: 15, weight: 700, family: 'cjk' });
    }

    // ---- toasts
    v.toasts.forEach((tst, i) => {
      const a = Math.min(1, tst.life / 0.3);
      const w = G.measure(ctx, tst.text, 16, 800, 'cjk') + 40;
      const ty = H - 112 - (v.toasts.length - 1 - i) * 40;
      ctx.save();
      ctx.globalAlpha = a;
      G.roundRect(ctx, W / 2 - w / 2, ty, w, 32, 16, tst.color || 'rgba(229,72,77,0.95)');
      G.text(ctx, tst.text, W / 2, ty + 22, { size: 15, weight: 800, align: 'center', family: 'cjk' });
      ctx.restore();
    });
  }

  L.hud = { render, contextHint, keycap };
})(typeof self !== 'undefined' ? self : this);
