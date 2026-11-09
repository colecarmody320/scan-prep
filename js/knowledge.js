// Mode 2: KNOWLEDGE — one place for both question sources:
//   * SCAN knowledge questions (category == knowledge, verbatim from the tests, official key)
//   * PPL general knowledge (app-authored bank with citations; answers checked on the server)
// Both share Study (calm, shuffled every session, streak + quick feedback) and Drill (arcade, aviator theme).
// A pool item is {id, label, q, tags(), check(selected)}.
import { h, clear, api, store, results, gauge, inkTabs, TOPIC_LABEL } from './util.js';
import { questionCard, tagLine } from './question.js';
import { sfx, burst, pop } from './fx.js';

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function loadScan(f) {
  const out = [];
  for (const y of f.years) {
    const q = await api.year(y, 'questions');
    const kn = new Set(q.modes.knowledge);
    for (const x of q.questions) {
      if (!kn.has(x.number)) continue;
      if (f.topics.length && !x.topics.some(t => f.topics.includes(t))) continue;
      out.push({ id: `${y}:${x.number}`, label: `${y} SCAN · Q${x.number}`, q: x, tags: () => tagLine(x),
        check: sel => api.check(y, x.number, sel) });
    }
  }
  return out;
}

// client view of the bank (the full bank, with answers, is data/ppl.json; answers are checked by api.pplCheck)
let pplView = null;
export async function pplBank() {
  if (pplView) return pplView;
  const b = await api.ppl();
  pplView = { topics: b.topics, questions: b.questions.map(q => ({ id: q.id, topic: q.topic, prompt: q.prompt, choices: q.choices,
    multi_answer: q.answer.length > 1, reference: q.reference, scan_themes: q.scan_themes || [], exhibit: q.exhibit || null,
    figure: q.visual ? { id: q.visual.id, need: q.visual.need, src: q.visual.src || null } : null })) };
  return pplView;
}
function pplQuestion(x) {
  return { number: x.id, number_as_printed: x.id, prompt: x.prompt, emphasis: [], choices: x.choices.map(c => ({ ...c, label_as_printed: c.label + '.' })),
    multi_answer: x.multi_answer, scored: true, reference: x.reference, figure: x.figure, exhibit: x.exhibit, related: [], embedded_images: [] };
}
async function loadPPL(f) {
  const b = await pplBank();
  const out = [];
  for (const x of b.questions) {
    if (f.topics.length && !f.topics.includes(x.topic)) continue;
    if (f.scanOnly && !x.scan_themes.length) continue;
    if (x.figure && !x.figure.src && !f.includePending) continue;
    out.push({ id: 'ppl:' + x.id, label: `PPL · ${b.topics[x.topic]}`, q: pplQuestion(x),
      tags: () => h('div', { class: 'tags' }, h('span', { class: 'tag topic' }, b.topics[x.topic]),
        x.scan_themes.length ? h('span', { class: 'tag', title: 'The NIFA SCAN tests asked about this theme in: ' + x.scan_themes.join(', ') }, 'SCAN theme: ' + x.scan_themes.join(', ')) : null),
      check: sel => api.pplCheck(x.id, sel) });
  }
  return out;
}

export const SOURCES = {
  scan: { key: 'knowledge:filters', title: 'SCAN knowledge', load: loadScan, pb: 'pb:', study: 'knowledge_study', drill: 'knowledge_drill' },
  ppl: { key: 'ppl:filters', title: 'PPL general knowledge', load: loadPPL, pb: 'pplpb:', study: 'ppl_study', drill: 'ppl_drill' },
};
const DEFAULTS = {
  scan: { years: [], topics: [], seconds: 20 },
  ppl: { topics: [], seconds: 20, scanOnly: false, includePending: false },
};
const base = src => `#/knowledge/${src}`;

// ------------------------------------------------------------------ setup (one page, source switch)
export async function knowledgeSetup(app, srcParam) {
  const src = srcParam === 'ppl' || srcParam === 'scan' ? srcParam : store.get('knowledge:source', 'scan');
  if (src !== store.get('knowledge:source', 'scan')) store.set('knowledge:source', src);
  const recent = await results.list().catch(() => []);
  const seg = h('div', { class: 'segmented tabs', role: 'tablist' },
    ...['scan', 'ppl'].map(k => h('button', { class: 'seg' + (k === src ? ' on' : ''), role: 'tab', 'aria-selected': k === src ? 'true' : 'false',
      onclick: () => { location.hash = base(k); } }, k === 'scan' ? 'SCAN knowledge' : 'PPL general knowledge')));
  const body = h('div', {});
  clear(app).append(h('section', { class: 'panel wide' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' › Knowledge'),
    h('div', { class: 'page-head' }, h('h1', {}, 'Knowledge'), lastScores(recent, src)),
    seg, h('div', { class: 'rwy-divider', 'aria-hidden': 'true' }), body));
  inkTabs(seg);
  if (src === 'scan') await scanFilters(body); else await pplFilters(body);
}

function lastScores(recent, src) {
  const S = SOURCES[src];
  const st = recent.filter(r => r.kind === S.study).slice(0, 10);
  const dr = recent.filter(r => r.kind === S.drill);
  const answered = st.reduce((a, r) => a + (r.answered || 0), 0), correct = st.reduce((a, r) => a + (r.correct || 0), 0);
  const best = dr.reduce((m, r) => Math.max(m, r.alt || 0), 0);
  return h('div', { class: 'gauges' },
    gauge(answered ? (100 * correct) / answered : null, 'Study accuracy', { size: 84, sub: answered ? `${correct}/${answered} recent` : 'no sessions yet' }),
    h('div', { class: 'stat' }, h('b', {}, best ? best.toLocaleString() + ' ft' : '--'), h('small', {}, 'best Drill altitude')));
}

function modePick(go, extra = null) {
  const secs = h('input', { type: 'number', min: '5', max: '120', value: '20', 'aria-label': 'Seconds per question' });
  return {
    secs,
    el: h('div', { class: 'mode-pick' },
      h('div', { class: 'mode-card' }, h('h3', {}, 'Study'), h('p', {}, 'One question at a time, no timer, in a new random order every session. Answer and explanation after each.'),
        extra, h('button', { class: 'btn primary', onclick: () => go('study') }, 'Start study')),
      h('div', { class: 'mode-card drill-card' }, h('h3', {}, '✈ Drill'), h('p', {}, 'Fast timed rounds, 3 engines, streak multiplier. Climb as high as you can.'),
        h('label', {}, 'Seconds per question ', secs), h('button', { class: 'btn primary', onclick: () => go('drill') }, 'Take off'))),
  };
}

async function scanFilters(body) {
  const idx = await api.index();
  const prev = { ...DEFAULTS.scan, ...store.get('knowledge:filters', {}) };
  const allTopics = new Set();
  for (const y of idx.years) (await api.year(y.year, 'questions')).questions
    .filter(x => x.category === 'knowledge').forEach(x => x.topics.forEach(t => allTopics.add(t)));
  const yearBoxes = idx.years.map(y => h('label', { class: 'chk' },
    h('input', { type: 'checkbox', value: y.year, checked: prev.years.includes(y.year) || !prev.years.length }), ` ${y.year} `,
    h('span', { class: 'muted small' }, `(${y.knowledge_questions})`)));
  const topicBoxes = [...allTopics].sort().map(t => h('label', { class: 'chk' },
    h('input', { type: 'checkbox', value: t, checked: prev.topics.includes(t) }), ' ', TOPIC_LABEL[t] || t));
  const count = h('span', { class: 'muted' });
  const mp = modePick(go);
  mp.secs.value = String(prev.seconds);
  function read() {
    return { years: yearBoxes.map(l => l.firstChild).filter(i => i.checked).map(i => +i.value),
      topics: topicBoxes.map(l => l.firstChild).filter(i => i.checked).map(i => i.value), seconds: Math.max(5, +mp.secs.value || 20) };
  }
  async function recount() { count.textContent = `${(await loadScan(read())).length} questions match.`; }
  function go(style) { store.set('knowledge:filters', read()); location.hash = `${base('scan')}/${style}`; }
  const allNone = (boxes, v) => () => { boxes.forEach(l => l.firstChild.checked = v); recount(); };
  body.append(
    h('p', { class: 'muted' }, 'Questions from the SCAN tests that need no supplement, chart or earlier answer, shown exactly as printed and graded against the official key. The knowledge tag is inferred.'),
    h('fieldset', { onchange: recount }, h('legend', {}, 'Years ', h('button', { class: 'link', onclick: allNone(yearBoxes, true) }, 'all'), ' · ',
      h('button', { class: 'link', onclick: allNone(yearBoxes, false) }, 'none')), h('div', { class: 'chk-grid' }, yearBoxes)),
    h('fieldset', { onchange: recount }, h('legend', {}, 'Topics (none ticked = all) ', h('button', { class: 'link', onclick: allNone(topicBoxes, false) }, 'clear')),
      h('div', { class: 'chk-grid' }, topicBoxes)),
    h('p', {}, count), mp.el);
  recount();
}

async function pplFilters(body) {
  const b = await pplBank();
  const prev = { ...DEFAULTS.ppl, ...store.get('ppl:filters', {}) };
  const topicBoxes = Object.entries(b.topics).map(([k, v]) => h('label', { class: 'chk' },
    h('input', { type: 'checkbox', value: k, checked: prev.topics.includes(k) }), ' ', v,
    h('span', { class: 'muted small' }, ` (${b.questions.filter(x => x.topic === k).length})`)));
  const scanOnly = h('input', { type: 'checkbox', checked: prev.scanOnly });
  const pending = h('input', { type: 'checkbox', checked: prev.includePending });
  const count = h('span', { class: 'muted' });
  const mp = modePick(go);
  mp.secs.value = String(prev.seconds);
  const read = () => ({ topics: topicBoxes.map(l => l.firstChild).filter(i => i.checked).map(i => i.value),
    seconds: Math.max(5, +mp.secs.value || 20), scanOnly: scanOnly.checked, includePending: pending.checked });
  async function recount() { count.textContent = `${(await loadPPL(read())).length} questions match.`; }
  function go(style) { store.set('ppl:filters', read()); location.hash = `${base('ppl')}/${style}`; }
  const missing = b.questions.filter(x => x.figure && !x.figure.src);
  body.append(
    h('p', { class: 'muted' }, `${b.questions.length} Private Pilot practice questions at FAA knowledge-test level, written for this app (not from the FAA test bank or the SCAN papers). `,
      'Each answer cites the regulation, AIM paragraph, handbook or Chart Supplement legend it comes from.'),
    h('fieldset', { onchange: recount }, h('legend', {}, 'Topics (none ticked = all) ',
      h('button', { class: 'link', onclick: () => { topicBoxes.forEach(l => l.firstChild.checked = false); recount(); } }, 'clear')),
      h('div', { class: 'chk-grid' }, topicBoxes)),
    h('fieldset', { onchange: recount }, h('legend', {}, 'Options'),
      h('label', { class: 'chk' }, scanOnly, ' Only themes the SCAN tests have asked about'), h('br'),
      h('label', { class: 'chk' }, pending, ` Include questions whose figure hasn't been added yet (${missing.length})`)),
    h('p', {}, count), mp.el);
  recount();
}

// ------------------------------------------------------------------ Study
export async function knowledgeStudy(app, ctx, src = 'scan') {
  const SRC = SOURCES[src];
  const f = { ...DEFAULTS[src], ...store.get(SRC.key, {}) };
  const pool = shuffle(await SRC.load(f)); // a new random order every session
  let i = 0, streak = 0, best = 0;
  const marks = new Set(store.get('bookmarks', []));
  const wrap = h('section', { class: 'panel study' });
  clear(app).append(wrap);
  if (!pool.length) { wrap.append(h('p', {}, 'No questions match. ', h('a', { href: base(src) }, 'Change filters'))); return; }
  const res = {}, picks = {};
  const tally = () => { const r = Object.values(res).filter(x => x.scored); return { answered: r.length, correct: r.filter(x => x.result === 'correct').length }; };
  ctx.onLeave(() => { const t = tally(); if (t.answered) results.add(SRC.study, null, { ...t, best_streak: best, source: src }).catch(() => {}); });
  function draw(flash) {
    const item = pool[i], { q, id } = item;
    const sel = picks[id] || [];
    const r = res[id];
    const bm = marks.has(id);
    const t = tally();
    const card = questionCard(q, { selected: sel, result: r, onSelect: l => { picks[id] = l; draw(); } });
    if (flash) card.classList.add(flash);
    clear(wrap).append(
      h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), ' › ', h('a', { href: base(src) }, 'Knowledge'), ' › ', SRC.title, ' › Study'),
      h('div', { class: 'study-head' },
        h('span', { class: 'mono small' }, `${item.label} · ${i + 1} / ${pool.length}`),
        h('span', { class: 'streak' + (streak >= 3 ? ' hot' : ''), title: 'Correct answers in a row' }, '▲ ', h('b', {}, streak), ' streak'),
        h('span', { class: 'mono small' }, `${t.correct}/${t.answered} correct`),
        h('button', { class: 'btn small' + (bm ? ' on' : ''), onclick: () => { bm ? marks.delete(id) : marks.add(id); store.set('bookmarks', [...marks]); draw(); } }, bm ? '★ Bookmarked' : '☆ Bookmark')),
      card, item.tags(),
      h('div', { class: 'qnav' },
        h('button', { class: 'btn', disabled: i === 0, onclick: () => { i--; draw(); } }, '← Previous'),
        h('button', { class: 'btn primary', disabled: !!r || !sel.length, onclick: async () => {
          const out = await item.check(sel); res[id] = out;
          if (out.scored) { streak = out.result === 'correct' ? streak + 1 : 0; best = Math.max(best, streak); }
          draw(out.result === 'correct' ? 'flash-ok' : out.scored ? 'flash-bad' : null);
          if (out.result === 'correct') {
            sfx.correct(); burst(wrap.querySelector('.result'));
            if (streak && streak % 5 === 0) { setTimeout(() => sfx.streak(streak), 250); pop(`Streak ×${streak}!`, wrap.querySelector('.streak'), 'gold'); }
          } else if (out.scored) sfx.wrong();
        } }, 'Check answer'),
        h('button', { class: 'btn', disabled: i === pool.length - 1, onclick: () => { i++; draw(); } }, 'Next →')));
  }
  draw();
}

// ------------------------------------------------------------------ Drill (arcade, aviator theme)
const BADGES = [
  { id: 'solo', name: 'First Solo', test: s => s.correct >= 1, icon: '🛩' },
  { id: 'wingman', name: 'Wingman', test: s => s.bestStreak >= 5, icon: '◆' },
  { id: 'element', name: 'Element Lead', test: s => s.bestStreak >= 10, icon: '◆◆' },
  { id: 'flight', name: 'Flight Lead', test: s => s.bestStreak >= 15, icon: '◆◆◆' },
  { id: 'ace', name: 'Squadron Ace', test: s => s.bestStreak >= 25, icon: '★' },
  { id: 'fl100', name: 'FL100 Club', test: s => s.alt >= 10000, icon: '▲' },
  { id: 'fl180', name: 'Class A (FL180)', test: s => s.alt >= 18000, icon: '▲▲' },
  { id: 'fl350', name: 'Flight Level 350', test: s => s.alt >= 35000, icon: '▲▲▲' },
  { id: 'deadstick', name: 'Dead-stick Hero', test: s => s.lives === 1 && s.streak >= 5, icon: '⚙' },
];
const FT_PER = 500;

export async function knowledgeDrill(app, ctx, src = 'scan') {
  const SRC = SOURCES[src];
  const f = { ...DEFAULTS[src], ...store.get(SRC.key, {}) };
  const all = (await SRC.load(f)).filter(p => p.q.scored);
  const pbKey = SRC.pb + JSON.stringify([(f.years || []).slice().sort(), f.topics.slice().sort(), f.seconds, !!f.scanOnly]);
  const pb = store.get(pbKey, 0);
  const earned = new Set(store.get('badges', []));
  const st = { lives: 3, streak: 0, bestStreak: 0, alt: 0, correct: 0, asked: 0, newBadges: [] };
  let deck = shuffle(all.slice()), raf = null, finished = false;
  const root = h('section', { class: 'drill' });
  clear(app).append(root);
  ctx.onLeave(() => cancelAnimationFrame(raf));
  if (!all.length) { root.append(h('p', {}, 'No scored questions match. ', h('a', { href: base(src) }, 'Change filters'))); return; }

  const mult = () => Math.min(5, 1 + Math.floor(st.streak / 3));
  const hud = h('div', { class: 'hud' });
  const alti = h('div', { class: 'altimeter' });
  const stage = h('div', { class: 'drill-stage' });
  root.append(h('div', { class: 'drill-top' }, h('a', { href: base(src), class: 'link light' }, '‹ Knowledge'), hud), h('div', { class: 'drill-main' }, alti, stage));

  function drawHud() {
    clear(hud).append(
      h('div', { class: 'engines', title: `${st.lives} engine(s) running`, 'aria-label': `${st.lives} lives` },
        ...[0, 1, 2].map(k => h('span', { class: 'engine' + (k < st.lives ? '' : ' out') }, k < st.lives ? '✇' : '✕'))),
      h('div', { class: 'hud-item' }, h('small', {}, 'STREAK'), h('b', {}, st.streak)),
      h('div', { class: 'hud-item' }, h('small', {}, 'MULT'), h('b', {}, '×' + mult())),
      h('div', { class: 'hud-item' }, h('small', {}, 'BEST'), h('b', {}, Math.max(pb, st.alt).toLocaleString() + ' ft')));
    const pct = Math.min(1, st.alt / 40000);
    const fill = h('div', { class: 'alt-fill', style: { height: pct * 100 + '%' } });
    fill.style.setProperty('--alt', pct * 100 + '%');
    clear(alti).append(h('div', { class: 'alt-tape' }, fill,
      ...[10000, 18000, 35000].map(a => h('div', { class: 'alt-mark', style: { bottom: a / 400 + '%' } }, a >= 18000 ? 'FL' + a / 100 : (a / 1000) + 'k'))),
      h('div', { class: 'alt-read' }, st.alt.toLocaleString(), h('small', {}, ' ft')));
  }
  function checkBadges() {
    for (const b of BADGES) if (!earned.has(b.id) && b.test(st)) { earned.add(b.id); st.newBadges.push(b); toast(b); }
    store.set('badges', [...earned]);
  }
  function toast(b) {
    const t = h('div', { class: 'badge-toast' }, h('span', { class: 'badge-ico' }, b.icon), ' Badge earned: ', h('b', {}, b.name));
    root.append(t); setTimeout(() => t.remove(), 2600);
    sfx.badge(); setTimeout(() => burst(t, { count: 22 }), 30);
  }
  function next() {
    if (!deck.length) deck = shuffle(all.slice());
    ask(deck.pop());
  }
  function ask(item) {
    const { q } = item;
    drawHud();
    let sel = [], done = false;
    const total = f.seconds * 1000, t0 = performance.now();
    const bar = h('div', { class: 'fuse' }, h('div', { class: 'fuse-fill' }));
    const submitBtn = q.multi_answer ? h('button', { class: 'btn primary', disabled: true, onclick: () => answer(sel) }, 'Lock in') : null;
    const slot = h('div', {});
    const render = () => clear(slot).append(questionCard(q, { selected: sel, onSelect: l => {
      sel = l;
      if (!q.multi_answer) answer(l); else { submitBtn.disabled = !l.length; render(); }
    } }));
    clear(stage).append(h('div', { class: 'drill-q' }, h('div', { class: 'drill-meta' }, item.label), bar, slot, submitBtn));
    render();
    const tick = () => {
      const left = 1 - (performance.now() - t0) / total;
      bar.firstChild.style.width = Math.max(0, left * 100) + '%';
      bar.classList.toggle('low', left < 0.3);
      if (left <= 0 && !done) answer(null); else if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    async function answer(letters) {
      if (done) return; done = true; cancelAnimationFrame(raf);
      const res = await item.check(letters || []);
      st.asked++;
      const ok = res.result === 'correct';
      if (ok) { st.streak++; st.correct++; st.bestStreak = Math.max(st.bestStreak, st.streak); st.alt += FT_PER * mult(); }
      else { st.lives--; st.streak = 0; }
      checkBadges(); drawHud();
      if (ok) { sfx.climb(); pop(`+${FT_PER * Math.min(5, 1 + Math.floor((st.streak - 1) / 3))} ft`, alti.querySelector('.alt-read'), 'gold'); if (st.streak % 5 === 0) setTimeout(() => sfx.streak(st.streak), 300); }
      else { sfx.engineOut(); hud.querySelector('.engine.out:last-of-type')?.classList.add('just-out'); }
      const card = questionCard(q, { selected: letters || [], result: res, disabled: true });
      card.classList.add(ok ? 'flash-ok' : 'flash-bad');
      const banner = ok ? h('div', { class: 'drill-banner ok' }, `Climbing! +${FT_PER * Math.min(5, 1 + Math.floor((st.streak - 1) / 3))} ft`)
        : h('div', { class: 'drill-banner bad' }, letters ? 'Engine out! Wrong answer.' : 'Engine out! Out of time.');
      const cont = h('button', { class: 'btn primary', onclick: go }, st.lives > 0 ? 'Continue' : 'See debrief');
      clear(stage).append(h('div', { class: 'drill-q' }, banner, card, cont));
      cont.focus();
      let auto = null;
      if (ok) auto = setTimeout(go, 1400);
      else if (st.lives > 0) auto = setTimeout(go, 6500); // wrong: show the answer and explanation briefly
      function go() { clearTimeout(auto); if (st.lives > 0) next(); else over(); }
    }
  }
  function over() {
    if (finished) return; finished = true;
    const isPB = st.alt > pb;
    if (isPB) store.set(pbKey, st.alt);
    setTimeout(() => sfx.fanfare(isPB ? 100 : Math.min(79, st.correct * 10)), 200);
    results.add(SRC.drill, null, { alt: st.alt, correct: st.correct, asked: st.asked, best_streak: st.bestStreak, source: src }).catch(() => {});
    clear(stage).append(h('div', { class: 'drill-over' },
      h('h2', {}, 'All engines out — forced landing'),
      h('p', { class: 'big' }, `Max altitude ${st.alt.toLocaleString()} ft`), isPB ? h('p', { class: 'pb' }, '★ New personal best for this filter set') : h('p', {}, `Personal best: ${pb.toLocaleString()} ft`),
      h('p', {}, `${st.correct} correct of ${st.asked} · best streak ${st.bestStreak}`),
      st.newBadges.length ? h('div', { class: 'badges' }, h('h3', {}, 'New badges'), ...st.newBadges.map(b => h('span', { class: 'badge' }, b.icon, ' ', b.name))) : null,
      h('div', { class: 'badges' }, h('h3', {}, 'Squadron badges'), ...BADGES.map(b => h('span', { class: 'badge' + (earned.has(b.id) ? '' : ' locked'), title: earned.has(b.id) ? 'earned' : 'locked' }, b.icon, ' ', b.name))),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => knowledgeDrill(app, ctx, src) }, 'Fly again'), h('a', { class: 'btn', href: base(src) }, 'Change filters'))));
  }
  next();
}
