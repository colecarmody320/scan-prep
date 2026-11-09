// Mode 3: LEG PRACTICE — one leg of one year's flight at a time.
import { h, clear, api, store, results, session, gauge, rwy, inkTabs, sourceLabel, FIELD_LABEL, SEGMENT_LABEL } from './util.js';
import { questionCard, contextsFor } from './question.js';
import { sfx, burst } from './fx.js';
import { timerPicker, Clock } from './timer.js';
import { referencePanel } from './reference.js';

const KIND_ORDER = ['route', 'route_change', 'altitude', 'aircraft', 'loading', 'fuel', 'weather', 'winds_aloft', 'performance_rules', 'time', 'pilot'];
const KIND_LABEL = { route: 'Route', route_change: 'Route change', altitude: 'Altitude', aircraft: 'Aircraft', loading: 'Loading',
  fuel: 'Fuel', weather: 'Weather', winds_aloft: 'Winds aloft', performance_rules: 'Performance rules', time: 'Time', pilot: 'Pilot' };

const doneKey = y => `legdone:${y}`;
const ansKey = y => `legans:${y}`;

export async function legYears(app) {
  const idx = await api.index();
  clear(app).append(h('section', { class: 'panel' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' › Leg Practice'),
    h('h1', {}, 'Leg Practice'), h('p', { class: 'muted' }, 'Pick a year, then work its flight one leg at a time.'),
    h('div', { class: 'year-grid' }, idx.years.filter(y => y.legs).map(y => {
      const done = store.get(doneKey(y.year), []);
      return h('a', { class: 'year-card', href: `#/legs/${y.year}` }, h('b', {}, y.year), h('span', {}, `${y.legs} legs`),
        done.length ? h('span', { class: 'muted small' }, `${done.length} done`) : null);
    }))));
}

export async function legList(app, year) {
  const L = await api.year(year, 'legs');
  const mine = (await results.list('leg').catch(() => [])).filter(r => r.year === year);
  const lastFor = id => mine.find(r => r.leg === id);
  const done = new Set(store.get(doneKey(year), []));
  const tt = L.trip_totals;
  const unlocked = tt && (!tt.unlock_after_leg || done.has(tt.unlock_after_leg));
  clear(app).append(h('section', { class: 'panel' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' › ', h('a', { href: '#/legs' }, 'Leg Practice'), ' › ', String(year)),
    h('h1', {}, `${year} legs`),
    h('p', { class: 'muted small' }, 'Leg titles are the leg text as printed in the source.'),
    h('ol', { class: 'leg-list' }, L.legs.map(leg => h('li', {},
      h('div', { class: 'leg-row' },
        h('a', { href: `#/legs/${year}/${leg.id}`, class: 'leg-link' }, rwy(leg.id), h('span', { class: 'src-text' }, leg.title)),
        (() => { const r = lastFor(leg.id); return r ? gauge(r.score?.percent ?? null, 'last', { size: 64 }) : (done.has(leg.id) ? h('span', { class: 'done-chip' }, '✓ done') : null); })()),
      leg.as_flown ? h('div', { class: 'as-flown' }, leg.as_flown.text) : null))),
    tt && tt.questions?.length ? h('div', { class: 'trip-card' + (unlocked ? '' : ' locked') },
      h('h3', {}, tt.label || 'Trip Totals'),
      unlocked ? h('a', { class: 'btn', href: `#/legs/${year}/TRIP` }, `Open (Q${tt.questions.join(', Q')})`)
        : h('p', { class: 'muted' }, `Unlocks after ${tt.unlock_after_leg}.`)) : null));
}

export async function legRun(app, year, legId, ctx) {
  const [L, Q] = await Promise.all([api.year(year, 'legs'), api.year(year, 'questions')]);
  const byN = Object.fromEntries(Q.questions.map(q => [q.number, q]));
  const isTrip = legId === 'TRIP';
  const leg = isTrip ? { id: 'TRIP', title: L.trip_totals.label || 'Trip Totals', questions: L.trip_totals.questions, nav_log: L.trip_totals.nav_log || [],
    briefing: [], briefing_notes: [], supplement_pages: [], ground_sections: [], excluded_questions: [], method_hints: [] }
    : L.legs.find(l => l.id === legId);
  if (!leg) { location.hash = `#/legs/${year}`; return; }
  const legIdx = L.legs.findIndex(l => l.id === legId);
  const setupKey = `legrun:${year}:${legId}`;
  let run = store.get(setupKey, null);

  // ---------------- setup screen (style + timer)
  if (!run) {
    const total = Q.questions.length, share = leg.questions.length / total;
    const off = Q.time_limit?.minutes;
    const sugg = off ? Math.max(1, Math.round(off * share)) : null;
    const tp = timerPicker(null, { suggestion: sugg ?? 15,
      suggestionLabel: sugg ? `Suggested: ${sugg} min = official ${off} min × this leg's share of questions (${leg.questions.length}/${total}). A suggestion, not an official limit.` : 'No official time limit is printed for this year.' });
    clear(app).append(h('section', { class: 'panel' },
      h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' › ', h('a', { href: '#/legs' }, 'Leg Practice'), ' › ', h('a', { href: `#/legs/${year}` }, String(year)), ' › ', legId),
      h('h1', { class: 'src-text' }, leg.title), leg.as_flown ? h('div', { class: 'as-flown' }, leg.as_flown.text) : null,
      h('div', { class: 'mode-pick' },
        h('div', { class: 'mode-card' }, h('h3', {}, 'Study'), h('p', {}, 'Feedback after each question; nav-log checks any time.'),
          h('button', { class: 'btn primary', onclick: () => start('study', { mode: 'off', minutes: null }) }, 'Start study')),
        h('div', { class: 'mode-card' }, h('h3', {}, 'Timed'), h('p', {}, 'One countdown for the leg; feedback at the end.'), tp.el,
          h('button', { class: 'btn primary', onclick: () => start('timed', tp.value()) }, 'Start timed')))));
    function start(style, timer) {
      run = { style, timer, startedAt: Date.now(), answers: {}, results: {}, nav: {}, navRes: {}, finished: false };
      store.set(setupKey, run); legRun(app, year, legId, ctx);
    }
    return;
  }
  const save = () => store.set(setupKey, run);
  const legAns = store.get(ansKey(year), {});

  // ---------------- layout
  const left = h('section', { class: 'legpanel' });
  const tabs = h('div', { class: 'ref-tabs' });
  const panes = { brief: h('div', { class: 'leg-pane' }), nav: h('div', { class: 'leg-pane' }), qs: h('div', { class: 'leg-pane' }) };
  const ref = await referencePanel(year, { attemptKey: `leg:${year}:${legId}`, measureAssist: true });
  const clockSlot = h('div', { class: 'clock-slot' });
  const head = h('div', { class: 'run-head' },
    h('a', { class: 'link', href: `#/legs/${year}` }, `‹ ${year} legs`),
    h('span', { class: 'run-title' }, rwy(legId), ` ${run.style === 'timed' ? 'Timed' : 'Study'}`), clockSlot,
    run.style === 'timed' && !run.finished ? h('button', { class: 'btn primary', onclick: () => finish(false) }, 'Finish leg') : null,
    h('button', { class: 'btn small', onclick: () => { if (confirm('Restart this leg? Your answers here are cleared.')) { store.del(setupKey); legRun(app, year, legId, ctx); } } }, 'Restart'));
  const tabDefs = isTrip ? [['nav', 'Nav log'], ['qs', 'Questions']] : [['brief', 'Briefing'], ['nav', 'Nav log'], ['qs', 'Questions']];
  for (const [id, label] of tabDefs) tabs.append(h('button', { class: 'ref-tab', 'data-id': id, onclick: () => showTab(id) }, label));
  left.append(tabs, ...tabDefs.map(([id]) => panes[id]));
  clear(app).append(h('div', { class: 'run' }, head, h('div', { class: 'split' }, left, ref.root)));
  function showTab(id) {
    for (const b of tabs.querySelectorAll('.ref-tab')) b.classList.toggle('on', b.dataset.id === id);
    inkTabs(tabs);
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== id;
    store.set(`legtab:${year}:${legId}`, id);
  }
  showTab(store.get(`legtab:${year}:${legId}`, tabDefs[0][0]));

  let clock = null;
  if (run.style === 'timed' && !run.finished) {
    clock = new Clock({ minutes: run.timer.minutes, startedAt: run.startedAt, onExpire: () => finish(true) });
    clockSlot.append(clock.el);
  }
  ctx.onLeave(() => { clock?.stop(); ref.destroy(); });
  const feedbackNow = run.style === 'study' || run.finished;

  // ---------------- briefing
  function srcChip(b) {
    if (b.question) return h('button', { class: 'src-chip link', onclick: () => { showTab('qs'); document.querySelector(`.qcard[data-n="${b.question}"]`)?.scrollIntoView({ behavior: 'smooth' }); } }, `Q${b.question}`);
    const file = (b.file || '').split('/').pop();
    if (file === 'supp.pdf') return h('button', { class: 'src-chip link', title: 'Open in the Briefing Packet', onclick: () => ref.openPage(b.page) }, `supp p${b.page}`);
    return h('span', { class: 'src-chip' }, sourceLabel(b));
  }
  if (!isTrip) {
    const P = panes.brief;
    P.append(h('h2', { class: 'src-text' }, leg.title));
    if (leg.as_flown) P.append(h('div', { class: 'as-flown' }, leg.as_flown.text));
    for (const n of leg.briefing_notes || []) {
      P.append(h('div', { class: 'note warn sources-differ' }, h('b', {}, n.heading || 'Sources differ:'), ' ', n.topic || '',
        h('ul', {}, n.values.map(v => h('li', {}, '“', v.text_as_printed, '” ', srcChip(v), v.context ? h('span', { class: 'muted small' }, ` (${v.context})`) : null))),
        n.grading ? h('div', { class: 'muted small' }, n.grading) : null));
    }
    const groups = {};
    for (const b of leg.briefing) (groups[b.kind] ||= []).push(b);
    for (const k of [...KIND_ORDER, ...Object.keys(groups).filter(k => !KIND_ORDER.includes(k))]) {
      if (!groups[k]) continue;
      const mono = k === 'weather' || k === 'winds_aloft';
      P.append(h('h3', { class: 'brief-h' }, KIND_LABEL[k] || k), h('ul', { class: 'brief-list' + (mono ? ' mono-list' : '') },
        groups[k].map(b => h('li', {}, h('span', { class: 'quote' + (mono ? ' mono' : '') }, b.quote), ' ', srcChip(b)))));
    }
    if (leg.supplement_pages?.length) {
      P.append(h('h3', {}, 'Related supplement pages'), h('div', { class: 'page-links' }, leg.supplement_pages.map(p =>
        h('button', { class: 'btn small', title: p.content, onclick: () => ref.openPage(p.page) }, `supp p${p.page}`, h('span', { class: 'muted small' }, ` ${p.content || ''}`)))));
    }
    // From earlier legs: only when a question in this leg depends on a question from an earlier leg
    const earlier = new Set(L.legs.slice(0, Math.max(0, legIdx)).flatMap(l => l.questions));
    const pulls = [];
    for (const n of leg.questions) for (const r of byN[n]?.related || []) {
      if (earlier.has(r.number) && r.display !== 'regardless_of' && !pulls.some(p => p.from === r.number)) pulls.push({ from: r.number, to: n, display: r.display });
    }
    if (pulls.length) {
      P.append(h('h3', {}, 'From earlier legs'), h('ul', { class: 'brief-list' }, pulls.map(p => {
        const q = byN[p.from], mine = legAns[p.from];
        return h('li', {}, h('b', {}, `Q${p.from}`), ` (${p.display === 'uses_your_answer' ? 'uses your answer' : 'related'}, for Q${p.to}): `, q.prompt,
          mine?.length ? h('div', { class: 'muted small' }, 'Your answer: ', mine.map(l => `${l}. ${q.choices.find(c => c.label === l)?.text ?? ''}`).join('; ')) : null);
      })));
    }
    if (leg.excluded_questions?.length) {
      P.append(h('div', { class: 'note' }, h('b', {}, 'Not in Leg Practice: '), leg.excluded_questions.map(x => `Q${x.number}`).join(', '), ' — ',
        leg.excluded_questions[0].note, '. They stay in Full Test.'));
    }
  }

  // ---------------- nav log
  const NP = panes.nav;
  if (leg.method_hints?.length) {
    NP.append(h('div', { class: 'hints' }, h('h3', {}, 'Official method hints (not graded)'),
      h('ul', {}, leg.method_hints.map(m => h('li', {}, h('span', { class: 'quote' }, m.text), ' ', h('span', { class: 'src-chip' }, sourceLabel(m.source)), ` (Q${m.question})`)))));
  }
  NP.append(h('p', { class: 'muted small' }, 'Fill in what you work out with the plotter and your CX-3. ',
    h('b', {}, 'Graded'), ' rows check against the official key (nearest answer choice). ', h('b', {}, 'Compare'), ' rows show the official worked value, no pass/fail. Others are self-check.'));
  const segs = {};
  for (const r of leg.nav_log) (segs[r.segment || '_'] ||= []).push(r);
  const tbl = h('table', { class: 'navlog' }, h('thead', {}, h('tr', {}, h('th', {}, 'Field'), h('th', {}, 'Your value'), h('th', {}, 'Check'), h('th', {}, 'Result'))));
  const tbody = h('tbody', {});
  tbl.append(tbody);
  NP.append(h('div', { class: 'table-wrap' }, tbl));
  for (const [seg, rows] of Object.entries(segs)) {
    tbody.append(h('tr', { class: 'seg-row' }, h('th', { colspan: 4 }, seg === '_' ? 'Leg' : (SEGMENT_LABEL[seg] || seg))));
    for (const r of rows) tbody.append(navRow(r));
  }
  function navRow(r) {
    const resCell = h('td', { class: 'nav-res' });
    const input = h('input', { type: 'text', value: run.nav[r.key] ?? '', placeholder: r.unit_as_printed || '', 'aria-label': FIELD_LABEL[r.field] || r.field,
      oninput: e => { run.nav[r.key] = e.target.value; delete run.navRes[r.key]; save(); clear(resCell); } });
    const name = h('td', {}, h('div', {}, FIELD_LABEL[r.field] || r.field),
      r.subsegment ? h('div', { class: 'muted small' }, r.subsegment) : null,
      r.segment_note ? h('div', { class: 'muted small' }, r.segment_note) : null,
      r.unit_as_printed ? h('div', { class: 'muted small' }, 'unit as printed: ', r.unit_as_printed) : null);
    let btn;
    if (r.status === 'graded_by_key') btn = h('button', { class: 'btn small', disabled: !feedbackNow, title: `official key answer, Q${r.question}`, onclick: () => check(r, resCell) }, `Check · Q${r.question}`);
    else if (r.status === 'official_comparison') btn = h('button', { class: 'btn small', disabled: !feedbackNow, title: 'official worked value, comparison only', onclick: () => check(r, resCell) }, 'Compare');
    else btn = h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: !!run.navRes[r.key]?.satisfied,
      onchange: e => { run.navRes[r.key] = { satisfied: e.target.checked }; save(); } }), " I'm satisfied");
    if (feedbackNow && run.navRes[r.key]?.method) showNav(run.navRes[r.key], resCell);
    return h('tr', { class: 'st-' + r.status }, name, h('td', {}, input), h('td', {}, btn), resCell);
  }
  async function check(r, cell) {
    const v = run.nav[r.key] ?? '';
    if (!v.trim()) { clear(cell).append(h('span', { class: 'muted small' }, 'Enter a value first.')); return; }
    const res = await api.navlog(year, r.key, v);
    run.navRes[r.key] = res; save(); showNav(res, cell);
    if (res.result === 'correct') { sfx.correct(); burst(cell); } else if (res.result === 'incorrect') sfx.wrong(); else sfx.select();
  }

  // ---------------- questions
  const QP = panes.qs;
  const gsOf = {};
  for (const g of leg.ground_sections || []) g.questions.forEach(n => gsOf[n] = g);
  let prevGS = null;
  const qnums = leg.questions;
  for (const n of qnums) {
    const g = gsOf[n] || null;
    if (g && g !== prevGS) QP.append(h('h3', { class: 'ground-head' }, g.label));
    else if (!g && prevGS) QP.append(h('h3', { class: 'ground-head air' }, 'Airborne'));
    prevGS = g;
    const slot = h('div', { class: 'qslot' });
    QP.append(slot);
    drawQ(n, slot);
  }
  function drawQ(n, slot) {
    const q = byN[n];
    const res = feedbackNow ? run.results[n] : null;
    const relatedPrompts = Object.fromEntries((q.related || []).map(r => [r.number, byN[r.number]?.prompt]));
    const card = questionCard(q, { selected: run.answers[n] || [], result: res, relatedPrompts,
      contexts: contextsFor(Q.context_blocks, n, qnums), disabled: run.finished,
      onSelect: l => { run.answers[n] = l; save(); drawQ(n, slot); } });
    clear(slot).append(card);
    if (run.style === 'study' && !res) {
      card.append(h('button', { class: 'btn primary small', disabled: !(run.answers[n]?.length), onclick: async () => {
        run.results[n] = await api.check(year, n, run.answers[n]); save(); recordAnswer(n); drawQ(n, slot);
        const rr = run.results[n];
        if (rr.result === 'correct') { sfx.correct(); burst(slot.querySelector('.result')); slot.firstChild?.classList.add('flash-ok'); }
        else if (rr.scored) { sfx.wrong(); slot.firstChild?.classList.add('flash-bad'); }
        maybeDone();
      } }, 'Check answer'));
    }
  }
  function recordAnswer(n) { const a = store.get(ansKey(year), {}); a[n] = run.answers[n]; store.set(ansKey(year), a); }
  function markDone() { const d = new Set(store.get(doneKey(year), [])); d.add(legId); store.set(doneKey(year), [...d]); }
  function maybeDone() {
    if (!qnums.every(n => run.results[n])) return;
    markDone(); summary();
    if (!run.saved) {
      run.saved = true; save();
      const rs = qnums.map(n => run.results[n]), sc = rs.filter(r => r.scored), ok = sc.filter(r => r.result === 'correct').length;
      results.add('leg', year, { leg: legId, style: 'study', score: { correct: ok, scored: sc.length, percent: sc.length ? Math.round(1000 * ok / sc.length) / 10 : null } }).catch(() => {});
    }
  }
  function summary() {
    const rs = qnums.map(n => run.results[n]).filter(Boolean);
    const scored = rs.filter(r => r.scored), ok = scored.filter(r => r.result === 'correct').length;
    QP.querySelector('.leg-summary')?.remove();
    QP.prepend(h('div', { class: 'leg-summary' }, gauge(scored.length ? 100 * ok / scored.length : null, 'This leg', { size: 72 }), h('b', {}, `${ok} / ${scored.length} correct`), ' on this leg.',
      L.trip_totals?.unlock_after_leg === legId ? h('span', {}, ' Trip Totals unlocked. ', h('a', { href: `#/legs/${year}/TRIP` }, 'Open Trip Totals')) : null,
      (() => { const nx = L.legs[legIdx + 1]; return nx ? h('span', {}, ' ', h('a', { href: `#/legs/${year}/${nx.id}` }, `Next: ${nx.id} →`)) : null; })()));
  }
  if (feedbackNow && qnums.length && qnums.every(n => run.results[n])) summary();

  async function finish(auto) {
    if (run.finished) return;
    if (!auto && !confirm('Finish the leg and see feedback?')) return;
    clock?.stop();
    const res = await api.submit(year, qnums, run.answers, { kind: 'leg', leg: legId, style: 'timed', seconds: Math.round(clock?.elapsed() || 0) });
    if (!res.result_id) results.add('leg', year, { leg: legId, style: 'timed', score: res.score }).catch(() => {});
    for (const r of res.results) run.results[r.number] = r;
    for (const r of leg.nav_log) if (r.status !== 'self_check' && (run.nav[r.key] || '').trim()) run.navRes[r.key] = await api.navlog(year, r.key, run.nav[r.key]);
    run.finished = true; save();
    qnums.forEach(recordAnswer); markDone();
    legRun(app, year, legId, ctx);
  }
}

function showNav(res, cell) {
  clear(cell);
  if (res.method === 'nearest_choice') {
    const v = { correct: '✓ correct', incorrect: '✗ incorrect', 'too close to call': '≈ too close to call', unreadable: '? ' + (res.message || 'unreadable') }[res.result] || res.result;
    cell.append(...[h('div', { class: 'nv nv-' + res.result.replace(/\s+/g, '-') }, v),
      res.read_as ? h('div', { class: 'muted small' }, 'read as ', res.read_as, res.nearest_choice_text ? ` → nearest choice “${res.nearest_choice_text}”` : '') : null,
      h('div', { class: 'small' }, 'Keyed: “', res.keyed_choice_text, '” ', h('span', { class: 'src-chip' }, res.label))].filter(Boolean));
    if (res.official_comparison) cell.append(compareBlock(res.official_comparison));
  } else if (res.method === 'official_comparison') cell.append(compareBlock(res));
}
function compareBlock(c) {
  return h('div', { class: 'cmp' }, c.official.map(o => h('div', {},
    'You: ', h('b', {}, c.you), ' · Official: ', h('b', {}, o.official_as_printed), o.difference ? ` · ${o.difference}` : '',
    ' ', h('span', { class: 'src-chip' }, o.source_label))), h('div', { class: 'muted small' }, 'comparison only, no pass/fail'));
}
