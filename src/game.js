// One dive: diver movement, the guideline, silt, gas, and the run log.
(function (root) {
  'use strict';
  const Gen = root.CaveGen;
  const C = Gen.C;

  const SPEED_SWIM = C.SWIM_SPEED, SPEED_HARD = 6.5;   // cells/s
  const ACCEL = 16, DRAG = 3.0;
  const REACH = 1.4;           // how close the line must be to grab it, cells
  const SPOOL_CELLS = 60;      // 30 m jump spool
  const SILT_TICK = 0.1;       // silt field update interval, s
  const SILT_HALF_LIFE = 75;   // s for suspended silt to halve (before spreading)
  const ZERO_VIS = 0.28;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  function Game(dive, mapMode) {
    this.d = dive;
    this.mapMode = mapMode;
    const N = dive.W * dive.H;
    this.silt = new Float32Array(N);
    this.siltNext = new Float32Array(N);
    this.stirredAt = new Float32Array(N).fill(-1);
    this.deposit = dive.deposit.slice();
    this.lines = dive.lines.slice();
    this.leads = dive.leads.map((l) => Object.assign({}, l));
    this.t = 0;
    this.siltClock = 0;
    this.gas = C.P0;
    this.diver = { x: dive.start.x, y: dive.start.y, vx: 0, vy: 0, face: 0, anim: 0, hard: false, tight: false, moving: false };
    this.hold = null;              // { line, s } while holding a line
    this.lastLine = -1;
    this.spool = { left: SPOOL_CELLS, line: null, used: false };
    this.felt = null;              // marker under the diver's hand
    this.lamp = { reach: dive.params.visibility, vis: 1 };
    this.goalTagged = false;
    this.entered = false;
    this.pen = 0;
    this.maxPen = { m: 0, t: 0, gas: C.P0 };
    this.atMax = { t: 0, gas: C.P0 };
    this.flags = {};
    this.blindNoLine = 0;
    this.zeroVisTime = 0;
    this.gasHard = 0; this.gasStress = 0;
    this.bumps = 0;
    this.log = [];
    this.toasts = [];
    this.puffs = [];
    this.bubbles = [];
    this.breath = 0;
    this.done = null;
    this.event('start', `Descended into the entrance pool with ${C.P0} bar. Turn pressure: ${Math.round(dive.budget.turn)} bar.`);
  }

  Game.prototype.idx = function (x, y) { return Math.floor(y) * this.d.W + Math.floor(x); };
  Game.prototype.isOpen = function (x, y) {
    if (x < 0 || y < 0 || x >= this.d.W || y >= this.d.H) return false;
    return this.d.open[this.idx(x, y)] === 1;
  };
  Game.prototype.siltAt = function (x, y) {
    const W = this.d.W, fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0, s = this.silt;
    const at = (cx, cy) => (cx < 0 || cy < 0 || cx >= W || cy >= this.d.H ? 0 : s[cy * W + cx]);
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
  Game.prototype.depth = function () { return this.diver.y * C.CELL_M; };
  Game.prototype.inExitZone = function () { return this.diver.x < C.BASIN_W - 6 && this.diver.y < 25; };
  Game.prototype.mapAllowed = function () {
    if (this.mapMode === 'full') return true;
    if (this.mapMode === 'entrance') return !this.entered || this.inExitZone();
    return false;
  };

  Game.prototype.event = function (type, text) {
    this.log.push({ t: this.t, type, text, pen: Math.round(this.pen), depth: Math.round(this.depth ? this.depth() : 0), gas: Math.round(this.gas) });
  };
  Game.prototype.toast = function (text, secs) { this.toasts.push({ text, until: this.t + (secs || 3.5) }); };

  // ------------------------------------------------------------------ lines
  Game.prototype.nearestLine = function (x, y, reach) {
    let best = null;
    this.lines.forEach((line, i) => {
      if (this.spool.line === line && !this.spool.used) return;   // can't hold a line you're still laying
      const n = Gen.nearestOnLine(line, x, y);
      if (n.d <= reach && (!best || n.d < best.d)) best = { line: i, s: n.s, d: n.d, x: n.x, y: n.y };
    });
    return best;
  };

  // Direction along the line near arc length s, smoothed over the corners.
  Game.prototype.lineTangent = function (line, s) {
    const a = Gen.linePoint(line, Math.max(0, s - 1.5)), b = Gen.linePoint(line, Math.min(line.total, s + 1.5));
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };

  // Pushing off the end of a line moves the hand onto another line tied in there.
  Game.prototype.transferAtEnd = function (line) {
    const d = this.diver;
    let best = null;
    this.lines.forEach((other, i) => {
      if (other === line || (this.spool.line === other && !this.spool.used)) return;
      const n = Gen.nearestOnLine(other, d.x, d.y);
      if (n.d <= REACH && (!best || n.d < best.d)) best = { line: i, s: n.s, d: n.d };
    });
    if (!best) return false;
    this.hold = { line: best.line, s: best.s };
    this.lastLine = best.line;
    const kind = this.lines[best.line].kind;
    this.event('switch', kind === 'branch' ? 'Moved across onto a branch line.' : kind === 'spool' ? 'Moved onto your spool line.' : 'Moved back onto the main line.');
    return true;
  };

  Game.prototype.toggleSpool = function () {
    const sp = this.spool;
    if (sp.line && !sp.used) {
      // Tie off right where the diver is, including the last stretch under a cell.
      const pts = sp.line.pts, last = pts[pts.length - 1], d = this.diver;
      const step = Math.hypot(d.x - last.x, d.y - last.y);
      if (step > 0.05) {
        pts.push({ x: d.x, y: d.y });
        sp.left -= step;
        const fresh = Gen.makeLine(pts, 'spool');
        sp.line.cum = fresh.cum; sp.line.total = fresh.total;
      }
      sp.used = true;
      this.event('spool_off', `Tied off the spool with ${Math.round((SPOOL_CELLS - sp.left) * C.CELL_M)} m laid.`);
      this.toast('Spool tied off. Its line can be followed back.');
      return;
    }
    if (sp.used) { this.toast('Your only spool is already laid.'); return; }
    const near = this.nearestLine(this.diver.x, this.diver.y, REACH);
    if (!near) { this.toast('Get within reach of a line to tie the spool in.'); return; }
    sp.line = Gen.makeLine([{ x: near.x, y: near.y }, { x: near.x + 0.01, y: near.y }], 'spool');
    this.lines.push(sp.line);
    this.event('spool_on', 'Tied a jump spool into the line and started laying it.');
    this.toast('Laying spool line. Press R again to tie it off.');
  };

  Game.prototype.laySpool = function () {
    const sp = this.spool, d = this.diver;
    if (!sp.line || sp.used) return;
    const pts = sp.line.pts, last = pts[pts.length - 1];
    const step = Math.hypot(d.x - last.x, d.y - last.y);
    if (step < 1) return;
    pts.push({ x: d.x, y: d.y });
    sp.left -= step;
    const fresh = Gen.makeLine(pts, 'spool');
    sp.line.cum = fresh.cum; sp.line.total = fresh.total;
    if (sp.left <= 0) {
      sp.used = true;
      this.event('spool_off', 'Ran the spool to its end (30 m).');
      this.toast('Spool empty: tied off.');
    }
  };

  // ------------------------------------------------------------------ update
  Game.prototype.update = function (dt, input) {
    if (this.done) return;
    this.t += dt;
    const d = this.diver, dive = this.d;
    const i = this.idx(d.x, d.y);
    d.tight = dive.tight[i] === 1;
    const localSilt = this.siltAt(d.x, d.y);
    const vis = 1 / (1 + 3 * localSilt);
    this.lamp.vis = vis;

    // Holding the line.
    if (input.hold) {
      if (!this.hold) {
        const near = this.nearestLine(d.x, d.y, REACH);
        if (near) {
          this.hold = { line: near.line, s: near.s };
          if (this.lastLine >= 0 && near.line !== this.lastLine) {
            const kind = this.lines[near.line].kind;
            this.event('switch', kind === 'branch' ? 'Crossed the gap onto a branch line.' : kind === 'spool' ? 'Moved onto your spool line.' : 'Crossed back onto the main line.');
          }
          if (this.flags.lostSince) {
            this.event('found', `Found the line again after ${Math.round(this.t - this.flags.lostSince)} s without it.`);
            this.flags.lostSince = 0;
          }
          this.lastLine = near.line;
        }
      }
    } else if (this.hold) {
      if (vis < 0.45) this.event('let_go', 'Let go of the line in very poor visibility.');
      this.hold = null;
    }

    let ix = input.x, iy = input.y;
    const il = Math.hypot(ix, iy);
    if (il > 1) { ix /= il; iy /= il; }
    const moving = il > 0.1;
    d.hard = input.hard && moving;
    let maxSpeed = (d.hard ? SPEED_HARD : SPEED_SWIM) * (d.tight ? C.TIGHT_SPEED : 1);

    if (this.hold) {
      // Hand on the line: move along it only. In silt the diver feels the way, slower.
      const line = this.lines[this.hold.line];
      const tan = this.lineTangent(line, this.hold.s);
      // Any key roughly along the line moves you along it at full speed.
      const dot = ix * tan.x + iy * tan.y;
      const along = Math.abs(dot) < 0.2 ? 0 : Math.sign(dot);
      const blind = C.BLIND_SPEED + (1 - C.BLIND_SPEED) * clamp((vis - 0.25) / 0.45, 0, 1);
      const ds = along * maxSpeed * blind * dt;
      const atEnd = (along < 0 && this.hold.s <= 0.01) || (along > 0 && this.hold.s >= line.total - 0.01);
      // After switching lines, start moving along the new one next frame.
      if (!(atEnd && this.transferAtEnd(line))) this.hold.s = clamp(this.hold.s + ds, 0, line.total);
      const p = Gen.linePoint(this.lines[this.hold.line], this.hold.s);
      const k = Math.min(1, 12 * dt);
      const nx = d.x + (p.x - d.x) * k, ny = d.y + (p.y - d.y) * k;
      d.vx = (nx - d.x) / dt; d.vy = (ny - d.y) / dt;
      d.x = nx; d.y = ny;
    } else {
      if (vis < 0.5) maxSpeed *= 0.4 + 1.2 * vis;   // groping in silt without a line
      d.vx += ix * ACCEL * dt; d.vy += iy * ACCEL * dt;
      const drag = Math.exp(-DRAG * dt);
      d.vx *= drag; d.vy *= drag;
      const sp = Math.hypot(d.vx, d.vy);
      if (sp > maxSpeed) { d.vx *= maxSpeed / sp; d.vy *= maxSpeed / sp; }
      this.move(dt);
    }
    const speed = Math.hypot(d.vx, d.vy);
    d.moving = speed > 0.4;
    if (speed > 0.3) {
      const target = Math.atan2(d.vy, d.vx);
      let diff = target - d.face;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      d.face += diff * Math.min(1, 7 * dt);
    }
    d.anim += dt * (0.8 + speed * 0.9);

    this.stir(dt, speed);
    this.laySpool();

    this.siltClock += dt;
    while (this.siltClock >= SILT_TICK) { this.siltClock -= SILT_TICK; this.stepSilt(); }
    this.updateLamp();
    this.breathe(dt, vis);
    this.updateEffects(dt);
    this.gasAndEvents(dt, vis, moving);
  };

  // Circle-vs-grid collision. Hitting rock at speed stirs a big cloud.
  Game.prototype.move = function (dt) {
    const d = this.diver, R = C.DIVER_R;
    const impact = Math.hypot(d.vx, d.vy);
    let hit = false;
    d.x += d.vx * dt; d.y += d.vy * dt;
    for (let iter = 0; iter < 3; iter++) {
      for (let cy = Math.floor(d.y - R) - 1; cy <= Math.floor(d.y + R) + 1; cy++) {
        for (let cx = Math.floor(d.x - R) - 1; cx <= Math.floor(d.x + R) + 1; cx++) {
          if (this.isOpen(cx + 0.5, cy + 0.5)) continue;
          const px = clamp(d.x, cx, cx + 1), py = clamp(d.y, cy, cy + 1);
          let nx = d.x - px, ny = d.y - py, dist = Math.hypot(nx, ny);
          if (dist >= R) continue;
          if (dist < 1e-6) { nx = 0; ny = -1; dist = 0; } else { nx /= dist; ny /= dist; }
          const push = R - dist;
          d.x += nx * push; d.y += ny * push;
          const vn = d.vx * nx + d.vy * ny;
          if (vn < 0) { d.vx -= vn * nx * 1.2; d.vy -= vn * ny * 1.2; }
          hit = true;
        }
      }
    }
    if (d.y < 1.2) { d.y = 1.2; if (d.vy < 0) d.vy = 0; }
    if (hit && impact > 2.2 && this.t - (this.flags.lastBump || -9) > 1.2) {
      this.flags.lastBump = this.t;
      this.bumps++;
      this.stirAround(d.x, d.y, 2.2, 0.9 * (impact / 4));
      this.toast('You hit the rock.', 1.5);
      if (this.bumps === 1 || this.bumps % 5 === 0) this.event('bump', `Hit the cave wall${this.bumps > 1 ? ` (${this.bumps} times so far)` : ''}.`);
    }
  };

  // Fins stir the silt beds near the floor and walls; hard kicks stir far more.
  Game.prototype.stir = function (dt, speed) {
    const d = this.diver;
    if (speed < 0.3) return;
    const fx = d.x - Math.cos(d.face) * 1.7, fy = d.y - Math.sin(d.face) * 1.7 + (d.hard ? 0.6 : 0.2);
    let power = d.hard ? 3.5 : 0.28;
    if (d.tight) power *= 4.5;   // in a squeeze, fins and body touch the floor
    if (this.hold && !d.hard) power *= 0.6;
    const added = this.stirAround(fx, fy, d.hard ? 2.8 : 1.9, power * (speed / SPEED_SWIM) * dt * 2.2);
    if (added > 0.02 && Math.random() < added * 8) {
      this.puffs.push({ x: fx + (Math.random() - 0.5), y: fy + (Math.random() - 0.3), t: 0, life: 1.8 + Math.random(), s: 0.8 + Math.random() * 0.8 });
    }
  };

  Game.prototype.stirAround = function (x, y, r, amount) {
    const W = this.d.W, dep = this.deposit, s = this.silt;
    let total = 0;
    for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        if (cx < 0 || cy < 0 || cx >= W || cy >= this.d.H) continue;
        const i = cy * W + cx;
        if (!this.d.open[i] || dep[i] <= 0) continue;
        const f = 1 - Math.hypot(cx + 0.5 - x, cy + 0.5 - y) / r;
        if (f <= 0) continue;
        const a = dep[i] * amount * f;
        s[i] = Math.min(4, s[i] + a);
        dep[i] = Math.max(0, dep[i] - a * 0.03);
        // Remember when a clear cell first got clouded, not every later kick.
        if (this.stirredAt[i] < 0 || s[i] - a < 0.05) this.stirredAt[i] = this.t;
        total += a;
      }
    }
    return total;
  };

  // Earliest time the diver stirred any cell nearby, if at least minAge seconds ago.
  Game.prototype.oldestStirNear = function (x, y, r, minAge) {
    let best = -1;
    for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        if (cx < 0 || cy < 0 || cx >= this.d.W || cy >= this.d.H) continue;
        const s = this.stirredAt[cy * this.d.W + cx];
        if (s >= 0 && this.t - s >= minAge && (best < 0 || s < best)) best = s;
      }
    }
    return best;
  };

  // Spread and settle the suspended silt.
  Game.prototype.stepSilt = function () {
    const W = this.d.W, H = this.d.H, open = this.d.open, s = this.silt, n = this.siltNext;
    const settle = Math.pow(0.5, SILT_TICK / SILT_HALF_LIFE), DIFF = 0.14;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const v = s[i];
        if (!open[i]) { n[i] = 0; continue; }
        const l = open[i - 1] ? s[i - 1] : v, r = open[i + 1] ? s[i + 1] : v;
        const u = open[i - W] ? s[i - W] : v, dn = open[i + W] ? s[i + W] : v;
        const nv = (v + DIFF * ((l + r + u + dn) * 0.25 - v)) * settle;
        n[i] = nv < 0.002 ? 0 : nv;
      }
    }
    this.silt = n; this.siltNext = s;
    this.siltDirty = true;
  };

  // How far the lamp reaches through the silt in front of the diver.
  Game.prototype.updateLamp = function () {
    const d = this.diver, max = this.d.params.visibility;
    const cx = Math.cos(d.face), cy = Math.sin(d.face);
    let tau = 0, reach = max;
    for (let r = 0.5; r <= max; r += 0.5) {
      tau += this.siltAt(d.x + cx * r, d.y + cy * r) * 0.5 * 0.9;
      if (tau > 2.4) { reach = r; break; }
    }
    this.lamp.reach = Math.max(1.2, reach);
  };

  // Exhaled bubbles rise, and where they hit the ceiling they knock a little silt loose.
  Game.prototype.breathe = function (dt, vis) {
    const d = this.diver;
    this.breath += dt * (d.hard ? 1.6 : 1) * (vis < ZERO_VIS ? 1.3 : 1);
    if (this.breath > 3.2) {
      this.breath = 0;
      const hx = d.x + Math.cos(d.face) * 1.3, hy = d.y + Math.sin(d.face) * 1.3 - 0.4;
      for (let k = 0; k < 6; k++) this.bubbles.push({ x: hx + (Math.random() - 0.5) * 0.4, y: hy, vy: -(2 + Math.random() * 2), r: 0.06 + Math.random() * 0.1, ph: Math.random() * 6 });
    }
  };

  Game.prototype.updateEffects = function (dt) {
    this.bubbles = this.bubbles.filter((b) => {
      b.y += b.vy * dt; b.ph += dt * 6;
      b.x += Math.sin(b.ph) * 0.4 * dt;
      if (!this.isOpen(b.x, b.y - 0.3)) {
        if (b.y > 2) this.stirAround(b.x, b.y - 0.2, 1.2, 0.02);
        return false;
      }
      return true;
    });
    this.puffs = this.puffs.filter((p) => (p.t += dt) < p.life);
    this.toasts = this.toasts.filter((t) => t.until > this.t);
  };

  // ------------------------------------------------------------------ gas and the run log
  Game.prototype.gasAndEvents = function (dt, vis, moving) {
    const d = this.diver, dive = this.d, B = dive.budget;
    const effort = d.hard ? 1.8 : moving ? 1 : 0.8;
    const stress = (d.tight ? C.TIGHT_STRESS : 1) * (vis < ZERO_VIS ? (this.hold ? C.BLIND_STRESS : 1.35) : 1);
    const rate = B.k * Gen.depthFactor(d.y) * effort * stress;
    const before = this.gas;
    this.gas = Math.max(0, this.gas - rate * dt);
    if (d.hard) this.gasHard += B.k * Gen.depthFactor(d.y) * 0.8 * stress * dt;
    this.gasStress += B.k * Gen.depthFactor(d.y) * effort * (stress - 1) * dt;

    const i = this.idx(d.x, d.y);
    const ed = dive.exitDist[i];
    if (isFinite(ed)) this.pen = ed * C.CELL_M;
    if (!this.entered && this.pen > 8) { this.entered = true; this.event('enter', 'Left the daylight of the entrance pool.'); }
    if (this.pen > this.maxPen.m) {
      if (this.flags.turned) { this.flags.turned = false; this.event('back_in', 'Headed further in again after turning.'); }
      this.maxPen = { m: this.pen, t: this.t, gas: this.gas };
    }
    // The turn is the last moment the diver was still at their furthest point.
    if (this.pen > this.maxPen.m - 1.5) this.atMax = { t: this.t, gas: this.gas };

    if (before > B.turn && this.gas <= B.turn) {
      this.flags.turnAt = { t: this.t, pen: this.pen };
      this.event('turn_pressure', `Reached turn pressure (${Math.round(B.turn)} bar) ${Math.round(this.pen)} m in.`);
      this.toast(`Turn pressure: ${Math.round(B.turn)} bar. Time to head out.`, 5);
    }
    if (before > B.reserve && this.gas <= B.reserve) {
      this.event('reserve', `Breathing into the reserve third, ${Math.round(this.pen)} m from the entrance.`);
      this.toast('You are into your reserve gas.', 4);
    }
    if (before > 25 && this.gas <= 25) this.toast('Gas critically low.', 4);

    // Turning around: a clear drop from the furthest point reached.
    if (!this.flags.turned && this.maxPen.m > 15 && this.pen < this.maxPen.m - 6) {
      this.flags.turned = true;
      const at = this.atMax, late = this.flags.turnAt && at.t > this.flags.turnAt.t + 2;
      this.event('turned', `Turned for the exit ${Math.round(this.maxPen.m)} m in, with ${Math.round(at.gas)} bar${late ? `, ${Math.round(at.t - this.flags.turnAt.t)} s after turn pressure` : ''}.`);
      const e = this.log[this.log.length - 1];
      e.t = at.t; e.late = late; e.after = late ? at.t - this.flags.turnAt.t : 0; e.gas = Math.round(at.gas); e.pen = Math.round(this.maxPen.m);
    }

    // Visibility episodes.
    if (vis < ZERO_VIS) {
      this.zeroVisTime += dt;
      if (!this.flags.zeroSince) {
        this.flags.zeroSince = this.t;
        const own = this.oldestStirNear(d.x, d.y, 2.5, 12);
        this.event('zero_vis', own >= 0 ? `Swam back into the silt you stirred up at ${fmt(own)}.` : 'Visibility dropped to almost nothing.');
        if (own >= 0) this.log[this.log.length - 1].own = own;
      }
    } else if (this.flags.zeroSince && vis > 0.45) {
      const dur = this.t - this.flags.zeroSince;
      if (dur > 3) this.event('clear', `Visibility came back after ${Math.round(dur)} s.`);
      this.flags.zeroSince = 0;
    }
    if (!this.hold && vis < 0.35) {
      this.blindNoLine += dt;
      if (!this.flags.lostSince && this.blindNoLine > 4) {
        this.flags.lostSince = this.t - 4;
        this.event('lost', 'Lost contact with any line in the silt.');
      }
    } else {
      this.blindNoLine = 0;
    }

    // Markers are read by touch.
    this.felt = null;
    if (this.hold) {
      for (const m of dive.markers) {
        if (this.lines[m.line] === this.lines[this.hold.line] && Math.abs(m.s - this.hold.s) < 1.6) { this.felt = m; break; }
      }
    }

    if (!this.goalTagged && Math.hypot(d.x - dive.goal.x, d.y - dive.goal.y) < 3.2) {
      this.goalTagged = true;
      this.event('goal', `Reached the end of the line and tagged it, ${Math.round(this.pen)} m in.`);
      this.toast('End of the line: tagged. Now get yourself home.', 5);
    }
    for (const l of this.leads) {
      if (!l.surveyed && l.reachable && Math.hypot(d.x - l.x, d.y - l.y) < 3.5) {
        l.surveyed = true;
        this.event('lead', `Surveyed an unexplored lead${l.extraBar ? ` (about ${Math.round(l.extraBar)} bar off the main line)` : ''}.`);
        this.toast('Surveyed an unexplored lead.', 3.5);
      }
    }

    if (this.gas <= 0) return this.finish('out_of_gas');
    if (this.entered && this.inExitZone()) return this.finish('exit');
  };

  Game.prototype.finish = function (outcome) {
    const surveyed = this.leads.filter((l) => l.surveyed).length;
    if (outcome === 'exit') this.event('exit', `Back in the entrance pool with ${Math.round(this.gas)} bar.`);
    else this.event('out_of_gas', `Ran out of gas ${Math.round(this.pen)} m from the entrance.`);
    const score = outcome === 'exit' ? (this.goalTagged ? 100 : 30) + surveyed * 25 + Math.round(this.gas / 4) : 0;
    this.done = { outcome, goal: this.goalTagged, surveyed, leads: this.leads.filter((l) => l.reachable).length, time: this.t, gas: this.gas, score };
  };

  Game.prototype.abort = function () {
    if (!this.done) {
      this.event('abort', 'Ended the dive from the menu.');
      this.done = { outcome: 'abort', goal: this.goalTagged, surveyed: 0, leads: this.leads.length, time: this.t, gas: this.gas, score: 0 };
    }
  };

  // ------------------------------------------------------------------ post-mortem
  // Hand-written templates, filled in from this run's log.
  Game.prototype.postMortem = function () {
    const res = this.done, B = this.d.budget, log = this.log;
    const find = (type) => log.find((e) => e.type === type);
    let headline;
    if (res.outcome === 'exit') headline = res.goal ? `Home safe with ${Math.round(res.gas)} bar, end of the line tagged.` : `Home safe with ${Math.round(res.gas)} bar. You turned back before the end of the line.`;
    else if (res.outcome === 'out_of_gas') headline = `You ran out of gas ${Math.round(this.pen)} m from the entrance.`;
    else headline = 'Dive ended early.';

    const notes = [];
    const tp = find('turn_pressure'), turned = log.filter((e) => e.type === 'turned').pop();
    if (turned && turned.late) notes.push(`You stayed in for ${Math.round(turned.after)} s after reaching turn pressure. Everything past that point came out of the gas meant for getting home.`);
    else if (!turned && tp && res.outcome === 'out_of_gas') notes.push(`You never turned for home. Turn pressure came at ${fmt(tp.t)}, ${tp.pen} m in.`);
    else if (turned && !tp && res.outcome === 'exit') notes.push('You turned before using a third of your gas: the rule of thirds kept a full reserve for the way out.');
    const own = log.find((e) => e.type === 'zero_vis' && e.own !== undefined);
    if (own) notes.push(`The silt you kicked up at ${fmt(own.own)} was still hanging there at ${fmt(own.t)}, when you came back through.`);
    const lost = find('lost');
    if (lost) notes.push(`At ${fmt(lost.t)} you were in the silt with no hand on any line. Without the line, the only reliable way out is gone.`);
    if (this.gasHard > 8) notes.push(`Hard kicking cost about ${Math.round(this.gasHard)} bar and stirred up far more silt than a gentle kick.`);
    if (this.gasStress > 6) notes.push(`Stress breathing in squeezes and zero visibility cost about ${Math.round(this.gasStress)} bar.`);
    if (this.bumps >= 3) notes.push(`You hit the rock ${this.bumps} times. Each hit puts a cloud of silt in the water.`);
    const leadsTaken = log.filter((e) => e.type === 'lead').length;
    if (leadsTaken && res.outcome === 'out_of_gas') notes.push('The side leads were tempting, but each one was paid for out of the gas meant for the way home.');
    if (res.outcome === 'out_of_gas' && !notes.length) notes.push(`The dive plan gave you ${Math.round(B.turn)} bar as a turn pressure. Turning there always leaves enough gas to get out, even following the line blind.`);
    if (res.outcome === 'exit' && !notes.length) notes.push('Clean dive: on the line, within your thirds, and out with gas to spare.');

    const keep = ['start', 'enter', 'turn_pressure', 'goal', 'lead', 'turned', 'back_in', 'zero_vis', 'lost', 'found', 'let_go', 'switch', 'spool_on', 'spool_off', 'reserve', 'bump', 'exit', 'out_of_gas', 'abort'];
    const timeline = log.filter((e) => keep.includes(e.type)).sort((a, b) => a.t - b.t)
      .map((e) => ({ t: fmt(e.t), text: e.text, type: e.type }));
    return { headline, notes, timeline, stats: { time: fmt(res.time), maxPen: Math.round(this.maxPen.m), zeroVis: Math.round(this.zeroVisTime), gas: Math.round(res.gas), score: res.score } };
  };

  const api = { Game, fmt, SPOOL_CELLS, ZERO_VIS, REACH };
  root.CaveGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
