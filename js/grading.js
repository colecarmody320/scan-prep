// Grading rules for the SCAN study app (docs/WEBAPP_SPEC.md), running in the browser.
// This is a line-for-line port of app/grading.py (kept as the reference implementation); the test suite
// checks that both give identical results on every nav-log row and a set of tricky entries.
//
// * Multiple choice: graded only against the official key. Questions that are not `scored` or have no key
//   letters are "no official answer" and never scored. Multi-letter keys need every letter.
// * Nav-log rows: graded_by_key -> nearest-choice rule (no tolerance; exactly halfway = too close to call);
//   official_comparison -> comparison only, no pass/fail (D10); anything else -> self-check.

export const NO_KEY = 'no official answer';

// Python round(): half to even
function roundHalfEven(x) {
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
// Python format(x, 'g') / '.6g'
export function fmtG(x, p = 6) {
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e < -4 || e >= p) {
    let [m, ex] = x.toExponential(p - 1).split('e');
    m = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    const n = parseInt(ex, 10);
    return `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  let s = x.toFixed(Math.max(0, p - 1 - e));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function num(t) {
  t = t.replace(/,/g, '').trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : null;
}
const pad2 = n => String(n).padStart(2, '0');
function fmtSec(sec) {
  sec = Math.trunc(sec);
  const h = Math.floor(sec / 3600), r = sec % 3600, m = Math.floor(r / 60), s = r % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m} min ${pad2(s)} s`;
}

// Returns [number, interpretation] or [null, error message]
export function parseStudent(value, kind) {
  const t = (value || '').trim();
  if (!t) return [null, 'empty'];
  if (kind === 'number') {
    let n = num(t);
    if (n === null) {
      const nums = t.match(/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[+-]?\.\d+/g) || [];
      if (nums.length === 1) n = num(nums[0]);
    }
    return n !== null ? [n, fmtG(n)] : [null, 'enter one number'];
  }
  if (kind === 'zulu' || kind === 'clock') {
    let s = t.replace(/\s*local\s*$/i, '').trim();
    const ampm = /(?<![a-z])([ap])\.?\s*m\.?$/i.exec(s);
    if (ampm) s = s.slice(0, ampm.index).trim();
    s = s.replace(/[zl]$/i, '').trim();
    const m = /^(\d{1,2}):?(\d{2})$/.exec(s);
    if (!m || +m[2] > 59 || +m[1] > (ampm ? 12 : 23)) return [null, 'enter a time as HHMM or HH:MM' + (kind === 'zulu' ? 'Z' : '')];
    let hh = +m[1];
    if (ampm) hh = (hh % 12) + (ampm[1].toLowerCase() === 'p' ? 12 : 0);
    return [hh * 60 + +m[2], `${pad2(hh)}${pad2(+m[2])}` + (kind === 'zulu' ? 'Z' : ' local')];
  }
  if (['mmss', 'hms', 'min_sec', 'min_sec_words'].includes(kind)) {
    const s = t.toLowerCase();
    let m = /^(\d+):(\d{2}):(\d{2})$/.exec(s);
    if (m && +m[2] < 60 && +m[3] < 60) { const sec = +m[1] * 3600 + +m[2] * 60 + +m[3]; return [sec, fmtSec(sec)]; }
    m = /^(\d+):(\d{2})$/.exec(s);
    if (m && +m[2] < 60) { const sec = +m[1] * 60 + +m[2]; return [sec, fmtSec(sec)]; }
    m = /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)?\.?(?:\s*(?:and\s*)?(\d+)\s*(?:s|sec|secs|seconds?)\.?)?$/.exec(s);
    if (m) { const sec = roundHalfEven(parseFloat(m[1]) * 60) + (m[2] ? +m[2] : 0); return [sec, fmtSec(sec)]; }
    m = /^(\d+)\s*(?:s|sec|secs|seconds?)$/.exec(s);
    if (m) return [+m[1], fmtSec(+m[1])];
    return [null, 'enter minutes and seconds, e.g. 12:30 or 12 min 30 s'];
  }
  return [null, `unsupported form '${kind}'`];
}

// ---------------------------------------------------------------- multiple choice
export function gradeQuestion(q, key, selected) {
  const letters = (key && key.letters) || [];
  const scored = !!q.scored && letters.length > 0;
  const sel = [...new Set((selected || []).map(s => String(s).toUpperCase()))].sort();
  const res = { number: q.number, selected: sel, scored, key_letters: letters,
    key_as_printed: key ? key.as_printed ?? null : null, key_source: key ? key.source ?? null : null,
    explanation: key ? key.explanation ?? null : null };
  if (!scored) res.result = NO_KEY;
  else if (!sel.length) res.result = 'unanswered';
  else res.result = JSON.stringify(sel) === JSON.stringify(letters.map(x => x.toUpperCase()).sort()) ? 'correct' : 'incorrect';
  return res;
}

export function score(results) {
  const scored = results.filter(r => r.scored);
  const correct = scored.filter(r => r.result === 'correct').length;
  return { correct, scored: scored.length, unscored: results.length - scored.length,
    percent: scored.length ? Math.round((1000 * correct) / scored.length) / 10 : null };
}

// ---------------------------------------------------------------- nav log
export function nearestChoice(check, value) {
  const [v, interp] = parseStudent(value, check.parse);
  const keyed = check.keyed_label;
  const kc = check.choice_values.find(c => c.label === keyed);
  const out = { method: 'nearest_choice', label: check.label, question: check.question, keyed_label: keyed,
    keyed_choice_text: kc ? kc.text : null, source: check.source };
  if (v === null) return { ...out, result: 'unreadable', message: interp };
  out.read_as = interp;
  const clock = check.parse === 'zulu' || check.parse === 'clock';
  const choices = [];
  for (const c of check.choice_values) {
    let cv = c.value ?? null;
    if (clock) { const [pv] = parseStudent(c.text, check.parse); if (pv !== null) cv = pv; }
    if (cv !== null) choices.push([cv, c]);
  }
  const dist = (a, b) => { const d = Math.abs(a - b); return clock ? Math.min(d, 1440 - d) : d; };
  const dists = choices.map(([cv, c]) => [dist(v, cv), cv, c]).sort((a, b) => a[0] - b[0]);
  if (!dists.length) return { ...out, result: 'unreadable', message: 'no numeric choices' };
  const [bestD, bestV, best] = dists[0];
  const tied = dists.filter(([d, cv]) => d === bestD && cv !== bestV);
  const keyedVals = choices.filter(([, c]) => c.label === keyed).map(([cv]) => cv);
  const same = dists.filter(([, cv]) => cv === bestV).map(x => x[2]);
  const shown = same.find(c => c.label === keyed) || best;
  out.nearest_label = shown.label;
  out.nearest_choice_text = shown.text;
  out.result = tied.length ? 'too close to call' : (keyedVals.includes(bestV) ? 'correct' : 'incorrect');
  return out;
}

function fmtDiff(d, form) {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const a = Math.abs(d);
  if (form === 'number') return sign + fmtG(a);
  const t = roundHalfEven(a), m = Math.floor(t / 60), s = t % 60;
  return `${sign}${m}:${pad2(s)}`;
}

export function compareOfficial(entries, value) {
  const rows = entries.map(e => {
    const row = { official_as_printed: e.value_as_printed, source: e.source, source_label: e.source_label, label: e.label, difference: null };
    const form = e.numeric_form;
    if (form && e.value_numeric !== null && e.value_numeric !== undefined) {
      const [v, interp] = parseStudent(value, form === 'number' ? 'number' : 'mmss');
      if (v !== null) { row.you_read_as = interp; row.difference = fmtDiff(v - e.value_numeric, form); }
    }
    return row;
  });
  return { method: 'official_comparison', result: 'comparison', you: value, official: rows, note: 'comparison only, no pass/fail' };
}

export function checkNav(answers, key, value) {
  const checks = answers.nav_log_checks || {};
  const off = (answers.nav_log_official_values || {})[key];
  if (checks[key]) {
    const out = nearestChoice(checks[key], value);
    if (off) out.official_comparison = compareOfficial(off, value);
    return out;
  }
  if (off) return compareOfficial(off, value);
  return { method: 'self_check', result: 'self-check', note: 'no official value: self-check only' };
}
