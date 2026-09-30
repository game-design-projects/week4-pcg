// Late — synthesised sound (WebAudio, no files): door chimes, gate beeps,
// footsteps, the train rumble and the crowd murmur. Starts on first input.
(function (root) {
  'use strict';
  const L = (root.Late = root.Late || {});

  let ac = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;
  let rumble = null;
  let murmur = null;

  function ensure() {
    if (ac || muted) return !!ac;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try {
      ac = new AC();
    } catch (e) {
      return false;
    }
    master = ac.createGain();
    master.gain.value = 0.55;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function tone(freq, dur, { type = 'sine', gain = 0.2, delay = 0, slide = 0 } = {}) {
    if (!ensure()) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(dur, { freq = 1200, q = 1, gain = 0.15, delay = 0, type = 'bandpass' } = {}) {
    if (!ensure()) return;
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  function loop(freq, q, gain) {
    if (!ensure()) return null;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return { g, f, target: gain };
  }

  const S = {
    step: () => noise(0.05, { freq: 900 + Math.random() * 400, gain: 0.05 }),
    gate: () => {
      tone(1760, 0.08, { type: 'square', gain: 0.06 });
      noise(0.12, { freq: 400, gain: 0.08, delay: 0.05 });
    },
    blocked: () => tone(110, 0.18, { type: 'sawtooth', gain: 0.08 }),
    lane: () => noise(0.08, { freq: 2000, gain: 0.04 }),
    chime: () => {
      tone(988, 0.5, { gain: 0.14 });
      tone(784, 0.7, { gain: 0.14, delay: 0.32 });
    },
    arrive: () => {
      [659, 784, 988].forEach((f, i) => tone(f, 0.35, { gain: 0.1, delay: i * 0.16, type: 'triangle' }));
    },
    doorsClosing: () => {
      for (let i = 0; i < 4; i++) tone(1320, 0.1, { type: 'square', gain: 0.05, delay: i * 0.22 });
    },
    board: () => noise(0.35, { freq: 500, gain: 0.1, type: 'lowpass' }),
    queue: () => tone(523, 0.25, { type: 'triangle', gain: 0.08 }),
    escalator: () => noise(0.3, { freq: 300, gain: 0.06, type: 'lowpass' }),
    tick: () => tone(2000, 0.03, { type: 'square', gain: 0.04 }),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, { gain: 0.14, delay: i * 0.12, type: 'triangle' })),
    late: () => [392, 370, 349, 311].forEach((f, i) => tone(f, 0.5, { gain: 0.12, delay: i * 0.22, type: 'sawtooth' })),
    phone: () => tone(1480, 0.06, { gain: 0.06 }),
    click: () => tone(880, 0.04, { type: 'square', gain: 0.04 }),
  };

  /** Continuous beds: train rumble (0..1 speed) and crowd murmur (0..1). */
  function beds(train, crowd) {
    if (!ac) return;
    if (!rumble) rumble = loop(180, 0.7, 0.3);
    if (!murmur) murmur = loop(700, 0.4, 0.06);
    const now = ac.currentTime;
    if (rumble) {
      rumble.g.gain.setTargetAtTime(train * 0.28, now, 0.3);
      rumble.f.frequency.setTargetAtTime(120 + train * 220, now, 0.3);
    }
    if (murmur) murmur.g.gain.setTargetAtTime(crowd * 0.05, now, 0.5);
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.55;
  }

  L.audio = { ...S, ensure, beds, setMuted, get muted() { return muted; } };
})(typeof self !== 'undefined' ? self : this);
