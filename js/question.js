// Question card + result display, shared by all modes. Text is rendered exactly as stored.
import { h, richText, sourceLabel, rwy, secureImg, CATEGORY_LABEL, TOPIC_LABEL } from './util.js';

// Render one question. opts: {selected:[], onSelect(letters), disabled, result, contexts:[block], relatedPrompts:{n:prompt}}
export function questionCard(q, opts = {}) {
  const sel = new Set(opts.selected || []);
  const card = h('article', { class: 'qcard', 'data-n': q.number });
  for (const cb of opts.contexts || []) {
    card.append(h('div', { class: 'context-block' }, h('div', {}, cb.text),
      h('span', { class: 'src-chip' }, `test p${cb.page}`)));
  }
  const head = h('header', { class: 'qhead' },
    h('span', { class: 'qnum' }, q.number_as_printed || `${q.number}.`),
    q.reference ? h('span', { class: 'src-chip', title: 'basis for this app-written question' }, q.reference)
      : h('span', { class: 'src-chip', title: q.source?.file }, sourceLabel(q.source)));
  card.append(head);
  if (q.chart_unavailable) card.append(h('div', { class: 'note warn' }, q.chart_unavailable.note));
  card.append(h('p', { class: 'prompt' }, richText(q.prompt, q.emphasis)));
  if (q.exhibit) {
    card.append(h('figure', { class: 'exhibit' }, h('pre', { class: 'mono' }, q.exhibit.text),
      h('figcaption', { class: 'muted small' }, 'Real line, quoted verbatim: ', q.exhibit.source)));
  }
  if (q.figure) {
    card.append(q.figure.src
      ? h('figure', { class: 'qfig' }, secureImg(q.figure.src, { class: 'qimg', alt: `Figure ${q.figure.id}` }), h('figcaption', { class: 'muted small' }, `Figure ${q.figure.id}`))
      : h('div', { class: 'note warn' }, `Figure ${q.figure.id} has not been added yet. It should show: ${q.figure.need}`));
  }
  for (const img of q.embedded_images || []) card.append(secureImg(img, { class: 'qimg', alt: `Image printed with question ${q.number}` }));
  if (q.related?.length) {
    const rel = h('div', { class: 'related' });
    for (const r of q.related) {
      const label = r.display === 'uses_your_answer' ? `uses your answer to Q${r.number}`
        : r.display === 'regardless_of' ? null
        : r.display === 'context_from' ? `context from Q${r.number}` : `related question: Q${r.number}`;
      if (!label) continue;
      const prompt = opts.relatedPrompts?.[r.number];
      rel.append(prompt ? h('details', {}, h('summary', {}, label), h('p', { class: 'muted' }, prompt)) : h('span', { class: 'rel-chip' }, label));
    }
    if (rel.childNodes.length) card.append(rel);
  }
  if (q.multi_answer) card.append(h('div', { class: 'note' }, 'Select every correct choice.'));
  const list = h('div', { class: 'choices', role: q.multi_answer ? 'group' : 'radiogroup' });
  const res = opts.result;
  for (const c of q.choices) {
    const isKey = res && res.key_letters?.includes(c.label);
    const picked = sel.has(c.label);
    const cls = ['choice', picked && 'picked', res && isKey && 'key', res && picked && !isKey && res.scored && 'wrong'].filter(Boolean).join(' ');
    const btn = h('button', { class: cls, role: q.multi_answer ? 'checkbox' : 'radio', 'aria-checked': picked ? 'true' : 'false',
      disabled: opts.disabled || !!res, onclick: () => {
        if (q.multi_answer) { picked ? sel.delete(c.label) : sel.add(c.label); } else { sel.clear(); sel.add(c.label); }
        opts.onSelect?.([...sel].sort());
      } },
      h('span', { class: 'clabel' }, c.label_as_printed || c.label + '.'), h('span', { class: 'ctext' }, c.text));
    list.append(btn);
  }
  card.append(list);
  if (res) card.append(resultBlock(res, q));
  return card;
}

export function resultBlock(res, q) {
  const verdict = { correct: 'Correct', incorrect: 'Incorrect', unanswered: 'Not answered', 'no official answer': 'No official answer (not scored)' }[res.result] || res.result;
  const box = h('div', { class: `result r-${res.result.replace(/\s+/g, '-')}` },
    h('div', { class: 'verdict' }, verdict),
    res.key_letters?.length ? h('div', {}, res.explanation?.kind === 'app_explanation' ? 'Answer: ' : 'Official answer: ', h('b', {}, res.key_as_printed ?? res.key_letters.join(', ')),
      ' ', h('span', { class: 'src-chip' }, sourceLabel(res.key_source))) : null);
  if (res.explanation) {
    box.append(h('div', { class: 'expl' }, h('span', { class: 'expl-kind' }, res.explanation.kind === 'reference' ? 'Official reference' : res.explanation.kind === 'app_explanation' ? 'Explanation (written for this app)' : 'Official explanation'),
      h('p', {}, res.explanation.text), h('span', { class: 'src-chip' }, sourceLabel(res.explanation.source))));
  } else if (res.scored || res.key_letters?.length) {
    box.append(h('div', { class: 'muted small' }, 'No official explanation.'));
  }
  return box;
}

export function tagLine(q) {
  return h('div', { class: 'tags' },
    h('span', { class: 'muted small' }, 'Tags (inferred, not printed):'),
    h('span', { class: 'tag', title: 'inferred, not printed in the source' }, CATEGORY_LABEL[q.category] || q.category),
    q.leg ? h('span', { class: 'tag tag-leg', title: 'leg (inferred)' }, rwy(q.leg)) : null,
    ...(q.topics || []).map(t => h('span', { class: 'tag topic', title: 'inferred' }, TOPIC_LABEL[t] || t)));
}

// context blocks that should appear before question n (shown before the first listed question they apply to)
export function contextsFor(ctxBlocks, n, shownNumbers) {
  return (ctxBlocks || []).filter(cb => {
    const firstShown = cb.applies_to.find(x => shownNumbers.includes(x));
    return firstShown === n;
  });
}
