// Late — the day as a graph, and a time-dependent shortest-path solver.
//
// Nodes are points of interest on floor segments (segment ends, stair and
// escalator ends, lift doors, train doors, street doors), one per lane.
// Edges are walking (costed by the corridor rules), lane changes, links
// (stairs, escalators that only run one way at a time, lifts on a cycle,
// fare gates, checkpoint queues, closed passages) and train rides.
//
// Every edge is FIFO (leaving later never gets you there earlier) and waiting
// is always allowed, so plain Dijkstra on arrival time gives exact earliest
// arrivals. The generator uses it to check that a day is winnable, and the
// game uses it for the par time, the "best route" replay and the autopilot.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'), require('./timetable.js'));
  else {
    const L = (root.Late = root.Late || {});
    L.solver = factory(L.rules, L.timetable);
  }
})(typeof self !== 'undefined' ? self : this, function (R, TT) {
  'use strict';

  const { RULES, walkSpeed, lanesOf, escalatorReady, liftArrival, linkBaseTime, isChecked } = R;

  const k2 = (seg, x, lane) => `${seg}|${Math.round(x * 100)}|${lane}`;
  // The simulation moves in whole ticks, so walking is costed in whole ticks
  // too (rounded up): the solver may be a hair pessimistic, never optimistic.
  const ticks = (sec) => Math.ceil(sec / RULES.DT - 1e-9) * RULES.DT;

  /**
   * @param day {network, interiors: {[stationId]: interior}, timetable}
   * @returns graph
   */
  function buildGraph(day) {
    const nodes = []; // {st, seg, x, lane, door?}
    const adj = [];
    const lookup = day.network.stations.map(() => new Map());
    const segNodes = []; // [st][seg] -> [lane0 ids, lane1 ids]
    const doorNodes = new Map(); // `${stationId}|${line}|${dir}` -> {side, platform, ids: [k] -> node}
    const addNode = (n) => {
      nodes.push(n);
      adj.push([]);
      return nodes.length - 1;
    };

    day.network.stations.forEach((station, si) => {
      const I = day.interiors[station.id];
      segNodes.push([]);
      for (const seg of I.segs) {
        const xs = new Set([seg.x0, seg.x1]);
        for (const p of I.poi[seg.id]) if (p.x >= seg.x0 && p.x <= seg.x1) xs.add(p.x);
        const sorted = [...xs].sort((a, b) => a - b);
        const perLane = [];
        for (let lane = 0; lane < lanesOf(seg); lane++) {
          const ids = sorted.map((x) => {
            const id = addNode({ st: si, seg: seg.id, x, lane });
            lookup[si].set(k2(seg.id, x, lane), id);
            return id;
          });
          for (let i = 0; i + 1 < ids.length; i++) {
            const dx = sorted[i + 1] - sorted[i];
            const vf = walkSpeed(seg, lane, 1);
            const vb = walkSpeed(seg, lane, -1);
            if (vf > 0) adj[ids[i]].push({ type: 'walk', to: ids[i + 1], cost: ticks(dx / vf) });
            if (vb > 0) adj[ids[i + 1]].push({ type: 'walk', to: ids[i], cost: ticks(dx / vb) });
          }
          perLane.push(ids);
        }
        if (perLane.length === 2) {
          for (let i = 0; i < sorted.length; i++) {
            adj[perLane[0][i]].push({ type: 'lane', to: perLane[1][i], cost: RULES.LANE_SWITCH });
            adj[perLane[1][i]].push({ type: 'lane', to: perLane[0][i], cost: RULES.LANE_SWITCH });
          }
        }
        segNodes[si][seg.id] = perLane;
      }
      // links: connect every lane at each end
      for (const link of I.links) {
        const aSeg = I.segs[link.a.seg];
        const bSeg = I.segs[link.b.seg];
        for (let la = 0; la < lanesOf(aSeg); la++) {
          for (let lb = 0; lb < lanesOf(bSeg); lb++) {
            // horizontal links keep the lane when both sides have two
            if (link.axis === 'h' && lanesOf(aSeg) === 2 && lanesOf(bSeg) === 2 && la !== lb) continue;
            const u = lookup[si].get(k2(aSeg.id, link.a.x, la));
            const v = lookup[si].get(k2(bSeg.id, link.b.x, lb));
            adj[u].push({ type: 'link', to: v, link, way: 'ab', st: si });
            adj[v].push({ type: 'link', to: u, link, way: 'ba', st: si });
          }
        }
      }
      // train doors
      for (const p of I.platforms) {
        for (const side of ['far', 'near']) {
          const tr = p.tracks[side];
          if (!tr) continue;
          const ids = p.doors.map((x, k) => {
            const id = lookup[si].get(k2(p.seg, x, 0));
            nodes[id].door = k;
            nodes[id].platform = p.id;
            return id;
          });
          doorNodes.set(`${station.id}|${tr.line}|${tr.dir}`, { side, platform: p.id, ids });
        }
      }
    });

    // boarding options per door node
    const services = day.timetable.services;
    const boardAt = new Map(); // node -> [{service, stop, side}]
    for (const s of services) {
      s.stops.forEach((stationId, k) => {
        if (k === s.stops.length - 1) return; // terminus: trains end here
        const dn = doorNodes.get(`${stationId}|${s.line}|${s.dir}`);
        if (!dn) throw new Error(`no platform for ${s.line}/${s.dir} at ${stationId}`);
        dn.ids.forEach((id) => {
          if (!boardAt.has(id)) boardAt.set(id, []);
          boardAt.get(id).push({ service: s, stop: k, side: dn.side });
        });
      });
    }
    const alightNode = (service, k, door) => doorNodes.get(`${service.stops[k]}|${service.line}|${service.dir}`).ids[door];

    return { nodes, adj, lookup, segNodes, doorNodes, boardAt, alightNode, key: k2, stationIndex: new Map(day.network.stations.map((s, i) => [s.id, i])) };
  }

  /** Node id at an exact point, or -1. */
  function nodeAt(graph, stationId, seg, x, lane = 0) {
    const si = graph.stationIndex.get(stationId);
    const id = graph.lookup[si].get(k2(seg, x, lane));
    return id === undefined ? -1 : id;
  }

  function checkWaitOf(link, mode) {
    if (mode === 'min') return link.check.wmin;
    if (mode === 'mean') return (link.check.wmin + link.check.wmax) / 2;
    return link.check.wmax;
  }

  /** Arrival time over a non-train edge leaving at t (Infinity if impassable). */
  function arrive(edge, t, opts) {
    if (edge.type !== 'link') return t + edge.cost;
    const L = edge.link;
    let t2 = t;
    if (L.closedUntil && t2 < L.closedUntil) {
      if (L.closedUntil === Infinity) return Infinity;
      t2 = L.closedUntil;
    }
    if (isChecked(L, edge.way)) t2 += checkWaitOf(L, opts.checkWait);
    if (L.kind === 'escalator') {
      const ready = escalatorReady(L.esc, edge.way === 'ab' ? 1 : -1, t2);
      return ready === Infinity ? Infinity : ready + RULES.ESCALATOR * L.levels;
    }
    if (L.kind === 'lift') return liftArrival(L.lift, edge.way === 'ab' ? 'a' : 'b', t2).arrive;
    return t2 + linkBaseTime(L, edge.way);
  }

  function makeHeap() {
    const a = [];
    return {
      get size() { return a.length; },
      push(t, n) {
        a.push([t, n]);
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
            const l = 2 * i + 1;
            const r = l + 1;
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
   * Earliest arrival from a start node (or a position between nodes) at time t0.
   * @param opts.target      node id to stop at (optional: otherwise all nodes)
   * @param opts.checkWait   'max' (default, the guarantee) | 'mean' | 'min'
   * @param opts.startPos    {st, seg, x, lane} instead of a node: walks to the neighbouring nodes
   * @param opts.skipLinks   Set of link objects to treat as impassable
   */
  function solve(day, graph, start, t0, opts = {}) {
    const N = graph.nodes.length;
    const best = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const how = new Array(N);
    const heap = makeHeap();
    const o = { checkWait: opts.checkWait || 'max' };
    if (opts.startPos) {
      const sp = opts.startPos;
      const I = day.interiors[day.network.stations[sp.st].id];
      const seg = I.segs[sp.seg];
      const lane = Math.min(sp.lane || 0, lanesOf(seg) - 1);
      const ids = graph.segNodes[sp.st][sp.seg][lane];
      let exact = -1;
      for (const id of ids) {
        const n = graph.nodes[id];
        if (Math.abs(n.x - sp.x) < 1e-6) exact = id;
      }
      if (exact >= 0) {
        best[exact] = t0;
        how[exact] = { type: 'start' };
        heap.push(t0, exact);
      } else {
        for (const id of ids) {
          const n = graph.nodes[id];
          const dir = n.x > sp.x ? 1 : -1;
          const v = walkSpeed(seg, lane, dir);
          if (v <= 0) continue;
          // only the nearest node on each side
          const between = ids.some((o2) => {
            const m = graph.nodes[o2];
            return o2 !== id && (dir > 0 ? m.x > sp.x && m.x < n.x : m.x < sp.x && m.x > n.x);
          });
          if (between) continue;
          const t = t0 + ticks(Math.abs(n.x - sp.x) / v);
          if (t < best[id]) {
            best[id] = t;
            how[id] = { type: 'startwalk' };
            heap.push(t, id);
          }
        }
      }
    } else {
      best[start] = t0;
      how[start] = { type: 'start' };
      heap.push(t0, start);
    }
    const target = opts.target ?? -1;
    while (heap.size) {
      const [t, u] = heap.pop();
      if (t > best[u]) continue;
      if (u === target) break;
      for (const e of graph.adj[u]) {
        if (opts.skipLinks && e.type === 'link' && opts.skipLinks.has(e.link)) continue;
        const t2 = arrive(e, t, o);
        if (t2 < best[e.to]) {
          best[e.to] = t2;
          prev[e.to] = u;
          how[e.to] = e;
          heap.push(t2, e.to);
        }
      }
      const boards = graph.boardAt.get(u);
      if (boards) {
        const door = graph.nodes[u].door;
        for (const b of boards) {
          const s = b.service;
          const j = TT.nextTrip(s, b.stop, t + RULES.BOARD_MARGIN);
          if (j < 0) continue;
          for (let m = b.stop + 1; m < s.stops.length; m++) {
            const v = graph.alightNode(s, m, door);
            const t2 = TT.arrAt(s, j, m) + RULES.ALIGHT;
            if (t2 < best[v]) {
              best[v] = t2;
              prev[v] = u;
              how[v] = { type: 'train', service: s.id, trip: j, from: b.stop, to: m, side: b.side, door, dep: TT.depAt(s, j, b.stop), arr: TT.arrAt(s, j, m) };
              heap.push(t2, v);
            }
          }
        }
      }
    }
    return { best, prev, how, t0 };
  }

  /** Hops from the start to `target`: [{node, how, t}] in order (first hop is the start). */
  function pathTo(res, target) {
    if (!(res.best[target] < Infinity)) return null;
    const hops = [];
    let cur = target;
    while (cur !== -1) {
      hops.push({ node: cur, how: res.how[cur], t: res.best[cur] });
      cur = res.prev[cur];
    }
    return hops.reverse();
  }

  /**
   * Turn hops into steps the autopilot and the UI understand:
   *   {type:'walk', st, seg, lane, x, t}   walk along a segment to x
   *   {type:'lane', st, seg, lane, t}      step into the other lane
   *   {type:'link', st, link, way, t}      take stairs/escalator/lift/gate/joint
   *   {type:'ride', service, trip, from, to, side, door, dep, arr, t}
   */
  function stepsOf(day, graph, hops) {
    const steps = [];
    for (let i = 1; i < hops.length; i++) {
      const h = hops[i];
      const n = graph.nodes[h.node];
      const how = h.how;
      if (how.type === 'walk' || how.type === 'startwalk') {
        const last = steps[steps.length - 1];
        if (last && last.type === 'walk' && last.st === n.st && last.seg === n.seg && last.lane === n.lane) {
          last.x = n.x;
          last.t = h.t;
        } else steps.push({ type: 'walk', st: n.st, seg: n.seg, lane: n.lane, x: n.x, t: h.t });
      } else if (how.type === 'lane') steps.push({ type: 'lane', st: n.st, seg: n.seg, lane: n.lane, x: n.x, t: h.t });
      else if (how.type === 'link') steps.push({ type: 'link', st: n.st, link: how.link.id, way: how.way, kind: how.link.kind, t: h.t });
      else if (how.type === 'train') steps.push({ type: 'ride', service: how.service, trip: how.trip, from: how.from, to: how.to, side: how.side, door: how.door, dep: how.dep, arr: how.arr, st: n.st, t: h.t });
    }
    return steps;
  }

  /** Summary numbers for a route (used by the generator's checks and the result screen). */
  function routeStats(day, graph, hops, t0) {
    const steps = stepsOf(day, graph, hops);
    const rides = steps.filter((s) => s.type === 'ride');
    const services = day.timetable.services;
    let walking = 0;
    let riding = 0;
    let checks = 0;
    let prevT = t0;
    const transferStations = [];
    for (let i = 1; i < hops.length; i++) {
      const how = hops[i].how;
      const dt = hops[i].t - hops[i - 1].t;
      if (how.type === 'train') riding += how.arr - how.dep;
      else if (how.type === 'walk' || how.type === 'startwalk' || how.type === 'lane') walking += dt;
      if (how.type === 'link' && isChecked(how.link, how.way)) checks += 1;
      prevT = hops[i].t;
    }
    // a transfer is a change of line; getting off and back on the same line
    // (changing cars during a dwell, or turning back) is a "reboard"
    const lines = [];
    let reboards = 0;
    rides.forEach((r, i) => {
      const s = services[r.service];
      if (i > 0 && lines[lines.length - 1] === s.line) reboards += 1;
      else {
        if (i > 0) transferStations.push(s.stops[r.from]);
        lines.push(s.line);
      }
    });
    const total = prevT - t0;
    const hubsVisited = transferStations.filter((id) => day.network.stations.find((s) => s.id === id).kind === 'hub');
    return {
      total,
      walking,
      riding,
      waiting: Math.max(0, total - walking - riding),
      rides: rides.length,
      transfers: Math.max(0, lines.length - 1),
      reboards,
      lines,
      transferStations,
      hubsVisited,
      checks,
      steps,
    };
  }

  /**
   * Static reachability ignoring clocks: can every place reachable from the
   * start still reach the goal? (One-way passages and fixed escalators are
   * the only ways to get stuck.)
   */
  function trapCheck(day, graph, start, goal) {
    const N = graph.nodes.length;
    const fwd = Array.from({ length: N }, () => []);
    const rev = Array.from({ length: N }, () => []);
    const addE = (u, v) => {
      fwd[u].push(v);
      rev[v].push(u);
    };
    for (let u = 0; u < N; u++) {
      for (const e of graph.adj[u]) {
        if (e.type === 'link') {
          const L = e.link;
          if (L.closedUntil === Infinity) continue;
          if (L.kind === 'escalator' && !L.esc.period && L.esc.dir0 !== (e.way === 'ab' ? 1 : -1)) continue;
        }
        addE(u, e.to);
      }
      const boards = graph.boardAt.get(u);
      if (boards) {
        for (const b of boards) {
          for (let m = b.stop + 1; m < b.service.stops.length; m++) addE(u, graph.alightNode(b.service, m, graph.nodes[u].door));
        }
      }
    }
    const reach = (from, lists) => {
      const seen = new Uint8Array(N);
      const stack = [from];
      seen[from] = 1;
      while (stack.length) {
        const u = stack.pop();
        for (const v of lists[u]) if (!seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
      }
      return seen;
    };
    const F = reach(start, fwd);
    const B = reach(goal, rev);
    const traps = [];
    for (let u = 0; u < N; u++) if (F[u] && !B[u]) traps.push(u);
    return { ok: F[goal] === 1 && traps.length === 0, reachable: F[goal] === 1, traps };
  }

  return { buildGraph, nodeAt, solve, pathTo, stepsOf, routeStats, trapCheck, arrive };
});
