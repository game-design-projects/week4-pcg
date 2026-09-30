// Late — the metro map: octilinear lines on the generator's grid, interchange
// rings, the hub, home and office, and optional route overlays.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});
  const G = L.gfx;

  const labelCache = new Map();

  function frame(day, box) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ln of day.network.lines) for (const [x, y] of ln.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const pad = Math.min(box.w, box.h) * 0.1 + 18;
    const sc = Math.min((box.w - 2 * pad) / Math.max(1, maxX - minX), (box.h - 2 * pad) / Math.max(1, maxY - minY));
    const ox = box.x + (box.w - (maxX - minX) * sc) / 2;
    const oy = box.y + (box.h - (maxY - minY) * sc) / 2;
    return { P: (gx, gy) => [ox + (gx - minX) * sc, oy + (gy - minY) * sc], sc };
  }

  /** Grid points a ride follows from one station to another along a line. */
  function ridePoints(line, fromId, toId) {
    const a = line.stops.indexOf(fromId);
    const b = line.stops.indexOf(toId);
    if (a < 0 || b < 0) return [];
    const pa = line.stopIdx[a];
    const pb = line.stopIdx[b];
    const pts = pa <= pb ? line.points.slice(pa, pb + 1) : line.points.slice(pb, pa + 1).reverse();
    return pts;
  }

  function placeLabels(ctx, day, fr, box, sizes) {
    const key = `${day.seed}|${day.attempt}|${Math.round(box.w)}x${Math.round(box.h)}|${sizes}`;
    if (labelCache.has(key)) return labelCache.get(key);
    const boxes = [];
    const segs = [];
    for (const ln of day.network.lines) for (let i = 1; i < ln.points.length; i++) segs.push([fr.P(...ln.points[i - 1]), fr.P(...ln.points[i])]);
    const hitsSeg = (r) => segs.some(([[x1, y1], [x2, y2]]) => {
      for (let u = 0; u <= 1; u += 0.25) {
        const x = x1 + (x2 - x1) * u;
        const y = y1 + (y2 - y1) * u;
        if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
      }
      return false;
    });
    const out = new Map();
    const stations = day.network.stations;
    const important = new Set([day.home && day.home.station, day.office && day.office.station, day.network.hubId].filter(Boolean));
    // the most important labels choose first
    const order = [...stations].sort((a, b) => important.has(b.id) - important.has(a.id) || b.lines.length - a.lines.length);
    // the home and office markers sit above their stations: keep labels off them
    for (const id of [day.home && day.home.station, day.office && day.office.station]) {
      const st = id && stations.find((x) => x.id === id);
      if (!st) continue;
      const [x, y] = fr.P(st.gx, st.gy);
      boxes.push({ x: x - 12, y: y - 34, w: 24, h: 28 });
    }
    // every station's marker is out of bounds for every label but its own
    const dots = stations.map((st) => {
      const [x, y] = fr.P(st.gx, st.gy);
      const r = st.lines.length > 1 ? 10 : 6;
      return { id: st.id, x: x - r, y: y - r, w: 2 * r, h: 2 * r };
    });
    const hit = (r, b) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y;
    const collides = (r, id) => boxes.some((b) => hit(r, b)) || dots.some((d) => d.id !== id && hit(r, d));
    const outside = (r) => r.x < box.x || r.x + r.w > box.x + box.w || r.y < box.y || r.y + r.h > box.y + box.h;
    for (const st of order) {
      const [cx, cy] = fr.P(st.gx, st.gy);
      const wEn = G.measure(ctx, st.name.en, sizes + 1, 700) + 4;
      const wZh = G.measure(ctx, st.name.zh, sizes - 1, 600) + 4;
      const r0 = st.lines.length > 1 ? 11 : 7;
      let chosen = null;
      // English and Chinese on two lines if there is room, else English alone; a minor
      // station whose label cannot be placed without covering another goes unlabelled
      for (const [mode, w, h] of [['full', Math.max(wEn, wZh), sizes * 2 + 4], ['en', wEn, sizes + 5]]) {
        const cands = [];
        for (const d of [r0, r0 + 12]) {
          cands.push([d, -h / 2], [-d - w, -h / 2], [-w / 2, -d - h], [-w / 2, d], [d - 2, -h - 2], [d - 2, 2], [-d - w + 2, -h - 2], [-d - w + 2, 2]);
        }
        let best = null;
        let bestScore = Infinity;
        cands.forEach(([dx, dy], i) => {
          const r = { x: cx + dx, y: cy + dy, w, h, mode };
          let score = i * 0.01;
          if (collides(r, st.id)) score += 10;
          if (hitsSeg(r)) score += 3;
          if (outside(r)) score += 20;
          if (score < bestScore) {
            bestScore = score;
            best = r;
          }
        });
        if (bestScore < 10) {
          chosen = best;
          break;
        }
        if (mode === 'en' && important.has(st.id)) chosen = best;
      }
      if (!chosen) continue;
      boxes.push(chosen);
      out.set(st.id, chosen);
    }
    labelCache.set(key, out);
    if (labelCache.size > 40) labelCache.delete(labelCache.keys().next().value);
    return out;
  }

  /**
   * @param opts.labels     'all' | 'ends' | 'none'
   * @param opts.routes     [{rides:[{line, from, to}], color, dash, width}]
   * @param opts.here       station id to mark with a pulsing dot
   * @param opts.clock      seconds, for the pulse
   * @param opts.dimLines   draw lines faded (e.g. for "names only")
   */
  function drawMap(ctx, day, box, opts = {}) {
    const fr = frame(day, box);
    const lw = Math.max(4, Math.min(9, fr.sc * 0.26));
    const lines = new Map(day.network.lines.map((l) => [l.id, l]));
    ctx.save();
    G.roundRect(ctx, box.x, box.y, box.w, box.h, 12, opts.bg || '#f4f1e8');
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    // faint grid
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < day.network.grid.W; gx++) {
      const [x] = fr.P(gx, 0);
      ctx.beginPath();
      ctx.moveTo(x, box.y);
      ctx.lineTo(x, box.y + box.h);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const ln of day.network.lines) {
      ctx.strokeStyle = opts.dimLines ? G.mix(ln.color, '#f4f1e8', 0.82) : ln.color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ln.points.forEach(([gx, gy], i) => {
        const [x, y] = fr.P(gx, gy);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      // line number flags at the termini
      if (!opts.dimLines) for (const end of [ln.points[0], ln.points[ln.points.length - 1]]) {
        const [x, y] = fr.P(...end);
        G.badge(ctx, ln, x, y, Math.max(8, lw * 1.2));
      }
    }
    // routes
    for (const r of opts.routes || []) {
      ctx.save();
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width || lw * 0.9;
      ctx.setLineDash(r.dash || []);
      ctx.shadowColor = r.glow || 'transparent';
      ctx.shadowBlur = r.glow ? 10 : 0;
      for (const ride of r.rides) {
        const pts = ridePoints(lines.get(ride.line), ride.from, ride.to);
        ctx.beginPath();
        pts.forEach(([gx, gy], i) => {
          const [x, y] = fr.P(gx, gy);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
      ctx.restore();
    }
    // stations
    const hubId = day.network.hubId;
    for (const st of day.network.stations) {
      const [x, y] = fr.P(st.gx, st.gy);
      if (st.id === hubId || st.kind === 'hub') {
        G.roundRect(ctx, x - 12, y - 12, 24, 24, 7, '#ffffff', '#1d1f24', 3);
      } else if (st.lines.length > 1) {
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#1d1f24';
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = opts.dimLines ? '#b9b4a6' : lines.get(st.lines[0]).color;
        ctx.stroke();
      }
    }
    // labels
    const size = opts.labelSize || Math.max(9, Math.min(12, Math.round(fr.sc * 0.34)));
    const placed = placeLabels(ctx, day, fr, box, size);
    const ends = new Set([day.home && day.home.station, day.office && day.office.station, hubId]);
    for (const st of day.network.stations) {
      if (opts.labels === 'none') break;
      if (opts.labels === 'ends' && !ends.has(st.id)) continue;
      const r = placed.get(st.id);
      if (!r) continue;
      const strong = ends.has(st.id);
      G.text(ctx, st.name.en, r.x + 2, r.y + size + 1, { size: size + 1, weight: 700, color: strong ? '#111' : '#2c2f36' });
      if (r.mode === 'full') G.text(ctx, st.name.zh, r.x + 2, r.y + size * 2 + 2, { size: size - 1, weight: 600, color: strong ? '#333' : '#5b606b' });
    }
    // home / office
    if (day.home) {
      const h = day.network.stations.find((s) => s.id === day.home.station);
      const [x, y] = fr.P(h.gx, h.gy);
      G.sprite(ctx, 'map_home', x, y - 8, { scale: 0.62 });
    }
    if (day.office) {
      const o = day.network.stations.find((s) => s.id === day.office.station);
      const [x, y] = fr.P(o.gx, o.gy);
      G.sprite(ctx, 'map_office', x, y - 8, { scale: 0.62 });
    }
    if (opts.here) {
      const st = day.network.stations.find((s) => s.id === opts.here);
      if (st) {
        const [x, y] = fr.P(st.gx, st.gy);
        const pulse = 10 + ((opts.clock || 0) * 14) % 14;
        ctx.beginPath();
        ctx.arc(x, y, pulse, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,120,40,${1 - (pulse - 10) / 14})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ff7a29';
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.restore();
    return fr;
  }

  L.viewMap = { drawMap, ridePoints };
})(typeof self !== 'undefined' ? self : this);
