// Late — the station as a side-on cross-section. Each depth is a row; a
// platform row shows the far track above the platform floor and the near
// track below it (Up boards the far train, Down the near one).
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});
  const G = L.gfx;
  const { RULES, escalatorDir, escalatorReady, liftOpenAt } = L.rules;
  const TT = L.timetable;
  const PAL = G.PAL;

  const PPM = 9; //                px per metre
  const GAP = 34; //               rock between rows
  const ROW_H = { street: 176, hall: 122, platform: 212, empty: 40 };
  const SPRITE_SCALE = 0.68;
  const NPC_SCALE = 0.6;

  const layouts = new WeakMap();

  function layoutOf(I) {
    let lay = layouts.get(I);
    if (lay) return lay;
    const maxD = Math.max(...I.segs.map((s) => s.depth));
    const rows = [];
    let y = 0;
    for (let d = 0; d <= maxD; d++) {
      const segs = I.segs.filter((s) => s.depth === d);
      const kind = d === 0 ? 'street' : !segs.length ? 'empty' : segs.some((s) => s.kind === 'platform') ? 'platform' : 'hall';
      const h = ROW_H[kind];
      const feet = kind === 'street' ? y + 142 : kind === 'platform' ? y + 136 : y + 100;
      rows.push({ depth: d, y, h, kind, feet, segs });
      y += h + GAP;
    }
    const x0 = I.segs[0].x0;
    lay = { rows, height: y - GAP, x0, width: (I.segs[0].x1 - x0) * PPM };
    layouts.set(I, lay);
    return lay;
  }

  const X = (lay, x) => (x - lay.x0) * PPM;

  function feetY(lay, seg, lane) {
    const r = lay.rows[seg.depth];
    return r.feet - (lane === 1 ? 13 : 0);
  }

  // ------------------------------------------------------------------ backgrounds

  function drawRock(ctx, cam, lay) {
    ctx.fillStyle = PAL.rock;
    ctx.fillRect(cam.x - 20, cam.y - 20, cam.w + 40, cam.h + 40);
    // strata lines
    ctx.strokeStyle = PAL.rock2;
    ctx.lineWidth = 2;
    const top = Math.floor((cam.y - 40) / 46) * 46;
    for (let yy = top; yy < cam.y + cam.h + 40; yy += 46) {
      ctx.beginPath();
      for (let xx = Math.floor(cam.x / 60) * 60 - 60; xx < cam.x + cam.w + 60; xx += 60) {
        const k = G.hashi(xx / 60, yy / 46);
        ctx.moveTo(xx, yy + k * 10);
        ctx.lineTo(xx + 40, yy + k * 10 + 3);
      }
      ctx.stroke();
    }
  }

  function skyColors(t) {
    // 07:15 dawn → 09:15 bright morning
    const k = Math.max(0, Math.min(1, (t - (7 * 3600 + 15 * 60)) / 7200));
    return [G.mix('#f2a65a', '#8ec5f0', k), G.mix('#6a7fb8', '#d6ecff', k)];
  }

  function drawStreet(ctx, v, lay, row) {
    const { I, cam } = v;
    const x0 = X(lay, I.segs[0].x0);
    const x1 = X(lay, I.segs[0].x1);
    const [top, bottom] = skyColors(v.t);
    const g = ctx.createLinearGradient(0, row.y, 0, row.y + 124);
    g.addColorStop(0, bottom);
    g.addColorStop(1, top);
    ctx.fillStyle = g;
    ctx.fillRect(Math.max(x0, cam.x - 10), row.y, Math.min(x1, cam.x + cam.w + 10) - Math.max(x0, cam.x - 10), 124);
    // skyline: deterministic per station
    const seedN = v.stIndex * 97 + 13;
    for (let i = Math.floor(Math.max(x0, cam.x - 200) / 70); i * 70 < Math.min(x1, cam.x + cam.w + 200); i++) {
      const bx = i * 70;
      const hh = 34 + G.hashi(i, seedN) * 80;
      const w = 50 + G.hashi(i, seedN, 3) * 26;
      const shade = G.mix('#2b3342', '#445067', G.hashi(i, seedN, 5));
      ctx.fillStyle = shade;
      ctx.fillRect(bx, row.y + 124 - hh, w, hh);
      ctx.fillStyle = 'rgba(255,226,150,0.55)';
      for (let wy = row.y + 124 - hh + 8; wy < row.y + 118; wy += 11) {
        for (let wx = bx + 6; wx < bx + w - 6; wx += 10) {
          if (G.hashi(wx, wy, seedN) < 0.33) ctx.fillRect(wx, wy, 4, 5);
        }
      }
    }
    // sidewalk and road
    ctx.fillStyle = '#8a8f98';
    ctx.fillRect(x0, row.y + 124, x1 - x0, 20);
    ctx.fillStyle = '#6d727b';
    for (let xx = Math.floor(Math.max(x0, cam.x) / 28) * 28; xx < Math.min(x1, cam.x + cam.w); xx += 28) ctx.fillRect(xx, row.y + 124, 2, 20);
    ctx.fillStyle = '#30343b';
    ctx.fillRect(x0, row.y + 144, x1 - x0, row.h - 144);
    ctx.fillStyle = '#d9d3a8';
    for (let xx = Math.floor(Math.max(x0, cam.x) / 60) * 60; xx < Math.min(x1, cam.x + cam.w); xx += 60) ctx.fillRect(xx, row.y + 158, 30, 3);
  }

  function drawHallSeg(ctx, v, lay, row, seg) {
    const x0 = X(lay, seg.x0);
    const x1 = X(lay, seg.x1);
    const { cam } = v;
    if (x1 < cam.x - 50 || x0 > cam.x + cam.w + 50) return;
    const paid = seg.kind === 'paid' || seg.kind === 'hall';
    const wallCol = seg.kind === 'unpaid' ? '#2f3540' : seg.kind === 'underpass' ? '#2b2f36' : seg.kind === 'passage' ? '#283039' : '#2c333e';
    // ceiling
    ctx.fillStyle = PAL.ceiling;
    ctx.fillRect(x0, row.y, x1 - x0, 18);
    // wall
    ctx.fillStyle = wallCol;
    ctx.fillRect(x0, row.y + 18, x1 - x0, row.feet - row.y - 18);
    // tiles
    ctx.strokeStyle = PAL.wallLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let yy = row.y + 30; yy < row.feet - 6; yy += 14) {
      ctx.moveTo(Math.max(x0, cam.x - 10), yy);
      ctx.lineTo(Math.min(x1, cam.x + cam.w + 10), yy);
    }
    for (let xx = Math.floor(Math.max(x0, cam.x - 20) / 18) * 18; xx < Math.min(x1, cam.x + cam.w + 20); xx += 18) {
      ctx.moveTo(xx, row.y + 30);
      ctx.lineTo(xx, row.feet - 6);
    }
    ctx.stroke();
    // wainscot stripe (paid areas get the warm stripe)
    ctx.fillStyle = paid ? '#3b4250' : '#363b44';
    ctx.fillRect(x0, row.feet - 22, x1 - x0, 16);
    // lights
    for (let xx = Math.ceil(x0 / 80) * 80 + 20; xx < x1 - 10; xx += 80) {
      if (xx < cam.x - 60 || xx > cam.x + cam.w + 60) continue;
      ctx.fillStyle = '#f7f2dc';
      ctx.fillRect(xx - 16, row.y + 14, 32, 3);
      const lg = ctx.createLinearGradient(0, row.y + 17, 0, row.feet);
      lg.addColorStop(0, 'rgba(255,248,220,0.16)');
      lg.addColorStop(1, 'rgba(255,248,220,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(xx - 14, row.y + 17);
      ctx.lineTo(xx + 14, row.y + 17);
      ctx.lineTo(xx + 40, row.feet);
      ctx.lineTo(xx - 40, row.feet);
      ctx.fill();
    }
    // floor
    ctx.fillStyle = PAL.floor;
    ctx.fillRect(x0, row.feet, x1 - x0, 5);
    ctx.fillStyle = PAL.floorDark;
    ctx.fillRect(x0, row.feet + 5, x1 - x0, row.y + row.h - row.feet - 5);
    // corridor markings
    if (seg.flow === 'opposing') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let xx = Math.ceil(x0 / 26) * 26; xx < x1; xx += 26) ctx.fillRect(xx, row.feet - 8, 14, 2);
      for (const lane of [0, 1]) {
        const dir = lane === 0 ? seg.dir : -seg.dir;
        const yy = row.feet - (lane === 1 ? 17 : 3);
        for (let xx = Math.ceil(x0 / 120) * 120 + 60; xx < x1 - 20; xx += 120) G.arrowGlyph(ctx, dir > 0 ? 'right' : 'left', xx, yy, 12, lane === 0 ? 'rgba(120,220,160,0.55)' : 'rgba(120,200,255,0.45)');
      }
    } else if (seg.flow === 'one-way') {
      for (let xx = Math.ceil(x0 / 60) * 60 + 30; xx < x1 - 10; xx += 60) G.arrowGlyph(ctx, seg.dir > 0 ? 'right' : 'left', xx, row.feet - 4, 16, 'rgba(255,200,60,0.7)');
      // one-way plaque
      const px = (x0 + x1) / 2;
      if (px > cam.x - 100 && px < cam.x + cam.w + 100) {
        G.roundRect(ctx, px - 58, row.y + 48, 116, 22, 4, '#b8321f');
        G.text(ctx, `单向通行 One way ${seg.dir > 0 ? '→' : '←'}`, px, row.y + 64, { size: 12, weight: 700, align: 'center' });
      }
    }
    if (seg.kind === 'unpaid') {
      G.text(ctx, '非付费区 Unpaid', x0 + 6, row.y + 34, { size: 10, color: 'rgba(255,255,255,0.35)' });
    }
  }

  function drawPlatformSeg(ctx, v, lay, row, seg) {
    const x0 = X(lay, seg.x0);
    const x1 = X(lay, seg.x1);
    const { cam } = v;
    if (x1 < cam.x - 50 || x0 > cam.x + cam.w + 50) return;
    const p = v.I.platforms[seg.platform];
    const lineFar = p.tracks.far && v.lines.get(p.tracks.far.line);
    const lineNear = p.tracks.near && v.lines.get(p.tracks.near.line);
    const accent = (lineFar || lineNear).color;
    // ceiling + back wall behind the far track
    ctx.fillStyle = PAL.ceiling;
    ctx.fillRect(x0, row.y, x1 - x0, 18);
    ctx.fillStyle = '#d8d6ce';
    ctx.fillRect(x0, row.y + 18, x1 - x0, 88);
    ctx.fillStyle = G.mix(accent, '#ffffff', 0.15);
    ctx.fillRect(x0, row.y + 26, x1 - x0, 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    for (let xx = Math.floor(Math.max(x0, cam.x) / 16) * 16; xx < Math.min(x1, cam.x + cam.w); xx += 16) {
      ctx.moveTo(xx, row.y + 36);
      ctx.lineTo(xx, row.y + 104);
    }
    for (let yy = row.y + 44; yy < row.y + 104; yy += 12) {
      ctx.moveTo(Math.max(x0, cam.x), yy);
      ctx.lineTo(Math.min(x1, cam.x + cam.w), yy);
    }
    ctx.stroke();
    // station name plates on the back wall
    for (const xx of [x0 + 110, x1 - 110]) {
      if (xx < cam.x - 150 || xx > cam.x + cam.w + 150) continue;
      G.roundRect(ctx, xx - 70, row.y + 46, 140, 34, 3, '#1c2129');
      G.text(ctx, v.station.name.zh, xx, row.y + 63, { size: 14, weight: 700, align: 'center', family: 'cjk' });
      G.text(ctx, v.station.name.en, xx, row.y + 76, { size: 10, weight: 600, align: 'center', color: '#c9d1dc' });
    }
    // far track bed
    ctx.fillStyle = '#23262c';
    ctx.fillRect(x0, row.y + 96, x1 - x0, 12);
    ctx.fillStyle = '#6f757e';
    ctx.fillRect(x0, row.y + 104, x1 - x0, 2);
    // platform floor
    ctx.fillStyle = '#8b9099';
    ctx.fillRect(x0, row.y + 108, x1 - x0, 34);
    ctx.fillStyle = PAL.edge;
    ctx.fillRect(x0, row.y + 108, x1 - x0, 4);
    ctx.fillRect(x0, row.y + 140, x1 - x0, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let xx = Math.floor(Math.max(x0, cam.x) / 12) * 12; xx < Math.min(x1, cam.x + cam.w); xx += 12) ctx.fillRect(xx, row.y + 113, 1, 26);
    // near track pit
    ctx.fillStyle = '#1b1e23';
    ctx.fillRect(x0, row.y + 144, x1 - x0, row.h - 144);
    ctx.fillStyle = '#5f656e';
    ctx.fillRect(x0, row.y + row.h - 8, x1 - x0, 2);
    ctx.fillStyle = '#3a3f47';
    for (let xx = Math.floor(Math.max(x0, cam.x) / 20) * 20; xx < Math.min(x1, cam.x + cam.w); xx += 20) ctx.fillRect(xx, row.y + row.h - 6, 10, 4);
    // door markers on the floor
    p.doors.forEach((dx) => {
      const px = X(lay, dx);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(px - 11, row.y + 118, 22, 2);
      ctx.fillRect(px - 11, row.y + 134, 22, 2);
    });
  }

  // ------------------------------------------------------------------ trains

  function trainState(service, k, t) {
    // the trip near this stop at t: arriving, dwelling or departing
    let j = TT.nextTrip(service, k, t - 9);
    if (j < 0) return null;
    const arr = TT.arrAt(service, j, k);
    const dep = TT.depAt(service, j, k);
    if (t < arr - 9) return null;
    let phase;
    let off = 0;
    if (t < arr) {
      phase = 'arriving';
      const u = (arr - t) / 9;
      off = -u * u;
    } else if (t < dep) phase = 'dwell';
    else {
      phase = 'leaving';
      const u = (t - dep) / 9;
      off = u * u;
    }
    let doors = 0;
    if (phase === 'dwell') {
      const since = t - arr;
      const until = dep - t;
      doors = Math.max(0, Math.min(1, since / 1.5, (until - 1) / 1.5));
    }
    return { trip: j, arr, dep, phase, off, doors, terminus: k === service.stops.length - 1 };
  }

  function drawTrain(ctx, v, lay, x, yTop, line, dir, st, near) {
    const len = RULES.TRAIN_LEN * PPM;
    const h = 62;
    const shift = st.off * 1400 * (dir === 0 ? 1 : -1);
    const bx = x + shift;
    if (bx + len < v.cam.x - 40 || bx > v.cam.x + v.cam.w + 40) return;
    const cars = 5;
    const carLen = len / cars;
    for (let c = 0; c < cars; c++) {
      const cx = bx + c * carLen + 2;
      const cw = carLen - 4;
      G.roundRect(ctx, cx, yTop, cw, h, 8, near ? '#dfe3e8' : '#eceef1', '#8e959f', 1.5);
      ctx.fillStyle = line.color;
      ctx.fillRect(cx, yTop + h - 20, cw, 7);
      ctx.fillStyle = G.mix(line.color, '#000000', 0.25);
      ctx.fillRect(cx, yTop + 6, cw, 3);
      // windows with passengers
      for (let wx = cx + 14; wx < cx + cw - 30; wx += 34) {
        const doorNear = RULES.DOORS.some((d) => Math.abs(bx + d * PPM - (wx + 11)) < 26);
        if (doorNear) continue;
        G.roundRect(ctx, wx, yTop + 14, 24, 22, 3, '#1e2a38');
        if (G.hashi(Math.round(wx), st.trip, c) < 0.7) {
          ctx.fillStyle = '#3a4656';
          ctx.beginPath();
          ctx.arc(wx + 12, yTop + 24, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(wx + 6, yTop + 29, 12, 7);
        }
      }
    }
    // doors
    for (const d of RULES.DOORS) {
      const dx = bx + d * PPM;
      const open = st.doors;
      const half = 11;
      ctx.fillStyle = open > 0.02 ? '#11161d' : '#cfd4da';
      ctx.fillRect(dx - half, yTop + 10, half * 2, h - 12);
      if (open > 0.02) {
        ctx.fillStyle = 'rgba(255,240,200,0.25)';
        ctx.fillRect(dx - half + 2, yTop + 12, half * 2 - 4, h - 16);
      }
      ctx.fillStyle = '#b8bec7';
      ctx.fillRect(dx - half - open * 10, yTop + 10, half, h - 12);
      ctx.fillRect(dx + open * 10, yTop + 10, half, h - 12);
      ctx.fillStyle = '#9aa2ad';
      ctx.fillRect(dx - half - open * 10 + 3, yTop + 16, half - 6, 14);
      ctx.fillRect(dx + open * 10 + 3, yTop + 16, half - 6, 14);
    }
    // destination board on the front car
    const front = dir === 0 ? bx + len - 70 : bx + 10;
    G.roundRect(ctx, front, yTop - 1, 60, 12, 2, '#0e1116');
    G.text(ctx, `${line.num} ${st.terminus ? '终点' : '▶'}`, front + 30, yTop + 9, { size: 9, weight: 700, align: 'center', color: '#ffb547', family: 'pixel' });
  }

  function drawTrainsForPlatform(ctx, v, lay, row, p, which) {
    const tr = p.tracks[which];
    if (!tr) return;
    const service = v.service.get(`${tr.line}|${tr.dir}`);
    const k = service.stopIndex.get(v.station.id);
    const st = trainState(service, k, v.t);
    if (!st) return;
    const line = v.lines.get(tr.line);
    const yTop = which === 'far' ? row.y + 40 : row.y + 146;
    drawTrain(ctx, v, lay, X(lay, p.trainX0), yTop, line, tr.dir, st, which === 'near');
  }

  // ------------------------------------------------------------------ links

  function linkEnds(v, lay, L) {
    const a = v.I.segs[L.a.seg];
    const b = v.I.segs[L.b.seg];
    return { ax: X(lay, L.a.x), ay: feetY(lay, a, 0), bx: X(lay, L.b.x), by: feetY(lay, b, 0) };
  }

  function drawVLink(ctx, v, lay, L) {
    const { ax, ay, bx, by } = linkEnds(v, lay, L);
    if (Math.max(ax, bx) < v.cam.x - 60 || Math.min(ax, bx) > v.cam.x + v.cam.w + 60) return;
    if (Math.max(ay, by) < v.cam.y - 40 || Math.min(ay, by) > v.cam.y + v.cam.h + 40) return;
    const closed = L.closedUntil && v.t < L.closedUntil;
    if (L.kind === 'lift') {
      const top = ay - 64;
      ctx.fillStyle = 'rgba(40,46,56,0.95)';
      ctx.fillRect(ax - 16, top, 32, by - top);
      ctx.strokeStyle = '#59616d';
      ctx.strokeRect(ax - 16, top, 32, by - top);
      // car position along the cycle
      const levels = L.lift.levels;
      const travel = RULES.LIFT_TRAVEL * levels;
      const period = 2 * (RULES.LIFT_DWELL + travel);
      const ph = (((v.t - L.lift.phase) % period) + period) % period;
      let u;
      if (ph < RULES.LIFT_DWELL) u = 0;
      else if (ph < RULES.LIFT_DWELL + travel) u = (ph - RULES.LIFT_DWELL) / travel;
      else if (ph < 2 * RULES.LIFT_DWELL + travel) u = 1;
      else u = 1 - (ph - 2 * RULES.LIFT_DWELL - travel) / travel;
      const cy = ay + (by - ay) * u;
      G.roundRect(ctx, ax - 14, cy - 58, 28, 56, 3, '#9aa3ae', '#d7dde4');
      ctx.fillStyle = '#5c6570';
      ctx.fillRect(ax - 1, cy - 56, 2, 52);
      for (const [yy, end] of [[ay, 'a'], [by, 'b']]) {
        const open = liftOpenAt(L.lift, end, v.t);
        G.roundRect(ctx, ax - 22, yy - 70, 44, 12, 2, '#11151b');
        G.text(ctx, open ? '▲▼ 开' : '电梯', ax, yy - 61, { size: 9, weight: 700, align: 'center', color: open ? '#7ee08a' : '#c8ced6', family: 'cjk' });
      }
      return;
    }
    const w = 20;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    ctx.save();
    ctx.globalAlpha = 0.97;
    // body
    ctx.beginPath();
    ctx.moveTo(ax + nx * w * 0.5, ay + ny * w * 0.5 - 2);
    ctx.lineTo(bx + nx * w * 0.5, by + ny * w * 0.5 - 2);
    ctx.lineTo(bx - nx * w * 0.5, by - ny * w * 0.5 - 2);
    ctx.lineTo(ax - nx * w * 0.5, ay - ny * w * 0.5 - 2);
    ctx.closePath();
    ctx.fillStyle = L.kind === 'escalator' ? '#4a525e' : '#6c7380';
    ctx.fill();
    ctx.strokeStyle = L.kind === 'escalator' ? '#262b33' : '#3c424c';
    ctx.lineWidth = 3;
    ctx.stroke();
    // steps
    const steps = Math.floor(len / 7);
    const run = L.kind === 'escalator' ? escalatorDir(L.esc, v.t) : 0;
    const shift = L.kind === 'escalator' ? (((v.t * 1.4 * run) % 1) + 1) % 1 : 0;
    ctx.strokeStyle = L.kind === 'escalator' ? '#9aa4b1' : '#a5acb7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < steps; i++) {
      const u = (i + shift) / steps;
      const px = ax + dx * u;
      const py = ay + dy * u - 2;
      ctx.moveTo(px + nx * w * 0.4, py + ny * w * 0.4);
      ctx.lineTo(px - nx * w * 0.4, py - ny * w * 0.4);
    }
    ctx.stroke();
    ctx.restore();
    if (L.kind === 'escalator') {
      // handrail + direction lights at both ends
      const dirNow = escalatorDir(L.esc, v.t); // +1 runs down (a→b)
      const upperOk = dirNow === 1; // can enter at the top
      for (const [px, py, ok, arrow] of [
        [ax, ay, upperOk, 'down'],
        [bx, by, !upperOk, 'up'],
      ]) {
        G.roundRect(ctx, px - 9, py - 70, 18, 16, 3, ok ? '#1f7a44' : '#8b2525');
        if (ok) G.arrowGlyph(ctx, arrow, px, py - 62, 11, '#e9fff1');
        else G.text(ctx, '✕', px, py - 57, { size: 11, weight: 800, align: 'center' });
      }
      if (L.esc.period && v.policy.escalatorTimers) {
        const next = escalatorReady(L.esc, -dirNow, v.t) - v.t;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2 - 30;
        G.roundRect(ctx, mx - 22, my - 10, 44, 14, 3, 'rgba(10,12,16,0.8)');
        G.text(ctx, `⟲ ${Math.floor(next / 60)}:${String(Math.floor(next % 60)).padStart(2, '0')}`, mx, my + 1, { size: 10, weight: 700, align: 'center', color: '#ffd166', family: 'pixel' });
      }
    }
    if (closed) {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      ctx.save();
      ctx.translate(mx, my - 6);
      for (let i = -2; i <= 2; i++) {
        ctx.fillStyle = i % 2 ? '#f2c200' : '#1a1a1a';
        ctx.fillRect(i * 8 - 4, -8, 8, 16);
      }
      ctx.restore();
      G.text(ctx, '停用 Closed', mx, my - 18, { size: 10, weight: 800, align: 'center', color: '#ffcf33', stroke: '#000', strokeWidth: 3 });
    }
    if (L.check) {
      // transfer ID check at the end you start from
      const [cx, cy] = L.check.dir === 1 ? [ax, ay] : [bx, by];
      const side = (L.check.dir === 1 ? bx - ax : ax - bx) > 0 ? -1 : 1;
      G.sprite(ctx, 'guard_f', cx + side * 26, cy, { scale: 0.5 });
      G.roundRect(ctx, cx - 50, cy - 92, 100, 18, 3, '#b3261e');
      G.text(ctx, `查验 ${L.check.label}`, cx, cy - 79, { size: 10, weight: 800, align: 'center', family: 'cjk' });
      for (let i = 0; i < 3; i++) G.sprite(ctx, i % 2 ? 'sil_1' : 'sil_3', cx + side * (44 + i * 12), cy - 2, { scale: 0.7, alpha: 0.85 });
    }
    if (L.exit) {
      // street entrance canopy with the exit letter
      G.roundRect(ctx, ax - 22, ay - 64, 44, 30, 4, '#1d6b3c', '#0f3d22', 2);
      G.text(ctx, `出口${L.exitLetter}`, ax, ay - 50, { size: 11, weight: 800, align: 'center', family: 'cjk' });
      G.text(ctx, `Exit ${L.exitLetter}`, ax, ay - 38, { size: 9, weight: 700, align: 'center', color: '#c9f3d9' });
    }
  }

  function drawHLink(ctx, v, lay, L) {
    const seg = v.I.segs[L.a.seg];
    const row = lay.rows[seg.depth];
    const px = X(lay, L.a.x);
    if (px < v.cam.x - 120 || px > v.cam.x + v.cam.w + 120) return;
    if (row.feet < v.cam.y - 60 || row.y > v.cam.y + v.cam.h + 60) return;
    const closed = L.closedUntil && v.t < L.closedUntil;
    if (L.kind === 'gate') {
      for (let i = -1; i <= 1; i++) {
        const gx = px + i * 9;
        ctx.fillStyle = '#9aa1ab';
        ctx.fillRect(gx - 2, row.feet - 26, 5, 26);
        ctx.fillStyle = '#c9ced5';
        ctx.fillRect(gx - 3, row.feet - 28, 7, 4);
        ctx.fillStyle = i === 0 ? '#39d98a' : '#39d98a';
        ctx.fillRect(gx - 1, row.feet - 24, 3, 2);
      }
      G.roundRect(ctx, px - 30, row.y + 22, 60, 16, 3, '#12161c');
      G.text(ctx, '检票 Gates', px, row.y + 34, { size: 9, weight: 700, align: 'center', color: '#dfe6ee', family: 'cjk' });
    } else {
      // passage mouth / joint
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(px - 2, row.y + 18, 4, row.feet - row.y - 18);
    }
    if (L.check) {
      const side = L.check.dir === 1 ? -1 : 1; // queue forms on the side you come from
      G.sprite(ctx, 'cp_scanner', px + side * 4, row.feet + 2, { scale: 0.34 });
      G.sprite(ctx, 'guard_f', px - side * 22, row.feet, { scale: 0.52 });
      G.roundRect(ctx, px - 46, row.y + 40, 92, 18, 3, '#b3261e');
      G.text(ctx, `${L.check.label === 'ID check' ? '查验' : '安检'} ${L.check.label}`, px, row.y + 53, { size: 10, weight: 800, align: 'center', family: 'cjk' });
      // a small standing queue
      for (let i = 0; i < 4; i++) {
        const qx = px + side * (26 + i * 13);
        G.sprite(ctx, i % 2 ? 'sil_2' : 'sil_4', qx, row.feet - 2, { scale: 0.7, alpha: 0.85 });
      }
    }
    if (closed) {
      ctx.save();
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#f2c200' : '#161616';
        ctx.fillRect(px - 20 + i * 7, row.feet - 30, 7, 10);
      }
      ctx.fillStyle = '#8b8f96';
      ctx.fillRect(px - 20, row.feet - 20, 3, 20);
      ctx.fillRect(px + 20, row.feet - 20, 3, 20);
      ctx.restore();
      G.sprite(ctx, 'prop_cone', px + 26, row.feet, { scale: 0.45 });
      G.roundRect(ctx, px - 50, row.y + 40, 100, 18, 3, '#e0a100');
      G.text(ctx, '施工 Closed for works', px, row.y + 53, { size: 10, weight: 800, align: 'center', color: '#1a1a1a', family: 'cjk' });
    }
  }

  // ------------------------------------------------------------------ signs and boards

  function drawSigns(ctx, v, lay) {
    if (!v.signs) return;
    for (const s of v.signs) {
      const seg = v.I.segs[s.seg];
      const row = lay.rows[seg.depth];
      const px = X(lay, s.x);
      if (px < v.cam.x - 160 || px > v.cam.x + v.cam.w + 160) continue;
      if (row.y > v.cam.y + v.cam.h || row.y + row.h < v.cam.y) continue;
      const state = L.display.signState(v.policy, v.day.seed, `${v.station.id}:${s.seg}:${s.x}`);
      if (state === 'missing') continue;
      if (seg.kind === 'platform') {
        const mid = X(lay, (seg.x0 + seg.x1) / 2);
        if (Math.abs(px - (mid - 170)) < 150 || Math.abs(px - (mid + 170)) < 150) continue;
      }
      const lines = s.items.filter((i) => i.kind === 'line').slice(0, 3);
      const exit = s.items.find((i) => i.kind === 'exit');
      const items = exit && seg.kind !== 'platform' ? [...lines, exit] : lines.length ? lines : exit ? [exit] : [];
      if (!items.length) continue;
      const w = items.length * 44 + 8;
      const sy = seg.kind === 'platform' ? row.y + 20 : row.y + 20;
      const sx = px - w / 2;
      ctx.fillStyle = '#50565f';
      ctx.fillRect(px - w / 2 + 6, row.y, 2, sy - row.y);
      ctx.fillRect(px + w / 2 - 8, row.y, 2, sy - row.y);
      G.roundRect(ctx, sx, sy, w, 22, 3, state === 'stale' ? '#2a2620' : '#161b22', '#3d4450');
      const tgt = state === 'ok' ? v.guideTarget : null;
      items.forEach((it, i) => {
        const cx = sx + 8 + i * 44;
        const arrow = state === 'stale' ? L.wayfinding.FLIP[it.arrow] : it.arrow;
        if (tgt && ((it.kind === 'line' && tgt.line === it.line) || (it.kind === 'exit' && tgt.exit === it.letter))) {
          // the route guide lights up the sign for your next line or exit
          ctx.save();
          ctx.shadowColor = 'rgba(255,209,102,0.95)';
          ctx.shadowBlur = 10 + 6 * Math.sin(v.clock * 5);
          G.roundRect(ctx, cx - 4, sy - 3, 44, 28, 5, 'rgba(255,209,102,0.28)', '#ffd166', 2);
          ctx.restore();
        }
        if (it.kind === 'line') G.badge(ctx, v.lines.get(it.line), cx + 9, sy + 11, 8);
        else {
          G.roundRect(ctx, cx, sy + 3, 20, 16, 2, '#1d7a44');
          G.text(ctx, it.letter, cx + 10, sy + 15, { size: 11, weight: 800, align: 'center' });
        }
        G.arrowGlyph(ctx, arrow, cx + 30, sy + 11, 12, '#ffffff');
      });
      if (state === 'stale') G.text(ctx, '旧', sx + w - 6, sy + 8, { size: 8, weight: 800, align: 'right', color: '#c8a15a', family: 'cjk' });
    }
  }

  // ------------------------------------------------------------------ route guide

  const GUIDE = '#ffd166';

  function chevron(ctx, x, y, dir, alpha) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(x - dir * 6, y - 7);
    ctx.lineTo(x + dir * 2, y);
    ctx.lineTo(x - dir * 6, y + 7);
    ctx.stroke();
  }

  function bounceArrow(ctx, x, y, dir, clock) {
    const b = Math.sin(clock * 6) * 4;
    ctx.globalAlpha = 1;
    G.arrowGlyph(ctx, dir, x, y + (dir === 'down' ? b : -b), 26, GUIDE);
  }

  /** Monday's route guide: where to walk, which stairs to take, which train to board. */
  function drawGuide(ctx, v, lay) {
    const g = v.guide;
    const s = v.sim;
    if (!g || g.busy || !s || s.mode !== 'walk' || g.st !== v.stIndex) return;
    const seg = v.I.segs[s.seg];
    const fy = (seg.kind === 'street' ? lay.rows[0].y + 140 : feetY(lay, seg, s.lane)) - 6;
    const px = X(lay, s.x);
    ctx.save();
    ctx.strokeStyle = GUIDE;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,209,102,0.9)';
    ctx.shadowBlur = 8;
    if (g.x !== undefined && (g.kind === 'walk' || g.kind === 'office' || (g.kind === 'link' && g.dir))) {
      const tx = X(lay, g.x);
      const dir = Math.sign(tx - px);
      if (dir && Math.abs(tx - px) > 10) {
        const step = 24;
        const phase = (v.clock * 42) % step;
        for (let x = px + dir * (20 + phase); dir > 0 ? x < tx - 4 : x > tx + 4; x += dir * step) {
          chevron(ctx, x, fy, dir, Math.min(0.95, Math.abs(x - px) / 60));
        }
      }
      // where the next step starts
      const r = 12 + 3 * Math.sin(v.clock * 5);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.ellipse(tx, fy + 6, r * 1.6, r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (Math.abs(tx - px) > 30) bounceArrow(ctx, tx, fy - 78, 'down', v.clock);
    }
    if (g.kind === 'link' && !g.dir) {
      const Lk = v.I.links[g.link];
      const e = linkEnds(v, lay, Lk);
      const [x0, y0, x1, y1] = g.way === 'ab' ? [e.ax, e.ay, e.bx, e.by] : [e.bx, e.by, e.ax, e.ay];
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(v.clock * 5);
      ctx.lineWidth = 6;
      ctx.setLineDash([2, 12]);
      ctx.lineDashOffset = -v.clock * 30;
      ctx.beginPath();
      ctx.moveTo(x0, y0 - 34);
      ctx.lineTo(x1, y1 - 34);
      ctx.stroke();
      ctx.setLineDash([]);
      bounceArrow(ctx, x0, y0 - 100, g.way === 'ab' ? 'down' : 'up', v.clock);
    }
    if (g.kind === 'lane') {
      bounceArrow(ctx, px + 26 * (s.facing || 1), fy - 40, g.lane === 1 ? 'up' : 'down', v.clock);
    }
    if (g.kind === 'board') {
      // Up boards the train behind the platform, Down the one in front
      bounceArrow(ctx, px, g.side === 'far' ? fy - 108 : fy + 24, g.side === 'far' ? 'up' : 'down', v.clock);
      const line = v.lines.get(g.line);
      if (line) G.badge(ctx, line, px + 24, g.side === 'far' ? fy - 108 : fy + 24, 9);
    }
    ctx.restore();
  }

  function drawBoards(ctx, v, lay) {
    for (const p of v.I.platforms) {
      const seg = v.I.segs[p.seg];
      const row = lay.rows[seg.depth];
      const mid = X(lay, (seg.x0 + seg.x1) / 2);
      for (const [which, off] of [['far', -170], ['near', 170]]) {
        const tr = p.tracks[which];
        if (!tr) continue;
        const bx = mid + off;
        if (bx < v.cam.x - 120 || bx > v.cam.x + v.cam.w + 120) continue;
        const line = v.lines.get(tr.line);
        const service = v.service.get(`${tr.line}|${tr.dir}`);
        const k = service.stopIndex.get(v.station.id);
        const terminus = service.stops[service.stops.length - 1];
        const termName = v.day.network.stations.find((s) => s.id === terminus).name;
        const working = L.display.isBoardWorking(v.policy, v.day.seed, `${v.station.id}:${p.id}:${which}`);
        const by = row.y + 50;
        G.roundRect(ctx, bx - 86, by, 172, 40, 4, '#0b0e12', '#2e3540', 2);
        G.badge(ctx, line, bx - 72, by + 12, 8);
        G.text(ctx, `${which === 'far' ? '↑' : '↓'} ${termName.zh} ${termName.en}`, bx - 60, by + 16, { size: 10, weight: 700, color: '#ffd9a0', family: 'cjk' });
        if (!working) {
          const flicker = Math.floor(v.t * 2) % 7 === 0;
          G.text(ctx, flicker ? '' : '暂停服务 Out of service', bx, by + 33, { size: 10, weight: 700, align: 'center', color: '#ff5b4d', family: 'cjk' });
          continue;
        }
        if (k === service.stops.length - 1) {
          G.text(ctx, '终点站 Terminus — do not board', bx, by + 33, { size: 10, weight: 700, align: 'center', color: '#ffb547' });
          continue;
        }
        const j = TT.nextTrip(service, k, v.t);
        const mins = [];
        for (let q = 0; q < 2 && j >= 0 && j + q < service.deps.length; q++) {
          const dep = TT.depAt(service, j + q, k);
          const arr = TT.arrAt(service, j + q, k);
          mins.push(v.t >= arr ? '进站 Now' : `${Math.max(0, Math.ceil((arr - v.t) / 60))} min`);
        }
        G.text(ctx, mins.join('   ·   '), bx, by + 33, { size: 12, weight: 700, align: 'center', color: '#ffb547', family: 'pixel' });
      }
    }
  }

  function drawProps(ctx, v, lay) {
    for (const p of v.I.props) {
      const seg = v.I.segs[p.seg];
      const row = lay.rows[seg.depth];
      const px = X(lay, p.x);
      if (px < v.cam.x - 60 || px > v.cam.x + v.cam.w + 60) continue;
      const y = seg.kind === 'platform' ? row.y + 112 : seg.kind === 'street' ? row.y + 126 : row.feet - 2;
      G.sprite(ctx, p.kind, px, y, { scale: seg.kind === 'platform' ? 0.42 : 0.46, alpha: 0.95 });
    }
  }

  function drawStreetDoors(ctx, v, lay) {
    const row = lay.rows[0];
    const d = v.day;
    if (d.home.station === v.station.id) {
      const px = X(lay, d.home.x);
      G.roundRect(ctx, px - 40, row.y + 40, 80, 88, 3, '#6b4f3a', '#3c2b1f', 2);
      for (let i = 0; i < 3; i++) for (let j2 = 0; j2 < 2; j2++) {
        ctx.fillStyle = 'rgba(255,215,140,0.8)';
        ctx.fillRect(px - 30 + i * 22, row.y + 50 + j2 * 22, 14, 12);
      }
      ctx.fillStyle = '#2b1f16';
      ctx.fillRect(px - 10, row.y + 100, 20, 28);
      G.text(ctx, '家 Home', px, row.y + 36, { size: 12, weight: 800, align: 'center', family: 'cjk', stroke: '#1b1b1b' });
    }
    if (d.office.station === v.station.id) {
      const px = X(lay, d.office.x);
      const g = ctx.createLinearGradient(px - 50, 0, px + 50, 0);
      g.addColorStop(0, '#5c7da3');
      g.addColorStop(1, '#9fc0e3');
      ctx.fillStyle = g;
      ctx.fillRect(px - 50, row.y - 30, 100, 158);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      for (let yy = row.y - 22; yy < row.y + 120; yy += 12) {
        ctx.moveTo(px - 50, yy);
        ctx.lineTo(px + 50, yy);
      }
      ctx.stroke();
      ctx.fillStyle = '#1d2733';
      ctx.fillRect(px - 14, row.y + 98, 28, 30);
      G.roundRect(ctx, px - 46, row.y - 48, 92, 18, 3, '#1f2630');
      G.text(ctx, '打卡科技 Daka Tech', px, row.y - 35, { size: 10, weight: 800, align: 'center', family: 'cjk', color: '#ffd166' });
      G.sprite(ctx, 'map_office', px, row.y + 94, { scale: 0.5 });
    }
  }

  // ------------------------------------------------------------------ people

  const crowdCache = new WeakMap();

  function crowdOf(v, seg) {
    let perSeg = crowdCache.get(v.I);
    if (!perSeg) {
      perSeg = new Map();
      crowdCache.set(v.I, perSeg);
    }
    if (perSeg.has(seg.id)) return perSeg.get(seg.id);
    const len = seg.x1 - seg.x0;
    const people = [];
    const density = seg.kind === 'passage' || seg.kind === 'underpass' ? 9 : seg.kind === 'street' ? 26 : seg.kind === 'platform' ? 1e9 : 15;
    const n = Math.floor(len / density);
    for (let i = 0; i < n; i++) {
      const h1 = G.hashi(i, seg.id, v.stIndex);
      const h2 = G.hashi(i, seg.id, v.stIndex + 7);
      let lane = 0;
      let dir;
      if (seg.flow === 'opposing') {
        lane = h1 < 0.5 ? 0 : 1;
        dir = lane === 0 ? seg.dir : -seg.dir;
      } else if (seg.flow === 'one-way') dir = seg.dir;
      else dir = h2 < 0.5 ? 1 : -1;
      people.push({ o: h1 * len, v: 1.1 + h2 * 0.6, dir, lane, sprite: lane === 1 ? `sil_${Math.floor(h2 * 7)}` : `npc_${Math.floor(h1 * 6)}`, ph: h2 * 6.28 });
    }
    perSeg.set(seg.id, people);
    return people;
  }

  function drawCrowd(ctx, v, lay, seg, lane) {
    const row = lay.rows[seg.depth];
    if (row.y > v.cam.y + v.cam.h || row.y + row.h < v.cam.y) return;
    const len = seg.x1 - seg.x0;
    for (const p of crowdOf(v, seg)) {
      if (p.lane !== lane) continue;
      const x = seg.x0 + ((((p.o + p.dir * p.v * v.t) % len) + len) % len);
      const px = X(lay, x);
      if (px < v.cam.x - 30 || px > v.cam.x + v.cam.w + 30) continue;
      const bob = Math.abs(Math.sin(p.ph + v.t * p.v * 3.2)) * 2;
      const y = (seg.kind === 'street' ? row.y + 140 : feetY(lay, seg, lane)) - bob;
      G.sprite(ctx, p.sprite, px, y, { scale: lane === 1 ? 0.9 : NPC_SCALE, flip: p.dir < 0, alpha: lane === 1 ? 0.75 : 1 });
    }
  }

  function drawWaiting(ctx, v, lay, p, which) {
    const tr = p.tracks[which];
    if (!tr) return;
    const seg = v.I.segs[p.seg];
    const row = lay.rows[seg.depth];
    const service = v.service.get(`${tr.line}|${tr.dir}`);
    const k = service.stopIndex.get(v.station.id);
    if (k === service.stops.length - 1) return;
    const j = TT.nextTrip(service, k, v.t);
    const dep = j >= 0 ? TT.depAt(service, j, k) : v.t + 999;
    const prevDep = j > 0 ? TT.depAt(service, j - 1, k) : dep - service.headway;
    const n = Math.max(0, Math.min(10, Math.floor((v.t - prevDep) / 18)));
    for (let i = 0; i < n; i++) {
      const door = p.doors[i % p.doors.length];
      const off = (G.hashi(i, p.id, v.stIndex) - 0.5) * 3 + (i >= p.doors.length ? 2 : 0);
      const px = X(lay, door + off);
      if (px < v.cam.x - 30 || px > v.cam.x + v.cam.w + 30) continue;
      const sprite = which === 'far' ? `npcb_${Math.floor(G.hashi(i, p.id, 3) * 6)}` : `npc_${Math.floor(G.hashi(i, p.id, 4) * 6)}`;
      G.sprite(ctx, sprite, px, which === 'far' ? row.y + 132 : row.y + 139, { scale: NPC_SCALE * 0.95 });
    }
  }

  function drawPlayer(ctx, v, lay) {
    const s = v.sim;
    const I = v.I;
    let px;
    let py;
    let frame = 'p_idle';
    let flip = s.facing < 0;
    let scale = SPRITE_SCALE;
    let alpha = 1;
    if (s.mode === 'link' || (s.mode === 'lift' && s.liftRiding)) {
      const Lk = s.link;
      const ends = Lk.axis === 'v' ? linkEnds(v, lay, Lk) : null;
      const u = 1 - Math.max(0, s.timer - v.alpha * RULES.DT) / s.timerTotal;
      if (ends) {
        const [x0, y0, x1, y1] = s.way === 'ab' ? [ends.ax, ends.ay, ends.bx, ends.by] : [ends.bx, ends.by, ends.ax, ends.ay];
        px = x0 + (x1 - x0) * u;
        py = y0 + (y1 - y0) * u;
        flip = x1 < x0;
        frame = Lk.kind === 'escalator' ? 'p_idle' : ['p_walk', 'p_run', 'p_walk', 'p_run2'][Math.floor(u * 16) % 4];
        if (Lk.kind === 'lift') alpha = 0.35;
      } else {
        const seg = I.segs[s.seg];
        px = X(lay, s.x);
        py = feetY(lay, seg, s.lane);
        frame = 'p_interact';
      }
    } else {
      const seg = I.segs[s.seg];
      const x = v.prevX !== null && v.prevSeg === s.seg ? v.prevX + (s.x - v.prevX) * v.alpha : s.x;
      px = X(lay, x);
      py = seg.kind === 'street' ? lay.rows[0].y + 140 : feetY(lay, seg, s.lane);
      if (s.mode === 'lane') {
        const u = 1 - s.timer / s.timerTotal;
        py = feetY(lay, seg, s.lane) + (s.lane === 1 ? 13 : -13) * (1 - u);
      }
      if (s.mode === 'queue' || s.mode === 'lift') frame = 'p_wait';
      else if (v.phoneOpen) frame = 'p_phone';
      else if (v.blockedFor > 0) frame = 'p_hurt';
      else if (s.moving) frame = ['p_run', 'p_walk', 'p_run2', 'p_walk'][Math.floor(Math.abs(px) / 16) % 4];
      else if (v.idleFor > 5) frame = 'p_wait';
      if (s.mode === 'alight') alpha = 0.6;
      if (s.lane === 1) scale *= 0.93;
    }
    // shadow + halo so the player reads in a crowd
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(px, py + 1, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = 'rgba(255,214,102,0.9)';
    ctx.shadowBlur = 10;
    G.sprite(ctx, frame, px, py, { scale, flip, alpha });
    ctx.restore();
    // "you" marker
    const bobble = Math.sin(v.clock * 5) * 2;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(px - 6, py - 70 + bobble);
    ctx.lineTo(px + 6, py - 70 + bobble);
    ctx.lineTo(px, py - 62 + bobble);
    ctx.fill();
    if (s.mode === 'queue') {
      const u = 1 - s.timer / s.timerTotal;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(px, py - 86, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(px, py - 86, 12, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2);
      ctx.stroke();
      G.text(ctx, `${Math.ceil(s.timer)}s`, px, py - 82, { size: 9, weight: 800, align: 'center', family: 'pixel' });
    }
    return { px, py };
  }

  // ------------------------------------------------------------------ minimap

  function drawMinimap(ctx, v, lay, box) {
    const { x, y, w, h } = box;
    G.roundRect(ctx, x, y, w, h, 8, 'rgba(12,15,20,0.82)', 'rgba(255,255,255,0.12)');
    const sx = (w - 16) / lay.width;
    const sy = (h - 16) / lay.height;
    const ox = x + 8;
    const oy = y + 8;
    for (const seg of v.I.segs) {
      const row = lay.rows[seg.depth];
      ctx.strokeStyle = seg.kind === 'platform' ? '#c9d1dc' : seg.kind === 'street' ? '#6e8fb3' : seg.flow === 'one-way' ? '#f2b33d' : '#7d8794';
      ctx.lineWidth = seg.kind === 'platform' ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(ox + X(lay, seg.x0) * sx, oy + row.feet * sy);
      ctx.lineTo(ox + X(lay, seg.x1) * sx, oy + row.feet * sy);
      ctx.stroke();
      if (seg.platform !== null) {
        const p = v.I.platforms[seg.platform];
        const line = v.lines.get((p.tracks.far || p.tracks.near).line);
        ctx.fillStyle = line.color;
        ctx.fillRect(ox + X(lay, seg.x0) * sx, oy + row.feet * sy - 5, (seg.x1 - seg.x0) * PPM * sx, 2);
      }
    }
    ctx.strokeStyle = 'rgba(200,210,220,0.55)';
    ctx.lineWidth = 1;
    for (const Lk of v.I.links) {
      if (Lk.axis !== 'v') continue;
      const e = linkEnds(v, lay, Lk);
      ctx.beginPath();
      ctx.moveTo(ox + e.ax * sx, oy + e.ay * sy);
      ctx.lineTo(ox + e.bx * sx, oy + e.by * sy);
      ctx.stroke();
    }
    if (v.playerPx) {
      const blink = Math.floor(v.clock * 3) % 2 === 0;
      ctx.fillStyle = blink ? '#ffd166' : '#ff8c42';
      ctx.beginPath();
      ctx.arc(ox + v.playerPx.px * sx, oy + v.playerPx.py * sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (v.day.office.station === v.station.id) {
      G.text(ctx, '💼', ox + X(lay, v.day.office.x) * sx, oy + lay.rows[0].feet * sy - 2, { size: 11, align: 'center' });
    }
  }

  // ------------------------------------------------------------------ main

  /**
   * @param v view: {day, I, station, stIndex, lines, service, sim, t, alpha, prevX, prevSeg,
   *                 policy, signs, cam:{x,y,w,h}, clock, phoneOpen, blockedFor, idleFor}
   */
  function render(ctx, v) {
    const lay = layoutOf(v.I);
    const cam = v.cam;
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    drawRock(ctx, cam, lay);
    for (const row of lay.rows) {
      if (row.y > cam.y + cam.h + 20 || row.y + row.h < cam.y - 20) continue;
      if (row.kind === 'street') drawStreet(ctx, v, lay, row);
      for (const seg of row.segs) {
        if (seg.kind === 'street') continue;
        if (seg.kind === 'platform') drawPlatformSeg(ctx, v, lay, row, seg);
        else drawHallSeg(ctx, v, lay, row, seg);
      }
    }
    drawProps(ctx, v, lay);
    drawBoards(ctx, v, lay);
    for (const p of v.I.platforms) {
      const row = lay.rows[v.I.segs[p.seg].depth];
      if (row.y > cam.y + cam.h + 20 || row.y + row.h < cam.y - 20) continue;
      drawTrainsForPlatform(ctx, v, lay, row, p, 'far');
    }
    for (const Lk of v.I.links) if (Lk.axis === 'v') drawVLink(ctx, v, lay, Lk);
    drawStreetDoors(ctx, v, lay);
    drawSigns(ctx, v, lay);
    for (const Lk of v.I.links) if (Lk.axis === 'h') drawHLink(ctx, v, lay, Lk);
    drawGuide(ctx, v, lay);
    for (const seg of v.I.segs) drawCrowd(ctx, v, lay, seg, 1);
    for (const p of v.I.platforms) drawWaiting(ctx, v, lay, p, 'far');
    let playerPx = null;
    if (v.sim && v.sim.mode !== 'train' && v.showPlayer !== false) playerPx = drawPlayer(ctx, v, lay);
    for (const seg of v.I.segs) drawCrowd(ctx, v, lay, seg, 0);
    for (const p of v.I.platforms) drawWaiting(ctx, v, lay, p, 'near');
    for (const p of v.I.platforms) {
      const row = lay.rows[v.I.segs[p.seg].depth];
      if (row.y > cam.y + cam.h + 20 || row.y + row.h < cam.y - 20) continue;
      drawTrainsForPlatform(ctx, v, lay, row, p, 'near');
    }
    ctx.restore();
    // level labels, screen-fixed on the left
    for (const row of lay.rows) {
      const sy = row.feet - cam.y;
      if (sy < 40 || sy > cam.h + 20 || row.kind === 'empty') continue;
      const label = row.depth === 0 ? 'G' : `B${row.depth}`;
      const segs = row.segs.filter((s) => s.kind === 'platform');
      const lines = [...new Set(segs.flatMap((s) => {
        const p = v.I.platforms[s.platform];
        return [p.tracks.far, p.tracks.near].filter(Boolean).map((t) => t.line);
      }))];
      G.roundRect(ctx, 8, sy - 30, 40, 24, 4, 'rgba(10,12,16,0.75)');
      G.text(ctx, label, 28, sy - 13, { size: 15, weight: 800, align: 'center', family: 'pixel', color: '#ffd166' });
      lines.forEach((id, i) => G.badge(ctx, v.lines.get(id), 60 + i * 22, sy - 18, 9));
    }
    return { lay, playerPx };
  }

  /** World position of the player (for the camera). */
  function playerWorld(v) {
    const lay = layoutOf(v.I);
    const s = v.sim;
    const seg = v.I.segs[s.seg];
    let x = X(lay, s.x);
    let y = seg.kind === 'street' ? lay.rows[0].y + 140 : feetY(lay, seg, s.lane);
    if ((s.mode === 'link' || (s.mode === 'lift' && s.liftRiding)) && s.link && s.link.axis === 'v') {
      const e = linkEnds(v, lay, s.link);
      const u = 1 - s.timer / s.timerTotal;
      const [x0, y0, x1, y1] = s.way === 'ab' ? [e.ax, e.ay, e.bx, e.by] : [e.bx, e.by, e.ax, e.ay];
      x = x0 + (x1 - x0) * u;
      y = y0 + (y1 - y0) * u;
    }
    return { x, y, lay };
  }

  L.viewStation = { render, layoutOf, playerWorld, PPM, X, feetY, trainState, drawMinimap };
})(typeof self !== 'undefined' ? self : this);
