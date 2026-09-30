// One dive: diver movement, laying and following the line, silt, gas, and the run log.
(function (root) {
  'use strict';
  const R = root.CaveRNG || require('./rng.js');
  const Gen = root.CaveGen || require('./gen.js');
  const C = Gen.C;

  // The simulation always steps at 60 Hz and uses only arithmetic that every
  // JS engine rounds the same way (no Math.random, trig, exp or hypot), so a
  // dive replayed from its inputs on the server ends exactly as it did here.
  const STEP = 1 / 60;
  const DRAG_STEP = 0.951229424500714;      // exp(-DRAG * STEP)
  const SETTLE = 0.9990762306970642;        // 0.5 ** (SILT_TICK / SILT_HALF_LIFE)
  const MAX_TICKS = 60 * 60 * 40;           // 40 minutes
  const hyp = (x, y) => Math.sqrt(x * x + y * y);

  const SPEED_SWIM = C.SWIM_SPEED, SPEED_HARD = 6.5;   // cells/s
  const ACCEL = 16;
  const REACH = 1.4;           // how close a line must be to grab or tie into it, cells
  const TIE_ROCK = 2.2;        // clearance at or below this is close enough to rock to tie off
  const SILT_TICK = 0.1;       // silt field update interval, s
  const ZERO_VIS = 0.28;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  // Level 0: learn to lay a line in and follow it out.
  const TUTORIAL = [
    { text: 'Swim down to the amber tie-off post in the pool and press R to tie your reel in.',
      done: (g) => g.reel.active !== null && g.lines[g.reel.active].anchored },
    { text: 'Swim into the cave. The reel pays out line behind you. If you back up, it reels the line back in.',
      done: (g) => g.laidMetres() >= 12 },
    { text: 'Follow the passage to the chamber at the end.',
      done: (g) => g.goalTagged },
    { text: 'Press R to tie your line off here, so it stays in place.',
      done: (g) => g.reel.active === null && g.lines.some((l) => l.fixed && l.anchored) },
    { text: 'Silt-out! You can’t see a thing. Hold Space to take hold of your line and follow it back to the pool.',
      enter: (g) => g.siltOut() },
  ];

  function Game(dive, mapMode) {
    this.d = dive;
    this.mapMode = mapMode;
    const N = dive.W * dive.H;
    this.silt = new Float32Array(N);
    this.siltNext = new Float32Array(N);
    this.siltBox = null;           // bounds of the cells holding silt, in this.silt
    this.staleBox = null;          // the same for this.siltNext (last step's field)
    this.stirredAt = new Float32Array(N).fill(-1);
    this.deposit = dive.deposit.slice();
    this.lines = [];               // every line the diver has laid
    this.reel = { left: dive.reel, active: null };
    this.t = 0;
    this.siltClock = 0;
    this.gas = C.P0;
    this.diver = { x: dive.start.x, y: dive.start.y, vx: 0, vy: 0, fx: 1, fy: 0, anim: 0, hard: false, tight: false, moving: false };
    this.fxRng = new R.RNG(`${dive.seed}|${dive.level}|fx`);   // bubbles and puffs, seeded so replays match
    this.tick = 0;
    this.inputs = [];              // [tick, mask] at every change of input
    this.lastMask = -1;
    this.heldTicks = 0;
    this.siltOuts = 0;
    this.hold = null;              // { line, s } while holding a line
    this.lastLine = -1;
    this.felt = null;              // which way the held line runs back
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
    this.deadEndsSeen = new Set();
    this.log = [];
    this.toasts = [];
    this.puffs = [];
    this.bubbles = [];
    this.breath = 0;
    this.done = null;
    this.tutorial = dive.tutorial ? { step: 0, steps: TUTORIAL } : null;
    this.event('start', `Descended into the entrance pool with ${C.P0} bar and ${Math.round(dive.reel * C.CELL_M)} m of line on the reel. Turn pressure: ${Math.round(dive.budget.turn)} bar.`);
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
  Game.prototype.laidMetres = function () {
    return this.lines.reduce((s, l) => s + l.total, 0) * C.CELL_M;
  };

  // A line leads out if it was tied in at the pool, or tied into a line that does.
  Game.prototype.connected = function (i, depth) {
    const line = this.lines[i];
    if (!line || (depth || 0) > this.lines.length) return false;
    return line.anchored || (line.parent >= 0 && this.connected(line.parent, (depth || 0) + 1));
  };

  Game.prototype.nearestLine = function (x, y, reach, skip) {
    let best = null;
    this.lines.forEach((line, i) => {
      if (i === skip || line.total < 0.05) return;
      const n = Gen.nearestOnLine(line, x, y);
      if (n.d <= reach && (!best || n.d < best.d)) best = { line: i, s: n.s, d: n.d, x: n.x, y: n.y };
    });
    return best;
  };

  // Direction along the line near arc length s, smoothed over the corners.
  Game.prototype.lineTangent = function (line, s) {
    const a = Gen.linePoint(line, Math.max(0, s - 1.5)), b = Gen.linePoint(line, Math.min(line.total, s + 1.5));
    const dx = b.x - a.x, dy = b.y - a.y, l = hyp(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };

  Game.prototype.refresh = function (line) {
    const fresh = Gen.makeLine(line.pts, line.kind);
    line.cum = fresh.cum; line.total = fresh.total;
  };

  // R: tie the reel in (at the pool's post, into a line, or to rock), or tie it off.
  Game.prototype.toggleReel = function () {
    const d = this.diver;
    if (this.reel.active !== null) return this.tieOff('Tied off your line.');
    if (this.reel.left < 1) { this.toast('Your reel is empty.'); return; }
    const a = this.d.anchor;
    const near = this.nearestLine(d.x, d.y, REACH);
    let start, parent = -1, anchored = false, how;
    if (hyp(d.x - a.x, d.y - a.y) < 2.5) { start = { x: a.x, y: a.y }; anchored = true; how = 'at the tie-off post in the pool'; }
    else if (near) { start = { x: near.x, y: near.y }; parent = near.line; how = 'into an existing line'; }
    else if ((this.d.clear[this.idx(d.x, d.y)] || 0) <= TIE_ROCK) { start = { x: d.x, y: d.y }; how = 'to the rock'; }
    else { this.toast('Nothing to tie to here. Get close to the rock, a line, or the post in the pool.'); return; }
    const line = Gen.makeLine([start, { x: start.x + 0.01, y: start.y }], 'reel');
    line.fixed = false; line.anchored = anchored; line.parent = parent;
    this.lines.push(line);
    this.reel.active = this.lines.length - 1;
    const leads = this.connected(this.reel.active);
    this.event('tie_in', `Tied the reel in ${how}${leads ? '' : ', not connected to the entrance'}.`);
    this.toast(leads ? 'Reel tied in. Line pays out as you swim; R again to tie off.' : 'Reel tied in, but this line does not lead back to the entrance.', 4);
  };

  Game.prototype.tieOff = function (msg) {
    const line = this.lines[this.reel.active], d = this.diver;
    const last = line.pts[line.pts.length - 1], step = hyp(d.x - last.x, d.y - last.y);
    if (step > 0.05 && this.hold === null) {
      line.pts.push({ x: d.x, y: d.y });
      this.reel.left -= step;
      this.refresh(line);
    }
    line.fixed = true;
    this.reel.active = null;
    this.event('tie_off', `${msg} ${Math.round(line.total * C.CELL_M)} m of line in place, ${Math.max(0, Math.round(this.reel.left * C.CELL_M))} m left on the reel.`);
    this.toast(msg, 3);
  };

  // Reel line back in to arc length s.
  Game.prototype.truncate = function (line, s) {
    if (s >= line.total - 0.02) return;
    const p = Gen.linePoint(line, s);
    let i = line.pts.length - 1;
    while (i > 0 && line.cum[i - 1] >= s) i--;
    const back = line.total - s;
    line.pts.length = i;
    line.pts.push({ x: p.x, y: p.y });
    if (line.pts.length < 2) line.pts.push({ x: p.x + 0.01, y: p.y });
    this.reel.left += back;
    this.refresh(line);
  };

  // While the reel is open and the diver swims free: pay out ahead, reel in on the way back.
  Game.prototype.payOut = function () {
    const line = this.lines[this.reel.active], pts = line.pts, d = this.diver;
    let changed = false;
    // Coming back over the line (not necessarily exactly on it) winds it back in
    // to that point. The last stretch needs a closer pass, or laying would undo itself.
    const n = pts.length;
    let cut = -1;
    for (let i = Math.max(1, n - 80); i <= n - 2 && cut < 0; i++) {
      if (hyp(d.x - pts[i].x, d.y - pts[i].y) < (i === n - 2 ? 0.9 : 1.3)) cut = i;
    }
    if (cut >= 0) {
      this.reel.left += line.total - line.cum[cut];
      pts.length = cut + 1;
      changed = true;
    }
    const last = pts[pts.length - 1], step = hyp(d.x - last.x, d.y - last.y);
    if (step >= 1) {
      pts.push({ x: d.x, y: d.y });
      this.reel.left -= step;
      changed = true;
    }
    if (changed) this.refresh(line);
    if (this.reel.left <= 0) {
      this.reel.left = 0;
      this.event('reel_empty', 'Ran the reel to its end.');
      this.tieOff('Reel empty: line tied off.');
    }
  };

  // Pushing off the end of a fixed line moves the hand onto another line tied in there.
  Game.prototype.transferAtEnd = function (line) {
    const d = this.diver, from = this.hold.line;
    const near = this.nearestLine(d.x, d.y, REACH, from);
    if (!near) return false;
    this.hold = { line: near.line, s: near.s };
    this.lastLine = near.line;
    this.event('switch', 'Moved your hand across onto another line.');
    return true;
  };

  // Tutorial: the whole cave silts out at once.
  Game.prototype.siltOut = function () {
    const d = this.d;
    for (let i = 0; i < this.silt.length; i++) {
      if (d.open[i] && d.exitDist[i] > 6) { this.silt[i] = 3; this.stirredAt[i] = this.t; }
    }
    this.siltBox = { x0: 0, y0: 0, x1: d.W - 1, y1: d.H - 1 };
    this.siltDirty = true;
  };

  // ------------------------------------------------------------------ update
  Game.prototype.update = function (dt, raw) {
    if (this.done) return;
    dt = STEP;
    const input = this.record(raw);
    if (input.reel) this.toggleReel();
    this.t += dt;
    const d = this.diver, dive = this.d;
    const i = this.idx(d.x, d.y);
    d.tight = dive.tight[i] === 1;
    const localSilt = this.siltAt(d.x, d.y);
    const vis = 1 / (1 + 3 * localSilt);
    this.lamp.vis = vis;

    // Holding a line.
    if (input.hold) {
      if (!this.hold) {
        const near = this.nearestLine(d.x, d.y, REACH);
        if (near) {
          this.hold = { line: near.line, s: near.s };
          if (this.flags.lostSince) {
            this.event('found', `Found a line again after ${Math.round(this.t - this.flags.lostSince)} s without one.`);
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
    const il = hyp(ix, iy);
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
      const laying = this.hold.line === this.reel.active;
      const atEnd = !laying && ((along < 0 && this.hold.s <= 0.01) || (along > 0 && this.hold.s >= line.total - 0.01));
      // After switching lines, start moving along the new one next frame.
      if (!(atEnd && this.transferAtEnd(line))) {
        this.hold.s = clamp(this.hold.s + ds, 0, line.total);
        // Following the line you are laying back toward its start reels it in.
        if (laying) this.truncate(line, this.hold.s);
      }
      const p = Gen.linePoint(this.lines[this.hold.line], this.hold.s);
      const k = Math.min(1, 12 * dt);
      const nx = d.x + (p.x - d.x) * k, ny = d.y + (p.y - d.y) * k;
      d.vx = (nx - d.x) / dt; d.vy = (ny - d.y) / dt;
      d.x = nx; d.y = ny;
    } else {
      if (vis < 0.5) maxSpeed *= 0.4 + 1.2 * vis;   // groping in silt without a line
      d.vx += ix * ACCEL * dt; d.vy += iy * ACCEL * dt;
      d.vx *= DRAG_STEP; d.vy *= DRAG_STEP;
      const sp = hyp(d.vx, d.vy);
      if (sp > maxSpeed) { d.vx *= maxSpeed / sp; d.vy *= maxSpeed / sp; }
      this.move(dt);
      if (this.reel.active !== null) this.payOut();
    }
    const speed = hyp(d.vx, d.vy);
    d.moving = speed > 0.4;
    if (speed > 0.3) {
      // Turn toward the direction of travel, kept as a unit vector (no trig).
      const k = Math.min(1, 7 * dt);
      let fx = d.fx + (d.vx / speed - d.fx) * k, fy = d.fy + (d.vy / speed - d.fy) * k;
      const fl = hyp(fx, fy);
      if (fl < 1e-6) { fx = d.vx / speed; fy = d.vy / speed; } else { fx /= fl; fy /= fl; }
      d.fx = fx; d.fy = fy;
    }
    d.anim += dt * (0.8 + speed * 0.9);

    this.stir(dt, speed);

    this.siltClock += dt;
    while (this.siltClock >= SILT_TICK) { this.siltClock -= SILT_TICK; this.stepSilt(); }
    this.updateLamp();
    this.breathe(dt, vis);
    this.updateEffects(dt);
    this.gasAndEvents(dt, vis, moving);
    if (this.hold) this.heldTicks++;
    this.tick++;
  };

  // Keyboard-style input: 8 directions, hard kick, hold, and the reel key.
  // Each change is kept as [tick, mask]; that list and the seed are all the
  // server needs to replay a dive.
  const quant = (v) => (v > 0.38 ? 1 : v < -0.38 ? -1 : 0);
  function encode(inp) {
    const x = quant(inp.x || 0), y = quant(inp.y || 0);
    return (x < 0 ? 1 : 0) | (x > 0 ? 2 : 0) | (y < 0 ? 4 : 0) | (y > 0 ? 8 : 0) |
      (inp.hard ? 16 : 0) | (inp.hold ? 32 : 0) | (inp.reel ? 64 : 0);
  }
  function decode(m) {
    return { x: (m & 2 ? 1 : 0) - (m & 1 ? 1 : 0), y: (m & 8 ? 1 : 0) - (m & 4 ? 1 : 0), hard: !!(m & 16), hold: !!(m & 32), reel: !!(m & 64) };
  }
  Game.prototype.record = function (input) {
    const mask = encode(input || {});
    if (mask !== this.lastMask) { this.inputs.push([this.tick, mask]); this.lastMask = mask; }
    return decode(mask);
  };

  // Circle-vs-grid collision. Hitting rock at speed stirs a big cloud.
  Game.prototype.move = function (dt) {
    const d = this.diver, R = C.DIVER_R;
    const impact = hyp(d.vx, d.vy);
    let hit = false;
    d.x += d.vx * dt; d.y += d.vy * dt;
    for (let iter = 0; iter < 3; iter++) {
      for (let cy = Math.floor(d.y - R) - 1; cy <= Math.floor(d.y + R) + 1; cy++) {
        for (let cx = Math.floor(d.x - R) - 1; cx <= Math.floor(d.x + R) + 1; cx++) {
          if (this.isOpen(cx + 0.5, cy + 0.5)) continue;
          const px = clamp(d.x, cx, cx + 1), py = clamp(d.y, cy, cy + 1);
          let nx = d.x - px, ny = d.y - py, dist = hyp(nx, ny);
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
    const fx = d.x - d.fx * 1.7, fy = d.y - d.fy * 1.7 + (d.hard ? 0.6 : 0.2);
    let power = d.hard ? 3.5 : 0.28;
    if (d.tight) power *= 4.5;   // in a squeeze, fins and body touch the floor
    if (this.hold && !d.hard) power *= 0.6;
    const added = this.stirAround(fx, fy, d.hard ? 2.8 : 1.9, power * (speed / SPEED_SWIM) * dt * 2.2);
    const rnd = this.fxRng;
    if (added > 0.02 && rnd.float() < added * 8) {
      this.puffs.push({ x: fx + (rnd.float() - 0.5), y: fy + (rnd.float() - 0.3), t: 0, life: 1.8 + rnd.float(), s: 0.8 + rnd.float() * 0.8 });
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
        const f = 1 - hyp(cx + 0.5 - x, cy + 0.5 - y) / r;
        if (f <= 0) continue;
        const a = dep[i] * amount * f;
        s[i] = Math.min(4, s[i] + a);
        this.markSilt(cx, cy);
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

  Game.prototype.markSilt = function (x, y) {
    const b = this.siltBox;
    if (!b) this.siltBox = { x0: x, y0: y, x1: x, y1: y };
    else {
      if (x < b.x0) b.x0 = x; else if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y; else if (y > b.y1) b.y1 = y;
    }
  };
  // Fill the whole cave with silt (the autopilot's worst case).
  Game.prototype.fillSilt = function (v) {
    this.silt.fill(v);
    this.siltBox = { x0: 0, y0: 0, x1: this.d.W - 1, y1: this.d.H - 1 };
  };

  // Spread and settle the suspended silt. Only the cells that hold silt, their
  // neighbours, and whatever last step's buffer still holds need updating;
  // everywhere else the result is zero either way.
  Game.prototype.stepSilt = function () {
    const W = this.d.W, H = this.d.H, open = this.d.open, s = this.silt, n = this.siltNext;
    const a = this.siltBox, b = this.staleBox;
    if (!a && !b) return;
    const x0 = Math.max(1, Math.min(a ? a.x0 - 1 : W, b ? b.x0 : W)), x1 = Math.min(W - 2, Math.max(a ? a.x1 + 1 : -1, b ? b.x1 : -1));
    const y0 = Math.max(1, Math.min(a ? a.y0 - 1 : H, b ? b.y0 : H)), y1 = Math.min(H - 2, Math.max(a ? a.y1 + 1 : -1, b ? b.y1 : -1));
    const settle = SETTLE, DIFF = 0.14;
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const v = s[i];
        if (!open[i]) { n[i] = 0; continue; }
        const l = open[i - 1] ? s[i - 1] : v, r = open[i + 1] ? s[i + 1] : v;
        const u = open[i - W] ? s[i - W] : v, dn = open[i + W] ? s[i + W] : v;
        const nv = (v + DIFF * ((l + r + u + dn) * 0.25 - v)) * settle;
        if (nv < 0.002) n[i] = 0;
        else {
          n[i] = nv;
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
          if (y < by0) by0 = y; if (y > by1) by1 = y;
        }
      }
    }
    this.silt = n; this.siltNext = s;
    // The old buffer still holds this step's input, up to its bounds; the
    // next step writes into it, so it must cover that region too.
    this.staleBox = a;
    this.siltBox = bx1 >= 0 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : null;
    this.siltDirty = true;
  };

  // How far the lamp reaches through the silt in front of the diver.
  Game.prototype.updateLamp = function () {
    const d = this.diver, max = this.d.params.visibility;
    const cx = d.fx, cy = d.fy;
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
      const hx = d.x + d.fx * 1.3, hy = d.y + d.fy * 1.3 - 0.4, rnd = this.fxRng;
      for (let k = 0; k < 6; k++) this.bubbles.push({ x: hx + (rnd.float() - 0.5) * 0.4, y: hy, vy: -(2 + rnd.float() * 2), r: 0.06 + rnd.float() * 0.1, ph: rnd.float() * 6 });
    }
  };

  Game.prototype.updateEffects = function (dt) {
    this.bubbles = this.bubbles.filter((b) => {
      b.y += b.vy * dt; b.ph += dt * 6;
      b.x += R.sin(b.ph) * 0.4 * dt;
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
    if (!this.entered && this.pen > 8) {
      this.entered = true;
      this.event('enter', this.reel.active !== null && this.connected(this.reel.active) ? 'Left the daylight of the pool, laying line.' : 'Left the daylight of the pool without a line tied in.');
    }
    if (this.pen > this.maxPen.m) {
      if (this.flags.turned) { this.flags.turned = false; this.event('back_in', 'Headed further in again after turning.'); }
      this.maxPen = { m: this.pen, t: this.t, gas: this.gas };
    }
    // The turn is the last moment the diver was still at their furthest point.
    if (this.pen > this.maxPen.m - 1.5) this.atMax = { t: this.t, gas: this.gas, x: d.x, y: d.y };

    if (before > B.turn && this.gas <= B.turn) {
      this.flags.turnAt = { t: this.t, pen: this.pen };
      this.event('turn_pressure', `Reached turn pressure (${Math.round(B.turn)} bar) ${Math.round(this.pen)} m in.`);
      this.toast(`Turn pressure: ${Math.round(B.turn)} bar. Time to follow your line out.`, 5);
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
      e.x = at.x; e.y = at.y;
    }

    // Dead ends.
    for (let k = 0; k < dive.deadEnds.length; k++) {
      const de = dive.deadEnds[k];
      if (!this.deadEndsSeen.has(k) && hyp(d.x - de.x, d.y - de.y) < de.r + 1.5) {
        this.deadEndsSeen.add(k);
        this.event('dead_end', `Reached a dead end ${Math.round(this.pen)} m in.`);
        this.toast('Dead end.', 2.5);
      }
    }

    // Visibility episodes.
    if (vis < ZERO_VIS) {
      this.zeroVisTime += dt;
      if (!this.flags.zeroSince) {
        this.flags.zeroSince = this.t;
        const own = this.tutorial ? -1 : this.oldestStirNear(d.x, d.y, 2.5, 12);
        this.siltOuts++;
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

    // Swimming away from every line, with no reel running.
    const laying = this.reel.active !== null;
    const near = laying || this.hold ? null : this.nearestLine(d.x, d.y, 4);
    if (!laying && !this.hold && !near && this.pen > 10) {
      if (!this.flags.offLineSince) {
        this.flags.offLineSince = this.t;
        this.event('no_line', this.lines.length ? `Swam away from your line, ${Math.round(this.pen)} m in.` : `Swimming into the cave with no line at all, ${Math.round(this.pen)} m in.`);
      }
    } else if (this.flags.offLineSince && (laying || this.hold || this.nearestLine(d.x, d.y, 2))) {
      this.flags.offLineSince = 0;
    }

    // Which way the line under the hand runs back.
    this.felt = null;
    if (this.hold) {
      const p = Gen.linePoint(this.lines[this.hold.line], this.hold.s);
      this.felt = { x: p.x, y: p.y, ex: p.ex, ey: p.ey, out: this.connected(this.hold.line) };
    }

    if (!this.goalTagged && hyp(d.x - dive.goal.x, d.y - dive.goal.y) < 3.2) {
      this.goalTagged = true;
      this.event('goal', `Reached the end chamber and tagged it, ${Math.round(this.pen)} m in.`);
      this.toast(this.tutorial ? 'You made it to the end chamber.' : 'End chamber: tagged. Now follow your line home.', 5);
    }

    // Tutorial steps.
    const tu = this.tutorial;
    if (tu && tu.step < tu.steps.length - 1 && tu.steps[tu.step].done(this)) {
      tu.step++;
      const next = tu.steps[tu.step];
      if (next.enter) next.enter(this);
      this.event('tutorial', `Tutorial step ${tu.step + 1}: ${next.text}`);
    }

    if (this.gas <= 0) return this.finish('out_of_gas');
    if (this.entered && this.inExitZone()) {
      if (tu && tu.step < tu.steps.length - 1) {
        if (this.t - (this.flags.tutorialNag || -9) > 4) { this.flags.tutorialNag = this.t; this.toast('Finish the tutorial steps first: head back into the cave.'); }
      } else {
        return this.finish('exit');
      }
    }
  };

  Game.prototype.finish = function (outcome) {
    if (outcome === 'exit') this.event('exit', `Back in the entrance pool with ${Math.round(this.gas)} bar.`);
    else this.event('out_of_gas', `Ran out of gas ${Math.round(this.pen)} m from the entrance.`);
    const score = outcome === 'exit' ? (this.goalTagged ? 100 : 30) + Math.round(this.gas / 4) : 0;
    this.done = { outcome, goal: this.goalTagged, time: this.t, gas: this.gas, score, tutorial: !!this.tutorial, deadEnds: this.deadEndsSeen.size };
  };

  Game.prototype.abort = function () {
    if (!this.done) {
      this.event('abort', 'Ended the dive from the menu.');
      this.done = { outcome: 'abort', goal: this.goalTagged, time: this.t, gas: this.gas, score: 0, tutorial: !!this.tutorial, deadEnds: this.deadEndsSeen.size };
    }
  };

  // ------------------------------------------------------------------ post-mortem
  // Hand-written templates, filled in from this run's log.
  Game.prototype.postMortem = function () {
    const res = this.done, B = this.d.budget, log = this.log;
    const find = (type) => log.find((e) => e.type === type);
    let headline;
    if (res.tutorial && res.outcome === 'exit') headline = 'You laid a line in, tied it off, and followed it out blind.';
    else if (res.outcome === 'exit') headline = res.goal ? `Home safe with ${Math.round(res.gas)} bar, end chamber tagged.` : `Home safe with ${Math.round(res.gas)} bar. You turned back before finding the end chamber.`;
    else if (res.outcome === 'out_of_gas') headline = `You ran out of gas ${Math.round(this.pen)} m from the entrance.`;
    else headline = 'Dive ended early.';

    const notes = [];
    const tp = find('turn_pressure'), turned = log.filter((e) => e.type === 'turned').pop();
    if (turned && turned.late) notes.push(`You stayed in for ${Math.round(turned.after)} s after reaching turn pressure. Everything past that point came out of the gas meant for getting home.`);
    else if (!turned && tp && res.outcome === 'out_of_gas') notes.push(`You never turned for home. Turn pressure came at ${fmt(tp.t)}, ${tp.pen} m in.`);
    else if (turned && !tp && res.outcome === 'exit' && !res.tutorial) notes.push('You turned before using a third of your gas: the rule of thirds kept a full reserve for the way out.');
    const firstTie = find('tie_in');
    if (!firstTie && this.entered) notes.push('You never tied a line in. In a maze, the line you lay is the only sure way back.');
    else if (firstTie && !this.lines.some((l) => l.anchored)) notes.push('None of your lines was tied in at the pool, so none of them could lead you all the way out.');
    const offLine = find('no_line');
    if (offLine && res.outcome === 'out_of_gas') notes.push(`At ${fmt(offLine.t)} you swam away from your line. From there on you were finding the way out from memory.`);
    const own = log.find((e) => e.type === 'zero_vis' && e.own !== undefined);
    if (own) notes.push(`The silt you kicked up at ${fmt(own.own)} was still hanging there at ${fmt(own.t)}, when you came back through.`);
    const lost = find('lost');
    if (lost && !res.tutorial) notes.push(`At ${fmt(lost.t)} you were in the silt with no hand on any line.`);
    if (res.deadEnds >= 2) notes.push(`You swam into ${res.deadEnds} dead ends. Each wrong turn is paid for twice, in and back out.`);
    if (this.gasHard > 8) notes.push(`Hard kicking cost about ${Math.round(this.gasHard)} bar and stirred up far more silt than a gentle kick.`);
    if (this.gasStress > 6) notes.push(`Stress breathing in squeezes and zero visibility cost about ${Math.round(this.gasStress)} bar.`);
    if (this.bumps >= 3) notes.push(`You hit the rock ${this.bumps} times. Each hit puts a cloud of silt in the water.`);
    if (res.outcome === 'out_of_gas' && !notes.length) notes.push(`Turning at ${Math.round(B.turn)} bar with a line back to the pool always leaves enough gas to follow it out, even blind.`);
    if (res.outcome === 'exit' && !notes.length && !res.tutorial) notes.push('Clean dive: a line all the way from the pool, within your thirds, and out with gas to spare.');

    const keep = ['start', 'tie_in', 'enter', 'dead_end', 'turn_pressure', 'goal', 'tie_off', 'reel_empty', 'turned', 'back_in', 'no_line', 'zero_vis', 'lost', 'found', 'let_go', 'switch', 'reserve', 'bump', 'exit', 'out_of_gas', 'abort'];
    const timeline = log.filter((e) => keep.includes(e.type)).sort((a, b) => a.t - b.t)
      .map((e) => ({ t: fmt(e.t), text: e.text, type: e.type }));
    return { headline, notes, timeline, stats: { time: fmt(res.time), maxPen: Math.round(this.maxPen.m), zeroVis: Math.round(this.zeroVisTime), gas: Math.round(res.gas), score: res.score, laid: Math.round(this.laidMetres()) } };
  };

  // Re-run a dive from its maze and recorded inputs (the leaderboard Worker does this).
  Game.validInputs = function (inputs) {
    if (!Array.isArray(inputs) || inputs.length > 50000) return false;
    let last = -1;
    for (const e of inputs) {
      if (!Array.isArray(e) || e.length !== 2) return false;
      const [t, m] = e;
      if (!Number.isInteger(t) || !Number.isInteger(m) || t <= last || t > MAX_TICKS || m < 0 || m > 127) return false;
      last = t;
    }
    return true;
  };
  Game.replay = function (dive, inputs, mapMode) {
    const g = new Game(dive, mapMode || 'none');
    let k = 0, mask = 0;
    while (!g.done && g.tick < MAX_TICKS) {
      while (k < inputs.length && inputs[k][0] <= g.tick) mask = inputs[k++][1];
      g.update(STEP, decode(mask));
    }
    return g;
  };

  const api = { Game, fmt, ZERO_VIS, REACH, TUTORIAL, STEP, MAX_TICKS, encode, decode };
  root.CaveGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
