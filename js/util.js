import { gradeQuestion, score, checkNav } from './grading.js';
// Small DOM + data helpers shared by every screen.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ---------------------------------------------------------------- data
// Question banks, answers, explanations and test data are NOT site files: they live in the Realtime Database and are
// readable only by approved users (cloud.js registers the source). Answer checking happens here in the browser.
let contentSource = null;
export function setContentSource(fn) { contentSource = fn; }
function content(name) {
  if (!contentSource) return Promise.reject(new Error('Not signed in.'));
  return contentSource(name);
}
const cache = new Map();
export async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}
const yearFile = (y, name) => content(`${y}/${name}`);
async function questionMap(y) { return new Map((await yearFile(y, 'questions')).questions.map(q => [q.number, q])); }

export const api = {
  index: () => content('index'),
  year: (y, name) => yearFile(y, name),
  async check(y, number, selected) {
    const [qm, ans] = await Promise.all([questionMap(y), yearFile(y, 'answers')]);
    const q = qm.get(number);
    if (!q) throw new Error(`no question ${number} in ${y}`);
    return gradeQuestion(q, ans.answers[String(number)], selected || []);
  },
  async submit(y, numbers, answers) {
    const [qm, ans] = await Promise.all([questionMap(y), yearFile(y, 'answers')]);
    const nums = numbers && numbers.length ? numbers : [...qm.keys()].sort((a, b) => a - b);
    const res = nums.map(n => gradeQuestion(qm.get(n), ans.answers[String(n)], (answers || {})[String(n)] || []));
    return { year: y, results: res, score: score(res) };
  },
  async navlog(y, key, value) {
    const [legs, ans] = await Promise.all([yearFile(y, 'legs'), yearFile(y, 'answers')]);
    const rows = [...legs.legs.flatMap(l => l.nav_log), ...((legs.trip_totals || {}).nav_log || [])];
    if (!rows.some(r => r.key === key)) throw new Error('no such nav-log row');
    return checkNav(ans, key, String(value ?? ''));
  },
  ppl: () => content('ppl'),
  async pplCheck(id, selected) {
    const q = (await content('ppl')).questions.find(x => x.id === id);
    if (!q) throw new Error('no such question');
    const sel = [...new Set((selected || []).map(x => String(x).toUpperCase()))].sort();
    const key = [...q.answer].sort();
    return { id: q.id, selected: sel, scored: true, key_letters: key, key_as_printed: key.join(', '), key_source: { label: q.reference },
      result: !sel.length ? 'unanswered' : JSON.stringify(sel) === JSON.stringify(key) ? 'correct' : 'incorrect',
      explanation: { text: q.explanation, kind: 'app_explanation', source: { label: q.reference } } };
  },
};

// ---------------------------------------------------------------- encrypted images
// Content images are published AES-256-GCM encrypted (12-byte IV + ciphertext); the key is protected content.
let keyP = null;
const imgCache = new Map();   // path -> Promise<objectURL>, least-recently-used first
const IMG_CACHE_MAX = 160;
function imageKey() {
  keyP ||= content('tilekey').then(b64 => crypto.subtle.importKey('raw', Uint8Array.from(atob(b64), c => c.charCodeAt(0)), 'AES-GCM', false, ['decrypt']));
  keyP.catch(() => { keyP = null; });
  return keyP;
}
export function loadImage(path) {
  if (imgCache.has(path)) { const p = imgCache.get(path); imgCache.delete(path); imgCache.set(path, p); return p; }
  const p = (async () => {
    const [key, buf] = await Promise.all([imageKey(), fetch(path).then(r => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.arrayBuffer(); })]);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(buf, 0, 12) }, key, new Uint8Array(buf, 12));
    const type = /\.png\.enc$/.test(path) ? 'image/png' : /\.jpe?g\.enc$/.test(path) ? 'image/jpeg' : 'image/webp';
    return URL.createObjectURL(new Blob([plain], { type }));
  })();
  imgCache.set(path, p);
  p.catch(() => imgCache.delete(path));
  while (imgCache.size > IMG_CACHE_MAX) { const [k, old] = imgCache.entries().next().value; imgCache.delete(k); old.then(u => URL.revokeObjectURL(u)).catch(() => {}); }
  return p;
}
// an <img> whose (encrypted) source is decrypted after it is created
export function secureImg(path, attrs = {}) {
  const img = h('img', attrs);
  loadImage(path).then(u => { img.src = u; }).catch(e => { img.alt = (attrs.alt || 'image') + ' (could not load)'; console.warn(e); });
  return img;
}
export function clearContentCaches() {
  keyP = null;
  for (const p of imgCache.values()) p.then(u => URL.revokeObjectURL(u)).catch(() => {});
  imgCache.clear(); cache.clear();
}

// ---------------------------------------------------------------- progress saved in this browser
// All progress (results, in-progress tests, marks, bookmarks, badges, Drill bests, filters) is kept in this
// browser's localStorage under the "scan:" prefix. Nothing is sent anywhere. Export/Import makes a backup file.
const PREFIX = 'scan:';
export const session = { user: null }; // no accounts on the static site
let storageOk = true;
try { localStorage.setItem(PREFIX + '_probe', '1'); localStorage.removeItem(PREFIX + '_probe'); } catch { storageOk = false; }
export const storageAvailable = () => storageOk;
const mem = new Map(); // fallback when storage is blocked (private mode etc.)

// per-key "last changed" times (used to merge with the cloud copy when signed in); kept outside the scan: prefix
const META = 'scanmeta';
let meta = {};
try { meta = JSON.parse(localStorage.getItem(META) || '{}') || {}; } catch { meta = {}; }
function saveMeta() { try { localStorage.setItem(META, JSON.stringify(meta)); } catch { /* ignore */ } }
export const keyStamp = k => meta[k] || 0;
let syncHook = null;                       // set by cloud.js when sign-in is available
export function setSyncHook(fn) { syncHook = fn; }

// write without notifying the cloud (used by cloud.js when applying merged data)
export function rawSet(k, v, t) {
  if (v === undefined) return;
  if (!storageOk) { mem.set(k, v); return; }
  try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); meta[k] = t || Date.now(); saveMeta(); }
  catch (e) { console.warn('could not save', k, e); window.dispatchEvent(new CustomEvent('scan-storage-full')); }
}
export function rawDel(k) {
  if (!storageOk) { mem.delete(k); return; }
  try { localStorage.removeItem(PREFIX + k); delete meta[k]; saveMeta(); } catch { /* ignore */ }
}

export const store = {
  get(k, dflt) {
    if (!storageOk) return mem.has(k) ? mem.get(k) : dflt;
    try { const v = localStorage.getItem(PREFIX + k); return v == null ? dflt : JSON.parse(v); } catch { return dflt; }
  },
  set(k, v) { rawSet(k, v, Date.now()); syncHook?.('set', k, v); },
  del(k) { rawDel(k); syncHook?.('del', k); },
  keys() {
    if (!storageOk) return [...mem.keys()];
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length)); } } catch { /* ignore */ }
    return out;
  },
};

// how two copies of the same key combine (this browser vs the account): sets are unioned, bests keep the max,
// leg answers are merged, anything else keeps the newer write (the account's on a tie)
export function mergeKey(k, lv, lt, rv, rt) {
  const newer = lt > rt ? { value: lv, t: lt } : { value: rv, t: rt };
  const t = Math.max(lt, rt);
  if ((k === 'badges' || k === 'bookmarks' || k.startsWith('legdone:')) && Array.isArray(lv) && Array.isArray(rv)) return { value: [...new Set([...rv, ...lv])], t };
  if ((k.startsWith('pb:') || k.startsWith('pplpb:')) && typeof lv === 'number' && typeof rv === 'number') return { value: Math.max(lv, rv), t };
  if (k.startsWith('legans:') && lv && rv && typeof lv === 'object' && typeof rv === 'object') return { value: lt > rt ? { ...rv, ...lv } : { ...lv, ...rv }, t };
  return newer;
}

const MAX_RESULTS = 500, MAX_DETAILS = 60;
export const results = {
  async list(kind) {
    const all = store.get('results', []);
    return kind ? all.filter(r => r.kind === kind) : all;
  },
  async add(kind, year, summary, detail = null) {
    const id = 'r' + uid();
    const all = store.get('results', []);
    all.unshift({ id, kind, year: year ?? null, created: Date.now() / 1000, ...summary, has_detail: !!detail });
    // keep the graded detail (debrief) only for the most recent attempts so storage stays small
    if (detail) store.set('detail:' + id, detail);
    const withDetail = all.filter(r => r.has_detail);
    for (const old of withDetail.slice(MAX_DETAILS)) { store.del('detail:' + old.id); old.has_detail = false; }
    store.set('results', all.slice(0, MAX_RESULTS));
    return id;
  },
  async get(id) {
    const row = store.get('results', []).find(r => r.id === id);
    return row ? { ...row, detail: store.get('detail:' + id, null) } : null;
  },
};

// ---------------------------------------------------------------- backup: export / import
export const BACKUP_APP = 'scan-prep-progress';
export function exportProgress() {
  const data = {};
  for (const k of store.keys()) data[k] = store.get(k, null);
  return { app: BACKUP_APP, version: 1, exported_at: new Date().toISOString(), data };
}
export function downloadBackup() {
  const blob = new Blob([JSON.stringify(exportProgress(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `scan-prep-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// mode: 'merge' keeps what is here and adds the backup's results; 'replace' wipes this browser's progress first
export function importProgress(obj, mode = 'merge') {
  if (!obj || obj.app !== BACKUP_APP || typeof obj.data !== 'object' || obj.data === null) throw new Error('That file is not a SCAN Prep progress backup.');
  if (mode === 'replace') for (const k of store.keys()) store.del(k);
  let n = 0;
  for (const [k, v] of Object.entries(obj.data)) {
    if (typeof k !== 'string' || k.length > 400) continue;
    if (mode === 'merge' && k === 'results') {
      const here = store.get('results', []), ids = new Set(here.map(r => r.id));
      const merged = [...here, ...(Array.isArray(v) ? v.filter(r => r && !ids.has(r.id)) : [])].sort((a, b) => (b.created || 0) - (a.created || 0));
      store.set('results', merged.slice(0, MAX_RESULTS)); n++; continue;
    }
    if (mode === 'merge' && k === 'badges') { store.set('badges', [...new Set([...store.get('badges', []), ...(v || [])])]); n++; continue; }
    if (mode === 'merge' && store.get(k, undefined) !== undefined && !k.startsWith('detail:')) continue; // keep this browser's own value
    store.set(k, v); n++;
  }
  return n;
}
// erase this browser's copy only (cloud.js handles erasing an account)
export function clearProgress() { for (const k of store.keys()) rawDel(k); }

// ---------------------------------------------------------------- small UI pieces
// Instrument-style gauge: a 240° dial with a needle; pct 0..100 (null = no data).
export function gauge(pct, label, { size = 96, sub = '' } = {}) {
  const r = 40, cx = 50, cy = 52, start = 150, sweep = 240;
  const pt = a => { const t = (a * Math.PI) / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
  const arc = (a0, a1) => { const [x0, y0] = pt(a0), [x1, y1] = pt(a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  const has = pct != null && !Number.isNaN(pct);
  const v = has ? Math.max(0, Math.min(100, pct)) : 0;
  const a = start + (sweep * v) / 100;
  const ticks = [];
  for (let i = 0; i <= 10; i++) { const t = ((start + sweep * i / 10) * Math.PI) / 180, r1 = i % 5 ? 34 : 31; ticks.push(`M${(cx + r1 * Math.cos(t)).toFixed(2)} ${(cy + r1 * Math.sin(t)).toFixed(2)} L${(cx + 38 * Math.cos(t)).toFixed(2)} ${(cy + 38 * Math.sin(t)).toFixed(2)}`); }
  const [nx, ny] = pt(a);
  const svg = s('svg', { viewBox: '0 0 100 100', width: size, height: size, class: 'gauge', role: 'img', 'aria-label': `${label}: ${has ? Math.round(v) + '%' : 'no data yet'}` },
    s('circle', { cx, cy, r: 47, class: 'g-face' }),
    s('path', { d: arc(start, start + sweep), class: 'g-track' }),
    has ? s('path', { d: arc(start, Math.max(start + 0.5, a)), pathLength: 100, class: 'g-val' + (v >= 70 ? ' good' : v >= 50 ? ' mid' : ' low') }) : null,
    s('path', { d: ticks.join(''), class: 'g-ticks' }),
    has ? s('g', { class: 'g-needle-g', style: `--a: ${a.toFixed(1)}deg` }, s('line', { x1: cx, y1: cy, x2: cx + r * 0.82, y2: cy, class: 'g-needle' })) : null,
    s('circle', { cx, cy, r: 3.5, class: 'g-hub' }),
    s('text', { x: cx, y: 78, class: 'g-num', 'text-anchor': 'middle' }, has ? `${Math.round(v)}` : '--'),
    s('text', { x: cx, y: 90, class: 'g-unit', 'text-anchor': 'middle' }, has ? '%' : ''));
  return h('figure', { class: 'gauge-wrap' }, svg, h('figcaption', {}, label, sub ? h('small', {}, sub) : null));
}

// Leg id -> runway-number style ("L3" -> "03", trip totals -> "TT")
export function rwy(legId) {
  const m = /^L(\d+)$/.exec(legId || '');
  return h('span', { class: 'rwy-badge', title: legId === 'TRIP' ? 'Trip Totals' : `Leg ${m ? m[1] : legId}` }, m ? m[1].padStart(2, '0') : 'TT');
}

// Gold underline that slides to the active tab. Call after (re)marking the active tab with class "on".
export function inkTabs(container) {
  let ink = container.querySelector(':scope > .tab-ink');
  if (!ink) { ink = h('span', { class: 'tab-ink', 'aria-hidden': 'true' }); container.append(ink); }
  const place = () => {
    const on = container.querySelector(':scope > .on');
    if (!on) { ink.style.opacity = '0'; return; }
    ink.style.opacity = '1';
    ink.style.width = on.offsetWidth + 'px';
    ink.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  requestAnimationFrame(place);
  if (!container._inkRO) { container._inkRO = new ResizeObserver(place); container._inkRO.observe(container); }
  return place;
}

// ---------------------------------------------------------------- source text rendering
// Prompts are shown exactly as stored; printed emphasis spans are wrapped, never altered.
export function richText(text, emphasis = []) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const spans = [];
  for (const e of emphasis || []) {
    const i = text.indexOf(e.text);
    if (i >= 0 && !spans.some(sp => i < sp.end && i + e.text.length > sp.start)) spans.push({ start: i, end: i + e.text.length, styles: e.styles });
  }
  spans.sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const sp of spans) {
    if (sp.start > pos) frag.append(text.slice(pos, sp.start));
    let node = document.createTextNode(text.slice(sp.start, sp.end));
    for (const st of sp.styles) {
      const tag = st === 'bold' ? 'strong' : st === 'italic' ? 'em' : st === 'underline' ? 'u' : 'span';
      const w = document.createElement(tag); w.append(node); node = w;
    }
    frag.append(node);
    pos = sp.end;
  }
  frag.append(text.slice(pos));
  return frag;
}

export function sourceLabel(src) {
  if (!src) return '';
  if (src.label) return src.label;
  const f = (src.file || '').split('/').pop().replace('.pdf', '');
  const p = src.page ?? src.page_start;
  return `${f} p${p}${src.page_end && src.page_end !== src.page_start ? '–' + src.page_end : ''}`;
}

export const CATEGORY_LABEL = { knowledge: 'Knowledge', leg_calc: 'Leg calculation', scenario_other: 'Scenario' };
export const TOPIC_LABEL = {
  airspace: 'Airspace', regs: 'Regulations', weather: 'Weather', 'w&b': 'Weight & balance', performance: 'Performance',
  nav: 'Navigation', fuel: 'Fuel', aeromedical: 'Aeromedical', maintenance: 'Maintenance', equipment: 'Equipment',
  airport_info: 'Airport info', chart_symbology: 'Chart symbology', night_ops: 'Night ops',
  pilot_certification: 'Pilot certification', time: 'Time', procedures: 'Procedures',
};
export const FIELD_LABEL = {
  true_course: 'True course', magnetic_course: 'Magnetic course', distance: 'Distance', wind: 'Wind',
  wind_correction_angle: 'Wind correction angle', true_heading: 'True heading', variation: 'Variation',
  magnetic_heading: 'Magnetic heading', true_airspeed: 'TAS', groundspeed: 'Groundspeed', time_en_route: 'Time en route',
  fuel_flow: 'Fuel flow', fuel_burn: 'Fuel burn', fuel_remaining: 'Fuel remaining', climb_time: 'Climb time',
  climb_fuel: 'Climb fuel', climb_distance: 'Climb distance', descent_time: 'Descent time', descent_fuel: 'Descent fuel',
  descent_distance: 'Descent distance', ramp_weight: 'Ramp weight', zero_fuel_weight: 'Zero-fuel weight',
  takeoff_weight: 'Takeoff weight', landing_weight: 'Landing weight', moment: 'Moment', center_of_gravity: 'CG',
  wb_within_limits: 'Within W&B limits (y/n)', takeoff_ground_roll: 'Takeoff ground roll',
  takeoff_distance_50ft: 'Takeoff over 50 ft', landing_ground_roll: 'Landing ground roll',
  landing_distance_50ft: 'Landing over 50 ft', departure_time: 'Departure time', arrival_time: 'Arrival time',
  eta: 'ETA', altitude: 'Altitude', airport_elevation: 'Airport elevation', rate_of_climb: 'Rate of climb',
  total_time: 'Total time',
};
export const SEGMENT_LABEL = { climb: 'Climb', cruise: 'Cruise', descent: 'Descent', leg_total: 'Leg total', taxi: 'Taxi', trip_total: 'Trip total' };

export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0');
}

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
