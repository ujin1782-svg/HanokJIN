// 2D 도면 보기: 원본 CAD 선 + 인식 결과(격자·기둥·외벽) 겹쳐 보기, 선택·기둥 추가·축척 보정.

import type { Bounds, CadDoc, Pillar, Sheet } from '../core/types';
import { CHEOK_MM } from '../core/params';
import { computeFootprint, nearestIndex, type Footprint } from '../model/footprint';
import { store } from '../app/store';
import { h, icon } from './dom';
import { sheetLabel } from '../cad/sheets';

interface Hit { kind: 'pillar'; pillar: Pillar }
interface EdgeHit { kind: 'edge'; x1: number; y1: number; x2: number; y2: number }

export interface DrawingCallbacks {
  addPillar: (x: number, y: number) => void;
  calibrate: (worldDist: number) => void;
}

export class DrawingView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private status: HTMLElement;
  private sheetSel: HTMLSelectElement;
  private layerPop: HTMLElement;
  private toolBtns: Record<string, HTMLButtonElement> = {};
  private s = 1; private tx = 0; private ty = 0;  // 화면 = (x*s + tx, -y*s + ty)
  private w = 0; private hgt = 0; private dpr = 1;
  private paths = new Map<string, { seg: Path2D; circ: Path2D }>();
  private pathsFor = '';
  private raf = 0;
  private hover: { x: number; y: number } | null = null;
  private hoverHit: Hit | EdgeHit | null = null;
  private calA: { x: number; y: number } | null = null;
  private fp: Footprint | null = null;
  private fitted = '';

  constructor(private cb: DrawingCallbacks) {
    this.canvas = h('canvas', { class: 'drawing-canvas', 'aria-label': '2D 도면. 휠로 확대, 끌어서 이동, 클릭으로 기둥 선택' });
    this.ctx = this.canvas.getContext('2d')!;
    this.status = h('div', { class: 'pane-status' });
    this.sheetSel = h('select', { class: 'select sm', 'aria-label': '도면 시트', onchange: () => { store.sheetId = this.sheetSel.value; this.fitted = ''; this.request(); store.emit('ui'); } });
    this.layerPop = h('div', { class: 'popover layer-pop', hidden: true });

    const tool = (id: 'select' | 'addPillar' | 'calibrate', ic: string, label: string, tip: string) => {
      const b = h('button', { class: 'btn icon', type: 'button', 'aria-label': label, 'data-tip': tip, onclick: () => { store.setUI({ tool: store.ui.tool === id && id !== 'select' ? 'select' : id }); this.calA = null; } }, icon(ic));
      this.toolBtns[id] = b;
      return b;
    };
    const toolbar = h('div', { class: 'pane-toolbar' },
      h('div', { class: 'pane-title' }, icon('plan', 16), h('span', null, '도면')),
      this.sheetSel,
      h('div', { class: 'tool-group' },
        tool('select', 'pointer', '선택', '선택·이동 (Esc)'),
        tool('addPillar', 'plus', '기둥 추가', '기둥 추가: 도면을 클릭하면 가까운 격자 교차점에 놓입니다'),
        tool('calibrate', 'ruler', '축척 보정', '축척 보정: 길이를 아는 두 점을 차례로 클릭'),
      ),
      h('button', { class: 'btn icon', type: 'button', 'aria-label': '화면 맞춤', 'data-tip': '화면 맞춤 (F)', onclick: () => this.fit() }, icon('fit')),
      h('div', { class: 'pop-anchor' },
        h('button', { class: 'btn icon', type: 'button', 'aria-label': '레이어', 'data-tip': '레이어·표시', onclick: (e: MouseEvent) => { e.stopPropagation(); this.toggleLayerPop(); } }, icon('layers')),
        this.layerPop),
    );
    this.el = h('section', { class: 'pane drawing-pane', 'aria-label': '도면 창' }, toolbar, h('div', { class: 'canvas-wrap' }, this.canvas), this.status);

    new ResizeObserver(() => this.resize()).observe(this.el);
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.hoverHit = null; this.request(); this.updateStatus(); });
    document.addEventListener('click', (e) => { if (!this.layerPop.contains(e.target as Node)) this.layerPop.hidden = true; });

    store.on('cad', () => { this.paths.clear(); this.pathsFor = ''; this.fitted = ''; this.refreshSheets(); this.request(); });
    store.on('project', () => { this.fp = null; this.request(); });
    store.on('selection', () => this.request());
    store.on('ui', () => { this.syncTools(); this.request(); });
    this.refreshSheets();
  }

  /* ───── 좌표 ───── */
  private toScreen(x: number, y: number): [number, number] { return [x * this.s + this.tx, -y * this.s + this.ty]; }
  private toWorld(sx: number, sy: number): [number, number] { return [(sx - this.tx) / this.s, -(sy - this.ty) / this.s]; }
  private get sheet(): Sheet | undefined { return store.sheets.find((s) => s.id === store.sheetId) ?? store.sheets[0]; }
  private get isPlan() { const p = store.project; return !!p && !!this.sheet && (p.source.sheetId ? p.source.sheetId === this.sheet.id : this.sheet.kind === 'PLAN'); }
  private origin() { return store.project?.origin ?? { x: 0, y: 0 }; }
  private footprint() { if (!this.fp && store.project) this.fp = computeFootprint(store.project); return this.fp; }

  fit() {
    const b = this.sheet?.bounds ?? store.cad?.extents;
    // 창이 숨겨져 크기가 없을 때 맞추면 배율이 음수가 된다. 보일 때 다시 맞춘다.
    if (!b || this.w < 80 || this.hgt < 80) { this.fitted = ''; return; }
    const bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY);
    this.s = Math.min((this.w - 40) / bw, (this.hgt - 40) / bh);
    this.tx = this.w / 2 - ((b.minX + b.maxX) / 2) * this.s;
    this.ty = this.hgt / 2 + ((b.minY + b.maxY) / 2) * this.s;
    this.fitted = this.sheet?.id ?? 'doc';
    this.updateStatus();
    this.request();
  }

  /** 프로젝트 좌표(mm)를 화면 가운데로 */
  focus(x: number, y: number) {
    const p = store.project;
    if (!p) return;
    const plan = store.sheets.find((s) => s.id === p.source.sheetId);
    if (plan && store.sheetId !== plan.id) { store.sheetId = plan.id; this.refreshSheets(); }
    const o = this.origin();
    this.s = Math.max(this.s, Math.min(this.w, this.hgt) / 9000);
    this.tx = this.w / 2 - (x + o.x) * this.s;
    this.ty = this.hgt / 2 + (y + o.y) * this.s;
    this.request();
  }

  private resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const prevW = this.w, prevH = this.hgt;
    this.w = Math.max(1, r.width); this.hgt = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.hgt * this.dpr);
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.hgt}px`;
    if (!this.fitted || prevW < 80 || prevH < 80) this.fit();
    else { this.tx += (this.w - prevW) / 2; this.ty += (this.hgt - prevH) / 2; }
    this.request();
  }

  refreshSheets() {
    this.sheetSel.replaceChildren(...store.sheets.map((s) => h('option', { value: s.id, selected: s.id === store.sheetId }, sheetLabel(s))));
    this.sheetSel.disabled = store.sheets.length < 2;
    this.sheetSel.hidden = !store.sheets.length;
  }

  private syncTools() {
    for (const [id, b] of Object.entries(this.toolBtns)) b.classList.toggle('active', store.ui.tool === id);
    this.canvas.style.cursor = store.ui.tool === 'select' ? 'default' : 'crosshair';
    if (store.sheetId !== this.sheetSel.value) this.refreshSheets();
    this.updateStatus();
  }

  private toggleLayerPop() {
    const pop = this.layerPop;
    pop.hidden = !pop.hidden;
    if (pop.hidden) return;
    const doc = store.cad;
    const ov = store.ui.overlay;
    const chk = (label: string, on: boolean, fn: (v: boolean) => void, swatch?: string) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => fn((e.target as HTMLInputElement).checked) }),
        swatch ? h('span', { class: 'swatch', style: `background:${swatch}` }) : null, h('span', null, label));
    pop.replaceChildren(
      h('div', { class: 'pop-title' }, '인식 결과 표시'),
      chk('격자(주열)', ov.grid, (v) => store.setUI({ overlay: { ...ov, grid: v } }), 'var(--grid)'),
      chk('기둥 표식', ov.pillars, (v) => store.setUI({ overlay: { ...ov, pillars: v } }), 'var(--ok)'),
      chk('외벽·창호', ov.walls, (v) => store.setUI({ overlay: { ...ov, walls: v } }), 'var(--window)'),
      h('div', { class: 'pop-title' }, 'CAD 레이어'),
      chk('레이어 색으로 보기', store.ui.layerColors, (v) => store.setUI({ layerColors: v })),
      h('div', { class: 'layer-list' }, ...(doc?.layers ?? []).map((l) =>
        chk(`${l.name} (${l.count.toLocaleString()})`, !store.ui.hiddenLayers.has(l.name), (v) => {
          const s = new Set(store.ui.hiddenLayers); if (v) s.delete(l.name); else s.add(l.name); store.setUI({ hiddenLayers: s });
        }, `#${l.color.toString(16).padStart(6, '0')}`))),
    );
  }

  /* ───── 입력 ───── */
  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.min(50, Math.max(1e-4, this.s * k));
    const f = ns / this.s;
    this.tx = mx - (mx - this.tx) * f; this.ty = my - (my - this.ty) * f; this.s = ns;
    this.request(); this.updateStatus();
  }

  private onDown(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    const tx0 = this.tx, ty0 = this.ty;
    let moved = false;
    this.canvas.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) moved = true;
      if (moved) { this.tx = tx0 + ev.clientX - x0; this.ty = ty0 + ev.clientY - y0; this.request(); }
    };
    const up = (ev: PointerEvent) => {
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      if (!moved && ev.button === 0) this.onClick(ev.clientX - r.left, ev.clientY - r.top);
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
  }

  private onMove(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [wx, wy] = this.toWorld(sx, sy);
    this.hover = { x: wx, y: wy };
    this.hoverHit = store.ui.tool === 'select' ? this.hitTest(sx, sy) : null;
    this.canvas.style.cursor = store.ui.tool !== 'select' ? 'crosshair' : this.hoverHit ? 'pointer' : 'default';
    this.updateStatus();
    this.request();
  }

  private hitTest(sx: number, sy: number): Hit | EdgeHit | null {
    const p = store.project;
    if (!p || !this.isPlan) return null;
    const o = this.origin();
    if (store.ui.overlay.pillars) {
      let best: Pillar | null = null, bd = Infinity;
      for (const pl of p.pillars) {
        const [px, py] = this.toScreen(pl.x + o.x, pl.y + o.y);
        const d = Math.hypot(px - sx, py - sy);
        const r = Math.max(10, (pl.size / 2) * this.s + 4);
        if (d < r && d < bd) { bd = d; best = pl; }
      }
      if (best) return { kind: 'pillar', pillar: best };
    }
    if (store.ui.overlay.walls) {
      const fp = this.footprint();
      for (const e of fp?.edges ?? []) {
        const [ax, ay] = this.toScreen(e.x1 + o.x, e.y1 + o.y), [bx, by] = this.toScreen(e.x2 + o.x, e.y2 + o.y);
        if (distToSeg(sx, sy, ax, ay, bx, by) < 7) return { kind: 'edge', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 };
      }
    }
    return null;
  }

  private snap(wx: number, wy: number): [number, number] {
    const p = store.project!;
    const o = this.origin();
    const x = wx - o.x, y = wy - o.y;
    const { xs, ys } = p.grid;
    if (!xs.length || !ys.length) return [Math.round(x), Math.round(y)];
    const i = nearestIndex(xs, x), j = nearestIndex(ys, y);
    const tol = 25 / this.s;
    return [Math.abs(xs[i] - x) < tol ? xs[i] : Math.round(x / 10) * 10, Math.abs(ys[j] - y) < tol ? ys[j] : Math.round(y / 10) * 10];
  }

  private onClick(sx: number, sy: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    if (store.ui.tool === 'addPillar') {
      if (!store.project) return;
      if (!this.isPlan) { this.status.textContent = '기둥은 평면도 시트에서만 추가할 수 있습니다.'; return; }
      const [x, y] = this.snap(wx, wy);
      this.cb.addPillar(x, y);
      return;
    }
    if (store.ui.tool === 'calibrate') {
      if (!this.calA) { this.calA = { x: wx, y: wy }; this.updateStatus(); return; }
      const d = Math.hypot(wx - this.calA.x, wy - this.calA.y);
      this.calA = null;
      store.setUI({ tool: 'select' });
      if (d > 0) this.cb.calibrate(d);
      return;
    }
    const hit = this.hitTest(sx, sy);
    if (hit?.kind === 'pillar') store.select({ kind: 'pillar', id: hit.pillar.id });
    else if (hit?.kind === 'edge') store.select({ kind: 'edge', x1: hit.x1, y1: hit.y1, x2: hit.x2, y2: hit.y2 });
    else store.select(null);
  }

  private updateStatus() {
    const parts: string[] = [];
    const t = store.ui.tool;
    if (t === 'addPillar') parts.push('기둥 추가: 놓을 곳을 클릭하세요 (Esc로 종료)');
    else if (t === 'calibrate') parts.push(this.calA ? '두 번째 점을 클릭하세요' : '길이를 아는 첫 번째 점을 클릭하세요');
    if (this.hover) {
      const o = this.isPlan ? this.origin() : { x: 0, y: 0 };
      const x = this.hover.x - o.x, y = this.hover.y - o.y;
      parts.push(this.isPlan ? `X1·Y1 기준 ${fmt(x)}, ${fmt(y)} mm (${(x / CHEOK_MM).toFixed(1)}척, ${(y / CHEOK_MM).toFixed(1)}척)` : `${fmt(x)}, ${fmt(y)}`);
    }
    if (this.hoverHit?.kind === 'pillar') parts.push(`기둥 ${this.hoverHit.pillar.id}`);
    // 화면 1mm ≈ 3.78px(96dpi). s는 도면 mm당 화면 px.
    parts.push(`화면 축척 약 1:${Math.max(1, Math.round(3.78 / this.s)).toLocaleString('ko-KR')}`);
    this.status.textContent = parts.join('  ·  ');
  }

  /* ───── 그리기 ───── */
  request() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }

  private buildPaths(doc: CadDoc, b: Bounds) {
    const key = `${this.sheet?.id}`;
    if (this.pathsFor === key) return;
    this.paths.clear();
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.02;
    const inb = (x: number, y: number) => x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad;
    for (const [layer, arr] of Object.entries(doc.segs)) {
      const seg = new Path2D();
      let n = 0;
      for (let i = 0; i < arr.length; i += 4) {
        if (!inb((arr[i] + arr[i + 2]) / 2, (arr[i + 1] + arr[i + 3]) / 2)) continue;
        seg.moveTo(arr[i], arr[i + 1]); seg.lineTo(arr[i + 2], arr[i + 3]); n++;
      }
      this.paths.set(layer, { seg, circ: new Path2D() });
      if (!n) this.paths.delete(layer);
    }
    for (const c of doc.circles) {
      if (!inb(c.x, c.y)) continue;
      let e = this.paths.get(c.layer);
      if (!e) { e = { seg: new Path2D(), circ: new Path2D() }; this.paths.set(c.layer, e); }
      e.circ.moveTo(c.x + c.r, c.y); e.circ.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    }
    this.pathsFor = key;
  }

  private draw() {
    const ctx = this.ctx, dpr = this.dpr;
    const css = getComputedStyle(this.el);
    const v = (n: string) => css.getPropertyValue(n).trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = v('--paper');
    ctx.fillRect(0, 0, this.w, this.hgt);
    const doc = store.cad, sheet = this.sheet;
    if (!doc || !sheet) {
      ctx.fillStyle = v('--muted'); ctx.font = '14px var(--font)'; ctx.textAlign = 'center';
      ctx.fillText('표시할 도면이 없습니다', this.w / 2, this.hgt / 2);
      return;
    }
    if (this.fitted !== sheet.id) { this.fit(); if (this.fitted !== sheet.id) return; }
    this.buildPaths(doc, sheet.bounds);

    const ink = v('--ink');
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    ctx.save();
    ctx.setTransform(this.s * dpr, 0, 0, -this.s * dpr, this.tx * dpr, this.ty * dpr);
    ctx.lineWidth = 1 / this.s;
    const overlayOn = this.isPlan && !!store.project;
    for (const l of doc.layers) {
      const e = this.paths.get(l.name);
      if (!e || store.ui.hiddenLayers.has(l.name)) continue;
      ctx.strokeStyle = store.ui.layerColors ? adapt(l.color, dark) : ink;
      ctx.globalAlpha = store.ui.layerColors ? 0.95 : overlayOn ? 0.55 : 0.8;
      ctx.stroke(e.seg); ctx.stroke(e.circ);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // 글자
    const b = sheet.bounds;
    ctx.fillStyle = ink;
    for (const t of doc.texts) {
      if (t.x < b.minX || t.x > b.maxX || t.y < b.minY || t.y > b.maxY || store.ui.hiddenLayers.has(t.layer)) continue;
      const px = t.h * this.s;
      if (px < 4.5) continue;
      const [sx, sy] = this.toScreen(t.x, t.y);
      if (sx < -400 || sx > this.w + 400 || sy < -50 || sy > this.hgt + 50) continue;
      ctx.save();
      ctx.translate(sx, sy); ctx.rotate(-t.rot);
      ctx.font = `${Math.min(px, 200)}px "Noto Sans KR", sans-serif`;
      ctx.textAlign = t.align; ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = overlayOn ? 0.75 : 0.9;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (overlayOn) this.drawOverlay(v);
    if (store.ui.tool === 'calibrate' && this.calA && this.hover) {
      const [ax, ay] = this.toScreen(this.calA.x, this.calA.y), [bx, by] = this.toScreen(this.hover.x, this.hover.y);
      ctx.strokeStyle = v('--accent'); ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = v('--accent'); ctx.font = '600 12px var(--font)';
      ctx.fillText(`${fmt(Math.hypot(this.hover.x - this.calA.x, this.hover.y - this.calA.y))} (도면 단위)`, (ax + bx) / 2 + 8, (ay + by) / 2 - 8);
    }
  }

  private drawOverlay(v: (n: string) => string) {
    const p = store.project!, ctx = this.ctx, o = this.origin();
    const S = (x: number, y: number) => this.toScreen(x + o.x, y + o.y);
    const { xs, ys, labelsX, labelsY } = p.grid;
    const sel = store.selection;
    if (store.ui.overlay.grid && xs.length && ys.length) {
      const x0 = Math.min(...xs) - 1500, x1 = Math.max(...xs) + 1500, y0 = Math.min(...ys) - 1500, y1 = Math.max(...ys) + 1500;
      ctx.strokeStyle = v('--grid'); ctx.lineWidth = 1; ctx.setLineDash([8, 5]); ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (const x of xs) { const [a, b] = S(x, y0), [c, d] = S(x, y1); ctx.moveTo(a, b); ctx.lineTo(c, d); }
      for (const y of ys) { const [a, b] = S(x0, y), [c, d] = S(x1, y); ctx.moveTo(a, b); ctx.lineTo(c, d); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      const bubble = (sx: number, sy: number, label: string) => {
        ctx.fillStyle = v('--paper'); ctx.strokeStyle = v('--grid'); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = v('--grid'); ctx.font = '700 10px var(--font)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, sx, sy + 0.5);
      };
      xs.forEach((x, k) => { const [a, b] = S(x, y1); bubble(a, b - 12, labelsX[k] ?? `X${k + 1}`); });
      ys.forEach((y, k) => { const [a, b] = S(x0, y); bubble(a - 12, b, labelsY[k] ?? `Y${k + 1}`); });
      // 칸 치수
      ctx.fillStyle = v('--grid'); ctx.font = '500 10px var(--font)'; ctx.textBaseline = 'bottom';
      for (let k = 0; k < xs.length - 1; k++) {
        const [a, b] = S((xs[k] + xs[k + 1]) / 2, y1);
        if ((xs[k + 1] - xs[k]) * this.s > 60) ctx.fillText(`${(xs[k + 1] - xs[k]).toLocaleString()} (${((xs[k + 1] - xs[k]) / CHEOK_MM).toFixed(1)}척)`, a, b - 28);
      }
      ctx.textBaseline = 'alphabetic';
    }
    if (store.ui.overlay.walls) {
      const fp = this.footprint()!;
      for (const e of fp.edges) {
        const op = p.openings.find((q) => Math.abs(q.x1 - e.x1) + Math.abs(q.y1 - e.y1) + Math.abs(q.x2 - e.x2) + Math.abs(q.y2 - e.y2) < 2);
        const [a, b] = S(e.x1, e.y1), [c, d] = S(e.x2, e.y2);
        const isSel = sel?.kind === 'edge' && sel.x1 === e.x1 && sel.y1 === e.y1 && sel.x2 === e.x2 && sel.y2 === e.y2;
        const isHover = this.hoverHit?.kind === 'edge' && this.hoverHit.x1 === e.x1 && this.hoverHit.y1 === e.y1 && this.hoverHit.x2 === e.x2 && this.hoverHit.y2 === e.y2;
        ctx.lineCap = 'round';
        if (isSel || isHover) { ctx.strokeStyle = v('--accent'); ctx.lineWidth = isSel ? 9 : 7; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
        ctx.globalAlpha = op ? 0.95 : 0.35;
        ctx.strokeStyle = op ? (op.kind === 'door' ? v('--door') : v('--window')) : v('--muted');
        ctx.lineWidth = op ? 4 : 3;
        ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    }
    if (store.ui.overlay.pillars) {
      const fp = this.footprint()!;
      const used = new Set([...fp.at.values()].map((q) => q.id));
      for (const pl of p.pillars) {
        const [sx, sy] = S(pl.x, pl.y);
        const r = Math.max(5, (pl.size / 2) * this.s);
        const color = pl.review ? v('--warn') : pl.source === 'user' ? v('--user') : v('--ok');
        const isSel = sel?.kind === 'pillar' && sel.id === pl.id;
        const isHover = this.hoverHit?.kind === 'pillar' && this.hoverHit.pillar.id === pl.id;
        if (isSel || isHover) {
          ctx.strokeStyle = v('--accent'); ctx.lineWidth = isSel ? 3 : 2;
          ctx.beginPath(); ctx.arc(sx, sy, r + 6, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = color; ctx.strokeStyle = v('--paper'); ctx.lineWidth = 1.5;
        ctx.globalAlpha = used.has(pl.id) ? 0.9 : 0.45;
        ctx.beginPath();
        if (pl.shape === 'round') ctx.arc(sx, sy, r, 0, Math.PI * 2); else ctx.rect(sx - r, sy - r, r * 2, r * 2);
        ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 1;
        if (pl.review) {
          ctx.fillStyle = v('--warn'); ctx.beginPath(); ctx.arc(sx + r + 2, sy - r - 2, 7, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = '800 10px var(--font)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('!', sx + r + 2, sy - r - 1.5); ctx.textBaseline = 'alphabetic';
        }
      }
    }
    if (store.ui.tool === 'addPillar' && this.hover) {
      const [x, y] = this.snap(this.hover.x, this.hover.y);
      const [sx, sy] = S(x, y);
      ctx.strokeStyle = v('--user'); ctx.setLineDash([4, 3]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, (p.params.baseD / 2) * this.s), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const fmt = (v: number) => Math.round(v).toLocaleString('ko-KR');

/** 배경에 맞춰 레이어 색 명도 조정 */
function adapt(rgb: number, dark: boolean) {
  let r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (!dark && lum > 0.62) { const k = 0.62 / lum; r *= k * 0.75; g *= k * 0.75; b *= k * 0.75; }
  if (dark && lum < 0.35) { r = r + (255 - r) * 0.5; g = g + (255 - g) * 0.5; b = b + (255 - b) * 0.5; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
