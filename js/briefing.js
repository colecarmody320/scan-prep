// Briefing Packet: tabbed viewer for a year's supplement pages, with a straightedge and crosshair for reading
// performance graphs, and a pencil + highlighter for annotating (saved per user, per attempt/leg, per page).
// Every page is shown as the rendered image; nothing is OCR'd. Annotations live in source-pixel coordinates,
// so they stay put when the page is zoomed or rotated.
import { h, s, clear, api, store } from './util.js';
import { TileViewer, zoomControls } from './viewer.js';

const DISPLAY_NOTE = {
  image_only: 'Image-only page: values are in the image.',
  image_and_partial_text: 'Mostly image: values are in the image.',
  blank: 'Blank page in the source.',
};

export async function briefingPacket(year, { initialPage = 1, marksKey = null } = {}) {
  const supp = await api.year(year, 'supplement');
  const root = h('div', { class: 'packet' });
  const tabs = h('div', { class: 'page-tabs', role: 'tablist' });
  const body = h('div', { class: 'packet-body' });
  const bar = h('div', { class: 'tool-bar' });
  root.append(tabs, bar, body);
  let viewer = null, current = null;
  const state = { tool: 'pan', edge: null, cross: false };
  const saveKey = `packetmarks:${marksKey || 'year:' + year}`;
  const marks = store.get(saveKey, {});          // { page: [{t: 'pen'|'hl', pts: [[x,y],...]}] }
  const persist = () => store.set(saveKey, marks);

  function show(pageNo) {
    const p = supp.pages.find(x => x.page === pageNo) || supp.pages[0];
    current = p.page;
    for (const b of tabs.children) b.classList.toggle('on', +b.dataset.page === p.page);
    viewer?.destroy();
    clear(body);
    const rot = rotationOf(p);
    viewer = new TileViewer({ width: p.width_px, height: p.height_px, tiles: p.tiles, tileSize: 1024, rotation: rot });
    body.append(viewer.root, zoomControls(viewer));
    const note = [p.mixed_orientation_note ? 'Part of this page is printed sideways: use Rotate 90° to read it.' : null,
      p.display_note, DISPLAY_NOTE[p.display]].filter(Boolean)[0];
    if (note) body.append(h('div', { class: 'page-note' }, `supp p${p.page}: `, note,
      rot ? ` (shown turned ${rot}° so the text reads upright)` : ''));
    setupTools(p);
  }

  // ------------------------------------------------ annotations (pencil + highlighter)
  let gInk = null;
  const path = pts => 'M' + pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L');
  function drawInk() {
    clear(gInk);
    (marks[current] || []).forEach((st, i) => gInk.append(s('path', { d: path(st.pts), class: st.t === 'hl' ? 'ink-hl' : 'ink-pen', 'data-i': i })));
  }
  const drawTool = kind => ({
    down(p) { this.cur = [[p.x, p.y]]; this.el = s('path', { class: kind === 'hl' ? 'ink-hl' : 'ink-pen', d: path(this.cur) }); gInk.append(this.el); },
    move(p) { if (!this.cur) return; const l = this.cur[this.cur.length - 1]; if (Math.hypot(p.x - l[0], p.y - l[1]) * viewer.scale < 1.5) return; this.cur.push([p.x, p.y]); this.el.setAttribute('d', path(this.cur)); },
    up() {
      if (this.cur && this.cur.length > 1) { (marks[current] ||= []).push({ t: kind, pts: this.cur.map(q => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]) }); persist(); }
      this.cur = null; drawInk();
    },
  });
  const eraser = {
    down(p, e) { this.hit(e); }, move(p, e) { this.hit(e); }, up() {},
    hit(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.dataset?.i != null && (el.classList.contains('ink-pen') || el.classList.contains('ink-hl'))) {
        marks[current].splice(+el.dataset.i, 1); persist(); drawInk();
      }
    },
  };
  const tools = { pen: drawTool('pen'), hl: drawTool('hl'), eraser };

  // ------------------------------------------------ straightedge + crosshair
  function setupTools(p) {
    const ov = viewer.overlay;
    gInk = s('g', { class: 'ink-layer' });
    const g = s('g', { class: 'edge-layer' });
    ov.append(gInk, g);
    drawInk();
    const crossH = s('line', { class: 'cross', x1: 0, x2: p.width_px, y1: -10, y2: -10 });
    const crossV = s('line', { class: 'cross', y1: 0, y2: p.height_px, x1: -10, x2: -10 });
    g.append(crossH, crossV);
    const edge = state.edge || { a: { x: p.width_px * 0.25, y: p.height_px * 0.5 }, b: { x: p.width_px * 0.75, y: p.height_px * 0.5 } };
    const line = s('line', { class: 'edge' });
    const hA = s('circle', { class: 'edge-h', r: 18, 'data-grab': 'a' });
    const hB = s('circle', { class: 'edge-h', r: 18, 'data-grab': 'b' });
    const bodyLine = s('line', { class: 'edge-body', 'data-grab': 'body' });
    g.append(bodyLine, line, hA, hB);
    function drawEdge() {
      const on = state.tool === 'edge';
      for (const el of [line, hA, hB, bodyLine]) el.style.display = on ? '' : 'none';
      // extend the straightedge across the page so it can be read anywhere along the graph
      const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y, L = 1e4 / Math.max(1e-6, Math.hypot(dx, dy));
      line.setAttribute('x1', edge.a.x - dx * L); line.setAttribute('y1', edge.a.y - dy * L);
      line.setAttribute('x2', edge.b.x + dx * L); line.setAttribute('y2', edge.b.y + dy * L);
      bodyLine.setAttribute('x1', edge.a.x); bodyLine.setAttribute('y1', edge.a.y);
      bodyLine.setAttribute('x2', edge.b.x); bodyLine.setAttribute('y2', edge.b.y);
      hA.setAttribute('cx', edge.a.x); hA.setAttribute('cy', edge.a.y);
      hB.setAttribute('cx', edge.b.x); hB.setAttribute('cy', edge.b.y);
      state.edge = edge;
    }
    drawEdge();
    viewer.grabHandler = (target, p0) => {
      const which = target.dataset.grab;
      if (state.tool !== 'edge') return null;
      if (which === 'a' || which === 'b') return { move: q => { edge[which] = q; drawEdge(); } };
      if (which === 'body') {
        let last = p0;
        return { move: q => {
          const dx = q.x - last.x, dy = q.y - last.y; last = q;
          edge.a = { x: edge.a.x + dx, y: edge.a.y + dy }; edge.b = { x: edge.b.x + dx, y: edge.b.y + dy }; drawEdge();
        } };
      }
      return null;
    };
    viewer.hoverHandler = pt => {
      if (!state.cross) { crossH.style.display = crossV.style.display = 'none'; return; }
      crossH.style.display = crossV.style.display = '';
      crossH.setAttribute('y1', pt.y); crossH.setAttribute('y2', pt.y);
      crossV.setAttribute('x1', pt.x); crossV.setAttribute('x2', pt.x);
    };
    drawTools = drawEdge;
    applyTools();
  }
  let drawTools = () => {};
  function applyTools() {
    drawTools();
    viewer.root.dataset.tool = state.tool;
    if (tools[state.tool]) viewer.tool = tools[state.tool];
    // touch: a tap sets the crosshair (then the drag pans as usual)
    else viewer.tool = state.cross ? { down: p => { viewer.hoverHandler(p); return false; }, move() {}, up() {} } : null;
    if (!state.cross) viewer.hoverHandler({ x: -1, y: -1 });
  }

  function toolBtn(id, label, title) {
    const b = h('button', { class: 'tbtn', title, onclick: () => {
      if (id === 'cross') state.cross = !state.cross; else state.tool = state.tool === id ? 'pan' : id;
      refreshBar(); applyTools();
    } }, label);
    b.dataset.id = id;
    return b;
  }
  function refreshBar() {
    for (const b of bar.querySelectorAll('.tbtn[data-id]')) b.classList.toggle('on', b.dataset.id === 'cross' ? state.cross : state.tool === b.dataset.id);
  }
  // display rotation: the page's default (sideways scans turned upright) unless the viewer turned it themselves
  const rotKey = `supprot:${year}`;
  function rotationOf(p) {
    const mine = store.get(rotKey, {})[p.page];
    return mine != null ? mine : (p.display_rotation_deg || 0);
  }
  function setRotation(deg) {
    const all = { ...store.get(rotKey, {}) };
    const p = supp.pages.find(x => x.page === current);
    if (deg === (p.display_rotation_deg || 0)) delete all[current]; else all[current] = deg;
    store.set(rotKey, all);
    show(current);
  }
  bar.append(
    toolBtn('pen', '✎ Pencil', 'Draw on this page (two fingers pan on a touch screen)'),
    toolBtn('hl', '▮ Highlighter', 'Highlight text or a line on a chart'),
    toolBtn('eraser', 'Eraser', 'Drag over a pencil or highlighter mark to erase it'),
    h('button', { class: 'tbtn danger', title: 'Erase every mark on this page', onclick: () => {
      if ((marks[current] || []).length && confirm(`Clear all marks on page ${current}?`)) { marks[current] = []; persist(); drawInk(); }
    } }, 'Clear page'),
    h('span', { class: 'sep' }),
    toolBtn('edge', 'Straightedge', 'Show a draggable straightedge (drag the ends to angle it)'),
    toolBtn('cross', 'Crosshair', 'Horizontal and vertical lines that follow the pointer'),
    h('span', { class: 'sep' }),
    h('button', { class: 'tbtn', title: 'Turn this page 90° clockwise', onclick: () => {
      const p = supp.pages.find(x => x.page === current); setRotation((rotationOf(p) + 90) % 360);
    } }, '⟳ Rotate 90°'),
    h('button', { class: 'tbtn', title: 'Back to the default orientation for this page', onclick: () => {
      const p = supp.pages.find(x => x.page === current); setRotation(p.display_rotation_deg || 0);
    } }, 'Reset'));

  for (const p of supp.pages) {
    tabs.append(h('button', { class: 'page-tab', role: 'tab', 'data-page': p.page, title: p.display_note || '', onclick: () => show(p.page) },
      `p${p.page}`, p.display === 'image_only' ? h('span', { class: 'tag-img', title: 'image-only page' }, '▣') : null));
  }
  requestAnimationFrame(() => show(initialPage));
  return { root, show, get page() { return current; } };
}
