// Late — seeded randomness. Every generated thing comes from one seed string
// through labelled forks, so the same seed always gives the same day and a
// change in one part of the generator does not reshuffle the others.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.Late = root.Late || {}).rng = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 128-bit string hash (cyrb128) → four 32-bit words. */
  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
      const k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= h2 ^ h3 ^ h4;
    h2 ^= h1;
    h3 ^= h1;
    h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }

  /** Small fast PRNG (sfc32) over four 32-bit words; returns floats in [0, 1). */
  function sfc32(a, b, c, d) {
    return function next() {
      a |= 0; b |= 0; c |= 0; d |= 0;
      const t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  /**
   * A seeded generator. `fork(label)` gives an independent stream for a
   * sub-task (one per station, one per line...), derived only from the seed
   * and the label.
   */
  function makeRng(seed) {
    const s = String(seed);
    const next = sfc32(...cyrb128(s));
    for (let i = 0; i < 15; i++) next();
    const rng = {
      seed: s,
      next,
      float: (lo, hi) => lo + (hi - lo) * next(),
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      chance: (p) => next() < p,
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      /** Pick from [[item, weight], ...]. */
      weighted(pairs) {
        let total = 0;
        for (const [, w] of pairs) total += w;
        let r = next() * total;
        for (const [item, w] of pairs) {
          r -= w;
          if (r < 0) return item;
        }
        return pairs[pairs.length - 1][0];
      },
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
      fork: (label) => makeRng(`${s}/${label}`),
    };
    return rng;
  }

  /** Deterministic float in [0, 1) from any list of values (used for checkpoint waits). */
  function hash01(...parts) {
    return cyrb128(parts.join('|'))[0] / 4294967296;
  }

  const SEED_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  /** A fresh human-friendly seed like "K7Q2-M4XP" (UI only; not used by the generator itself). */
  function randomSeedCode(random) {
    const r = random || (() => {
      const c = typeof globalThis !== 'undefined' && globalThis.crypto;
      if (c && c.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] / 4294967296;
      return Math.random();
    });
    let out = '';
    for (let i = 0; i < 8; i++) {
      if (i === 4) out += '-';
      out += SEED_ALPHABET[Math.floor(r() * SEED_ALPHABET.length)];
    }
    return out;
  }

  /** Seed shared by everyone on a calendar day, e.g. "DAILY-2026-09-30". */
  function dailySeed(date) {
    const d = date || new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `DAILY-${y}-${m}-${day}`;
  }

  function cleanSeed(s) {
    return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
  }

  return { makeRng, hash01, cyrb128, randomSeedCode, dailySeed, cleanSeed };
});
