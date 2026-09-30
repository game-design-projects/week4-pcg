// Late — riding a train: the car interior, the tunnel streaming past, and the
// line strip map above the doors (the only map you always have).
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});
  const G = L.gfx;
  const TT = L.timetable;

  function render(ctx, v) {
    const { W, H } = v;
    const s = v.sim;
    const sv = v.day.timetable.services[s.ride.service];
    const line = v.lines.get(sv.line);
    const pos = TT.tripPosition(sv, s.ride.trip, v.t) || { state: 'at', stop: s.ride.from, next: null, frac: 0 };
    const moving = pos.state === 'between';
    const dirSign = sv.dir === 0 ? 1 : -1;

    // ---- outside, seen through the windows
    const winTop = 250;
    const winH = 140;
    if (moving) {
      ctx.fillStyle = '#07090c';
      ctx.fillRect(0, 0, W, H);
      const speed = Math.sin(Math.PI * Math.min(1, Math.max(0, pos.frac))) * 2600 + 200;
      const scroll = v.clock * speed;
      for (let i = 0; i < 14; i++) {
        const x = ((((-scroll * dirSign + i * 260) % (W + 400)) + (W + 400)) % (W + 400)) - 200;
        const g = ctx.createLinearGradient(x - 80, 0, x + 80, 0);
        g.addColorStop(0, 'rgba(255,220,150,0)');
        g.addColorStop(0.5, 'rgba(255,220,150,0.8)');
        g.addColorStop(1, 'rgba(255,220,150,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 80, winTop + 30 + (i % 3) * 30, 160, 3);
      }
      ctx.strokeStyle = 'rgba(80,90,100,0.6)';
      ctx.lineWidth = 2;
      for (const yy of [winTop + 18, winTop + winH - 20]) {
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(W, yy);
        ctx.stroke();
      }
    } else {
      const stId = sv.stops[pos.stop];
      const st = v.day.network.stations.find((x) => x.id === stId);
      ctx.fillStyle = '#d9d6cd';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = G.mix(line.color, '#ffffff', 0.15);
      ctx.fillRect(0, winTop + 14, W, 10);
      for (let x = 60; x < W; x += 420) {
        G.roundRect(ctx, x, winTop + 44, 220, 64, 4, '#1c2129');
        G.text(ctx, st.name.zh, x + 110, winTop + 78, { size: 26, weight: 800, align: 'center', family: 'cjk' });
        G.text(ctx, st.name.en, x + 110, winTop + 99, { size: 14, weight: 600, align: 'center', color: '#c9d1dc' });
      }
    }

    // ---- car body with window cut-outs
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    for (let x = 40; x < W - 40; x += 190) {
      const doorZone = Math.abs(x + 70 - W / 2) < 170;
      if (doorZone) continue;
      ctx.moveTo(x, winTop);
      ctx.lineTo(x, winTop + winH);
      ctx.lineTo(x + 140, winTop + winH);
      ctx.lineTo(x + 140, winTop);
      ctx.closePath();
    }
    ctx.clip('evenodd');
    ctx.fillStyle = '#e9ebee';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // ceiling and lights
    ctx.fillStyle = '#c9cdd3';
    ctx.fillRect(0, 0, W, 104);
    ctx.fillStyle = '#fbfaf3';
    for (let x = 30; x < W; x += 180) ctx.fillRect(x, 96, 120, 6);
    // handrail
    ctx.fillStyle = '#9aa1ab';
    ctx.fillRect(0, 214, W, 4);
    for (let x = 20; x < W; x += 46) {
      ctx.fillRect(x, 218, 2, 12);
      G.roundRect(ctx, x - 7, 229, 16, 14, 7, null, '#8d949e', 3);
    }
    // line colour stripe and floor
    ctx.fillStyle = line.color;
    ctx.fillRect(0, winTop + winH + 20, W, 12);
    ctx.fillStyle = '#7d848e';
    ctx.fillRect(0, H - 110, W, 110);
    ctx.fillStyle = '#6b7079';
    for (let x = 0; x < W; x += 40) ctx.fillRect(x, H - 110, 2, 110);
    // seats
    for (let x = 40; x < W - 40; x += 190) {
      if (Math.abs(x + 70 - W / 2) < 170) continue;
      G.roundRect(ctx, x - 4, H - 196, 148, 30, 6, G.mix(line.color, '#27303c', 0.55));
      G.roundRect(ctx, x - 4, H - 170, 148, 18, 4, G.mix(line.color, '#1c222b', 0.6));
    }
    // doors in the middle
    const dcx = W / 2;
    const open = !moving ? Math.max(0, Math.min(1, (v.t - TT.arrAt(sv, s.ride.trip, pos.stop)) / 1.5, (TT.depAt(sv, s.ride.trip, pos.stop) - v.t - 1) / 1.5)) : 0;
    ctx.fillStyle = open > 0.02 ? '#2c3440' : '#b9c0c9';
    ctx.fillRect(dcx - 90, winTop - 20, 180, H - 110 - (winTop - 20));
    ctx.fillStyle = '#c4cad2';
    ctx.fillRect(dcx - 90 - open * 80, winTop - 20, 90, H - 110 - (winTop - 20));
    ctx.fillRect(dcx + open * 80, winTop - 20, 90, H - 110 - (winTop - 20));
    ctx.fillStyle = '#26303b';
    ctx.fillRect(dcx - 70 - open * 80, winTop + 4, 50, 120);
    ctx.fillRect(dcx + 20 + open * 80, winTop + 4, 50, 120);
    if (open > 0.5) {
      ctx.fillStyle = 'rgba(255,245,210,0.35)';
      ctx.fillRect(dcx - 60, winTop - 10, 120, H - 130 - winTop);
    }
    // passengers (deterministic per trip)
    const trip = s.ride.trip;
    for (let i = 0; i < 9; i++) {
      const u = G.hashi(i, trip, s.ride.service);
      let x = 60 + u * (W - 120);
      if (Math.abs(x - dcx) < 120) x += x < dcx ? -140 : 140;
      const name = i % 3 === 0 ? `npcb_${i % 6}` : `npc_${(i + trip) % 6}`;
      const sway = Math.sin(v.clock * 2 + i) * (moving ? 2 : 0);
      G.sprite(ctx, name, x + sway, H - 104, { scale: 1.05, flip: G.hashi(i, trip) < 0.5 });
    }
    // the player, by the door
    const frame = v.phoneOpen ? 'p_phone' : open > 0.5 ? 'p_lookup' : 'p_idle';
    ctx.save();
    ctx.shadowColor = 'rgba(255,214,102,0.9)';
    ctx.shadowBlur = 12;
    G.sprite(ctx, frame, dcx - 130, H - 100, { scale: 1.2, flip: dirSign < 0 });
    ctx.restore();

    // ---- LED ticker
    const tickerY = 168;
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
    const scrollX = tw > 470 ? ((v.clock * 70) % (tw + 120)) : 0;
    G.text(ctx, msg, dcx - 236 - scrollX + (tw > 470 ? 0 : (470 - tw) / 2), tickerY + 27, { size: 18, weight: 700, color: '#ffb547', family: 'cjk' });
    if (tw > 470) G.text(ctx, msg, dcx - 236 - scrollX + tw + 120, tickerY + 27, { size: 18, weight: 700, color: '#ffb547', family: 'cjk' });
    ctx.restore();

    // ---- line strip map (top)
    drawStrip(ctx, v, sv, line, pos, W);
    return { pos, open, moving };
  }

  function drawStrip(ctx, v, sv, line, pos, W) {
    const n = sv.stops.length;
    const x0 = 70;
    const x1 = W - 70;
    const y = 128;
    G.roundRect(ctx, 20, 106, W - 40, 56, 8, 'rgba(12,14,18,0.92)');
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

  L.viewTrain = { render };
})(typeof self !== 'undefined' ? self : this);
