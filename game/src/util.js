// util.js — SOLMAR BAY shared helpers: seeded RNG, math, keyboard/mouse input,
// procedural WebAudio (no files, no network). Everything deterministic except input.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// ---- Input: keyboard state + mouse drag orbit + click edges ----
export class Input {
  constructor(canvas) {
    this.keys = {};
    this.pressed = {}; // edge-triggered, consumed by the game each frame
    this.mouseDX = 0; this.mouseDY = 0;
    this.mouseDown = false; this.clicked = false;
    this.dragging = false; this.lastX = 0; this.lastY = 0;
    this.enabled = true;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true; this.pressed[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true; this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
    });
    addEventListener('mouseup', (e) => {
      if (this.mouseDown && Math.hypot(e.clientX - this.lastX, e.clientY - this.lastY) < 5) this.clicked = true;
      this.mouseDown = false; this.dragging = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.mouseDX += e.clientX - this.lastX; this.mouseDY += e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    // programmatic key injection for self-tests / shot presets
    this.inject = (code, down) => { this.keys[code] = down; if (down) this.pressed[code] = true; };
  }
  down(code) { return !!this.keys[code]; }
  hit(code) { const v = !!this.pressed[code]; if (v) this.pressed[code] = false; return v; }
  consumeMouse() { const dx = this.mouseDX, dy = this.mouseDY; this.mouseDX = 0; this.mouseDY = 0; return { dx, dy }; }
  consumeClick() { const c = this.clicked; this.clicked = false; return c; }
  endFrame() { this.pressed = {}; this.mouseDX = 0; this.mouseDY = 0; this.clicked = false; }
}

// ---- Procedural audio: WebAudio only, created lazily on first gesture ----
export class AudioEngine {
  constructor() {
    this.ctx = null; this.master = null; this.musicTimer = null;
    this.engineOsc = null; this.engineGain = null;
    this.sirenOsc = null; this.sirenLfo = null;
    this.enabled = true; this.musicStep = 0;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      return true;
    } catch { return false; }
  }
  _noiseBuf(dur = 0.3) {
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  }
  blip(freq, dur, type = 'square', vol = 0.2, slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur = 0.2, vol = 0.3, filterFreq = 1200) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf(dur);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  }
  sfx(name) {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case 'shoot': this.noise(0.12, 0.5, 3000); this.blip(220, 0.08, 'square', 0.15, 60); break;
      case 'punch': this.noise(0.08, 0.3, 500); break;
      case 'pickup': this.blip(660, 0.09, 'sine', 0.25); setTimeout(() => this.blip(990, 0.12, 'sine', 0.25), 90); break;
      case 'cash': this.blip(880, 0.08, 'sine', 0.22); setTimeout(() => this.blip(1174, 0.1, 'sine', 0.22), 80); setTimeout(() => this.blip(1568, 0.16, 'sine', 0.22), 160); break;
      case 'mission': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.18, 'triangle', 0.25), i * 110)); break;
      case 'fail': [400, 300, 200].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'sawtooth', 0.15), i * 130)); break;
      case 'enterCar': this.blip(180, 0.12, 'square', 0.15, 320); break;
      case 'horn': this.blip(370, 0.25, 'sawtooth', 0.12); this.blip(466, 0.25, 'sawtooth', 0.1); break;
      case 'crash': this.noise(0.3, 0.5, 700); break;
      case 'busted': [330, 262, 196].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 'triangle', 0.25), i * 200)); break;
      case 'click': this.blip(1200, 0.04, 'sine', 0.15); break;
      case 'spray': this.noise(0.5, 0.25, 5000); break;
    }
  }
  engineStart() {
    if (!this.ctx || this.engineOsc) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 50; g.gain.value = 0.0;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    o.connect(f); f.connect(g); g.connect(this.master); o.start();
    this.engineOsc = o; this.engineGain = g;
  }
  engineSet(speedNorm, on) {
    if (!this.engineOsc) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(on ? 0.05 + speedNorm * 0.06 : 0.0, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(45 + speedNorm * 140, t, 0.1);
  }
  sirenStart() {
    if (!this.ctx || this.sirenOsc) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle'; g.gain.value = 0.045;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.7;
    const lg = this.ctx.createGain(); lg.gain.value = 220;
    lfo.connect(lg); lg.connect(o.frequency); o.frequency.value = 700;
    o.connect(g); g.connect(this.master); o.start(); lfo.start();
    this.sirenOsc = o; this.sirenLfo = lfo;
  }
  sirenStop() {
    if (!this.sirenOsc) return;
    try { this.sirenOsc.stop(); this.sirenLfo.stop(); } catch { /* already stopped */ }
    this.sirenOsc = null; this.sirenLfo = null;
  }
  musicStart() {
    if (!this.ctx || this.musicTimer) return;
    // Lo-fi bass + hats loop: 8th-note steps at 100 BPM, minor key groove.
    const bass = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 58.3, 0, 73.4, 0];
    this.musicTimer = setInterval(() => {
      if (!this.enabled) return;
      const step = this.musicStep++ % 16;
      const f = bass[step];
      if (f) this.blip(f, 0.22, 'triangle', 0.16);
      if (step % 2 === 0) this.noise(0.03, 0.05, 6000);
      if (step === 0 || step === 8) this.blip(220, 0.1, 'sine', 0.05);
    }, 150);
  }
  musicStop() { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; } }
}
