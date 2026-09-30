// Cave generator: seed + level -> a checked, playable maze dive.
//
// Pipeline: maze graph -> carve passages into a grid -> clearance map ->
// silt beds and props -> fairness check, gas budget and reel length. There is
// no pre-laid guideline: the diver lays their own. A dive that fails the check
// is regenerated from a derived seed. Level 0 is the tutorial cave.
(function (root) {
  'use strict';
  const { RNG, valueNoise } = root.CaveRNG || require('./rng.js');

  const C = {
    CELL_M: 0.5,        // metres per grid cell
    H: 120,             // grid height in cells (60 m)
    BASIN_W: 26,        // open-water entrance pool on the left
    DIVER_R: 0.75,      // diver collision radius, cells
    SQUEEZE_R: 1.6,     // carve radius at the narrowest point of a squeeze
    TIGHT: 2.1,         // passage no more than 4 cells (2 m) across: a squeeze
    SWIM_SPEED: 4,      // cells/s with a normal kick
    TIGHT_SPEED: 0.5,   // speed multiplier in tight spots
    BLIND_SPEED: 0.6,   // speed multiplier following the line by touch
    TIGHT_STRESS: 1.2,  // breathing multiplier in a squeeze
    BLIND_STRESS: 1.1,  // breathing multiplier in zero visibility with a hand on the line
    P0: 200,            // starting gas, bar
    MAX_ATTEMPTS: 30,
  };
  // ROUTE: passages on the shortest way to the goal; SIDE: everything else (dead ends, loops).
  const TAG = { ROCK: 0, ROUTE: 1, BASIN: 2, SIDE: 4 };

  function params(level) {
    const L = Math.max(0, level | 0);
    if (L === 0) {
      // Tutorial: one short passage to a chamber, generous gas and reel.
      return { level: 0, tutorial: true, cols: 3, rows: 1, loops: 0, squeezes: 0, chamberChance: 0,
        gasMargin: 3, reelSlack: 2.5, siltiness: 0.7, visibility: 16 };
    }
    return {
      level: L,
      tutorial: false,
      cols: Math.min(4 + L, 12),                  // maze size grows with level
      rows: Math.min(2 + Math.ceil(L / 3), 5),
      loops: Math.floor(L / 2),                   // extra connections: more than one way through
      squeezes: Math.min(Math.floor(L * 0.7), 7),
      chamberChance: 0.22,
      gasMargin: Math.max(1.5, 2.5 - L * 0.11),   // room for wrong turns, shrinking with level
      reelSlack: Math.max(1.5, 2.2 - L * 0.08),   // reel length / shortest route
      siltiness: Math.min(0.55 + L * 0.1, 1.4),
      visibility: Math.max(10, 16 - L * 0.7),
    };
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const smooth = (t) => t * t * (3 - 2 * t);
  function bump(t, a, b, ramp) {
    if (t < a - ramp || t > b + ramp) return 0;
    if (t < a) return smooth((t - (a - ramp)) / ramp);
    if (t > b) return smooth(((b + ramp) - t) / ramp);
    return 1;
  }
  // ---------------------------------------------------------------- maze
  // Passages join a jittered grid of junctions. A growing-tree walk makes a
  // spanning tree (long winding corridors with dead ends off them), a few
  // extra edges add loops, and the goal is the junction farthest from the
  // entrance along the maze.
  function buildMaze(rng, P) {
    const nodes = [], edges = [];
    const node = (x, y, r, kind) => (nodes.push({ id: nodes.length, x, y, r, kind, deg: 0 }), nodes.length - 1);
    const edge = (a, b) => {
      edges.push({ id: edges.length, a, b, re: rng.range(2.5, 3.4), squeeze: false });
      nodes[a].deg++; nodes[b].deg++;
    };
    const sx = rng.range(18, 22), sy = rng.range(17, 21);
    const x0 = C.BASIN_W + 12, y0 = P.tutorial ? 22 : 20;
    const grid = [];
    for (let c = 0; c < P.cols; c++) {
      grid.push([]);
      for (let r = 0; r < P.rows; r++) {
        const jx = P.tutorial ? 0 : rng.range(-3.5, 3.5), jy = P.tutorial ? rng.range(-2, 2) : rng.range(-3, 3);
        grid[c].push(node(x0 + c * sx + jx, y0 + r * sy + jy, rng.range(2.8, 3.6), 'junction'));
      }
    }
    const at = (c, r) => (c >= 0 && r >= 0 && c < P.cols && r < P.rows ? grid[c][r] : -1);
    const cellOf = (id) => { for (let c = 0; c < P.cols; c++) { const r = grid[c].indexOf(id); if (r >= 0) return [c, r]; } return null; };
    const nbrs = (id) => { const [c, r] = cellOf(id); return [at(c + 1, r), at(c - 1, r), at(c, r + 1), at(c, r - 1)].filter((n) => n >= 0); };

    // Growing tree: mostly extend the newest corridor, sometimes branch from an older one.
    const linked = new Set(), seen = new Set([grid[0][0]]), active = [grid[0][0]];
    const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
    while (active.length) {
      const i = rng.chance(0.75) ? active.length - 1 : rng.int(0, active.length - 1);
      const cur = active[i], open = nbrs(cur).filter((n) => !seen.has(n));
      if (!open.length) { active.splice(i, 1); continue; }
      const nb = rng.pick(open);
      edge(cur, nb); linked.add(key(cur, nb)); seen.add(nb); active.push(nb);
    }
    // Loops.
    const extra = [];
    for (let c = 0; c < P.cols; c++) for (let r = 0; r < P.rows; r++) {
      for (const n of [at(c + 1, r), at(c, r + 1)]) if (n >= 0 && !linked.has(key(grid[c][r], n))) extra.push([grid[c][r], n]);
    }
    for (let l = 0; l < P.loops && extra.length; l++) {
      const [a, b] = extra.splice(rng.int(0, extra.length - 1), 1)[0];
      edge(a, b); linked.add(key(a, b));
    }

    // The pool's mouth joins the first junction.
    const mouth = node(C.BASIN_W - 3, 19, 4, 'mouth');
    edge(mouth, grid[0][0]);

    // Goal: the junction farthest from the mouth through the maze.
    const dist = nodes.map(() => Infinity), prev = nodes.map(() => -1);
    dist[mouth] = 0;
    const todo = new Set(nodes.map((n) => n.id));
    while (todo.size) {
      let u = -1;
      for (const v of todo) if (u < 0 || dist[v] < dist[u]) u = v;
      todo.delete(u);
      for (const e of edges) {
        const v = e.a === u ? e.b : e.b === u ? e.a : -1;
        if (v < 0) continue;
        const d = dist[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].y - nodes[u].y);
        if (d < dist[v]) { dist[v] = d; prev[v] = u; }
      }
    }
    let goal = grid[0][0];
    for (const n of nodes) if (n.kind === 'junction' && dist[n.id] > dist[goal]) goal = n.id;
    nodes[goal].kind = 'goal';
    nodes[goal].r = rng.range(5, 7);
    const onRoute = new Set();
    for (let v = goal; v >= 0; v = prev[v]) onRoute.add(v);
    for (const e of edges) e.route = onRoute.has(e.a) && onRoute.has(e.b) && (prev[e.a] === e.b || prev[e.b] === e.a);
    for (const n of nodes) {
      n.route = onRoute.has(n.id);
      if (n.kind === 'junction' && rng.chance(P.chamberChance)) { n.kind = 'chamber'; n.r = rng.range(4.5, 6.5); }
    }

    // Squeezes: anywhere but the mouth.
    const candidates = edges.filter((e) => e.a !== mouth && e.b !== mouth).map((e) => e.id);
    for (let q = 0; q < P.squeezes && candidates.length; q++) edges[candidates.splice(rng.int(0, candidates.length - 1), 1)[0]].squeeze = true;

    const W = Math.ceil(Math.max(...nodes.map((n) => n.x)) + 22);
    return { nodes, edges, mouth, goal, W };
  }

  // ---------------------------------------------------------------- carving
  function edgePath(rng, wiggle, A, B, e) {
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const amp = e.squeeze ? rng.range(0.5, 1.5) : rng.range(1, 4);
    const s0 = rng.range(0.25, 0.35), s1 = s0 + rng.range(0.3, 0.42);
    const flat = Math.abs(dx) >= Math.abs(dy);
    const steps = Math.max(2, Math.ceil(len / 0.5)), pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const off = amp * Math.sin(Math.PI * t) * wiggle(t * len + e.id * 97, e.id * 31);
      const w = e.squeeze ? bump(t, s0, s1, 0.1) : 0;
      let px = A.x + dx * t + nx * off, py = A.y + dy * t + ny * off;
      // Snap the narrowest part to cell centres so a squeeze is reliably three cells across.
      if (w > 0.5) { if (flat) py = Math.floor(py) + 0.5; else px = Math.floor(px) + 0.5; }
      pts.push({ x: px, y: py, r: e.re + (C.SQUEEZE_R - e.re) * w, squeeze: w > 0.5 });
    }
    return pts;
  }

  function carveAll(rng, seed, g, P) {
    const W = g.W, H = C.H, N = W * H;
    const open = new Uint8Array(N), tag = new Uint8Array(N), protect = new Uint8Array(N);
    const wall = valueNoise(seed + ':wall', 3.5), fine = valueNoise(seed + ':fine', 1.4);
    const wiggle = valueNoise(seed + ':wiggle', 6);

    const set = (i, t) => { if (!open[i] || t < tag[i]) tag[i] = t; open[i] = 1; };
    function disc(x, y, r, rough, t, floorY) {
      const R = r + rough + 1;
      for (let cy = Math.max(1, Math.floor(y - R)); cy <= Math.min(H - 2, Math.ceil(y + R)); cy++) {
        if (floorY !== undefined && cy + 0.5 > floorY) continue;
        for (let cx = Math.max(1, Math.floor(x - R)); cx <= Math.min(W - 2, Math.ceil(x + R)); cx++) {
          const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
          // Wall noise mostly pushes walls out, so rough walls rarely pinch a passage shut.
          if (d < r + rough * (0.35 + 0.8 * wall(cx, cy) + 0.3 * fine(cx, cy))) set(cy * W + cx, t);
          if (d < Math.min(r, 1.3)) protect[cy * W + cx] = 1;
        }
      }
    }

    // Entrance pool, open to the surface (row 1) and lit from above.
    for (let cy = 1; cy < 26; cy++) for (let cx = 1; cx < C.BASIN_W; cx++) {
      const ex = (cx + 0.5 - C.BASIN_W / 2) / (C.BASIN_W / 2 - 1), ey = (cy + 0.5 - 1) / 23;
      if (ex * ex + ey * ey < 1 + 0.15 * wall(cx, cy)) set(cy * W + cx, TAG.BASIN);
    }

    for (const e of g.edges) {
      e.path = edgePath(rng, wiggle, g.nodes[e.a], g.nodes[e.b], e);
      const t = e.route ? TAG.ROUTE : TAG.SIDE;
      for (const p of e.path) disc(p.x, p.y, p.r, p.squeeze ? 0.2 : 1.0, t);
    }
    for (const n of g.nodes) {
      const t = n.kind === 'mouth' ? TAG.BASIN : n.route ? TAG.ROUTE : TAG.SIDE;
      if (n.kind === 'chamber' || n.kind === 'goal') {
        const floorY = n.y + n.r * 0.6;   // chambers get a flat, silty floor
        disc(n.x, n.y, n.r, 1.4, t, floorY);
        for (let k = 0; k < 4; k++) {
          const a = rng.range(0, Math.PI * 2), d = rng.range(0.2, 0.6) * n.r;
          disc(n.x + Math.cos(a) * d * 1.3, n.y + Math.sin(a) * d * 0.7, n.r * rng.range(0.5, 0.8), 1.2, t, floorY);
        }
      } else {
        disc(n.x, n.y, n.r, 1.0, t);
      }
    }

    // One smoothing pass: drop rock spikes and fill pinholes, never closing the centre line.
    const copy = open.slice();
    for (let cy = 1; cy < H - 1; cy++) for (let cx = 1; cx < W - 1; cx++) {
      const i = cy * W + cx;
      if (protect[i]) continue;
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (ox || oy) n += copy[i + oy * W + ox];
      if (copy[i] && n <= 2) open[i] = 0;
      else if (!copy[i] && n >= 6) {
        open[i] = 1;
        let t = 255;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (copy[i + oy * W + ox]) t = Math.min(t, tag[i + oy * W + ox]);
        tag[i] = t;
      }
    }
    for (let i = 0; i < N; i++) if (!open[i]) tag[i] = TAG.ROCK;
    return { W, H, open, tag };
  }

  // Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), squared.
  function edt1d(f, n, d, v, z) {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      while (true) {
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s <= z[k]) { k--; continue; }
        break;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }
  function clearanceMap(open, W, H) {
    const INF = 1e12, d2 = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) d2[i] = open[i] ? INF : 0;
    const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n);
    const v = new Int32Array(n), z = new Float64Array(n + 1);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = d2[y * W + x];
      edt1d(f, H, d, v, z);
      for (let y = 0; y < H; y++) d2[y * W + x] = d[y];
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) f[x] = d2[y * W + x];
      edt1d(f, W, d, v, z);
      for (let x = 0; x < W; x++) d2[y * W + x] = d[x];
    }
    const clear = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) clear[i] = open[i] ? Math.sqrt(d2[i]) - 0.5 : 0;
    return clear;
  }

  // A cell is in a squeeze when nothing within 2 cells of it has room to spare.
  // (Clearance alone would also flag the wall of a wide chamber.)
  function tightMap(open, clear, W, H) {
    const R = 2, rowMax = new Float32Array(W * H), tight = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let m = 0;
      for (let ox = Math.max(0, x - R); ox <= Math.min(W - 1, x + R); ox++) m = Math.max(m, clear[y * W + ox]);
      rowMax[y * W + x] = m;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!open[y * W + x]) continue;
      let m = 0;
      for (let oy = Math.max(0, y - R); oy <= Math.min(H - 1, y + R); oy++) m = Math.max(m, rowMax[oy * W + x]);
      if (m < C.TIGHT) tight[y * W + x] = 1;
    }
    return tight;
  }

  // Keep only the water connected to the start; everything else becomes rock.
  function keepConnected(cave, sx, sy) {
    const { W, H, open, tag } = cave, seen = new Uint8Array(W * H), stack = [sy * W + sx];
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop();
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j >= 0 && j < W * H && open[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    for (let i = 0; i < W * H; i++) if (!seen[i]) { open[i] = 0; tag[i] = TAG.ROCK; }
  }

  // ---------------------------------------------------------------- search
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    const k = this.k, v = this.v; let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  };

  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  // Dijkstra over cells the diver fits through. stepCost(i, len) prices one step.
  function dijkstra(cave, sources, stepCost) {
    const { W, H, pass } = cave, dist = new Float64Array(W * H).fill(Infinity), heap = new Heap();
    for (const s of sources) { dist[s] = 0; heap.push(0, s); }
    while (heap.k.length) {
      const d0 = heap.k[0], i = heap.pop();
      if (d0 > dist[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [ox, oy, len] of NB) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!pass[j]) continue;
        if (ox && oy && (!pass[y * W + nx] || !pass[ny * W + x])) continue;
        const nd = d0 + stepCost(j, len);
        if (nd < dist[j]) { dist[j] = nd; heap.push(nd, j); }
      }
    }
    return dist;
  }

  const depthFactor = (y) => 1 + (y * C.CELL_M) / 10;   // ambient pressure in atm
  function gasStep(cave) {
    return (j, len) => {
      const tight = cave.tight[j] ? C.TIGHT_STRESS / C.TIGHT_SPEED : 1;
      return (len / C.SWIM_SPEED) * tight * depthFactor((j / cave.W) | 0);
    };
  }

  // ---------------------------------------------------------------- lines (laid by the diver)
  function makeLine(pts, kind) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { kind, pts, cum, total: cum[cum.length - 1] };
  }

  // Point at arc length s, and the unit direction back toward the line's start.
  function linePoint(line, s) {
    const { pts, cum } = line;
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = clamp((s - cum[i - 1]) / seg, 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ex: (a.x - b.x) / seg, ey: (a.y - b.y) / seg };
  }

  function nearestOnLine(line, x, y) {
    let best = { d: Infinity };
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1], b = line.pts[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1) : 0;
      const px = a.x + dx * t, py = a.y + dy * t, d = Math.hypot(x - px, y - py);
      if (d < best.d) best = { d, x: px, y: py, seg: i, s: line.cum[i - 1] + Math.sqrt(l2) * t };
    }
    return best;
  }

  // ---------------------------------------------------------------- one attempt
  function attempt(seed, level, P) {
    const rng = new RNG(seed);
    const g = buildMaze(rng, P);
    const cave = carveAll(rng, seed, g, P);
    const start = { x: 8, y: 5 };
    keepConnected(cave, Math.floor(start.x), Math.floor(start.y));
    cave.clear = clearanceMap(cave.open, cave.W, cave.H);
    cave.tight = tightMap(cave.open, cave.clear, cave.W, cave.H);
    cave.pass = new Uint8Array(cave.W * cave.H);
    for (let i = 0; i < cave.pass.length; i++) cave.pass[i] = cave.open[i] && cave.clear[i] >= C.DIVER_R ? 1 : 0;

    const fail = (why) => ({ ok: false, why, cave, graph: g });
    const W = cave.W, idx = (p) => Math.floor(p.y) * W + Math.floor(p.x);

    // The primary tie-off in the pool, where a diver ties their reel in.
    const anchor = { x: C.BASIN_W - 9, y: 17 };
    const goalNode = g.nodes[g.goal];
    const goal = { x: goalNode.x, y: goalNode.y };

    // ---- fairness check: the gas-cost search
    const startI = idx(start), goalI = idx(goal), anchorI = idx(anchor);
    if (!cave.pass[startI] || !cave.pass[goalI] || !cave.pass[anchorI]) return fail('start, tie-off or goal inside rock');
    const cost = dijkstra(cave, [anchorI], gasStep(cave));
    if (!isFinite(cost[goalI])) return fail('goal unreachable');
    const exitCells = [];
    for (let y = 1; y < 26; y++) for (let x = 1; x < C.BASIN_W - 6; x++) if (cave.pass[y * W + x]) exitCells.push(y * W + x);
    const exitDist = dijkstra(cave, exitCells, (j, len) => len);
    // The way a diver would swim from the tie-off to the goal: shortest, but
    // kept off the walls (steps near rock cost more), walked back down the field.
    const midField = dijkstra(cave, [anchorI], (j, len) => len * (1 + 2.5 / Math.max(0.6, cave.clear[j])));
    const route = [];
    let routeCells = 0, routeCost = 0;
    for (let i = goalI, guard = 0; guard < W * cave.H; guard++) {
      route.push({ x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5 });
      if (i === anchorI) break;
      let best = i;
      const x = i % W, y = (i / W) | 0;
      for (const [ox, oy] of NB) {
        const j = (y + oy) * W + x + ox;
        if (cave.pass[j] && midField[j] < midField[best]) best = j;
      }
      if (best === i) return fail('route walk stuck');
      const step = Math.hypot((best % W) - x, ((best / W) | 0) - y);
      routeCells += step;
      routeCost += gasStep(cave)(i, step);
      i = best;
    }
    route.reverse();
    if (!P.tutorial && routeCells * C.CELL_M < 40) return fail('too short');

    // Gas is always 200 bar. The breathing rate is set so that swimming the
    // route to the goal costs a third of it, divided by the margin (the margin
    // is room for wrong turns). The reel holds the route times the slack.
    if (routeCost > cost[goalI] * 1.6) return fail('route detours too much');
    const k = C.P0 / (3 * P.gasMargin * routeCost);
    const turn = C.P0 * (2 / 3);
    const reel = Math.ceil((routeCells * P.reelSlack * C.CELL_M) / 10) * 10 / C.CELL_M;
    // A line laid while swimming is never longer than the swim, and following
    // it out blind costs at most BLIND_STRESS / BLIND_SPEED times as much gas
    // per cell. Turning at turn pressure with the line intact therefore fits
    // in the remaining two thirds whatever maze the diver has swum.
    if (C.BLIND_STRESS / C.BLIND_SPEED > 2) return fail('blind exit factor too high');

    // ---- silt beds: heaviest in dead ends and squeezes, lighter on the through route
    const N = W * cave.H, deposit = new Float32Array(N);
    const siltNoise = valueNoise(seed + ':silt', 5);
    for (let y = 1; y < cave.H - 2; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!cave.open[i]) continue;
      const floor = !cave.open[i + W] ? 1 : !cave.open[i + 2 * W] ? 0.5 : 0;
      const side = (!cave.open[i - 1] || !cave.open[i + 1]) ? 0.25 : 0;
      const base = Math.max(floor, side);
      if (!base) continue;
      const t = cave.tag[i];
      const mult = t === TAG.BASIN ? 0.25 : t === TAG.ROUTE ? 0.8 : 1.3;
      const tight = cave.tight[i] ? 1.6 : 1;
      deposit[i] = P.siltiness * base * mult * tight * (0.55 + 0.45 * siltNoise(x, y));
    }

    // ---- props (decoration only, no collision)
    const props = [], taken = new Uint8Array(N);
    const free = (x, y, r) => {
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        const j = (y + oy) * W + x + ox;
        if (j >= 0 && j < N && taken[j]) return false;
      }
      return true;
    };
    const take = (x, y) => { taken[y * W + x] = 1; };
    for (let y = 2; y < cave.H - 2; y++) for (let x = C.BASIN_W; x < W - 1; x++) {
      const i = y * W + x;
      if (!cave.open[i] || cave.tight[i]) continue;
      const lush = cave.tag[i] === TAG.SIDE ? 1.5 : 1;
      // Ceiling and floor cells touch rock, so check for room two cells into the passage.
      if (!cave.open[i - W] && cave.clear[i + 2 * W] >= 1.5 && rng.chance(0.1 * lush) && free(x, y, 2)) {
        let span = 0;
        while (span < 14 && cave.open[i + (span + 1) * W]) span++;
        if (span >= 5 && span <= 9 && rng.chance(0.25)) { props.push({ type: 'column', x: x + 0.5, y, y2: y + span + 1 }); take(x, y); continue; }
        const type = cave.clear[i + 2 * W] > 3.5 && rng.chance(0.3) ? 'curtain' : 'stalactite';
        props.push({ type, x: x + 0.5, y, s: rng.range(0.7, 1.2), flip: rng.chance(0.5) });
        take(x, y);
      } else if (!cave.open[i + W] && cave.clear[i - 2 * W] >= 1.5 && rng.chance(0.08 * lush) && free(x, y, 2)) {
        const type = rng.pick(['stalagmite', 'spire_tall', 'spire_short', 'boulder', 'boulders', 'rock_small', 'ledge']);
        props.push({ type, x: x + 0.5, y: y + 1, s: rng.range(0.7, 1.15), flip: rng.chance(0.5) });
        take(x, y);
      }
    }

    // ---- measures shown in the briefing and used by the README
    let maxDepth = 0, tightCells = 0;
    for (const p of route) { maxDepth = Math.max(maxDepth, p.y * C.CELL_M); if (cave.tight[idx(p)]) tightCells++; }
    const junctions = g.nodes.filter((n) => n.kind !== 'mouth' && n.deg >= 3).length;
    const deadEnds = g.nodes.filter((n) => n.kind !== 'mouth' && n.kind !== 'goal' && n.deg === 1);
    const straight = Math.hypot(goal.x - anchor.x, goal.y - anchor.y);

    return {
      ok: true, seed, level, params: P, C, TAG, tutorial: !!P.tutorial,
      W, H: cave.H, open: cave.open, tag: cave.tag, clear: cave.clear, pass: cave.pass, tight: cave.tight,
      deposit, exitDist, start, anchor, goal, route, props, reel,
      deadEnds: deadEnds.map((n) => ({ x: n.x, y: n.y, r: n.r })),
      graph: g,
      budget: { P0: C.P0, k, turn, reserve: C.P0 / 3, routeCost, shortestCost: cost[goalI] },
      measures: {
        routeLength: Math.round(routeCells * C.CELL_M),
        winding: +(routeCells / straight).toFixed(2),
        reelLength: Math.round(reel * C.CELL_M),
        maxDepth: Math.round(maxDepth),
        tightMetres: Math.round(tightCells * C.CELL_M),
        junctions, deadEnds: deadEnds.length, loops: P.loops,
        gasToGoal: Math.round(routeCost * k),
      },
    };
  }

  function generate(seed, level) {
    const P = params(level);
    const reasons = [];
    for (let a = 0; a < C.MAX_ATTEMPTS; a++) {
      const d = attempt(`${seed}|${P.level}|${a}`, level, P);
      if (d.ok) {
        d.seed = seed; d.attempts = a + 1; d.rejected = reasons;
        return d;
      }
      reasons.push(d.why);
    }
    throw new Error(`No valid cave for seed ${seed} at level ${level}: ${reasons.join(', ')}`);
  }

  const api = { generate, attempt, params, C, TAG, linePoint, nearestOnLine, makeLine, depthFactor, dijkstra, clearanceMap, NB };
  root.CaveGen = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
