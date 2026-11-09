// Tabbed reference area: Briefing Packet + Nav Table, each full-screenable. Created lazily.
import { h, clear, inkTabs } from './util.js';
import { briefingPacket } from './briefing.js';
import { navTable } from './navtable.js';

export async function referencePanel(year, { attemptKey, measureAssist, initialTab = 'packet' } = {}) {
  const root = h('section', { class: 'refpanel' });
  const tabs = h('div', { class: 'ref-tabs', role: 'tablist' });
  const body = h('div', { class: 'ref-body' });
  const panes = {}, made = {};
  let cur = null;
  const fsBtn = h('button', { class: 'tbtn', title: 'Full screen', onclick: () => {
    if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen?.();
  } }, '⛶');
  const defs = [['packet', 'Briefing Packet'], ['nav', 'Nav Table']];
  for (const [id, label] of defs) {
    panes[id] = h('div', { class: 'ref-pane', hidden: true });
    body.append(panes[id]);
    tabs.append(h('button', { class: 'ref-tab', 'data-id': id, role: 'tab', onclick: () => show(id) }, label));
  }
  tabs.append(h('span', { class: 'grow' }), fsBtn);
  root.append(tabs, body);

  async function show(id) {
    cur = id;
    for (const b of tabs.querySelectorAll('.ref-tab')) b.classList.toggle('on', b.dataset.id === id);
    inkTabs(tabs);
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== id;
    if (!made[id]) {
      made[id] = id === 'packet' ? briefingPacket(year, { marksKey: attemptKey }) : navTable(year, { attemptKey });
      const v = await made[id];
      clear(panes[id]).append(v.root);
      api.packet = id === 'packet' ? v : api.packet;
    }
    // viewers measure their box on resize; make sure a newly shown one fits
    window.dispatchEvent(new Event('resize'));
  }
  const api = {
    root,
    show,
    async openPage(page) { await show('packet'); const v = await made.packet; v.show(page); },
    destroy() { for (const p of Object.values(made)) p.then(v => v.destroy?.()); },
  };
  show(initialTab);
  return api;
}
