// Drawing: cave walls, silt, lines, diver, the lamp, the HUD, and the survey map.
(function (root) {
  'use strict';
  const Gen = root.CaveGen, C = Gen.C;

  const SPRITE_PX = 50;     // diver sprite pixels per cell
  const PROP_PX = 30;       // prop sprite pixels per cell
  const CHUNK = 32;
  const PAD = 16, PAD_TOP = 48;   // solid rock drawn around the grid, and room above the pool for the sky
  const AMBER = '#f0a238';
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const ART = {
    diver_idle: 4, diver_swim: 6, diver_squeeze: 4, silt_puff: 6, rock_tile: 1, spool: 1,
    prop_stalactite: 1, prop_stalagmite: 1, prop_column: 1, prop_curtain: 1, prop_boulders: 1,
    prop_boulder: 1, prop_rock_small: 1, prop_spire_tall: 1, prop_spire_short: 1, prop_ledge: 1,
  };

  function loadArt(base, done) {
    const imgs = {};
    let left = Object.keys(ART).length;
    for (const name of Object.keys(ART)) {
      const img = new Image();
      img.onload = () => { imgs[name] = img; if (--left === 0) done(imgs); };
      img.onerror = () => { if (--left === 0) done(imgs); };   // missing art falls back to shapes
      img.src = `${base}/${name}.png`;
    }
  }

  // 3x3 box blur of a 0/1 mask, so contours come out rounded instead of blocky.
  function smoothField(mask, W, H) {
    const f = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) { n++; continue; }
        s += mask[yy * W + xx]; n++;
      }
      f[y * W + x] = s / n;
    }
    return f;
  }

  // Marching squares over values at cell centres. Adds the "below iso" part of
  // every square to fill (as polygons) and the contour to edge (as segments).
  function contour(field, W, H, x0, y0, x1, y1, iso, fill, edge) {
    const P = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let j = Math.max(0, y0); j < Math.min(H - 1, y1); j++) {
      let run = -1;
      for (let i = Math.max(0, x0); i <= Math.min(W - 1, x1); i++) {
        const inRange = i < Math.min(W - 1, x1);
        const a = inRange ? field[j * W + i] : 1, b = inRange ? field[j * W + i + 1] : 1;
        const c = inRange ? field[(j + 1) * W + i + 1] : 1, d = inRange ? field[(j + 1) * W + i] : 1;
        const all = a < iso && b < iso && c < iso && d < iso;
        if (all) { if (run < 0) run = i; continue; }
        if (run >= 0) { if (fill) fill.rect(run + 0.5, j + 0.5, i - run, 1); run = -1; }
        if (!inRange || (a >= iso && b >= iso && c >= iso && d >= iso)) continue;
        const X = [i + 0.5, i + 1.5, i + 1.5, i + 0.5], Y = [j + 0.5, j + 0.5, j + 1.5, j + 1.5], V = [a, b, c, d];
        let n = 0;
        const cross = [];
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) & 3, va = V[k], vb = V[k2];
          if (va < iso) { P[n++] = X[k]; P[n++] = Y[k]; }
          if ((va < iso) !== (vb < iso)) {
            const t = (iso - va) / (vb - va);
            const px = X[k] + (X[k2] - X[k]) * t, py = Y[k] + (Y[k2] - Y[k]) * t;
            P[n++] = px; P[n++] = py;
            cross.push(px, py);
          }
        }
        if (fill && n >= 6) {
          fill.moveTo(P[0], P[1]);
          for (let k = 2; k < n; k += 2) fill.lineTo(P[k], P[k + 1]);
          fill.closePath();
        }
        if (edge) for (let k = 0; k + 3 < cross.length; k += 4) { edge.moveTo(cross[k], cross[k + 1]); edge.lineTo(cross[k + 2], cross[k + 3]); }
      }
    }
  }

  function Renderer(canvas, art) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.art = art;
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.cam = { x: 0, y: 0 };
    this.resize();
  }

  Renderer.prototype.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = dpr; this.w = w; this.h = h;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.light.width = Math.round(w * dpr * 0.5); this.light.height = Math.round(h * dpr * 0.5);
    this.px = clamp(Math.min(w / 60, h / 34), 11, 30);   // screen pixels per cell
  };

  // Everything that only depends on the cave: contour paths, silt beds, the survey map.
  Renderer.prototype.setDive = function (game) {
    const d = game.d;
    this.game = game;
    // The rock is drawn from a padded copy of the grid: solid rock all around,
    // except a shaft of open air above the pool, so the walls and the shading
    // run on past the edges of the grid with no seam.
    const PW = d.W + 2 * PAD, PH = d.H + PAD_TOP + PAD;
    const mask = new Uint8Array(PW * PH);
    for (let y = 0; y < d.H; y++) for (let x = 0; x < d.W; x++) mask[(y + PAD_TOP) * PW + x + PAD] = d.open[y * d.W + x];
    let s0 = -1, s1 = -1;
    for (let x = 0; x < C.BASIN_W; x++) if (d.open[d.W + x]) { if (s0 < 0) s0 = x; s1 = x; }
    this.shaft = null;
    if (s0 >= 0) {
      // Row 0 and the air above the pool: a sinkhole that opens out a little
      // as it rises, with rough walls.
      const rough = (y, side) => ((Math.imul(y * 7 + side, 0x9e3779b1) >>> 29) & 1);
      let top = null;
      for (let y = 0; y >= -PAD_TOP; y--) {
        const flare = Math.floor(-y / 6);
        const a = Math.max(-PAD + 1, s0 - flare - rough(y, 1)), b = Math.min(d.W + PAD - 2, s1 + flare + rough(y, 2));
        for (let x = a; x <= b; x++) mask[(y + PAD_TOP) * PW + x + PAD] = 1;
        top = { x0: a + 0.5, x1: b + 0.5 };
      }
      this.shaft = { x0: s0 + 0.5, x1: s1 + 0.5, top };
    }
    this.pad = { W: PW, H: PH, mask };
    this.field = smoothField(mask, PW, PH);
    this.chunks = new Map();
    this.silt = document.createElement('canvas');
    this.silt.width = d.W; this.silt.height = d.H;
    this.siltImg = this.silt.getContext('2d').createImageData(d.W, d.H);
    this.map = renderSurvey(d, 4);
    // Rock fades to black away from the passage, so only the walls show texture.
    const inv = new Uint8Array(PW * PH);
    for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
    const depth = Gen.clearanceMap(inv, PW, PH);
    this.shade = document.createElement('canvas');
    this.shade.width = PW; this.shade.height = PH;
    const sctx = this.shade.getContext('2d'), img = sctx.createImageData(PW, PH);
    for (let i = 0; i < inv.length; i++) {
      img.data[i * 4] = 3; img.data[i * 4 + 1] = 7; img.data[i * 4 + 2] = 11;
      img.data[i * 4 + 3] = inv[i] ? 255 * clamp((depth[i] - 0.6) / 3.5, 0, 0.96) : 0;
    }
    sctx.putImageData(img, 0, 0);
    this.cam.x = d.start.x; this.cam.y = d.start.y;
    if (this.art.rock_tile) {
      this.rockPattern = this.ctx.createPattern(this.art.rock_tile, 'repeat');
      if (this.rockPattern.setTransform) this.rockPattern.setTransform(new DOMMatrix().scale(10 / 256));
    }
  };

  Renderer.prototype.chunk = function (cx, cy) {
    const key = cx + ',' + cy;
    let ch = this.chunks.get(key);
    if (ch) return ch;
    // Chunks are in padded coordinates; draw() shifts them back onto the grid.
    const d = this.game.d, x0 = cx * CHUNK, y0 = cy * CHUNK;
    const rock = new Path2D(), edge = new Path2D(), beds = [new Path2D(), new Path2D(), new Path2D()];
    contour(this.field, this.pad.W, this.pad.H, x0, y0, x0 + CHUNK, y0 + CHUNK, 0.5, rock, edge);
    for (let py = y0; py < y0 + CHUNK; py++) for (let px = x0; px < x0 + CHUNK; px++) {
      const x = px - PAD, y = py - PAD_TOP;
      if (x < 0 || y < 0 || x >= d.W || y >= d.H - 1) continue;
      const dep = d.deposit[y * d.W + x];
      if (dep < 0.15 || d.open[(y + 1) * d.W + x]) continue;
      const b = beds[dep > 0.8 ? 2 : dep > 0.45 ? 1 : 0];
      b.moveTo(px + 1.4, py + 1.12);
      b.ellipse(px + 0.5, py + 1.12, 0.9, 0.3, 0, 0, Math.PI * 2);
    }
    ch = { rock, edge, beds };
    this.chunks.set(key, ch);
    return ch;
  };

  Renderer.prototype.updateSilt = function () {
    const g = this.game, s = g.silt, data = this.siltImg.data;
    let any = false;
    for (let i = 0; i < s.length; i++) {
      const a = s[i];
      if (a > 0.01) any = true;
      const o = i * 4;
      data[o] = 158; data[o + 1] = 148; data[o + 2] = 120;
      data[o + 3] = a <= 0 ? 0 : Math.min(250, a * 150);
    }
    this.silt.getContext('2d').putImageData(this.siltImg, 0, 0);
    this.siltAny = any;
    g.siltDirty = false;
  };

  Renderer.prototype.worldTransform = function (ctx, scale) {
    const k = this.px * this.dpr * scale;
    ctx.setTransform(k, 0, 0, k, (this.w / 2 - this.cam.x * this.px) * this.dpr * scale, (this.h / 2 - this.cam.y * this.px) * this.dpr * scale);
  };

  Renderer.prototype.draw = function (dt, ui) {
    const g = this.game, d = g.d, ctx = this.ctx, dv = g.diver;
    // Facing as an angle, for drawing only (the simulation keeps a unit vector).
    this.face = Math.atan2(dv.fy, dv.fx);
    // Camera leads the diver a little in the direction they face.
    const tx = dv.x + Math.cos(this.face) * 4, ty = dv.y + Math.sin(this.face) * 2;
    const k = Math.min(1, dt * 3);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    const halfW = this.w / 2 / this.px, halfH = this.h / 2 / this.px;
    const vx0 = this.cam.x - halfW - 2, vx1 = this.cam.x + halfW + 2, vy0 = this.cam.y - halfH - 2, vy1 = this.cam.y + halfH + 2;
    if (g.siltDirty) this.updateSilt();

    // Water: lighter teal near the surface, ink blue at depth.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const top = (this.cam.y - halfH) * C.CELL_M, bot = (this.cam.y + halfH) * C.CELL_M;
    const water = ctx.createLinearGradient(0, 0, 0, this.h);
    water.addColorStop(0, depthColor(top)); water.addColorStop(1, depthColor(bot));
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, this.w, this.h);

    this.worldTransform(ctx, 1);
    // Daylight in the shaft above the pool, drawn before the rock so the
    // shaft walls cut it off.
    const sh = this.shaft, SURFACE = 0.4;
    if (sh && vy0 < SURFACE) {
      const sky = ctx.createLinearGradient(0, SURFACE - 14, 0, SURFACE);
      sky.addColorStop(0, '#5f9ea3'); sky.addColorStop(0.75, '#b9e2de'); sky.addColorStop(1, '#dff5f1');
      ctx.fillStyle = sky;
      ctx.fillRect(sh.top.x0 - 2, vy0 - 1, sh.top.x1 - sh.top.x0 + 4, SURFACE - vy0 + 1);
      const below = ctx.createLinearGradient(0, SURFACE, 0, SURFACE + 5);
      below.addColorStop(0, 'rgba(210,240,236,0.35)'); below.addColorStop(1, 'rgba(210,240,236,0)');
      ctx.fillStyle = below;
      ctx.fillRect(sh.x0 - 2, SURFACE, sh.x1 - sh.x0 + 4, 5);
      ctx.strokeStyle = 'rgba(236,252,250,0.85)'; ctx.lineWidth = 0.1;
      ctx.beginPath(); ctx.moveTo(sh.x0 - 2, SURFACE); ctx.lineTo(sh.x1 + 2, SURFACE); ctx.stroke();
    }
    const cks = [];
    const pvx0 = vx0 + PAD, pvx1 = vx1 + PAD, pvy0 = vy0 + PAD_TOP, pvy1 = vy1 + PAD_TOP;
    for (let cy = Math.floor(pvy0 / CHUNK); cy <= Math.floor(pvy1 / CHUNK); cy++) {
      for (let cx = Math.floor(pvx0 / CHUNK); cx <= Math.floor(pvx1 / CHUNK); cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= this.pad.W || cy * CHUNK >= this.pad.H) continue;
        cks.push(this.chunk(cx, cy));
      }
    }
    ctx.save();
    ctx.translate(-PAD, -PAD_TOP);
    // Silt beds on the floor, then rock on top so only their upper edge shows.
    const bedColors = ['rgba(120,112,88,0.22)', 'rgba(128,118,92,0.34)', 'rgba(136,124,96,0.46)'];
    for (const ch of cks) ch.beds.forEach((b, i) => { ctx.fillStyle = bedColors[i]; ctx.fill(b); });
    for (const ch of cks) {
      ctx.fillStyle = this.rockPattern || '#1b2a33';
      ctx.fill(ch.rock);
      ctx.fillStyle = 'rgba(10,20,28,0.3)';
      ctx.fill(ch.rock);
    }
    ctx.imageSmoothingEnabled = true;
    {
      const sx = clamp(Math.floor(pvx0), 0, this.pad.W - 1), sy = clamp(Math.floor(pvy0), 0, this.pad.H - 1);
      const sw = clamp(Math.ceil(pvx1), 1, this.pad.W) - sx, shh = clamp(Math.ceil(pvy1), 1, this.pad.H) - sy;
      if (sw > 0 && shh > 0) ctx.drawImage(this.shade, sx, sy, sw, shh, sx, sy, sw, shh);
    }
    ctx.lineCap = 'round';
    for (const ch of cks) {
      ctx.strokeStyle = 'rgba(8,14,20,0.9)'; ctx.lineWidth = 0.5; ctx.stroke(ch.edge);
      ctx.strokeStyle = 'rgba(122,156,166,0.45)'; ctx.lineWidth = 0.14; ctx.stroke(ch.edge);
    }
    ctx.restore();
    // Solid rock beyond the padding (the same colour as the shaded rock there),
    // leaving the shaft of daylight open all the way up.
    const px0 = -PAD + 0.5, py0 = -PAD_TOP + 0.5, px1 = d.W + PAD - 0.5, py1 = d.H + PAD - 0.5;
    if (vx0 < px0 || vy0 < py0 || vx1 > px1 || vy1 > py1) {
      const outside = new Path2D();
      outside.rect(vx0 - 5, vy0 - 5, vx1 - vx0 + 10, vy1 - vy0 + 10);
      outside.rect(px0, py0, px1 - px0, py1 - py0);
      if (sh && vy0 < py0) outside.rect(sh.top.x0, vy0 - 5, sh.top.x1 - sh.top.x0, py0 - (vy0 - 5));
      ctx.fillStyle = '#04080c';
      ctx.fill(outside, 'evenodd');
    }

    this.drawProps(ctx, vx0, vx1, vy0, vy1);
    this.drawLines(ctx);
    this.drawGoal(ctx);
    this.drawBubbles(ctx);
    this.drawPuffs(ctx);

    // Suspended silt, only the part in view.
    if (this.siltAny) {
      const sx = clamp(Math.floor(vx0), 0, d.W - 1), sy = clamp(Math.floor(vy0), 0, d.H - 1);
      const sw = clamp(Math.ceil(vx1), 1, d.W) - sx, sh = clamp(Math.ceil(vy1), 1, d.H) - sy;
      if (sw > 0 && sh > 0) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.silt, sx, sy, sw, sh, sx, sy, sw, sh);
      }
    }

    this.drawLight();
    // The diver is drawn over the darkness: you always know where your own body is.
    this.worldTransform(ctx, 1);
    ctx.save();
    ctx.shadowColor = 'rgba(120,190,200,0.55)'; ctx.shadowBlur = 6 * this.dpr;
    this.drawDiver(ctx);
    ctx.restore();
    this.drawFelt(ctx);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHUD(ctx, ui);
  };

  function depthColor(m) {
    const t = clamp(m / 40, 0, 1);
    const a = [34, 96, 108], b = [9, 24, 38];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  }

  Renderer.prototype.drawProps = function (ctx, x0, x1, y0, y1) {
    for (const p of this.game.d.props) {
      if (p.x < x0 - 5 || p.x > x1 + 5 || p.y < y0 - 8 || p.y > y1 + 8) continue;
      const img = this.art['prop_' + p.type];
      if (!img) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.flip) ctx.scale(-1, 1);
      if (p.type === 'column') {
        const h = p.y2 - p.y + 0.6, w = (img.width / img.height) * h;
        ctx.drawImage(img, -w / 2, -0.3, w, h);
      } else {
        const w = (img.width / PROP_PX) * p.s, h = (img.height / PROP_PX) * p.s;
        if (p.type === 'stalactite' || p.type === 'curtain') ctx.drawImage(img, -w / 2, -0.35, w, h);
        else ctx.drawImage(img, -w / 2, -h + 0.3, w, h);
      }
      ctx.restore();
    }
  };

  Renderer.prototype.drawLines = function (ctx) {
    const g = this.game, a = g.d.anchor;
    // The tie-off post in the pool, standing on the pool floor.
    let floor = a.y;
    while (floor < a.y + 12 && g.isOpen(a.x, floor + 0.5)) floor += 0.5;
    ctx.fillStyle = '#5c4a2c';
    ctx.fillRect(a.x - 0.14, a.y, 0.28, floor - a.y + 0.4);
    ctx.strokeStyle = AMBER; ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.arc(a.x, a.y, 0.4, 0, Math.PI * 2); ctx.stroke();

    ctx.lineJoin = 'round';
    g.lines.forEach((line, i) => {
      const live = i === g.reel.active;
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      line.pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (live && !g.hold) ctx.lineTo(g.diver.x, g.diver.y);   // still running off the reel
      ctx.stroke();
      // Knots where the line is tied in and tied off.
      ctx.fillStyle = '#c9822a';
      const ends = live ? [line.pts[0]] : [line.pts[0], line.pts[line.pts.length - 1]];
      for (const p of ends) { ctx.beginPath(); ctx.arc(p.x, p.y, 0.18, 0, Math.PI * 2); ctx.fill(); }
    });
  };

  // A small triangle pointing along (ex, ey).
  function drawArrow(ctx, x, y, ex, ey, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(ey, ex));
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(40,20,0,0.8)';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(size * 0.7, 0); ctx.lineTo(-size * 0.5, -size * 0.55); ctx.lineTo(-size * 0.5, size * 0.55); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  Renderer.prototype.drawGoal = function (ctx) {
    const g = this.game, p = g.d.goal;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = g.goalTagged ? '#ffd48a' : AMBER;
    ctx.strokeStyle = '#3a2208'; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.rect(-0.45, -0.3, 0.9, 0.6); ctx.fill(); ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.drawBubbles = function (ctx) {
    ctx.strokeStyle = 'rgba(200,230,240,0.55)';
    ctx.lineWidth = 0.04;
    for (const b of this.game.bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); }
  };

  Renderer.prototype.drawPuffs = function (ctx) {
    const img = this.art.silt_puff;
    if (!img) return;
    const fw = img.width / 6;
    for (const p of this.game.puffs) {
      const f = Math.min(5, Math.floor((p.t / p.life) * 6));
      const size = 2.6 * p.s * (0.7 + p.t / p.life);
      ctx.globalAlpha = 0.7 * (1 - p.t / p.life);
      ctx.drawImage(img, f * fw, 0, fw, img.height, p.x - size / 2, p.y - size / 2, size, size * (img.height / fw));
    }
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawDiver = function (ctx) {
    const g = this.game, dv = g.diver;
    const name = dv.tight ? 'diver_squeeze' : dv.moving ? 'diver_swim' : 'diver_idle';
    const img = this.art[name];
    ctx.save();
    ctx.translate(dv.x, dv.y);
    let a = this.face;
    if (Math.cos(a) < 0) { ctx.scale(-1, 1); a = Math.PI - a; }
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    ctx.rotate(clamp(a, -1.2, 1.2));
    if (img) {
      const n = ART[name], fw = img.width / n, f = Math.floor(dv.anim * (dv.moving ? 1.6 : 0.8)) % n;
      const w = fw / SPRITE_PX, h = img.height / SPRITE_PX;
      ctx.drawImage(img, f * fw, 0, fw, img.height, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = '#10181e';
      ctx.beginPath(); ctx.ellipse(0, 0, 1.6, 0.45, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  // Darkness with holes cut for the lamp, the diver's glow and the daylight in the pool.
  Renderer.prototype.drawLight = function () {
    const g = this.game, dv = g.diver, l = this.lctx, S = 0.5;
    const L = this.light;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, L.width, L.height);
    l.fillStyle = 'rgba(2,6,10,0.985)';
    l.fillRect(0, 0, L.width, L.height);
    l.globalCompositeOperation = 'destination-out';
    this.worldTransform(l, S);

    const dayX = this.shaft ? (this.shaft.x0 + this.shaft.x1) / 2 : C.BASIN_W / 2;
    const day = l.createRadialGradient(dayX, -8, 2, dayX, -8, 38);
    day.addColorStop(0, 'rgba(0,0,0,0.97)'); day.addColorStop(0.6, 'rgba(0,0,0,0.75)'); day.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = day;
    l.fillRect(dayX - 38, -46, 76, 76);

    const hx = dv.x + Math.cos(this.face) * 1.3, hy = dv.y + Math.sin(this.face) * 1.3 - 0.25;
    const halo = l.createRadialGradient(dv.x, dv.y, 0, dv.x, dv.y, 4.5);
    halo.addColorStop(0, 'rgba(0,0,0,0.7)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = halo;
    l.fillRect(dv.x - 5, dv.y - 5, 10, 10);

    const reach = g.lamp.reach;
    const cone = (half, len, a0) => {
      const grad = l.createRadialGradient(hx, hy, 0, hx, hy, len);
      grad.addColorStop(0, `rgba(0,0,0,${a0})`); grad.addColorStop(0.35, `rgba(0,0,0,${a0 * 0.9})`);
      grad.addColorStop(0.7, `rgba(0,0,0,${a0 * 0.45})`); grad.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = grad;
      l.beginPath(); l.moveTo(hx, hy); l.arc(hx, hy, len, this.face - half, this.face + half); l.closePath(); l.fill();
    };
    cone(0.95, reach * 0.65, 0.4);
    cone(0.27, reach * 1.15, 1);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(L, 0, 0, this.cv.width, this.cv.height);

    // Warm lamp light, and the milky glare of the lamp on silt right in front of the mask.
    this.worldTransform(ctx, 1);
    ctx.globalCompositeOperation = 'lighter';
    const warm = ctx.createRadialGradient(hx, hy, 0, hx, hy, reach);
    warm.addColorStop(0, 'rgba(255,214,150,0.16)'); warm.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = warm;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.arc(hx, hy, reach, this.face - 0.27, this.face + 0.27); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const s = g.siltAt(hx, hy) + g.siltAt(hx + Math.cos(this.face) * 2, hy + Math.sin(this.face) * 2);
    if (s > 0.12) {
      const gx = hx + Math.cos(this.face) * 1.2, gy = hy + Math.sin(this.face) * 1.2;
      const r = Math.min(6.5, 3.2 + s);
      const glare = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      glare.addColorStop(0, `rgba(196,186,156,${Math.min(0.75, s * 0.32)})`); glare.addColorStop(1, 'rgba(196,186,156,0)');
      ctx.fillStyle = glare;
      ctx.fillRect(gx - r, gy - r, 2 * r, 2 * r);
    }
  };

  // What the diver can feel: the line under the hand, and which way it runs back.
  Renderer.prototype.drawFelt = function (ctx) {
    const g = this.game;
    this.worldTransform(ctx, 1);
    if (g.hold) {
      const line = g.lines[g.hold.line];
      ctx.save();
      ctx.shadowColor = AMBER; ctx.shadowBlur = 8 * this.dpr;
      ctx.strokeStyle = 'rgba(240,162,56,0.75)'; ctx.lineWidth = 0.12;
      ctx.beginPath();
      for (let s = Math.max(0, g.hold.s - 2.5), first = true; s <= Math.min(line.total, g.hold.s + 2.5); s += 0.25, first = false) {
        const p = Gen.linePoint(line, s);
        if (first) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (g.felt && g.hold.s > 0.5) {
      const m = g.felt, dv = g.diver;
      ctx.save();
      ctx.globalAlpha = 0.85;
      drawArrow(ctx, dv.x + m.ex * 2.4, dv.y - 1.8 + m.ey * 0.8, m.ex, m.ey, 0.6, m.out ? '#ffe0a8' : '#ff8a6a');
      ctx.restore();
    }
  };

  // ------------------------------------------------------------------ HUD
  Renderer.prototype.drawHUD = function (ctx, ui) {
    const g = this.game, d = g.d, B = d.budget;
    ctx.font = '600 13px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textBaseline = 'alphabetic';

    // Status chips go under the gauge; the panel grows to fit them.
    const chips = [];
    if (g.hold) chips.push(['ON LINE', AMBER]);
    if (g.reel.active !== null) chips.push(['LAYING LINE', '#f6c566']);
    const lineIdx = g.hold ? g.hold.line : g.reel.active;
    if (lineIdx !== null && lineIdx !== undefined && !g.connected(lineIdx)) chips.push(['NOT TIED TO THE ENTRANCE', '#ff8a6a']);
    else if (lineIdx === null && g.entered && !g.nearestLine(g.diver.x, g.diver.y, 4)) chips.push(['NO LINE', '#ff8a6a']);
    if (g.diver.tight) chips.push(['TIGHT', '#c9d6da']);
    if (g.lamp.vis < root.CaveGame.ZERO_VIS) chips.push(['ZERO VIS', '#ff8a6a']);
    if (g.goalTagged) chips.push(['END TAGGED', '#ffd48a']);
    const x = 18, y = 18, w = 280;
    ctx.font = '700 11px system-ui, -apple-system, Segoe UI, sans-serif';
    const placed = [];
    let cx = x, cy = y + 66;
    for (const [text, color] of chips) {
      const tw = ctx.measureText(text).width + 12;
      if (cx > x && cx + tw > x + w) { cx = x; cy += 24; }
      placed.push([text, color, cx, cy, tw]);
      cx += tw + 6;
    }
    const bottom = placed.length ? cy + 18 + 12 : y + 58 + 12;
    panel(ctx, x - 10, y - 10, w + 20, bottom - (y - 10));

    // Gas gauge, split into thirds.
    ctx.font = '600 13px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillStyle = '#9fb7bf'; ctx.fillText('GAS', x, y + 12);
    ctx.fillStyle = g.gas <= B.reserve ? '#ff8a6a' : g.gas <= B.turn ? '#ffc46b' : '#e8f1f2';
    ctx.font = '700 20px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(`${g.gas > 0 ? Math.max(1, Math.round(g.gas)) : 0} bar`, x + 36, y + 14);   // rounded like the results screen
    ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillStyle = '#9fb7bf';
    ctx.textAlign = 'right'; ctx.fillText(`turn at ${Math.round(B.turn)}`, x + w, y + 12); ctx.textAlign = 'left';
    const by = y + 24, bh = 10;
    const thirds = [['rgba(120,50,44,0.8)', 0, 1 / 3], ['rgba(40,70,80,0.9)', 1 / 3, 2 / 3], ['rgba(52,92,104,0.9)', 2 / 3, 1]];
    for (const [c, a, b] of thirds) { ctx.fillStyle = c; ctx.fillRect(x + w * a, by, w * (b - a) - 1, bh); }
    ctx.fillStyle = g.gas <= B.reserve ? '#ff8a6a' : AMBER;
    ctx.fillRect(x, by + 2, w * (g.gas / B.P0), bh - 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + w * (B.turn / B.P0) - 1, by - 3, 2, bh + 6);

    // Depth and time on the left, the reel and the line left on it on the right.
    ctx.font = '600 13px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillStyle = '#cfe0e3';
    const ty = y + 56;
    ctx.fillText(`DEPTH ${g.depth().toFixed(0)} m`, x, ty);
    // Room for a two-digit depth, so TIME doesn't move as the depth changes.
    ctx.fillText(`TIME ${root.CaveGame.fmt(g.t)}`, x + ctx.measureText('DEPTH 88 m').width + 16, ty);
    const reelText = `${Math.max(0, Math.round(g.reel.left * C.CELL_M))} m`;
    ctx.textAlign = 'right'; ctx.fillText(reelText, x + w, ty); ctx.textAlign = 'left';
    if (this.art.spool) ctx.drawImage(this.art.spool, x + w - ctx.measureText(reelText).width - 26, ty - 15, 21, 18);

    ctx.font = '700 11px system-ui, -apple-system, Segoe UI, sans-serif';
    for (const [text, color, px, py, tw] of placed) {
      ctx.fillStyle = 'rgba(6,16,24,0.62)'; ctx.fillRect(px, py, tw, 18);
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, tw - 1, 17);
      ctx.fillStyle = color; ctx.fillText(text, px + 6, py + 13);
    }
    if (g.felt) {
      ctx.font = '600 13px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillStyle = g.felt.out ? '#ffe0a8' : '#ff8a6a';
      ctx.fillText(g.felt.out ? 'Hand on the line: the arrow shows the way back to the entrance.' : 'Hand on a line that does not lead back to the entrance.', x - 2, bottom + 22);
    }
    if (g.tutorial) this.drawTutorial(ctx);

    // Dive info, bottom right.
    ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(190,210,214,0.75)';
    const mapNote = g.mapMode === 'full' ? 'M: map' : g.mapMode === 'entrance' ? (g.mapAllowed() ? 'M: map (at the entrance only)' : 'map left at the entrance') : 'no map';
    ctx.fillText(`Dive ${ui.diveNo} · level ${d.level} · seed ${d.seed} · ${mapNote}`, this.w - 16, this.h - 16);
    ctx.textAlign = 'left';

    if (ui.showHelp) {
      const lines = ['WASD / arrows: swim', 'Shift: kick hard (fast, costly, silty)', 'R: tie your reel in / tie it off', 'Space (hold): follow a line by touch', 'M: map \u00b7 H: hide this \u00b7 Esc: pause'];
      panel(ctx, 8, this.h - 24 - lines.length * 18, 300, lines.length * 18 + 14);
      ctx.fillStyle = '#cfe0e3';
      lines.forEach((t, i) => ctx.fillText(t, 18, this.h - 14 - (lines.length - 1 - i) * 18 - 4));
    }

    // Toasts.
    ctx.textAlign = 'center';
    ctx.font = '600 16px system-ui, -apple-system, Segoe UI, sans-serif';
    g.toasts.slice(-3).forEach((t, i, arr) => {
      const a = clamp(t.until - g.t, 0, 1);
      const ty = this.h - 70 - (arr.length - 1 - i) * 30;
      const tw = ctx.measureText(t.text).width + 28;
      ctx.globalAlpha = a;
      panel(ctx, this.w / 2 - tw / 2, ty - 20, tw, 28);
      ctx.fillStyle = '#f2e6cf';
      ctx.fillText(t.text, this.w / 2, ty - 1);
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = 'left';

    if (ui.showMap) this.drawMapOverlay(ctx);
  };

  function panel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(6,16,24,0.62)';
    ctx.strokeStyle = 'rgba(120,160,170,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();
  }

  Renderer.prototype.drawTutorial = function (ctx) {
    const tu = this.game.tutorial, step = tu.steps[tu.step];
    const w = Math.min(620, this.w - 340), x = (this.w - w) / 2 + 60, y = 16;
    ctx.font = '600 15px system-ui, -apple-system, Segoe UI, sans-serif';
    const words = step.text.split(' '), rows = [];
    let row = '';
    for (const word of words) {
      const t = row ? row + ' ' + word : word;
      if (ctx.measureText(t).width > w - 28 && row) { rows.push(row); row = word; } else row = t;
    }
    rows.push(row);
    panel(ctx, x, y, w, 36 + rows.length * 20);
    ctx.fillStyle = '#ffc46b';
    ctx.font = '700 12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(`TUTORIAL \u00b7 STEP ${tu.step + 1} OF ${tu.steps.length}`, x + 14, y + 20);
    ctx.fillStyle = '#f2e6cf';
    ctx.font = '600 15px system-ui, -apple-system, Segoe UI, sans-serif';
    rows.forEach((r, i) => ctx.fillText(r, x + 14, y + 42 + i * 20));
  };

  Renderer.prototype.drawMapOverlay = function (ctx) {
    const g = this.game, m = this.map, d = g.d;
    ctx.fillStyle = 'rgba(2,8,14,0.78)';
    ctx.fillRect(0, 0, this.w, this.h);
    // Fit the screen, but don't blow a small cave's survey (and its labels) up past 1.6x.
    const s = Math.min((this.w - 60) / m.width, (this.h - 110) / m.height, 1.6);
    const w = m.width * s, h = m.height * s, x = (this.w - w) / 2, y = (this.h - h) / 2 + 10;
    ctx.drawImage(m, x, y, w, h);
    const X = (wx) => x + (wx / d.W) * w, Y = (wy) => y + ((wy - m.cropY0) / m.cropH) * h;
    // Your own lines, as laid so far.
    ctx.strokeStyle = AMBER; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    g.lines.forEach((line, i) => {
      ctx.beginPath();
      line.pts.forEach((p, k) => (k ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      if (i === g.reel.active && !g.hold) ctx.lineTo(X(g.diver.x), Y(g.diver.y));
      ctx.stroke();
    });
    ctx.fillStyle = '#e8f1f2';
    ctx.font = '700 16px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(`Survey \u00b7 seed ${d.seed}`, x, y - 14);
    ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillStyle = '#9fb7bf';
    ctx.fillText('The survey shows the passages, not the way. Ring: tie-off post \u00b7 square: end chamber \u00b7 amber: the line you have laid', x, y + h + 22);
    const px = X(g.diver.x), py = Y(g.diver.y);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = AMBER; ctx.lineWidth = 2; ctx.stroke();
  };

  // ------------------------------------------------------------------ survey map
  // Drawn in the style of resources/cave_concept_2.png: passages filled in depth
  // bands, with the tie-off post and the end chamber marked. No line: the diver lays it.
  function renderSurvey(d, scale) {
    // Crop to the rows the cave actually uses.
    let minY = d.H, maxY = 0;
    for (let i = 0; i < d.open.length; i++) if (d.open[i]) { const y = (i / d.W) | 0; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const M = 7;                           // rows of margin above the water surface
    const y0 = -M, y1 = Math.min(d.H, maxY + 8);
    const cv = document.createElement('canvas');
    cv.width = d.W * scale; cv.height = (y1 - y0) * scale;
    cv.cropY0 = y0; cv.cropH = y1 - y0;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0f2433';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = 'rgba(120,160,180,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < cv.width; x += 10 * scale) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke(); }
    for (let y = M * scale; y < cv.height; y += 10 * scale) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); }
    ctx.setTransform(scale, 0, 0, scale, 0, M * scale);

    const N = d.W * d.H;
    const inv = (f) => { for (let i = 0; i < f.length; i++) f[i] = 1 - f[i]; return f; };

    // Passages: depth bands (lighter = shallower), lighter near the walls.
    // The pool is open to the surface (row 0 is rock only in the grid).
    const open = d.open.slice();
    let s0 = -1, s1 = -1;
    for (let x = 0; x < C.BASIN_W; x++) if (d.open[d.W + x]) { open[x] = 1; if (s0 < 0) s0 = x; s1 = x; }
    const sf = inv(smoothField(open, d.W, d.H));
    const fill = new Path2D(), edge = new Path2D();
    contour(sf, d.W, d.H, 0, 0, d.W, d.H, 0.5, fill, edge);
    const small = document.createElement('canvas');
    small.width = d.W; small.height = d.H;
    const sctx = small.getContext('2d'), img = sctx.createImageData(d.W, d.H);
    for (let i = 0; i < N; i++) {
      const y = (i / d.W) | 0, band = Math.floor((y * C.CELL_M) / 6);
      const wall = clamp(1 - d.clear[i] / 3, 0, 1);
      const t = clamp(band / 8, 0, 1);
      img.data[i * 4] = 70 - 50 * t + 60 * wall;
      img.data[i * 4 + 1] = 150 - 80 * t + 50 * wall;
      img.data[i * 4 + 2] = 170 - 70 * t + 40 * wall;
      img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.clip(fill);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, d.W, d.H);
    ctx.restore();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10,18,24,0.95)'; ctx.lineWidth = 0.9; ctx.stroke(edge);
    ctx.strokeStyle = 'rgba(190,210,205,0.55)'; ctx.lineWidth = 0.25; ctx.stroke(edge);
    if (s0 >= 0) {
      // The water surface in the entrance pool.
      ctx.strokeStyle = 'rgba(220,245,240,0.8)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(s0 + 0.2, 0.5); ctx.lineTo(s1 + 0.8, 0.5); ctx.stroke();
    }

    // The tie-off post.
    ctx.strokeStyle = AMBER; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(d.anchor.x, d.anchor.y, 1.4, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = '#ffd48a';
    ctx.beginPath(); ctx.rect(d.goal.x - 1.2, d.goal.y - 0.8, 2.4, 1.6); ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const Y = (wy) => (wy - y0) * scale;
    ctx.font = `700 ${Math.round(scale * 3.2)}px system-ui, sans-serif`;
    ctx.fillStyle = '#e8f1f2';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('ENTRANCE', ((s0 + s1 + 1) / 2) * scale, Y(-M / 2));
    // END CHAMBER goes on whichever side of the chamber covers the least passage.
    const tw = ctx.measureText('END CHAMBER').width / scale, th = 3.4;
    let best = null;
    for (const [dx, dy] of [[0, -5], [0, 5], [tw / 2 + 4, 0], [-tw / 2 - 4, 0]]) {
      const cx = clamp(d.goal.x + dx, tw / 2 + 1, d.W - tw / 2 - 1), cy = clamp(d.goal.y + dy, y0 + th, y1 - th);
      let cover = 0;
      for (let yy = Math.floor(cy - th / 2); yy <= cy + th / 2; yy++) for (let xx = Math.floor(cx - tw / 2); xx <= cx + tw / 2; xx++) {
        if (yy >= 0 && yy < d.H && xx >= 0 && xx < d.W && d.open[yy * d.W + xx]) cover++;
      }
      if (!best || cover < best.cover) best = { cx, cy, cover };
    }
    ctx.fillText('END CHAMBER', best.cx * scale, Y(best.cy));
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(160,190,200,0.55)';
    ctx.font = `600 ${Math.round(scale * 2.4)}px system-ui, sans-serif`;
    for (let m = 10; m / C.CELL_M < y1 - 2; m += 10) ctx.fillText(`${m} m`, cv.width - 2 * scale, Y(m / C.CELL_M));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return cv;
  }

  root.CaveRender = { Renderer, loadArt, renderSurvey };
})(window);
