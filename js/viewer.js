// Pan/zoom viewer for tiled images (supplement pages and sectional charts).
// Everything inside the stage is in SOURCE PIXEL coordinates; the view transform (pan, zoom, display
// rotation) is applied to the stage only. Overlays drawn into `this.overlay` (an SVG with viewBox = source
// pixels) therefore stay in source coordinates, as the spec requires for the plotter maths.
import { h, s, loadImage } from './util.js';

export class TileViewer {
  constructor({ width, height, tiles, tileSize = 1024, rotation = 0, minZoom = null }) {
    this.W = width; this.H = height; this.tiles = tiles; this.tileSize = tileSize; this.rot = rotation;
    this.root = h('div', { class: 'viewer', tabindex: '0' });
    this.stage = h('div', { class: 'stage', style: { width: width + 'px', height: height + 'px' } });
    this.imgs = tiles.map(t => {
      const img = h('img', { class: 'tile', alt: '', draggable: 'false',
        style: { left: t.x + 'px', top: t.y + 'px', width: tileSize + 'px', height: tileSize + 'px' } });
      img.dataset.src = t.file;
      this.stage.append(img);
      return img;
    });
    this.overlay = s('svg', { class: 'overlay', width: width, height: height, viewBox: `0 0 ${width} ${height}` });
    this.stage.append(this.overlay);
    this.root.append(this.stage);
    this.tx = 0; this.ty = 0; this.scale = 1; this.minZoom = minZoom;
    this.pointers = new Map();
    this.tool = null;          // {down(p,e), move(p,e), up(p,e), cursor}
    this.listeners = [];
    this._bind();
    this.ro = new ResizeObserver(() => { if (!this._fitted) this.fit(); else this._apply(); });
    this.ro.observe(this.root);
  }

  destroy() { this.ro.disconnect(); }

  matrix() { return new DOMMatrix().translate(this.tx, this.ty).rotate(this.rot).scale(this.scale); }
  toSource(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    const p = this.matrix().inverse().transformPoint(new DOMPoint(clientX - r.left, clientY - r.top));
    return { x: p.x, y: p.y };
  }
  toScreen(x, y) { const p = this.matrix().transformPoint(new DOMPoint(x, y)); return { x: p.x, y: p.y }; }

  fit() {
    const r = this.root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const rad = this.rot * Math.PI / 180, c = Math.abs(Math.cos(rad)), sn = Math.abs(Math.sin(rad));
    const bw = this.W * c + this.H * sn, bh = this.W * sn + this.H * c;
    this.scale = Math.min(r.width / bw, r.height / bh) * 0.98;
    this.minZoomEff = this.minZoom ?? this.scale * 0.5;
    // centre the image
    const ctr = new DOMMatrix().rotate(this.rot).scale(this.scale).transformPoint(new DOMPoint(this.W / 2, this.H / 2));
    this.tx = r.width / 2 - ctr.x; this.ty = r.height / 2 - ctr.y;
    this._fitted = true;
    this._apply();
  }

  zoomAt(k, sx, sy) {
    const ns = Math.min(4, Math.max(this.minZoomEff || 0.02, this.scale * k));
    k = ns / this.scale;
    this.tx = sx + k * (this.tx - sx); this.ty = sy + k * (this.ty - sy); this.scale = ns;
    this._apply();
  }
  zoomCenter(k) { const r = this.root.getBoundingClientRect(); this.zoomAt(k, r.width / 2, r.height / 2); }

  centerOn(x, y, scale) {
    const r = this.root.getBoundingClientRect();
    if (scale) this.scale = scale;
    const p = new DOMMatrix().rotate(this.rot).scale(this.scale).transformPoint(new DOMPoint(x, y));
    this.tx = r.width / 2 - p.x; this.ty = r.height / 2 - p.y;
    this._apply();
  }

  onChange(fn) { this.listeners.push(fn); }

  _apply() {
    this.stage.style.transform = this.matrix().toString();
    this._cull();
    for (const fn of this.listeners) fn(this);
  }

  // load only tiles that intersect the viewport (plus a margin)
  _cull() {
    const r = this.root.getBoundingClientRect();
    if (!r.width) return;
    const inv = this.matrix().inverse();
    const pts = [[0, 0], [r.width, 0], [0, r.height], [r.width, r.height]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
    const m = this.tileSize * 0.5;
    const x0 = Math.min(...pts.map(p => p.x)) - m, x1 = Math.max(...pts.map(p => p.x)) + m;
    const y0 = Math.min(...pts.map(p => p.y)) - m, y1 = Math.max(...pts.map(p => p.y)) + m;
    this.tiles.forEach((t, i) => {
      const vis = t.x < x1 && t.x + this.tileSize > x0 && t.y < y1 && t.y + this.tileSize > y0;
      const img = this.imgs[i];
      if (vis && !img.src && !img.dataset.loading) {
        img.dataset.loading = '1';
        loadImage(img.dataset.src).then(u => { img.src = u; }).catch(e => { console.warn(e); delete img.dataset.loading; });
      }
    });
  }

  _bind() {
    const el = this.root;
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      this.zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        const p = this.toSource(e.clientX, e.clientY);
        const target = e.target.closest?.('[data-grab]');
        this.active = target ? 'grab' : (this.tool ? 'tool' : 'pan');
        if (this.active === 'grab') this.grab = this.grabHandler?.(target, p, e);
        if (this.active === 'grab' && !this.grab) this.active = this.tool ? 'tool' : 'pan';
        if (this.active === 'tool' && this.tool.down(p, e) === false) this.active = 'pan';
      } else { this.active = 'pinch'; this._pinch = null; }
    });
    el.addEventListener('pointermove', e => {
      const prev = this.pointers.get(e.pointerId);
      const p = this.toSource(e.clientX, e.clientY);
      this.hoverHandler?.(p, e);
      if (!prev) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.active === 'pan') { this.tx += e.clientX - prev.x; this.ty += e.clientY - prev.y; this._apply(); }
      else if (this.active === 'tool') this.tool.move(p, e);
      else if (this.active === 'grab') this.grab.move(p, e);
      else if (this.active === 'pinch' && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), r = el.getBoundingClientRect();
        const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
        if (this._pinch) {
          this.tx += cx - this._pinch.cx; this.ty += cy - this._pinch.cy;
          this.zoomAt(d / this._pinch.d, cx, cy);
        }
        this._pinch = { d, cx, cy };
      }
    });
    const end = e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const p = this.toSource(e.clientX, e.clientY);
      if (this.active === 'tool') this.tool.up?.(p, e);
      if (this.active === 'grab') this.grab.up?.(p, e);
      if (this.pointers.size === 0) this.active = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', e => {
      const step = 60;
      if (e.key === '+' || e.key === '=') this.zoomCenter(1.25);
      else if (e.key === '-') this.zoomCenter(0.8);
      else if (e.key === 'ArrowLeft') { this.tx += step; this._apply(); }
      else if (e.key === 'ArrowRight') { this.tx -= step; this._apply(); }
      else if (e.key === 'ArrowUp') { this.ty += step; this._apply(); }
      else if (e.key === 'ArrowDown') { this.ty -= step; this._apply(); }
      else if (e.key === '0') this.fit();
      else return;
      e.preventDefault();
    });
  }
}

export function zoomControls(v) {
  return h('div', { class: 'zoom-ctl' },
    h('button', { title: 'Zoom in (+)', onclick: () => v.zoomCenter(1.4) }, '+'),
    h('button', { title: 'Zoom out (−)', onclick: () => v.zoomCenter(1 / 1.4) }, '−'),
    h('button', { title: 'Fit (0)', onclick: () => v.fit() }, 'Fit'),
    h('button', { title: 'Actual size (1 image pixel = 1 screen pixel)', onclick: () => {
      const r = v.root.getBoundingClientRect(); v.zoomAt(1 / v.scale, r.width / 2, r.height / 2);
    } }, '1:1'));
}
