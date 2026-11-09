// Sound and motion effects. Sounds are synthesized with the Web Audio API (no audio files), short and quiet,
// and can be muted from the header (remembered on this device). Motion respects prefers-reduced-motion.
const PREF = 'scan-sound';
let ctx = null, master = null;
let enabled = (() => { try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; } })();
export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function ac() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.22; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// one enveloped oscillator note
function tone(freq, { t = 0, dur = 0.12, type = 'sine', vol = 1, glide = null, attack = 0.008 } = {}) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + t;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise({ t = 0, dur = 0.3, vol = 0.5, from = 1200, to = 200 } = {}) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + t;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(from, t0); f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t0);
}

export const sfx = {
  get on() { return enabled; },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(PREF, enabled ? 'on' : 'off'); } catch { /* ignore */ }
    if (enabled) this.click();
    return enabled;
  },
  click() { tone(1400, { dur: 0.03, type: 'square', vol: 0.12 }); },
  select() { tone(880, { dur: 0.05, type: 'triangle', vol: 0.25 }); },
  tab() { tone(660, { dur: 0.04, type: 'triangle', vol: 0.18, glide: 990 }); },
  correct() { tone(784, { dur: 0.12, type: 'triangle', vol: 0.5 }); tone(1175, { t: 0.09, dur: 0.22, type: 'triangle', vol: 0.45 }); },
  wrong() { tone(220, { dur: 0.22, type: 'sawtooth', vol: 0.25, glide: 150 }); tone(165, { t: 0.05, dur: 0.25, type: 'square', vol: 0.12 }); },
  streak(n) { const base = 660 * Math.pow(1.06, Math.min(n, 12)); [0, 0.07, 0.14].forEach((t, i) => tone(base * [1, 1.25, 1.5][i], { t, dur: 0.12, type: 'triangle', vol: 0.35 })); },
  badge() { [523, 659, 784, 1047].forEach((f, i) => tone(f, { t: i * 0.09, dur: 0.18, type: 'triangle', vol: 0.4 })); tone(1568, { t: 0.4, dur: 0.4, type: 'sine', vol: 0.25 }); },
  climb() { tone(330, { dur: 0.35, type: 'sawtooth', vol: 0.12, glide: 660 }); tone(990, { t: 0.12, dur: 0.18, type: 'triangle', vol: 0.3 }); },
  engineOut() { tone(140, { dur: 0.6, type: 'sawtooth', vol: 0.22, glide: 45 }); noise({ t: 0.05, dur: 0.5, vol: 0.25, from: 900, to: 120 }); },
  warn() { [0, 0.18].forEach(t => tone(1046, { t, dur: 0.1, type: 'square', vol: 0.18 })); },
  submit() { noise({ dur: 0.18, vol: 0.18, from: 3000, to: 600 }); tone(523, { t: 0.05, dur: 0.12, type: 'triangle', vol: 0.3 }); },
  fanfare(pct) {
    const notes = pct >= 80 ? [523, 659, 784, 1047, 1319] : pct >= 60 ? [523, 659, 784, 1047] : [440, 523, 587];
    notes.forEach((f, i) => tone(f, { t: i * 0.11, dur: 0.22, type: 'triangle', vol: 0.4 }));
  },
  pencil() { noise({ dur: 0.05, vol: 0.06, from: 5000, to: 2500 }); },
};

// ---------------------------------------------------------------- visual helpers
// small gold spark burst from an element (correct answers, badges)
export function burst(el, { count = 14, colors = ['#C99000', '#e6b23a', '#f6e7c4', '#5fcf6a'] } = {}) {
  if (!el || reducedMotion()) return;
  const r = el.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'fx-burst';
  layer.style.left = r.left + r.width / 2 + 'px'; layer.style.top = r.top + r.height / 2 + 'px';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.4, d = 40 + Math.random() * 50;
    p.style.setProperty('--dx', Math.cos(a) * d + 'px'); p.style.setProperty('--dy', Math.sin(a) * d + 'px');
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 60 + 'ms';
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 900);
}

// count a number up inside an element
export function countUp(el, to, { ms = 900, fmt = v => String(Math.round(v)) } = {}) {
  if (!el) return;
  if (reducedMotion()) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(to * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// floating "+500 ft" / "STREAK x5" pop text
export function pop(text, el, cls = '') {
  if (!el || reducedMotion()) return;
  const r = el.getBoundingClientRect();
  const t = document.createElement('div');
  t.className = 'fx-pop ' + cls; t.textContent = text;
  t.style.left = r.left + r.width / 2 + 'px'; t.style.top = r.top + 'px';
  document.body.append(t);
  setTimeout(() => t.remove(), 1100);
}

// ---------------------------------------------------------------- global wiring
export function installFx() {
  // ripple + soft click on buttons
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest?.('.btn, .tbtn, .seg, .ref-tab, .page-tab, .choice, .gbtn, .year-card');
    if (!b || b.disabled) return;
    if (b.matches('.choice')) sfx.select(); else if (b.matches('.seg, .ref-tab, .page-tab')) sfx.tab(); else sfx.click();
    if (reducedMotion() || !b.matches('.btn, .choice, .year-card')) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
    const rip = document.createElement('span');
    rip.className = 'fx-ripple';
    rip.style.width = rip.style.height = d + 'px';
    rip.style.left = e.clientX - r.left - d / 2 + 'px'; rip.style.top = e.clientY - r.top - d / 2 + 'px';
    b.append(rip);
    setTimeout(() => rip.remove(), 600);
  }, { passive: true });
}

// sound toggle button for the header
export function soundButton() {
  const b = document.createElement('button');
  b.className = 'sound-btn';
  const draw = () => {
    b.textContent = sfx.on ? '🔊' : '🔇';
    b.title = sfx.on ? 'Sound effects on (click to mute)' : 'Sound effects muted (click to turn on)';
    b.setAttribute('aria-pressed', String(sfx.on));
    b.setAttribute('aria-label', 'Sound effects');
  };
  b.addEventListener('click', () => { sfx.toggle(); draw(); });
  draw();
  return b;
}
