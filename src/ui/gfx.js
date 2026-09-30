// Late — canvas helpers: the letterboxed game canvas, the sprite atlas cut
// from the team's sheet, text in the game's fonts, line badges and panels.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});

  const FONT_UI = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Zen Hei", sans-serif';
  const FONT_PIXEL = '"Pixelify Sans", "Courier New", monospace';
  const FONT_CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Zen Hei", sans-serif';

  const PAL = {
    rock: '#12151a',
    rock2: '#181c22',
    wall: '#2a3039',
    wallLine: '#343b46',
    tile: '#e4e2da',
    ceiling: '#1b2027',
    floor: '#59606b',
    floorDark: '#3a4049',
    edge: '#e8c21e',
    ink: '#eef1f5',
    dim: '#98a2b3',
    panel: '#1a1f27',
    panel2: '#232a35',
    red: '#e5484d',
    green: '#30a46c',
    amber: '#f5a524',
    blue: '#3e8ed0',
  };

  const atlas = { img: null, ready: false, frames: {} };

  function loadAtlas() {
    if (atlas.img || typeof Image === 'undefined') return;
    atlas.frames = L.atlas.frames;
    atlas.img = new Image();
    atlas.img.onload = () => {
      atlas.ready = true;
    };
    atlas.img.src = L.atlas.src;
  }

  /**
   * Draw a sprite anchored at its bottom centre (feet on the floor).
   * opts: scale, flip, alpha, anchor ('bottom' | 'center'), tint (css color over it)
   */
  function sprite(ctx, name, x, y, opts = {}) {
    const f = atlas.frames[name];
    if (!f || !atlas.ready) return false;
    const s = opts.scale || 1;
    const w = f[2] * s;
    const h = f[3] * s;
    ctx.save();
    if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
    ctx.translate(Math.round(x), Math.round(y));
    if (opts.rotate) ctx.rotate(opts.rotate);
    if (opts.flip) ctx.scale(-1, 1);
    const oy = opts.anchor === 'center' ? -h / 2 : -h;
    ctx.drawImage(atlas.img, f[0], f[1], f[2], f[3], -w / 2, oy, w, h);
    ctx.restore();
    return true;
  }

  const frameSize = (name) => atlas.frames[name] || [0, 0, 0, 0];

  function font(size, weight = 600, family = FONT_UI) {
    return `${weight} ${size}px ${family}`;
  }

  function text(ctx, str, x, y, o = {}) {
    ctx.save();
    ctx.font = font(o.size || 14, o.weight || 600, o.family === 'pixel' ? FONT_PIXEL : o.family === 'cjk' ? FONT_CJK : FONT_UI);
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.shadow) {
      ctx.shadowColor = o.shadow;
      ctx.shadowBlur = o.blur || 6;
    }
    if (o.stroke) {
      ctx.lineWidth = o.strokeWidth || 3;
      ctx.strokeStyle = o.stroke;
      ctx.lineJoin = 'round';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = o.color || PAL.ink;
    ctx.fillText(str, x, y);
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  function measure(ctx, str, size, weight = 600, family) {
    ctx.save();
    ctx.font = font(size, weight, family === 'pixel' ? FONT_PIXEL : family === 'cjk' ? FONT_CJK : FONT_UI);
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  function roundRect(ctx, x, y, w, h, r, fill, stroke, lw = 1) {
    ctx.beginPath();
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  /** Round line badge with the line number. */
  function badge(ctx, line, x, y, r = 10) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = line.color;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r / 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    text(ctx, String(line.num), x, y + r * 0.38, { size: Math.round(r * 1.15), weight: 800, align: 'center', color: '#fff' });
  }

  const ARROWS = { left: '←', right: '→', up: '↑', down: '↓' };

  function arrowGlyph(ctx, dir, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    const rot = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir] || 0;
    ctx.rotate(rot);
    ctx.fillStyle = color || '#fff';
    const s = size / 2;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(0, -s * 0.8);
    ctx.lineTo(0, -s * 0.32);
    ctx.lineTo(-s, -s * 0.32);
    ctx.lineTo(-s, s * 0.32);
    ctx.lineTo(0, s * 0.32);
    ctx.lineTo(0, s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
  }

  /** Cheap deterministic noise in [0,1) from integers (for cosmetic variety). */
  function hashi(a, b = 0, c = 0) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  L.gfx = { PAL, FONT_UI, FONT_PIXEL, FONT_CJK, atlas, loadAtlas, sprite, frameSize, font, text, measure, roundRect, badge, arrowGlyph, ARROWS, mix, hashi };
})(typeof self !== 'undefined' ? self : this);
