// Late — riding a train: a scrolling view of the carriages (you can walk
// through them to the door you want), the tunnel streaming past the windows,
// the LED ticker and the line strip map above the doors.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});
  const G = L.gfx;
  const TT = L.timetable;
  const { RULES } = L.rules;

  const PX = 34; //       px per metre inside the train
  const CAR = RULES.TRAIN_LEN / RULES.DOORS.length; // 24 m
  const WIN_TOP = 250;
  const WIN_H = 140;

  function render(ctx, v) {
    const { W, H } = v;
    const s = v.sim;
    const sv = v.day.timetable.services[s.ride.service];
    const line = v.lines.get(sv.line);
    const pos = TT.tripPosition(sv, s.ride.trip, v.t) || { state: 'at', stop: s.ride.from, next: null, frac: 0 };
    const moving = pos.state === 'between';
    const dirSign = sv.dir === 0 ? 1 : -1;
    const me = s.ride.pos;
    // camera: the player stays near the middle; clamp to the train's ends
    const trainPx = RULES.TRAIN_LEN * PX;
    const camX = Math.max(-40, Math.min(trainPx - W + 40, me * PX - W / 2));
    const sx = (m) => m * PX - camX;
    const floorY = H - 110;

    // ---- outside
    if (moving) {
      ctx.fillStyle = '#07090c';
      ctx.fillRect(0, 0, W, H);
      const speed = Math.sin(Math.PI * Math.min(1, Math.max(0, pos.frac))) * 2600 + 200;
      const scroll = v.clock * speed + camX;
      for (let i = 0; i < 16; i++) {
        const x = ((((-scroll * dirSign + i * 250) % (W + 400)) + (W + 400)) % (W + 400)) - 200;
        const g = ctx.createLinearGradient(x - 80, 0, x + 80, 0);
        g.addColorStop(0, 'rgba(255,220,150,0)');
        g.addColorStop(0.5, 'rgba(255,220,150,0.8)');
        g.addColorStop(1, 'rgba(255,220,150,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 80, WIN_TOP + 30 + (i % 3) * 30, 160, 3);
      }
    } else {
      const st = v.day.network.stations.find((x) => x.id === sv.stops[pos.stop]);
      ctx.fillStyle = '#d9d6cd';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = G.mix(line.color, '#ffffff', 0.15);
      ctx.fillRect(0, WIN_TOP + 14, W, 10);
      for (let x = -((camX * 0.6) % 520) - 100; x < W; x += 520) {
        G.roundRect(ctx, x, WIN_TOP + 44, 220, 64, 4, '#1c2129');
        G.text(ctx, st.name.zh, x + 110, WIN_TOP + 78, { size: 26, weight: 800, align: 'center', family: 'cjk' });
        G.text(ctx, st.name.en, x + 110, WIN_TOP + 99, { size: 14, weight: 600, align: 'center', color: '#c9d1dc' });
      }
    }

    // ---- car bodies with window cut-outs (windows between doors and gangways)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    for (let c = 0; c < RULES.DOORS.length; c++) {
      const c0 = c * CAR;
      for (const [a, b] of [[c0 + 1.5, c0 + CAR / 2 - 3], [c0 + CAR / 2 + 3, c0 + CAR - 1.5]]) {
        for (let wm = a; wm + 3.2 <= b; wm += 4.2) {
          const x = sx(wm);
          if (x > W || x + 3.6 * PX < 0) continue;
          ctx.moveTo(x, WIN_TOP);
          ctx.lineTo(x, WIN_TOP + WIN_H);
          ctx.lineTo(x + 3.6 * PX, WIN_TOP + WIN_H);
          ctx.lineTo(x + 3.6 * PX, WIN_TOP);
          ctx.closePath();
        }
      }
    }
    ctx.clip('evenodd');
    ctx.fillStyle = '#e9ebee';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // ceiling, lights, handrail
    ctx.fillStyle = '#c9cdd3';
    ctx.fillRect(0, 0, W, 104);
    ctx.fillStyle = '#fbfaf3';
    for (let m = 2; m < RULES.TRAIN_LEN; m += 5.5) {
      const x = sx(m);
      if (x > -140 && x < W) ctx.fillRect(x, 96, 120, 6);
    }
    ctx.fillStyle = '#9aa1ab';
    ctx.fillRect(0, 214, W, 4);
    for (let m = 1; m < RULES.TRAIN_LEN; m += 1.4) {
      const x = sx(m);
      if (x < -20 || x > W + 20) continue;
      ctx.fillRect(x, 218, 2, 12);
      G.roundRect(ctx, x - 7, 229, 16, 14, 7, null, '#8d949e', 3);
    }
    ctx.fillStyle = line.color;
    ctx.fillRect(0, WIN_TOP + WIN_H + 20, W, 12);
    ctx.fillStyle = '#7d848e';
    ctx.fillRect(0, floorY, W, 110);
    ctx.fillStyle = '#6b7079';
    for (let m = 0; m < RULES.TRAIN_LEN; m += 1.2) {
      const x = sx(m);
      if (x > -4 && x < W) ctx.fillRect(x, floorY, 2, 110);
    }
    // beyond the train's ends
    ctx.fillStyle = '#0d1016';
    if (sx(0) > 0) ctx.fillRect(0, 0, sx(0), H);
    if (sx(RULES.TRAIN_LEN) < W) ctx.fillRect(sx(RULES.TRAIN_LEN), 0, W - sx(RULES.TRAIN_LEN), H);
    // seats between door and gangway, gangways between cars
    for (let c = 0; c < RULES.DOORS.length; c++) {
      const c0 = c * CAR;
      for (const [a, b] of [[c0 + 1.2, c0 + CAR / 2 - 3.2], [c0 + CAR / 2 + 3.2, c0 + CAR - 1.2]]) {
        const x0 = sx(a);
        const x1 = sx(b);
        if (x1 < 0 || x0 > W) continue;
        G.roundRect(ctx, x0, floorY - 86, x1 - x0, 30, 6, G.mix(line.color, '#27303c', 0.55));
        G.roundRect(ctx, x0, floorY - 60, x1 - x0, 18, 4, G.mix(line.color, '#1c222b', 0.6));
      }
      if (c > 0) {
        const gx = sx(c0);
        if (gx > -40 && gx < W + 40) {
          ctx.fillStyle = '#4a515c';
          ctx.fillRect(gx - 14, 104, 28, floorY - 104);
          ctx.fillStyle = '#353b44';
          for (let y = 120; y < floorY; y += 16) ctx.fillRect(gx - 14, y, 28, 5);
        }
      }
    }
    // doors
    const atStop = !moving;
    const open = atStop ? Math.max(0, Math.min(1, (v.t - TT.arrAt(sv, s.ride.trip, pos.stop)) / 1.5, (TT.depAt(sv, s.ride.trip, pos.stop) - v.t - 1) / 1.5)) : 0;
    const near = RULES.DOORS.findIndex((d) => Math.abs(d - me) <= RULES.DOOR_REACH);
    RULES.DOORS.forEach((d, k) => {
      const dcx = sx(d);
      if (dcx < -120 || dcx > W + 120) return;
      const hw = 2.6 * PX;
      ctx.fillStyle = open > 0.02 ? '#2c3440' : '#b9c0c9';
      ctx.fillRect(dcx - hw, WIN_TOP - 20, hw * 2, floorY - (WIN_TOP - 20));
      ctx.fillStyle = '#c4cad2';
      ctx.fillRect(dcx - hw - open * hw * 0.9, WIN_TOP - 20, hw, floorY - (WIN_TOP - 20));
      ctx.fillRect(dcx + open * hw * 0.9, WIN_TOP - 20, hw, floorY - (WIN_TOP - 20));
      ctx.fillStyle = '#26303b';
      ctx.fillRect(dcx - hw + 18 - open * hw * 0.9, WIN_TOP + 4, hw - 36, 120);
      ctx.fillRect(dcx + 18 + open * hw * 0.9, WIN_TOP + 4, hw - 36, 120);
      if (open > 0.5) {
        ctx.fillStyle = 'rgba(255,245,210,0.35)';
        ctx.fillRect(dcx - hw * 0.7, WIN_TOP - 10, hw * 1.4, floorY - WIN_TOP - 20);
      }
      const here = k === near;
      G.roundRect(ctx, dcx - 34, WIN_TOP - 44, 68, 20, 4, here && atStop ? '#1f7a44' : '#20262f');
      G.text(ctx, `${k + 1}号车 Car ${k + 1}`, dcx, WIN_TOP - 30, { size: 11, weight: 700, align: 'center', color: '#e8edf3', family: 'cjk' });
    });
    // passengers along the whole train (deterministic per trip)
    const trip = s.ride.trip;
    for (let i = 0; i < 26; i++) {
      const m = 2 + G.hashi(i, trip, s.ride.service) * (RULES.TRAIN_LEN - 4);
      const x = sx(m);
      if (x < -40 || x > W + 40 || Math.abs(m - me) < 1.2) continue;
      const name = i % 3 === 0 ? `npcb_${i % 6}` : `npc_${(i + trip) % 6}`;
      const sway = Math.sin(v.clock * 2 + i) * (moving ? 2 : 0);
      G.sprite(ctx, name, x + sway, floorY + 6, { scale: 1.05, flip: G.hashi(i, trip) < 0.5 });
    }
    // the player
    const frame = v.phoneOpen ? 'p_phone' : s.moving ? ['p_walk', 'p_run', 'p_walk', 'p_run2'][Math.floor(me * 3) % 4] : open > 0.5 ? 'p_lookup' : 'p_idle';
    ctx.save();
    ctx.shadowColor = 'rgba(255,214,102,0.9)';
    ctx.shadowBlur = 12;
    G.sprite(ctx, frame, sx(me), floorY + 10, { scale: 1.2, flip: s.facing < 0 });
    ctx.restore();
    const bob = Math.sin(v.clock * 5) * 2;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(sx(me) - 7, floorY - 118 + bob);
    ctx.lineTo(sx(me) + 7, floorY - 118 + bob);
    ctx.lineTo(sx(me), floorY - 109 + bob);
    ctx.fill();

    // ---- LED ticker
    const tickerY = 168;
    const dcx = W / 2;
    G.roundRect(ctx, dcx - 250, tickerY, 500, 40, 6, '#0b0d10', '#39414d', 2);
    let msg;
    if (moving) {
      const nx = v.day.network.stations.find((x) => x.id === sv.stops[pos.next]);
      msg = `下一站 ${nx.name.zh}   Next ▸ ${nx.name.en}`;
    } else {
      const here = v.day.network.stations.find((x) => x.id === sv.stops[pos.stop]);
      msg = pos.stop === sv.stops.length - 1 ? `终点站 ${here.name.zh}  Terminus — all change` : `${here.name.zh} 到了   ${here.name.en}`;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(dcx - 244, tickerY + 4, 488, 32);
    ctx.clip();
    const tw = G.measure(ctx, msg, 18, 700, 'cjk');
    const scrollX = tw > 470 ? (v.clock * 70) % (tw + 120) : 0;
    G.text(ctx, msg, dcx - 236 - scrollX + (tw > 470 ? 0 : (470 - tw) / 2), tickerY + 27, { size: 18, weight: 700, color: '#ffb547', family: 'cjk' });
    if (tw > 470) G.text(ctx, msg, dcx - 236 - scrollX + tw + 120, tickerY + 27, { size: 18, weight: 700, color: '#ffb547', family: 'cjk' });
    ctx.restore();

    drawStrip(ctx, v, sv, line, pos, W);
    drawTrainDiagram(ctx, me, near, W);
    return { pos, open, moving };
  }

  function drawStrip(ctx, v, sv, line, pos, W) {
    const n = sv.stops.length;
    const x0 = 70;
    const x1 = W - 70;
    const y = 128;
    G.roundRect(ctx, 20, 106, W - 40, 56, 8, '#0c0e12');
    ctx.fillStyle = line.color;
    ctx.fillRect(x0, y - 3, x1 - x0, 6);
    const step = (x1 - x0) / Math.max(1, n - 1);
    const at = pos.state === 'between' ? pos.stop + pos.frac : pos.stop;
    for (let k = 0; k < n; k++) {
      const x = x0 + k * step;
      const st = v.day.network.stations.find((s) => s.id === sv.stops[k]);
      const past = k < at - 0.01;
      ctx.beginPath();
      ctx.arc(x, y, st.lines.length > 1 ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = past ? '#6b7280' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = st.lines.length > 1 ? '#111' : line.color;
      ctx.stroke();
      const align = k === 0 ? 'left' : k === n - 1 ? 'right' : 'center';
      const lx = k === 0 ? x - 8 : k === n - 1 ? x + 8 : x;
      G.text(ctx, st.name.en, lx, y + 22, { size: 10, weight: 600, align, color: past ? '#6b7280' : '#e6ebf2' });
      if (v.policy.stripTransfers) {
        const others = st.lines.filter((l) => l !== line.id);
        others.forEach((id, i) => G.badge(ctx, v.lines.get(id), x - (others.length - 1) * 8 + i * 16, y - 15, 6));
      }
      if (v.day.office.station === st.id) G.sprite(ctx, 'map_office', x + 12, y - 4, { scale: 0.34 });
    }
    const tx = x0 + at * step;
    G.sprite(ctx, 'ic_train', tx, y + 9, { scale: 0.42 });
  }

  /** Five cars, their doors, and where you are standing. */
  function drawTrainDiagram(ctx, me, near, W) {
    const w = 250;
    const x0 = W - w - 24;
    const y = 222;
    G.roundRect(ctx, x0 - 10, y - 14, w + 20, 34, 8, 'rgba(12,14,18,0.85)');
    const cw = w / RULES.DOORS.length;
    for (let c = 0; c < RULES.DOORS.length; c++) {
      G.roundRect(ctx, x0 + c * cw + 1, y - 6, cw - 2, 16, 3, '#dfe3e8');
      ctx.fillStyle = c === near ? '#39d98a' : '#6b7280';
      ctx.fillRect(x0 + c * cw + cw / 2 - 3, y - 6, 6, 16);
    }
    const px = x0 + (me / RULES.TRAIN_LEN) * w;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(px, y + 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1b1f25';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  L.viewTrain = { render };
})(typeof self !== 'undefined' ? self : this);
