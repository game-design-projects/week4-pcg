// Late — wayfinding signs. For every station we work out, from the generated
// layout alone, which way to walk for each line and each exit, and hang signs
// at decision points (stair ends, passage mouths, long corridors). Whether a
// sign is actually shown, or shown out of date, is the display policy's call.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else {
    const L = (root.Late = root.Late || {});
    L.wayfinding = factory(L.rules);
  }
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const { RULES } = R;

  function staticCost(e) {
    if (e.type !== 'link') return e.cost;
    const L = e.link;
    if (L.closedUntil === Infinity) return Infinity;
    let c = 0;
    if (L.check && ((L.check.dir === 1 && e.way === 'ab') || (L.check.dir === -1 && e.way === 'ba'))) c += (L.check.wmin + L.check.wmax) / 2;
    if (L.kind === 'stairs') return c + (e.way === 'ab' ? RULES.STAIRS_DOWN : RULES.STAIRS_UP) * L.levels;
    if (L.kind === 'escalator') {
      if (!L.esc.period && L.esc.dir0 !== (e.way === 'ab' ? 1 : -1)) return Infinity;
      return c + RULES.ESCALATOR * L.levels + (L.esc.period ? L.esc.period / 4 : 0);
    }
    if (L.kind === 'lift') return c + RULES.LIFT_TRAVEL * L.levels * 2 + RULES.LIFT_DWELL * 2;
    if (L.kind === 'gate') return c + RULES.GATE + 20; // leaving the paid area is a big deal
    return c;
  }

  /** Distances (s) from every node of one station to the nearest node in `targets`. */
  function distancesTo(graph, si, targets) {
    const nodes = graph.nodes;
    const dist = new Map();
    // reverse adjacency restricted to this station
    const rev = new Map();
    // signs never send you out onto the street to walk round to another exit
    for (let u = 0; u < nodes.length; u++) {
      if (nodes[u].st !== si || nodes[u].seg === 0) continue;
      for (const e of graph.adj[u]) {
        if (nodes[e.to].st !== si || nodes[e.to].seg === 0) continue;
        const c = staticCost(e);
        if (c === Infinity) continue;
        if (!rev.has(e.to)) rev.set(e.to, []);
        rev.get(e.to).push([u, c]);
      }
    }
    const pq = targets.map((t) => [0, t]);
    for (const t of targets) dist.set(t, 0);
    while (pq.length) {
      let bi = 0;
      for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
      const [d, v] = pq.splice(bi, 1)[0];
      if (d > (dist.get(v) ?? Infinity)) continue;
      for (const [u, c] of rev.get(v) || []) {
        const nd = d + c;
        if (nd < (dist.get(u) ?? Infinity)) {
          dist.set(u, nd);
          pq.push([nd, u]);
        }
      }
    }
    return dist;
  }

  /**
   * @returns [{seg, x, items: [{kind:'line'|'exit', line?, letter?, arrow:'left'|'right'|'up'|'down'}]}]
   */
  function stationSigns(day, graph, stationId) {
    const si = graph.stationIndex.get(stationId);
    const station = day.network.stations[si];
    const I = day.interiors[stationId];
    const targets = [];
    for (const line of station.lines) {
      const ids = [];
      for (const dir of [0, 1]) {
        const dn = graph.doorNodes.get(`${stationId}|${line}|${dir}`);
        if (dn) ids.push(...dn.ids);
      }
      targets.push({ kind: 'line', line, ids });
    }
    for (const e of I.exits) {
      const L = I.links[e.link];
      const id = graph.lookup[si].get(graph.key(L.b.seg, L.b.x, 0));
      targets.push({ kind: 'exit', letter: e.letter, ids: [id] });
    }
    for (const t of targets) t.dist = distancesTo(graph, si, t.ids);

    const signs = [];
    const perSeg = graph.segNodes[si];
    for (const seg of I.segs) {
      if (seg.kind === 'street') continue;
      const ids = perSeg[seg.id][0];
      // hang a sign at every decision node, and every ~35 m on long stretches
      const spots = [];
      for (let i = 0; i < ids.length; i++) {
        const n = graph.nodes[ids[i]];
        const decision = graph.adj[ids[i]].some((e) => e.type === 'link');
        if (decision) spots.push({ node: ids[i], x: n.x });
        if (i + 1 < ids.length) {
          const nx = graph.nodes[ids[i + 1]].x;
          const gap = nx - n.x;
          for (let k = 1; k * 35 < gap - 12; k++) spots.push({ between: [ids[i], ids[i + 1]], x: n.x + k * 35 });
        }
      }
      for (const spot of spots) {
        const items = [];
        for (const t of targets) {
          if (t.ids.includes(spot.node)) continue;
          let best = Infinity;
          let arrow = null;
          const consider = (cost, a) => {
            if (cost < best - 1e-6) {
              best = cost;
              arrow = a;
            }
          };
          if (spot.node !== undefined) {
            for (const e of graph.adj[spot.node]) {
              if (graph.nodes[e.to].st !== si) continue;
              const c = staticCost(e);
              const d = t.dist.get(e.to);
              if (c === Infinity || d === undefined) continue;
              const to = graph.nodes[e.to];
              let a;
              if (e.type === 'link' && e.link.axis === 'v') a = e.way === 'ab' ? 'down' : 'up';
              else if (e.type === 'link') a = e.way === 'ab' ? 'right' : 'left'; // gates and joints sit at one x
              else if (e.type === 'lane') continue;
              else a = to.x > spot.x ? 'right' : 'left';
              consider(c + d, a);
            }
          } else {
            const [l, r] = spot.between;
            const dl = t.dist.get(l);
            const dr = t.dist.get(r);
            if (dl !== undefined) consider(dl + (spot.x - graph.nodes[l].x) / RULES.WALK, 'left');
            if (dr !== undefined) consider(dr + (graph.nodes[r].x - spot.x) / RULES.WALK, 'right');
          }
          if (arrow && best < 3600) items.push({ kind: t.kind, line: t.line, letter: t.letter, arrow, cost: Math.round(best) });
        }
        const last = signs[signs.length - 1];
        if (items.length && !(last && last.seg === seg.id && Math.abs(last.x - spot.x) < 14)) {
          signs.push({ seg: seg.id, x: spot.x, items: items.sort((a, b) => (a.kind === b.kind ? a.cost - b.cost : a.kind === 'line' ? -1 : 1)) });
        }
      }
    }
    return signs;
  }

  const FLIP = { left: 'right', right: 'left', up: 'down', down: 'up' };

  return { stationSigns, FLIP, staticCost };
});
