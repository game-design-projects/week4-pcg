// Late — keyboard and touch input, turned into the simulation's key mask.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});

  const held = new Set();
  const pressed = [];
  const touch = new Set();
  const MAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    KeyE: 'act', Enter: 'act',
    Space: 'wait', ShiftLeft: 'wait', ShiftRight: 'wait',
    KeyM: 'map', Tab: 'map', KeyT: 'timetable',
    Escape: 'pause', KeyP: 'pause', KeyH: 'help',
  };

  function onKey(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = MAP[e.code];
    if (!k) return;
    if (['up', 'down', 'left', 'right', 'wait', 'map'].includes(k)) e.preventDefault();
    if (down) {
      if (!held.has(k)) pressed.push(k);
      held.add(k);
    } else held.delete(k);
  }

  function init() {
    root.addEventListener('keydown', (e) => onKey(e, true));
    root.addEventListener('keyup', (e) => onKey(e, false));
    root.addEventListener('blur', () => held.clear());
  }

  const is = (k) => held.has(k) || touch.has(k);

  /** Simulation key mask (see sim.js KEY). */
  function mask() {
    const K = L.sim.KEY;
    let m = 0;
    if (is('left')) m |= K.LEFT;
    if (is('right')) m |= K.RIGHT;
    if (is('up')) m |= K.UP;
    if (is('down')) m |= K.DOWN;
    if (is('act')) m |= K.ACT;
    return m;
  }

  /** Keys pressed since the last call (for menus and toggles). */
  function drain() {
    return pressed.splice(0, pressed.length);
  }

  /** On-screen buttons for touch devices. */
  function mountTouch(el) {
    const pads = [
      ['left', '◀'], ['right', '▶'], ['up', '▲'], ['down', '▼'], ['act', 'E'], ['wait', '⏩'], ['map', '🗺'],
    ];
    el.innerHTML = '';
    for (const [k, label] of pads) {
      const b = document.createElement('button');
      b.className = `tbtn tbtn-${k}`;
      b.textContent = label;
      b.setAttribute('aria-label', k);
      const on = (ev) => {
        ev.preventDefault();
        if (!touch.has(k)) pressed.push(k);
        touch.add(k);
      };
      const off = (ev) => {
        ev.preventDefault();
        touch.delete(k);
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      el.appendChild(b);
    }
  }

  L.input = { init, mask, drain, is, mountTouch, held };
})(typeof self !== 'undefined' ? self : this);
