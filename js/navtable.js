// Nav Table: tiled sectional + pencil line tool + eraser.
// Pencil (user request 2026-11-08, replaces the separate plotter and measure assist): click a first dot, click a
// second dot, and the tool draws the line and labels it with the true course and distance from the chart
// calibration, rounded per chart.json.measure_assist and labelled "computed by app, not official".
// All geometry is in source pixel coordinates; display rotation (2011) rotates the view only.
import { h, s, clear, api, store } from './util.js';
import { TileViewer, zoomControls } from './viewer.js';
import { ChartGeo } from './geo.js';

const SM_PER_NM = 1 / 0.868976;
const APP_LABEL = 'computed by app, not official';

export async function navTable(year, { attemptKey = null } = {}) {
  const chart = await api.year(year, 'chart');
  const disp = chart.display || {};
  const root = h('div', { class: 'navtable' });
  if (disp.nav_table_enabled === false || disp.chart_matches_flight === false) {
    root.append(h('div', { class: 'disabled-panel' },
      h('h3', {}, 'Nav Table unavailable for ', String(year)),
      h('p', {}, 'Chart does not match the flight. The pencil and Nav Table are turned off for this year.'),
      disp.note ? h('p', { class: 'muted' }, disp.note) : ''));
    return { root, destroy() {} };
  }
  const geo = new ChartGeo(chart);
  const viewer = new TileViewer({ width: chart.width_px, height: chart.height_px, tiles: chart.tiles,
    tileSize: chart.tile_size, rotation: disp.rotation_deg || 0 });
  const bar = h('div', { class: 'tool-bar' });
  const labels = h('div', { class: 'line-labels' });
  const hint = h('div', { class: 'readout', hidden: true });
  root.append(bar, h('div', { class: 'nav-body' }, viewer.root, labels, zoomControls(viewer), hint));
  if (disp.rotation_deg) root.append(h('div', { class: 'page-note' }, `Shown rotated ${disp.rotation_deg}° for display only. `, disp.rotation_note || ''));

  const gLines = s('g', { class: 'lines' });
  const gLive = s('g', { class: 'live' });
  viewer.overlay.append(gLines, gLive);

  const saveKey = attemptKey ? `lines:${attemptKey}` : null;
  const state = { tool: 'pan', lines: (saveKey && store.get(saveKey, null)) || [], pending: null, live: null };
  const persist = () => { if (saveKey) store.set(saveKey, state.lines); };

  const ma = chart.measure_assist || { distance_round_nm: 1, course_round_deg: 1 };
  function measure(a, b) {
    const d = geo.distNM(a, b), tc = geo.trueCourse(a, b);
    const nm = Math.round(d / ma.distance_round_nm) * ma.distance_round_nm;
    const deg = (Math.round(tc / ma.course_round_deg) * ma.course_round_deg) % 360;
    return { nm, sm: Math.round(d * SM_PER_NM), deg: String(deg).padStart(3, '0') };
  }
  const labelText = m => `${m.deg}° T · ${m.nm} NM`;

  // ---------------------------------------------------------------- drawing
  function drawLines() {
    clear(gLines); clear(labels);
    state.lines.forEach((ln, i) => {
      const [a, b] = ln;
      gLines.append(
        s('line', { class: 'pline', x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'data-i': i }),
        s('line', { class: 'pline-hit', x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'data-i': i }),
        s('circle', { class: 'pdot', cx: a.x, cy: a.y, r: 7, 'data-i': i }),
        s('circle', { class: 'pdot', cx: b.x, cy: b.y, r: 7, 'data-i': i }));
      const m = measure(a, b);
      labels.append(h('div', { class: 'line-label', 'data-i': i, title: `${m.sm} SM · ${APP_LABEL}` }, labelText(m)));
    });
    placeLabels();
  }
  function placeLabels() {
    state.lines.forEach((ln, i) => {
      const el = labels.children[i];
      if (!el) return;
      const p = viewer.toScreen((ln[0].x + ln[1].x) / 2, (ln[0].y + ln[1].y) / 2);
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -130%)`;
    });
  }
  viewer.onChange(placeLabels);

  function drawLive() {
    clear(gLive);
    const a = state.pending;
    if (!a) {
      hint.hidden = state.tool !== 'pencil';
      if (!hint.hidden) clear(hint).append(h('div', {}, 'Click the first dot.'), h('div', { class: 'app-label' }, APP_LABEL));
      return;
    }
    gLive.append(s('circle', { class: 'pdot', cx: a.x, cy: a.y, r: 7 }));
    const b = state.live;
    hint.hidden = false;
    if (b) {
      gLive.append(s('line', { class: 'pline live', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
      const m = measure(a, b);
      clear(hint).append(h('div', {}, h('b', {}, labelText(m)), ` · ${m.sm} SM`), h('div', { class: 'app-label' }, APP_LABEL),
        h('div', { class: 'muted small' }, 'Click the second dot (Esc cancels).'));
    } else clear(hint).append(h('div', {}, 'Click the second dot (Esc cancels).'), h('div', { class: 'app-label' }, APP_LABEL));
  }

  // ---------------------------------------------------------------- tools
  // Pencil: a click places a dot, a drag pans the chart.
  const pencil = {
    down(p, e) { this.start = p; this.last = { x: e.clientX, y: e.clientY }; this.moved = 0; },
    move(p, e) {
      if (!this.last) return;
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.moved += Math.hypot(dx, dy);
      if (this.moved > 6) { viewer.tx += dx; viewer.ty += dy; viewer._apply(); }
      this.last = { x: e.clientX, y: e.clientY };
    },
    up(p) {
      const click = this.start && this.moved <= 6;
      const at = this.start;
      this.start = this.last = null;
      if (!click) return;
      if (!state.pending) state.pending = at;
      else {
        const a = state.pending;
        if (Math.hypot(at.x - a.x, at.y - a.y) * viewer.scale > 4) { state.lines.push([a, at]); persist(); }
        state.pending = null; state.live = null; drawLines();
      }
      drawLive();
    },
  };
  const eraser = {
    down(p, e) { this.hit(e); }, move(p, e) { this.hit(e); }, up() {},
    hit(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const i = el?.dataset?.i;
      if (i != null && ['pline-hit', 'pline', 'pdot'].some(c => el.classList.contains(c))) {
        state.lines.splice(+i, 1); persist(); drawLines();
      }
    },
  };
  viewer.hoverHandler = p => { if (state.tool === 'pencil' && state.pending) { state.live = p; drawLive(); } };

  const toolObj = { pan: null, pencil, eraser };
  function setTool(t) {
    state.tool = t; viewer.tool = toolObj[t] || null;
    viewer.root.dataset.tool = t;
    for (const b of bar.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    if (t !== 'pencil') { state.pending = null; state.live = null; }
    drawLive();
  }
  const tools = [
    ['pan', 'Move', 'Pan and zoom the chart'],
    ['pencil', '✎ Pencil', `Click two dots: draws the line and shows true course and distance (${APP_LABEL})`],
    ['eraser', 'Eraser', 'Click a line to erase it'],
  ];
  for (const [id, label, title] of tools) bar.append(h('button', { class: 'tbtn', 'data-tool': id, title, onclick: () => setTool(id) }, label));
  bar.append(h('span', { class: 'sep' }),
    h('button', { class: 'tbtn danger', title: 'Erase every line', onclick: () => {
      if (state.lines.length && confirm('Clear all pencil lines?')) { state.lines = []; persist(); drawLines(); }
    } }, 'Clear all'),
    h('span', { class: 'bar-label' }, `Course and distance are ${APP_LABEL}`));
  const onKey = e => { if (e.key === 'Escape' && state.pending) { state.pending = null; state.live = null; drawLive(); } };
  document.addEventListener('keydown', onKey);

  drawLines(); setTool('pan');
  return { root, viewer, destroy() { viewer.destroy(); document.removeEventListener('keydown', onKey); } };
}
