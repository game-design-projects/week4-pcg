// Seeded randomness: the same seed string always gives the same numbers.
(function (root) {
  'use strict';

  // FNV-1a style string hash, spread into four 32-bit words for sfc32.
  function hashString(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x5bd1e995);
      h3 = Math.imul(h3 ^ c, 0x27d4eb2d);
      h4 = Math.imul(h4 ^ c, 0x165667b1);
    }
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }

  // sfc32: small, fast, and good enough for level generation.
  function RNG(seed) {
    let [a, b, c, d] = hashString(String(seed));
    this.next = function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
    for (let i = 0; i < 12; i++) this.next();
  }
  RNG.prototype.float = function () { return this.next(); };
  RNG.prototype.range = function (lo, hi) { return lo + (hi - lo) * this.next(); };
  RNG.prototype.int = function (lo, hi) { return lo + Math.floor((hi - lo + 1) * this.next()); };
  RNG.prototype.chance = function (p) { return this.next() < p; };
  RNG.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };

  // Smooth 2D value noise in [-1, 1], with its own lattice drawn from the seed.
  function valueNoise(seed, scale) {
    const rng = new RNG(seed + ':noise');
    const N = 256, table = new Float32Array(N * N);
    for (let i = 0; i < table.length; i++) table[i] = rng.float() * 2 - 1;
    const at = (x, y) => table[((y & (N - 1)) * N) + (x & (N - 1))];
    const fade = (t) => t * t * (3 - 2 * t);
    return function (x, y) {
      x /= scale; y /= scale;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = fade(x - x0), fy = fade(y - y0);
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    };
  }

  // Short readable seed for new dives, e.g. "K7Q2ZP".
  function randomSeed() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  const api = { RNG, hashString, valueNoise, randomSeed };
  root.CaveRNG = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
