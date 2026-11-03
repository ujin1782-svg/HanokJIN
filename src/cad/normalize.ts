// 원시 엔티티(RawDrawing) → 화면 표시·인식에 쓰는 정규화 문서(CadDoc).
// 블록(INSERT)은 변환 행렬을 적용해 펼치고, 곡선은 선분으로 근사한다.

import type { CadDoc, CadText, CadCircle, CadPoly, CadDim, CadLayer, Bounds } from '../core/types';
import type { RawDrawing, RawEntity, P } from './raw';
import { aciToRgb } from './aci';

const MAX_SEGMENTS = 3_000_000;
const MAX_DEPTH = 8;

/** 행렬 [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f */
type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];

function mul(m: M, n: M): M {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const UNIT_SCALE: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };

export function cleanMText(s: string): string {
  return s
    .replace(/\\P/g, '\n')
    .replace(/\\[ACcFfHhQqTtWw][^;\\]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*);/g, (_m, g: string) => g.replace(/[#^]/g, '/'))
    .replace(/\\~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\');
}

export function cleanText(s: string): string {
  return s
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export interface NormalizeProgress { (msg: string): void }

export function normalize(raw: RawDrawing, fileName: string): CadDoc {
  const unitScale = UNIT_SCALE[raw.insUnits] ?? 1;
  const layerInfo = new Map(raw.layers.map((l) => [l.name, l]));
  const hiddenLayers = new Set(raw.layers.filter((l) => l.off || l.frozen).map((l) => l.name));

  const segLists = new Map<string, number[]>();
  const circles: CadCircle[] = [];
  const polys: CadPoly[] = [];
  const texts: CadText[] = [];
  const dims: CadDim[] = [];
  const byType: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const layerCount = new Map<string, number>();
  let segTotal = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const grow = (x: number, y: number) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  const skip = (t: string) => { skipped[t] = (skipped[t] ?? 0) + 1; };

  const pushSeg = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    if (!Number.isFinite(x1 + y1 + x2 + y2)) return;
    let arr = segLists.get(layer);
    if (!arr) { arr = []; segLists.set(layer, arr); }
    arr.push(x1, y1, x2, y2);
    grow(x1, y1); grow(x2, y2);
    if (++segTotal > MAX_SEGMENTS) throw new Error('도면이 너무 큽니다. 필요한 시트만 남겨 다시 저장한 뒤 열어 주세요.');
  };

  const tx = (m: M, x: number, y: number): [number, number] =>
    [(m[0] * x + m[2] * y + m[4]) * unitScale, (m[1] * x + m[3] * y + m[5]) * unitScale];
  const mScale = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * unitScale;
  const mRot = (m: M) => Math.atan2(m[1], m[0]);

  const pushPolyline = (layer: string, m: M, pts: { x: number; y: number; bulge?: number }[], closed: boolean) => {
    if (pts.length < 2) return;
    const n = pts.length;
    const last = closed ? n : n - 1;
    const world: number[] = [];
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const bulge = a.bulge ?? 0;
      if (Math.abs(bulge) < 1e-9) {
        const [x1, y1] = tx(m, a.x, a.y), [x2, y2] = tx(m, b.x, b.y);
        pushSeg(layer, x1, y1, x2, y2);
        world.push(x1, y1);
      } else {
        // bulge = tan(sweep/4)
        const sweep = 4 * Math.atan(bulge);
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        if (chord < 1e-12) continue;
        const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const sagitta = r * Math.cos(sweep / 2);
        const nx = -(b.y - a.y) / chord, ny = (b.x - a.x) / chord;
        const sgn = bulge > 0 ? 1 : -1;
        const cx = mx + nx * sagitta * sgn, cy = my + ny * sagitta * sgn;
        const a0 = Math.atan2(a.y - cy, a.x - cx);
        const steps = Math.max(2, Math.min(48, Math.ceil(Math.abs(sweep) / (Math.PI / 18))));
        let [px, py] = tx(m, a.x, a.y);
        world.push(px, py);
        for (let s = 1; s <= steps; s++) {
          const ang = a0 + (sweep * s) / steps;
          const [qx, qy] = tx(m, cx + r * Math.cos(ang), cy + r * Math.sin(ang));
          pushSeg(layer, px, py, qx, qy);
          if (s < steps) world.push(qx, qy);
          px = qx; py = qy;
        }
      }
    }
    if (closed && n >= 3 && n <= 12) polys.push({ layer, pts: world });
  };

  const pushArc = (layer: string, m: M, c: P, r: number, a0: number, a1: number, full: boolean) => {
    let sweep = full ? Math.PI * 2 : a1 - a0;
    if (!full) while (sweep <= 0) sweep += Math.PI * 2;
    const steps = Math.max(6, Math.min(72, Math.ceil(sweep / (Math.PI / 24))));
    let [px, py] = tx(m, c.x + r * Math.cos(a0), c.y + r * Math.sin(a0));
    for (let s = 1; s <= steps; s++) {
      const ang = a0 + (sweep * s) / steps;
      const [qx, qy] = tx(m, c.x + r * Math.cos(ang), c.y + r * Math.sin(ang));
      pushSeg(layer, px, py, qx, qy);
      px = qx; py = qy;
    }
  };

  const pushText = (layer: string, m: M, e: RawEntity, mtext: boolean) => {
    const rawStr = e.text ?? '';
    const str = cleanText(mtext ? cleanMText(rawStr) : rawStr).trim();
    if (!str) return;
    const h0 = e.textHeight ?? 2.5;
    let ax: number, ay: number, align: CadText['align'] = 'left';
    let rot = e.rotation ?? 0;
    if (mtext) {
      const ip = e.insertionPoint ?? { x: 0, y: 0 };
      if (e.direction && (e.direction.x !== 0 || e.direction.y !== 0)) rot = Math.atan2(e.direction.y, e.direction.x);
      const ap = e.attachmentPoint ?? 1;
      align = [1, 4, 7].includes(ap) ? 'left' : [2, 5, 8].includes(ap) ? 'center' : 'right';
      const lines = str.split('\n');
      const total = lines.length * h0 * 1.6;
      const top = ap <= 3 ? 0 : ap <= 6 ? total / 2 : total;
      lines.forEach((line, i) => {
        const off = -top + total - (i + 1) * h0 * 1.6 + h0 * 0.3;
        const lx = ip.x - Math.sin(rot) * off, ly = ip.y + Math.cos(rot) * off;
        const [x, y] = tx(m, lx, ly);
        if (line.trim()) texts.push({ layer, x, y, h: h0 * mScale(m), rot: rot + mRot(m), text: line.trim(), align });
        grow(x, y);
      });
      return;
    }
    const ha = e.halign ?? 0, va = e.valign ?? 0;
    const useAlign = (ha !== 0 || va !== 0) && e.endPoint;
    const base = useAlign ? e.endPoint! : (e.startPoint ?? e.insertionPoint ?? { x: 0, y: 0 });
    ax = base.x; ay = base.y;
    align = ha === 1 || ha === 4 ? 'center' : ha === 2 ? 'right' : 'left';
    const vOff = ha === 4 || va === 2 ? -h0 / 2 : va === 3 ? -h0 : 0;
    ax += -Math.sin(rot) * vOff; ay += Math.cos(rot) * vOff;
    const [x, y] = tx(m, ax, ay);
    texts.push({ layer, x, y, h: h0 * mScale(m), rot: rot + mRot(m), text: str, align });
    grow(x, y);
  };

  const walk = (ents: RawEntity[], m: M, parentLayer: string | null, depth: number) => {
    for (const e of ents) {
      const layer = (e.layer === '0' || !e.layer) && parentLayer ? parentLayer : (e.layer || '0');
      if (hiddenLayers.has(layer)) { skip('숨김 레이어'); continue; }
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      layerCount.set(layer, (layerCount.get(layer) ?? 0) + 1);
      switch (e.type) {
        case 'LINE': {
          const a = e.startPoint, b = e.endPoint;
          if (!a || !b) break;
          const [x1, y1] = tx(m, a.x, a.y), [x2, y2] = tx(m, b.x, b.y);
          pushSeg(layer, x1, y1, x2, y2);
          break;
        }
        case 'LWPOLYLINE': case 'POLYLINE2D': case 'POLYLINE': case 'POLYLINE3D': {
          // LWPOLYLINE은 LibreDWG 규약(512=닫힘), 구형 POLYLINE은 DXF 규약(1=닫힘)
          const f = e.flag ?? 0;
          const closed = (e.type === 'LWPOLYLINE' ? (f & 512) !== 0 : (f & 1) !== 0) || closedByPoints(e.vertices);
          pushPolyline(layer, m, e.vertices ?? [], closed);
          break;
        }
        case 'CIRCLE': {
          if (!e.center || !e.radius) break;
          const [cx, cy] = tx(m, e.center.x, e.center.y);
          const r = e.radius * mScale(m);
          circles.push({ layer, x: cx, y: cy, r });
          grow(cx - r, cy - r); grow(cx + r, cy + r);
          break;
        }
        case 'ARC': {
          if (!e.center || !e.radius) break;
          pushArc(layer, m, e.center, e.radius, e.startAngle ?? 0, e.endAngle ?? Math.PI * 2, false);
          break;
        }
        case 'ELLIPSE': {
          const c = e.center, maj = e.majorAxisEndPoint;
          if (!c || !maj) break;
          const ratio = e.axisRatio ?? 1;
          const a0 = e.startAngle ?? 0;
          let a1 = e.endAngle ?? Math.PI * 2;
          if (a1 <= a0) a1 += Math.PI * 2;
          const ux = maj.x, uy = maj.y, vx = -maj.y * ratio, vy = maj.x * ratio;
          const steps = Math.max(8, Math.min(72, Math.ceil((a1 - a0) / (Math.PI / 24))));
          let prev: [number, number] | null = null;
          for (let s = 0; s <= steps; s++) {
            const t = a0 + ((a1 - a0) * s) / steps;
            const p = tx(m, c.x + ux * Math.cos(t) + vx * Math.sin(t), c.y + uy * Math.cos(t) + vy * Math.sin(t));
            if (prev) pushSeg(layer, prev[0], prev[1], p[0], p[1]);
            prev = p;
          }
          break;
        }
        case 'SPLINE': {
          const pts = (e.fitPoints && e.fitPoints.length > 1 ? e.fitPoints : e.controlPoints) ?? [];
          pushPolyline(layer, m, pts.map((p) => ({ x: p.x, y: p.y })), false);
          break;
        }
        case 'SOLID': case '3DFACE': case 'TRACE': {
          const cs = [e.corner1, e.corner2, e.corner4 ?? e.corner3, e.corner3].filter(Boolean) as P[];
          if (cs.length >= 3) pushPolyline(layer, m, cs, true);
          break;
        }
        case 'TEXT': case 'ATTRIB':
          pushText(layer, m, e, false);
          break;
        case 'MTEXT':
          pushText(layer, m, e, true);
          break;
        case 'INSERT': {
          if (depth >= MAX_DEPTH) { skip('중첩 블록'); break; }
          const blk = e.name ? raw.blocks.get(e.name) : undefined;
          if (blk) {
            const ip = e.insertionPoint ?? { x: 0, y: 0 };
            const sx = e.xScale || 1, sy = e.yScale || 1, r = e.rotation ?? 0;
            const cos = Math.cos(r), sin = Math.sin(r);
            const local: M = [cos * sx, sin * sx, -sin * sy, cos * sy, ip.x, ip.y];
            const toBase: M = [1, 0, 0, 1, -blk.basePoint.x, -blk.basePoint.y];
            walk(blk.entities, mul(m, mul(local, toBase)), layer, depth + 1);
          }
          if (e.attribs) walk(e.attribs, m, layer, depth + 1);
          break;
        }
        case 'DIMENSION': {
          const a = e.subDefinitionPoint1, b = e.subDefinitionPoint2, d = e.definitionPoint;
          if (a && b && d) {
            const [ax, ay] = tx(m, a.x, a.y), [bx, by] = tx(m, b.x, b.y), [lx, ly] = tx(m, d.x, d.y);
            const tol = Math.max(1e-6, Math.hypot(bx - ax, by - ay) * 1e-4);
            let orient: CadDim['orient'] = 'a';
            let value = Math.hypot(bx - ax, by - ay);
            if (Math.abs(lx - bx) < tol && Math.abs(bx - ax) > tol) { orient = 'h'; value = Math.abs(bx - ax); }
            else if (Math.abs(ly - by) < tol && Math.abs(by - ay) > tol) { orient = 'v'; value = Math.abs(by - ay); }
            if (e.measurement && e.measurement > 0) value = e.measurement * unitScale;
            dims.push({ layer, ax, ay, bx, by, lineX: lx, lineY: ly, orient, value });
          }
          const blk = e.name ? raw.blocks.get(e.name) : undefined;
          if (blk && depth < MAX_DEPTH) walk(blk.entities, m, layer, depth + 1);
          break;
        }
        default:
          skip(e.type);
      }
    }
  };

  walk(raw.entities, IDENTITY, null, 0);

  const segs: Record<string, Float64Array> = {};
  for (const [k, v] of segLists) segs[k] = Float64Array.from(v);

  const layers: CadLayer[] = [];
  const names = new Set([...layerCount.keys()]);
  for (const name of names) {
    const info = layerInfo.get(name);
    layers.push({ name, color: aciToRgb(info?.colorIndex && info.colorIndex > 0 ? info.colorIndex : 7), count: layerCount.get(name) ?? 0 });
  }
  layers.sort((a, b) => b.count - a.count);

  const extents: Bounds = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const entities = Object.values(byType).reduce((s, v) => s + v, 0);
  return {
    fileName, format: raw.format, version: raw.version, unitScale,
    layers, segs, circles, polys, texts, dims, extents,
    stats: { entities, byType, skipped },
  };
}

function closedByPoints(v?: { x: number; y: number }[]): boolean {
  if (!v || v.length < 3) return false;
  const a = v[0], b = v[v.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
}

/** 단위 추정 결과에 따라 문서 전체 좌표에 배율을 곱한다. */
export function scaleDoc(doc: CadDoc, k: number): CadDoc {
  if (k === 1) return doc;
  const segs: Record<string, Float64Array> = {};
  for (const [name, arr] of Object.entries(doc.segs)) segs[name] = arr.map((v) => v * k);
  return {
    ...doc,
    unitScale: doc.unitScale * k,
    segs,
    circles: doc.circles.map((c) => ({ ...c, x: c.x * k, y: c.y * k, r: c.r * k })),
    polys: doc.polys.map((p) => ({ ...p, pts: p.pts.map((v) => v * k) })),
    texts: doc.texts.map((t) => ({ ...t, x: t.x * k, y: t.y * k, h: t.h * k })),
    dims: doc.dims.map((d) => ({ ...d, ax: d.ax * k, ay: d.ay * k, bx: d.bx * k, by: d.by * k, lineX: d.lineX * k, lineY: d.lineY * k, value: d.value * k })),
    extents: { minX: doc.extents.minX * k, minY: doc.extents.minY * k, maxX: doc.extents.maxX * k, maxY: doc.extents.maxY * k },
  };
}
