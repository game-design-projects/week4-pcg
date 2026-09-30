// Late — the city's metro network: lines routed on a coarse grid in the
// octilinear style of a metro map (0/45/90 degree bends), stations spaced
// along them, interchanges wherever lines share a grid point, and one central
// hub where at least three lines meet.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./names.js'));
  else {
    const L = (root.Late = root.Late || {});
    L.network = factory(L.names);
  }
})(typeof self !== 'undefined' ? self : this, function (names) {
  'use strict';

  const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const LINE_COLORS = {
    1: '#2e9b57', 2: '#d63a3a', 3: '#2f6fbf', 4: '#e8b21e', 5: '#7b4bb3',
    6: '#1aa39a', 7: '#e67822', 8: '#8d6e63', 9: '#d6539b', 10: '#7a9a2a',
  };
  const SQRT2 = Math.SQRT2;

  const pkey = (x, y) => `${x},${y}`;
  const ekey = (ax, ay, bx, by) => (ax < bx || (ax === bx && ay < by) ? `${ax},${ay}|${bx},${by}` : `${bx},${by}|${ax},${ay}`);
  // the other diagonal of the unit square a diagonal step crosses
  const crossKey = (ax, ay, bx, by) => ekey(ax, by, bx, ay);

  function turnCost(d, nd) {
    if (d === 8) return 0;
    let diff = Math.abs(d - nd);
    diff = Math.min(diff, 8 - diff);
    return diff === 0 ? 0 : diff === 1 ? 0.35 : diff === 2 ? 1.6 : Infinity;
  }

  /** Min-heap of [f, ...payload] arrays. */
  function heap() {
    const a = [];
    return {
      get size() { return a.length; },
      push(item) {
        a.push(item);
        let i = a.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (a[p][0] <= a[i][0]) break;
          [a[p], a[i]] = [a[i], a[p]];
          i = p;
        }
      },
      pop() {
        const top = a[0];
        const last = a.pop();
        if (a.length) {
          a[0] = last;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1, r = l + 1;
            let m = i;
            if (l < a.length && a[l][0] < a[m][0]) m = l;
            if (r < a.length && a[r][0] < a[m][0]) m = r;
            if (m === i) break;
            [a[m], a[i]] = [a[i], a[m]];
            i = m;
          }
        }
        return top;
      },
    };
  }

  /**
   * A* on the grid, 8 directions, penalising bends, sharing track with other
   * lines and crossing their diagonals between grid points.
   * @returns {{points: number[][], lastDir: number} | null}
   */
  function route(rng, grid, from, to, ctx, startDir) {
    const { W, H } = grid;
    const noise = new Float32Array(W * H * 8);
    for (let i = 0; i < noise.length; i++) noise[i] = rng.next() * 0.7;
    const idx = (x, y, d) => (y * W + x) * 9 + d;
    const g = new Float64Array(W * H * 9).fill(Infinity);
    const came = new Int32Array(W * H * 9).fill(-1);
    const h = (x, y) => {
      const dx = Math.abs(x - to[0]), dy = Math.abs(y - to[1]);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };
    const open = heap();
    const s0 = idx(from[0], from[1], startDir ?? 8);
    g[s0] = 0;
    open.push([h(from[0], from[1]), from[0], from[1], startDir ?? 8, 0]);
    while (open.size) {
      const [, x, y, d, gp] = open.pop();
      const si = idx(x, y, d);
      if (gp > g[si]) continue;
      if (x === to[0] && y === to[1]) {
        const pts = [];
        let cur = si;
        while (cur !== -1) {
          const cell = Math.floor(cur / 9);
          pts.push([cell % W, Math.floor(cell / W)]);
          cur = came[cur];
        }
        pts.reverse();
        return { points: pts, lastDir: d };
      }
      for (let nd = 0; nd < 8; nd++) {
        const tc = turnCost(d, nd);
        if (tc === Infinity) continue;
        const nx = x + DIRS8[nd][0], ny = y + DIRS8[nd][1];
        if (nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2) continue;
        const k = pkey(nx, ny);
        if (ctx.blocked.has(k) && !(nx === to[0] && ny === to[1])) continue;
        const diag = nd % 2 === 1;
        let cost = (diag ? SQRT2 : 1) + tc + noise[(y * W + x) * 8 + nd];
        if (ctx.usedEdges.has(ekey(x, y, nx, ny))) cost += 9;
        if (diag && ctx.usedEdges.has(crossKey(x, y, nx, ny))) cost += 2.5;
        if (ctx.pointLines.has(k)) cost += ctx.avoid.has(k) ? 2.5 : 0.25;
        const ni = idx(nx, ny, nd);
        const ng = g[si] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = si;
          open.push([ng + h(nx, ny), nx, ny, nd, ng]);
        }
      }
    }
    return null;
  }

  function distToEdge(grid, p, u) {
    const { W, H } = grid;
    const tx = u[0] > 1e-9 ? (W - 2 - p[0]) / u[0] : u[0] < -1e-9 ? (1 - p[0]) / u[0] : Infinity;
    const ty = u[1] > 1e-9 ? (H - 2 - p[1]) / u[1] : u[1] < -1e-9 ? (1 - p[1]) / u[1] : Infinity;
    return Math.min(tx, ty);
  }

  const clampPt = (grid, p) => [Math.max(1, Math.min(grid.W - 2, Math.round(p[0]))), Math.max(1, Math.min(grid.H - 2, Math.round(p[1])))];
  const gdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function pathLength(points, i, j) {
    let len = 0;
    for (let k = i; k < j; k++) len += points[k][0] !== points[k + 1][0] && points[k][1] !== points[k + 1][1] ? SQRT2 : 1;
    return len;
  }

  /**
   * @param rng seeded generator (a fork of the day's)
   * @param P   difficulty params: lines, hubLines, gridW, gridH, secPerUnit, secBase
   * @returns network or null when this attempt should be retried
   */
  function generateNetwork(rng, P) {
    const grid = { W: P.gridW, H: P.gridH };
    const C = [Math.round(grid.W / 2) + rng.int(-1, 1), Math.round(grid.H / 2) + rng.int(-1, 0)];
    const nLines = P.lines;
    const hubLines = Math.min(P.hubLines, nLines);
    const ctx = { usedEdges: new Set(), pointLines: new Map(), blocked: new Set(), avoid: new Set([pkey(C[0], C[1])]) };
    const rot = rng.float(0, Math.PI);
    const lines = [];

    for (let i = 0; i < nLines; i++) {
      const isHub = i < hubLines;
      let made = null;
      for (let tries = 0; tries < 24 && !made; tries++) {
        let via;
        let theta;
        if (isHub) {
          via = C;
          theta = rot + ((i + 0.5) * Math.PI) / hubLines + rng.float(-0.2, 0.2) + tries * 0.13;
        } else {
          const cands = [];
          for (const ln of lines) for (let k = 2; k < ln.points.length - 2; k++) {
            const p = ln.points[k];
            if (gdist(p, C) >= 2.5 && (ctx.pointLines.get(pkey(p[0], p[1])) || new Set()).size === 1) cands.push(p);
          }
          if (!cands.length) return null;
          via = rng.pick(cands);
          theta = rng.float(0, Math.PI);
        }
        const u = [Math.cos(theta), Math.sin(theta)];
        const ra = distToEdge(grid, via, u) * rng.float(0.78, 0.97);
        const rb = distToEdge(grid, via, [-u[0], -u[1]]) * rng.float(0.78, 0.97);
        const A = clampPt(grid, [via[0] + u[0] * ra, via[1] + u[1] * ra]);
        const B = clampPt(grid, [via[0] - u[0] * rb, via[1] - u[1] * rb]);
        if (gdist(A, via) < 3.2 || gdist(B, via) < 3.2) continue;
        if (ctx.pointLines.has(pkey(A[0], A[1])) || ctx.pointLines.has(pkey(B[0], B[1]))) continue;
        const localCtx = { ...ctx, blocked: new Set(), avoid: isHub ? new Set() : ctx.avoid };
        const first = route(rng, grid, A, via, localCtx);
        if (!first) continue;
        for (const p of first.points.slice(0, -1)) localCtx.blocked.add(pkey(p[0], p[1]));
        const second = route(rng, grid, via, B, localCtx, first.lastDir);
        if (!second) continue;
        const points = first.points.concat(second.points.slice(1));
        if (pathLength(points, 0, points.length - 1) < 9) continue;
        made = points;
      }
      if (!made) return null;
      const line = { index: i, points: made };
      lines.push(line);
      for (let k = 0; k < made.length; k++) {
        const [x, y] = made[k];
        const pk = pkey(x, y);
        if (!ctx.pointLines.has(pk)) ctx.pointLines.set(pk, new Set());
        ctx.pointLines.get(pk).add(i);
        if (k > 0) ctx.usedEdges.add(ekey(made[k - 1][0], made[k - 1][1], x, y));
      }
    }

    // ---- stations along each line
    const stationByKey = new Map();
    const stations = [];
    const nums = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).slice(0, nLines).sort((a, b) => a - b);
    const outLines = [];
    lines.forEach((ln, li) => {
      const pts = ln.points;
      const must = new Set([0, pts.length - 1]);
      pts.forEach(([x, y], k) => {
        if (ctx.pointLines.get(pkey(x, y)).size >= 2) must.add(k);
      });
      const mustIdx = [...must].sort((a, b) => a - b);
      const stops = [];
      for (let m = 0; m < mustIdx.length - 1; m++) {
        const a = mustIdx[m], b = mustIdx[m + 1];
        stops.push(a);
        const len = pathLength(pts, a, b);
        const n = Math.max(1, Math.round(len / rng.float(2.1, 2.8)));
        let last = a;
        for (let s = 1; s < n; s++) {
          const target = (len * s) / n;
          let bestK = -1, bestD = Infinity;
          for (let k = last + 1; k < b; k++) {
            const d = Math.abs(pathLength(pts, a, k) - target);
            if (d < bestD) { bestD = d; bestK = k; }
          }
          if (bestK > last && pathLength(pts, last, bestK) >= 1.4 && pathLength(pts, bestK, b) >= 1.4) {
            stops.push(bestK);
            last = bestK;
          }
        }
      }
      stops.push(pts.length - 1);
      const num = nums[li];
      const line = { id: `L${num}`, num, color: LINE_COLORS[num], points: pts, stopIdx: stops, stops: [], run: [], units: [] };
      for (const k of stops) {
        const [x, y] = pts[k];
        const sk = pkey(x, y);
        let st = stationByKey.get(sk);
        if (!st) {
          st = { id: `S${stations.length}`, index: stations.length, gx: x, gy: y, lines: [], kind: 'plain', flavor: null, layout: null, terminus: false, name: null };
          stations.push(st);
          stationByKey.set(sk, st);
        }
        if (!st.lines.includes(line.id)) st.lines.push(line.id);
        line.stops.push(st.id);
      }
      for (let s = 0; s < stops.length - 1; s++) {
        const units = pathLength(pts, stops[s], stops[s + 1]);
        line.units.push(units);
        line.run.push(Math.round((units * P.secPerUnit + P.secBase) / 5) * 5);
      }
      stations.find((s) => s.id === line.stops[0]).terminus = true;
      stations.find((s) => s.id === line.stops[line.stops.length - 1]).terminus = true;
      outLines.push(line);
    });

    // ---- connectivity of the line graph
    const parent = outLines.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const st of stations) {
      const ids = st.lines.map((id) => outLines.findIndex((l) => l.id === id));
      for (let k = 1; k < ids.length; k++) parent[find(ids[k])] = find(ids[0]);
    }
    if (new Set(outLines.map((_, i) => find(i))).size !== 1) return null;

    // ---- kinds and names
    const namer = names.makeNamer(rng.fork('names'));
    let hubId = null;
    for (const st of stations) {
      st.kind = st.lines.length >= 3 ? 'hub' : st.lines.length === 2 ? 'transfer' : 'plain';
    }
    const hubs = stations.filter((s) => s.kind === 'hub');
    if (!hubs.length) return null;
    const center = stationByKey.get(pkey(C[0], C[1]));
    hubId = center && center.kind === 'hub' ? center.id : hubs[0].id;
    for (const st of stations) {
      st.name = namer(st.kind === 'hub' ? 'hub' : st.terminus ? 'terminus' : 'plain');
    }
    return { grid, lines: outLines, stations, hubId, center: C };
  }

  return { generateNetwork, LINE_COLORS, pathLength };
});
