// Mode 1: FULL TEST — the year's full question set as the real event runs it. Quiet, paper-like.
import { h, clear, api, store, results, session, gauge, fmtClock, uid, CATEGORY_LABEL, TOPIC_LABEL } from './util.js';
import { questionCard, resultBlock, contextsFor, tagLine } from './question.js';
import { timerPicker, Clock } from './timer.js';
import { sfx, countUp, burst } from './fx.js';
import { referencePanel } from './reference.js';

export async function fullTestCover(app, year) {
  const q = await api.year(year, 'questions');
  const saved = store.get(`test:${year}:current`, null);
  const tp = timerPicker(q.time_limit?.minutes ?? null);
  clear(app).append(h('section', { class: 'paper cover' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' › Full Test › ', String(year)),
    h('h1', {}, `${year} Regional SCAN — Full Test`),
    h('div', { class: 'instructions' }, q.instructions
      ? h('p', {}, q.instructions)
      : h('p', { class: 'muted' }, 'No instructions page in the source for this year.')),
    q.time_limit?.minutes
      ? h('p', { class: 'muted small' }, 'Time limit as printed: “', q.time_limit.quote, '” (', q.time_limit.file.split('/').pop(), ' p', q.time_limit.page, ')')
      : h('p', { class: 'muted small' }, 'No time limit is printed for this year. Choose Custom or Off.'),
    tp.el,
    h('p', { class: 'muted small' }, `${q.questions.length} questions. No score or feedback until you submit.`),
    h('div', { class: 'actions' },
      saved ? h('button', { class: 'btn primary', onclick: () => location.hash = `#/test/${year}/run` }, 'Resume attempt in progress') : null,
      h('button', { class: 'btn ' + (saved ? '' : 'primary'), onclick: () => {
        if (saved && !confirm('Discard the attempt in progress and start again?')) return;
        const id = uid();
        store.set(`test:${year}:current`, { id, year, startedAt: Date.now(), timer: tp.value(), answers: {}, flags: [], current: 0 });
        location.hash = `#/test/${year}/run`;
      } }, saved ? 'Start new attempt' : 'Start test'))));
}

export async function fullTestRun(app, year, ctx) {
  const att = store.get(`test:${year}:current`, null);
  if (!att) { location.hash = `#/test/${year}`; return; }
  const q = await api.year(year, 'questions');
  const qs = q.questions, nums = qs.map(x => x.number);
  const save = () => store.set(`test:${year}:current`, att);

  const grid = h('nav', { class: 'qgrid', 'aria-label': 'Question list' });
  const main = h('div', { class: 'qmain' });
  const clockSlot = h('div', { class: 'clock-slot' });
  const head = h('div', { class: 'run-head' },
    h('span', { class: 'run-title' }, `${year} Full Test`), clockSlot,
    h('button', { class: 'btn primary', onclick: () => submit(false) }, 'Submit'));
  const qpanel = h('section', { class: 'qpanel paper' }, grid, main);
  const ref = await referencePanel(year, { attemptKey: att.id, measureAssist: false });
  clear(app).append(h('div', { class: 'run' }, head, h('div', { class: 'split' }, qpanel, ref.root)));
  ctx.onLeave(() => { clock.stop(); ref.destroy(); });

  const clock = new Clock({ minutes: att.timer.minutes, startedAt: att.startedAt, onExpire: () => submit(true) });
  clockSlot.append(clock.el);

  function drawGrid() {
    clear(grid);
    qs.forEach((x, i) => {
      const a = att.answers[x.number];
      grid.append(h('button', {
        class: ['gbtn', a?.length && 'answered', att.flags.includes(x.number) && 'flagged', i === att.current && 'cur'].filter(Boolean).join(' '),
        title: `Question ${x.number}${att.flags.includes(x.number) ? ' (flagged)' : ''}`,
        onclick: () => { att.current = i; save(); draw(); } }, String(x.number)));
    });
  }
  function draw() {
    drawGrid();
    const x = qs[att.current];
    const flagged = att.flags.includes(x.number);
    clear(main).append(
      questionCard(x, { selected: att.answers[x.number] || [], contexts: contextsFor(q.context_blocks, x.number, nums),
        onSelect: letters => { att.answers[x.number] = letters; save(); draw(); } }),
      h('div', { class: 'qnav' },
        h('button', { class: 'btn', disabled: att.current === 0, onclick: () => { att.current--; save(); draw(); } }, '← Previous'),
        h('button', { class: 'btn' + (flagged ? ' on' : ''), onclick: () => {
          att.flags = flagged ? att.flags.filter(n => n !== x.number) : [...att.flags, x.number]; save(); draw();
        } }, flagged ? '⚑ Flagged' : '⚐ Flag for review'),
        h('button', { class: 'btn', disabled: att.current === qs.length - 1, onclick: () => { att.current++; save(); draw(); } }, 'Next →')));
    main.scrollTop = 0;
  }
  draw();
  // keyboard: A-D (or 1-4) pick, ← → move, F flag
  const onKey = e => {
    if (e.target.closest('input, textarea, select, .viewer') || e.ctrlKey || e.metaKey || e.altKey) return;
    const x = qs[att.current];
    const k = e.key.toLowerCase();
    const idx = 'abcdefgh'.indexOf(k) >= 0 ? 'abcdefgh'.indexOf(k) : '12345678'.indexOf(k);
    if (idx >= 0 && x.choices[idx]) {
      const lab = x.choices[idx].label;
      const cur = att.answers[x.number] || [];
      att.answers[x.number] = x.multi_answer ? (cur.includes(lab) ? cur.filter(l => l !== lab) : [...cur, lab].sort()) : [lab];
    } else if (e.key === 'ArrowRight' && att.current < qs.length - 1) att.current++;
    else if (e.key === 'ArrowLeft' && att.current > 0) att.current--;
    else if (k === 'f') att.flags = att.flags.includes(x.number) ? att.flags.filter(n => n !== x.number) : [...att.flags, x.number];
    else return;
    e.preventDefault(); save(); draw();
  };
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => document.removeEventListener('keydown', onKey));
  qpanel.append(h('div', { class: 'muted small kbd-hint' }, 'Keys: A–D choose · ← → previous/next · F flag'));

  let submitting = false;
  async function submit(auto) {
    if (submitting) return;
    if (!auto) {
      const unanswered = qs.filter(x => !(att.answers[x.number]?.length)).map(x => x.number);
      const msg = (unanswered.length ? `${unanswered.length} question(s) unanswered: ${unanswered.join(', ')}.\n` : '') +
        (att.flags.length ? `Flagged for review: ${att.flags.join(', ')}.\n` : '') + 'Submit the test now?';
      if (!confirm(msg)) return;
    }
    submitting = true;
    clock.stop();
    sfx.submit();
    const save = { kind: 'full_test', timer: att.timer, seconds: Math.round(clock.elapsed()), flags: att.flags, auto };
    const res = await api.submit(year, nums, att.answers, save);
    const id = await results.add('full_test', year, { score: res.score, ...save }, { results: res.results, answers: att.answers });
    store.del(`test:${year}:current`);
    location.hash = `#/debrief/${id}`;
  }
}

export async function debrief(app, attemptId) {
  const rec = await results.get(attemptId);
  const res = rec?.detail;
  if (!rec || !res) {
    clear(app).append(h('section', { class: 'panel' }, h('p', {}, rec
      ? 'The detailed debrief for this older attempt is no longer kept (only the most recent attempts keep one). Its score is still in your results.'
      : 'That attempt is not saved in this browser.'), h('a', { href: '#/' }, 'Home')));
    return;
  }
  rec.seconds = rec.seconds || 0; rec.timer = rec.timer || { mode: 'off' };
  res.score = rec.score;
  const q = await api.year(rec.year, 'questions');
  const byN = Object.fromEntries(q.questions.map(x => [x.number, x]));
  const filt = { category: '', leg: '', topic: '', result: '' };
  const list = h('div', { class: 'debrief-list' });
  const sel = (key, opts) => h('select', { onchange: e => { filt[key] = e.target.value; draw(); } },
    h('option', { value: '' }, 'All'), ...opts.map(([v, l]) => h('option', { value: v }, l)));
  const legs = [...new Set(q.questions.map(x => x.leg).filter(Boolean))];
  const topics = [...new Set(q.questions.flatMap(x => x.topics))];
  const sc = res.score;
  clear(app).append(h('section', { class: 'paper debrief' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' › Debrief'),
    h('h1', {}, `${rec.year} Full Test — Debrief`),
    h('div', { class: 'score-line' }, gauge(sc.percent, 'Score', { size: 104 }),
      h('span', { class: 'big' }, h('span', { class: 'count' }, '0'), ` / ${sc.scored}`), sc.percent != null ? ` (${sc.percent}%)` : '',
      ` · time used ${fmtClock(rec.seconds)}`, ` · timer ${rec.timer.mode}${rec.timer.minutes ? ` (${rec.timer.minutes} min)` : ''}`,
      rec.auto ? ' · auto-submitted at time' : '',
      sc.unscored ? ` · ${sc.unscored} question(s) have no official answer and are not scored` : ''),
    h('div', { class: 'filters' },
      h('label', {}, 'Category ', sel('category', Object.entries(CATEGORY_LABEL))),
      legs.length ? h('label', {}, 'Leg ', sel('leg', legs.map(l => [l, l]))) : null,
      h('label', {}, 'Topic ', sel('topic', topics.map(t => [t, TOPIC_LABEL[t] || t]))),
      h('label', {}, 'Result ', sel('result', [['correct', 'Correct'], ['incorrect', 'Incorrect'], ['unanswered', 'Unanswered'], ['no official answer', 'No official answer']])),
      h('span', { class: 'muted small' }, 'Category, leg and topic are inferred, not printed in the test.')),
    list,
    h('div', { class: 'actions' }, h('a', { class: 'btn', href: `#/test/${rec.year}` }, 'Take it again'), h('a', { class: 'btn', href: '#/' }, 'Home'))));
  countUp(app.querySelector('.score-line .count'), sc.correct);
  if (sc.percent != null) setTimeout(() => { sfx.fanfare(sc.percent); if (sc.percent >= 70) burst(app.querySelector('.score-line .gauge-wrap'), { count: 24 }); }, 350);
  function draw() {
    clear(list);
    for (const r of res.results) {
      const x = byN[r.number];
      if (filt.category && x.category !== filt.category) continue;
      if (filt.leg && x.leg !== filt.leg) continue;
      if (filt.topic && !x.topics.includes(filt.topic)) continue;
      if (filt.result && r.result !== filt.result) continue;
      const card = questionCard(x, { selected: r.selected, result: r, disabled: true });
      card.append(tagLine(x));
      if (rec.flags?.includes(r.number)) card.querySelector('.qhead').append(h('span', { class: 'flag-mark' }, '⚑ flagged'));
      list.append(card);
    }
    if (!list.childNodes.length) list.append(h('p', { class: 'muted' }, 'No questions match these filters.'));
  }
  draw();
}
export { resultBlock };
