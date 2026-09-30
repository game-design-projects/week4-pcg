// Late — station interiors, drawn and played as a side-on cross-section.
//
// A station is a set of floor SEGMENTS (horizontal walkable strips at a depth:
// 0 street, 1 concourse, 2+ platforms and passages) joined by LINKS:
//   vertical   stairs, escalators (some reverse on a timer), lifts
//   horizontal fare gates, and joints inside passages (where checkpoints and
//              closures can later be placed)
// Every segment has a corridor type: two-way, one-way, or opposing (two lanes
// that flow in opposite directions).
//
// Plain and transfer stations are one or two BLOCKS. Hubs (3+ lines) are built
// from several blocks side by side, linked in one of four flavours:
//   sprawl  long passages between blocks
//   maze    paired one-way passages on two levels, easy to take the wrong one
//   split   two halves with no paid link: leave through the gates, walk the
//           unpaid underpass, come back in
//   deep    blocks whose platforms sit several levels down, reached by chains
//           of escalators and a lift
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else {
    const L = (root.Late = root.Late || {});
    L.interior = factory(L.rules);
  }
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const { RULES } = R;
  const BLOCK_W = 150;
  const TRAIN_X0 = 15; //  block-local x of the stopped train's left end
  const PLAT_X0 = 9;
  const PLAT_X1 = 141;
  const DOOR_REL = RULES.DOORS.map((d) => TRAIN_X0 + d); // 27 51 75 99 123
  const FEET_REL = [39, 63, 87, 111]; // between doors: stair feet never sit in a doorway
  const RUN = RULES.RUN_PER_LEVEL;
  const STREET_MARGIN = 70;

  // ------------------------------------------------------------ builder

  function create(station) {
    return {
      stationId: station.id,
      kind: station.kind,
      flavor: station.flavor || null,
      layout: null,
      segs: [],
      links: [],
      platforms: [],
      exits: [],
      doors: [], // street doors: home / office candidates
      props: [],
      blocks: [],
      poi: [], // per segment: [{x, kind}]
      street: null,
      width: 0,
      maxDepth: 1,
    };
  }

  function addSeg(I, o) {
    const seg = {
      id: I.segs.length,
      depth: o.depth,
      x0: o.x0,
      x1: o.x1,
      kind: o.kind,
      flow: o.flow || 'two-way',
      dir: o.dir || 1,
      block: o.block ?? -1,
      platform: null,
    };
    if (seg.x1 - seg.x0 < 4) throw new Error(`segment too short (${seg.x1 - seg.x0} m)`);
    I.segs.push(seg);
    I.poi.push([]);
    I.maxDepth = Math.max(I.maxDepth, seg.depth);
    return seg;
  }

  const inside = (seg, x, margin) => x >= seg.x0 + margin && x <= seg.x1 - margin;

  function free(I, seg, x, gap) {
    return I.poi[seg.id].every((p) => Math.abs(p.x - x) >= gap);
  }

  function mark(I, seg, x, kind) {
    I.poi[seg.id].push({ x, kind });
  }

  /** Vertical link. `upper` has the smaller depth; a = upper end, b = lower end. */
  function addVLink(I, kind, upper, ux, lower, lx, extra) {
    const link = {
      id: I.links.length,
      kind,
      axis: 'v',
      a: { seg: upper.id, x: ux },
      b: { seg: lower.id, x: lx },
      levels: lower.depth - upper.depth,
      ...extra,
    };
    if (link.levels < 1) throw new Error('vertical link must go down');
    I.links.push(link);
    mark(I, upper, ux, kind);
    mark(I, lower, lx, kind);
    return link;
  }

  /** Horizontal link across the shared boundary of two segments at the same depth. */
  function addHLink(I, kind, left, right) {
    if (left.depth !== right.depth || Math.abs(left.x1 - right.x0) > 1e-6) throw new Error('hlink needs touching segments');
    const link = { id: I.links.length, kind, axis: 'h', a: { seg: left.id, x: left.x1 }, b: { seg: right.id, x: right.x0 }, levels: 0 };
    I.links.push(link);
    mark(I, left, left.x1, kind);
    mark(I, right, right.x0, kind);
    return link;
  }

  function escalatorSpec(rng, P, preferDir) {
    if (rng.chance(P.reversibleShare)) {
      const period = rng.int(P.escPeriod[0], P.escPeriod[1]);
      return { dir0: rng.chance(0.5) ? 1 : -1, period, phase: rng.int(0, period - 1) };
    }
    return { dir0: preferDir || (rng.chance(0.5) ? 1 : -1), period: 0, phase: 0 };
  }

  /**
   * A bank of stairs (and usually an escalator beside them) between two
   * segments. Tries the candidate feet in random order.
   */
  function bank(I, rng, P, upper, lower, feet, opts = {}) {
    const levels = lower.depth - upper.depth;
    const want = opts.count || 1;
    let made = 0;
    for (const f of rng.shuffle(feet)) {
      if (made >= want) break;
      for (const s of rng.shuffle([1, -1])) {
        const ux = f + s * RUN * levels;
        if (!inside(upper, ux, 2.5) || !inside(lower, f, 2.5)) continue;
        if (!free(I, upper, ux, 3) || !free(I, lower, f, 3)) continue;
        const escOnly = made > 0 && rng.chance(P.escOnlyShare);
        let stairs = null;
        if (!escOnly) stairs = addVLink(I, 'stairs', upper, ux, lower, f, {});
        let esc = null;
        if (escOnly || rng.chance(opts.escChance ?? P.escalatorShare)) {
          for (const off of rng.shuffle([4, -4])) {
            const f2 = f + off;
            const u2 = f2 + s * RUN * levels;
            if (inside(upper, u2, 2.5) && inside(lower, f2, 2.5) && free(I, upper, u2, 2.5) && free(I, lower, f2, 2.5)) {
              esc = addVLink(I, 'escalator', upper, u2, lower, f2, { esc: escalatorSpec(rng, P, opts.escDir) });
              break;
            }
          }
        }
        if (!stairs && !esc) continue;
        made += 1;
        break;
      }
    }
    return made;
  }

  function addLift(I, rng, upper, lower, xs) {
    for (const x of xs) {
      if (inside(upper, x, 3) && inside(lower, x, 3) && free(I, upper, x, 4) && free(I, lower, x, 4)) {
        return addVLink(I, 'lift', upper, x, lower, x, { lift: { levels: lower.depth - upper.depth, phase: rng.int(0, 60) } });
      }
    }
    return null;
  }

  function addPlatform(I, block, bx, depth, tracks) {
    const seg = addSeg(I, { depth, x0: bx + PLAT_X0, x1: bx + PLAT_X1, kind: 'platform', block });
    const platform = { id: I.platforms.length, seg: seg.id, tracks, trainX0: bx + TRAIN_X0, doors: DOOR_REL.map((d) => bx + d) };
    seg.platform = platform.id;
    I.platforms.push(platform);
    platform.doors.forEach((x) => mark(I, seg, x, 'door'));
    return seg;
  }

  /** Concourse at depth 1: unpaid | gates | paid | gates | unpaid, exits up to the street. */
  function addConcourse(I, rng, P, block, bx, busy) {
    const uL = rng.int(22, 30);
    const uR = rng.int(22, 30);
    const unpaidL = addSeg(I, { depth: 1, x0: bx, x1: bx + uL, kind: 'unpaid', block });
    const paid = addSeg(I, { depth: 1, x0: bx + uL, x1: bx + BLOCK_W - uR, kind: 'paid', block });
    const unpaidR = addSeg(I, { depth: 1, x0: bx + BLOCK_W - uR, x1: bx + BLOCK_W, kind: 'unpaid', block });
    const gateL = addHLink(I, 'gate', unpaidL, paid);
    const gateR = addHLink(I, 'gate', paid, unpaidR);
    // rush hour: busy concourses run as two opposing lanes, and the halls by the
    // exits carry the crowd coming in while you try to get out
    const lanes = (seg, share) => {
      if (!rng.chance(share)) return;
      seg.flow = 'opposing';
      seg.dir = rng.chance(P.keepLeftShare) ? -1 : 1;
    };
    if (busy) lanes(paid, P.concourseOpposingShare);
    lanes(unpaidL, P.unpaidOpposingShare);
    lanes(unpaidR, P.unpaidOpposingShare);
    // exits: stairs from each unpaid end up to the street (a few stations lose one side)
    const sides = rng.chance(0.15) ? [rng.pick([-1, 1])] : [-1, 1];
    for (const side of sides) {
      const seg = side < 0 ? unpaidL : unpaidR;
      const foot = side < 0 ? seg.x0 + 5 : seg.x1 - 5;
      addVLink(I, 'stairs', I.street, foot + side * RUN, seg, foot, { exit: true });
    }
    return { unpaidL, paid, unpaidR, gateL, gateR };
  }

  /**
   * Passage between two segments at the same depth, split into parts joined
   * by 'joint' links (candidate checkpoint / closure sites).
   */
  function addPassage(I, rng, P, left, right, opts = {}) {
    const x0 = left.x1;
    const x1 = right.x0;
    const len = x1 - x0;
    if (len < 8) {
      addHLink(I, 'joint', left, right);
      return [];
    }
    const parts = len > 110 ? 3 : len > 36 ? 2 : 1;
    const cuts = [x0];
    for (let i = 1; i < parts; i++) cuts.push(Math.round(x0 + (len * i) / parts + rng.float(-len / (parts * 5), len / (parts * 5))));
    cuts.push(x1);
    const segs = [];
    for (let i = 0; i < parts; i++) {
      const flow = opts.flow || passageFlow(rng, P);
      const dir = opts.dir || (flow === 'opposing' ? (rng.chance(P.keepLeftShare) ? -1 : 1) : rng.chance(0.5) ? 1 : -1);
      segs.push(addSeg(I, { depth: left.depth, x0: cuts[i], x1: cuts[i + 1], kind: opts.kind || 'passage', flow, dir, block: -1 }));
    }
    addHLink(I, 'joint', left, segs[0]);
    for (let i = 1; i < segs.length; i++) addHLink(I, 'joint', segs[i - 1], segs[i]);
    addHLink(I, 'joint', segs[segs.length - 1], right);
    return segs;
  }

  function passageFlow(rng, P) {
    return rng.chance(P.opposingShare) ? 'opposing' : 'two-way';
  }

  // ------------------------------------------------------------ blocks

  /**
   * One block: its own concourse and 1-2 platforms (or a deep stack of halls).
   * spec.platforms: [{tracks}] top to bottom; spec.deep: extra hall levels above the first platform.
   */
  function addBlock(I, rng, P, index, bx, spec) {
    const cc = addConcourse(I, rng, P, index, bx, I.kind !== 'plain');
    const block = { index, bx, concourse: cc, platforms: [], halls: [], left2: null, right2: null, maxDepth: 1 };
    let upper = cc.paid;
    let depth = 2;
    const deep = spec.deep || 0;
    for (let h = 0; h < deep; h++) {
      const hall = addSeg(I, { depth, x0: bx + 4, x1: bx + BLOCK_W - 4, kind: 'hall', block: index });
      const feet = upper === cc.paid ? FEET_REL.map((f) => bx + f) : [bx + 26, bx + 52, bx + 78, bx + 104, bx + 126];
      if (!bank(I, rng, P, upper, hall, feet, { count: 2, escChance: 0.85 })) throw new Error('no bank into hall');
      block.halls.push(hall);
      upper = hall;
      depth += 1;
    }
    spec.platforms.forEach((pl, i) => {
      const seg = addPlatform(I, index, bx, depth, pl.tracks);
      const feet = FEET_REL.map((f) => bx + f);
      const count = i === 0 && !deep ? 2 : rng.int(1, 2);
      if (!bank(I, rng, P, upper, seg, feet, { count })) throw new Error('no bank to platform');
      block.platforms.push(seg);
      upper = seg;
      depth += 1;
    });
    if (deep) {
      const lift = addLift(I, rng, cc.paid, block.platforms[0], [bx + 117, bx + 33, bx + 45, bx + 105, bx + 57, bx + 93]);
      if (lift) block.lift = lift;
    }
    const top = deep ? block.halls[0] : block.platforms[0];
    block.left2 = top;
    block.right2 = top;
    block.maxDepth = depth - 1;
    I.blocks.push(block);
    return block;
  }

  const island = (line) => ({ far: { line, dir: 0 }, near: { line, dir: 1 } });

  // ------------------------------------------------------------ station types

  function buildPlain(I, rng, P, lines) {
    const [a] = lines;
    if (rng.chance(0.2)) {
      I.layout = 'stacked-sides';
      addBlock(I, rng, P, 0, 0, { platforms: [{ tracks: { far: { line: a, dir: 0 }, near: null } }, { tracks: { far: null, near: { line: a, dir: 1 } } }] });
    } else {
      I.layout = 'island';
      addBlock(I, rng, P, 0, 0, { platforms: [{ tracks: island(a) }] });
    }
  }

  function buildTransfer(I, rng, P, lines) {
    const [a, b] = rng.shuffle(lines);
    const layout = rng.weighted([['stacked', 3], ['cross', 2], ['side', 3], ['side-maze', P.mazeTransferShare * 8]]);
    I.layout = layout;
    if (layout === 'stacked') {
      addBlock(I, rng, P, 0, 0, { platforms: [{ tracks: island(a) }, { tracks: island(b) }] });
    } else if (layout === 'cross') {
      addBlock(I, rng, P, 0, 0, {
        platforms: [{ tracks: { far: { line: a, dir: 0 }, near: { line: b, dir: 0 } } }, { tracks: { far: { line: a, dir: 1 }, near: { line: b, dir: 1 } } }],
      });
    } else {
      const gap = rng.int(24, 70);
      const A = addBlock(I, rng, P, 0, 0, { platforms: [{ tracks: island(a) }] });
      const B = addBlock(I, rng, P, 1, BLOCK_W + gap, { platforms: [{ tracks: island(b) }] });
      if (layout === 'side') addPassage(I, rng, P, A.right2, B.left2);
      else mazeLink(I, rng, P, A, B);
      if (rng.chance(0.5)) addPassage(I, rng, P, A.concourse.unpaidR, B.concourse.unpaidL, { kind: 'underpass' });
    }
  }

  /**
   * Two one-way passages between neighbouring blocks: one along the platform
   * level, and a second one level below everything that flows the other way.
   * The lower passage runs exactly between its two stair feet, so walking to
   * either end always leaves you at a staircase (a stub past the last stairs
   * of a one-way passage would be a dead end).
   */
  function mazeLink(I, rng, P, A, B) {
    const eastTop = rng.chance(0.5);
    addPassage(I, rng, P, A.right2, B.left2, { flow: 'one-way', dir: eastTop ? 1 : -1 });
    const depth = Math.max(A.maxDepth, B.maxDepth) + 1;
    const upA = A.right2;
    const upB = B.left2;
    const levelsA = depth - upA.depth;
    const levelsB = depth - upB.depth;
    const topsA = [];
    const topsB = [];
    for (let d = 6; d <= 40; d += 2) {
      topsA.push(upA.x1 - d);
      topsB.push(upB.x0 + d);
    }
    const topA = topsA.find((x) => inside(upA, x, 2.5) && free(I, upA, x, 3) && free(I, upA, x + 4, 2.5));
    const topB = topsB.find((x) => inside(upB, x, 2.5) && free(I, upB, x, 3) && free(I, upB, x - 4, 2.5));
    if (topA === undefined || topB === undefined) throw new Error('maze stairs do not fit');
    const footA = topA + RUN * levelsA;
    const footB = topB - RUN * levelsB;
    if (footB - footA < 30) throw new Error('maze lower passage too short');
    const lower = addSeg(I, { depth, x0: footA, x1: footB, kind: 'passage', flow: 'one-way', dir: eastTop ? -1 : 1, block: -1 });
    addVLink(I, 'stairs', upA, topA, lower, footA, {});
    addVLink(I, 'stairs', upB, topB, lower, footB, {});
    if (rng.chance(P.escalatorShare)) addVLink(I, 'escalator', upA, topA + 4, lower, footA + 4, { esc: escalatorSpec(rng, P) });
    if (rng.chance(P.escalatorShare)) addVLink(I, 'escalator', upB, topB - 4, lower, footB - 4, { esc: escalatorSpec(rng, P) });
    return lower;
  }

  function buildHub(I, rng, P, lines, flavor) {
    I.layout = `hub-${flavor}`;
    const order = rng.shuffle(lines);
    // one line per block; a fifth line shares a block (stacked)
    const groups = [];
    for (const l of order) {
      if (groups.length < 4) groups.push([l]);
      else groups[rng.int(0, groups.length - 1)].push(l);
    }
    const gapRange = flavor === 'sprawl' ? P.sprawlGap : [28, 64];
    const blocks = [];
    let bx = 0;
    const deepPick = flavor === 'deep' ? new Set(rng.shuffle(groups.map((_, i) => i)).slice(0, Math.max(1, Math.floor(groups.length / 2)))) : new Set();
    groups.forEach((g, i) => {
      const deep = deepPick.has(i) ? rng.int(1, 3) : 0;
      const platforms = g.map((line) => ({ tracks: island(line) }));
      blocks.push(addBlock(I, rng, P, i, bx, { platforms, deep }));
      bx += BLOCK_W + rng.int(gapRange[0], gapRange[1]);
    });
    const splitAt = flavor === 'split' ? rng.int(1, blocks.length - 1) : -1;
    for (let i = 0; i < blocks.length - 1; i++) {
      const A = blocks[i];
      const B = blocks[i + 1];
      if (i + 1 === splitAt) {
        // no paid link: the halves meet only through an unpaid underpass (and the street)
        const segs = addPassage(I, rng, P, A.concourse.unpaidR, B.concourse.unpaidL, { kind: 'underpass', flow: 'opposing', dir: 1 });
        I.splitGate = B.concourse.gateL.id;
        I.splitUnderpass = segs.map((s) => s.id);
      } else if (flavor === 'maze') {
        mazeLink(I, rng, P, A, B);
      } else {
        addPassage(I, rng, P, A.right2, B.left2, flavor === 'sprawl' ? { flow: 'opposing' } : {});
        if (flavor === 'sprawl' && rng.chance(0.5)) addPassage(I, rng, P, A.concourse.unpaidR, B.concourse.unpaidL, { kind: 'underpass' });
      }
    }
  }

  // ------------------------------------------------------------ cosmetic props

  const PROPS = {
    platform: ['prop_bench', 'prop_seats_blue', 'prop_seats_gray', 'prop_bin', 'prop_vending', 'prop_mapboard', 'prop_firebox'],
    paid: ['prop_vending', 'prop_plant', 'prop_mapboard', 'prop_bin', 'prop_plant_s'],
    unpaid: ['prop_ticket', 'prop_ticket', 'prop_mapboard', 'prop_plant'],
    passage: ['prop_plant_s', 'prop_firebox', 'prop_ebox', 'prop_bin'],
    underpass: ['prop_ebox', 'prop_cone', 'prop_wetfloor'],
    hall: ['prop_plant', 'prop_mapboard', 'prop_bin'],
    street: ['prop_plant', 'prop_bin', 'prop_cone'],
  };

  function addProps(I, rng) {
    for (const seg of I.segs) {
      const kinds = PROPS[seg.kind];
      if (!kinds) continue;
      const len = seg.x1 - seg.x0;
      const n = Math.floor(len / (seg.kind === 'platform' ? 22 : 30));
      for (let i = 0; i < n; i++) {
        const x = rng.float(seg.x0 + 3, seg.x1 - 3);
        if (!free(I, seg, x, 3.5) || I.props.some((p) => p.seg === seg.id && Math.abs(p.x - x) < 6)) continue;
        I.props.push({ seg: seg.id, x: Math.round(x * 10) / 10, kind: rng.pick(kinds) });
      }
    }
  }

  // ------------------------------------------------------------ entry point

  function checkOverlaps(I) {
    const byDepth = new Map();
    for (const s of I.segs) {
      if (!byDepth.has(s.depth)) byDepth.set(s.depth, []);
      byDepth.get(s.depth).push(s);
    }
    for (const list of byDepth.values()) {
      list.sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < list.length; i++) {
        if (list[i].x0 < list[i - 1].x1 - 1e-6) throw new Error(`segments overlap at depth ${list[i].depth}`);
      }
    }
  }

  /**
   * @param station network station
   * @param rng     a fork for this station
   * @param P       difficulty params
   */
  function buildInterior(station, rng, P) {
    const I = create(station);
    // the street spans the whole station; its right end is set once the width is known
    const street = { id: 0, depth: 0, x0: -STREET_MARGIN, x1: 0, kind: 'street', flow: 'two-way', dir: 1, block: -1, platform: null };
    I.segs.push(street);
    I.poi.push([]);
    I.street = street;
    const lines = station.lines.slice();
    if (station.kind === 'hub') buildHub(I, rng, P, lines, station.flavor || 'sprawl');
    else if (station.kind === 'transfer') buildTransfer(I, rng, P, lines);
    else buildPlain(I, rng, P, lines);
    const right = Math.max(...I.segs.filter((s) => s !== street).map((s) => s.x1));
    I.width = right;
    street.x1 = right + STREET_MARGIN;
    // exits get letters left to right
    I.links
      .filter((l) => l.exit)
      .sort((p, q) => p.a.x - q.a.x)
      .forEach((l, i) => {
        l.exitLetter = String.fromCharCode(65 + i);
        I.exits.push({ link: l.id, letter: l.exitLetter, x: l.a.x });
      });
    // street doors: both far ends (home candidates) and one beside each exit (office candidates)
    for (const x of [street.x0 + 14, street.x1 - 14]) {
      I.doors.push({ x, kind: 'end' });
      mark(I, street, x, 'door');
    }
    for (const e of I.exits) {
      for (const side of rng.shuffle([1, -1])) {
        const x = Math.round(e.x + side * rng.float(16, 30));
        if (inside(street, x, 16) && free(I, street, x, 8)) {
          I.doors.push({ x, kind: 'exit', exit: e.letter });
          mark(I, street, x, 'door');
          break;
        }
      }
    }
    checkOverlaps(I);
    addProps(I, rng.fork('props'));
    return I;
  }

  return { buildInterior, BLOCK_W, TRAIN_X0, DOOR_REL, STREET_MARGIN };
});
