// 프로젝트(격자·기둥·외벽·창호·실)에서 2D 평면도를 그린다. 도면 없이 만든 모델(4면 사진)의 도면 창과 DXF 내보내기에 쓴다.

import type { CadDoc, CadText, Project } from '../core/types';
import { computeFootprint } from './footprint';

const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

/** 프로젝트에서 평면도를 그린다. */
export function drawingFromProject(p: Project, title: string): CadDoc {
  const segs: Record<string, number[]> = { CEN: [], WALL: [], WIN: [], DOOR: [], COL: [], TIT: [] };
  const circles: CadDoc['circles'] = [];
  const polys: CadDoc['polys'] = [];
  const texts: CadText[] = [];
  const { xs, ys } = p.grid;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ext = 1800;
  xs.forEach((x, k) => {
    segs.CEN.push(x, y0 - ext + 600, x, y1 + ext - 600);
    circles.push({ layer: '주열마크', x, y: y1 + ext, r: 400 });
    texts.push({ layer: '주열번호', x, y: y1 + ext - 120, h: 260, rot: 0, text: p.grid.labelsX[k], align: 'center' });
  });
  ys.forEach((y, k) => {
    segs.CEN.push(x0 - ext + 600, y, x1 + ext - 600, y);
    circles.push({ layer: '주열마크', x: x0 - ext, y, r: 400 });
    texts.push({ layer: '주열번호', x: x0 - ext, y: y - 120, h: 260, rot: 0, text: p.grid.labelsY[k], align: 'center' });
  });
  for (const pl of p.pillars) {
    if (pl.shape === 'round') circles.push({ layer: 'COL', x: pl.x, y: pl.y, r: pl.size / 2 });
    else {
      const s = pl.size / 2;
      const pts = [pl.x - s, pl.y - s, pl.x + s, pl.y - s, pl.x + s, pl.y + s, pl.x - s, pl.y + s];
      polys.push({ layer: 'COL', pts });
      for (let k = 0; k < 4; k++) segs.COL.push(pts[k * 2], pts[k * 2 + 1], pts[((k + 1) % 4) * 2], pts[((k + 1) % 4) * 2 + 1]);
    }
  }
  const fp = computeFootprint(p);
  for (const e of fp.edges) {
    const horiz = e.y1 === e.y2, t = 75;
    const op = p.openings.find((o) => Math.abs(o.x1 - e.x1) + Math.abs(o.y1 - e.y1) + Math.abs(o.x2 - e.x2) + Math.abs(o.y2 - e.y2) < 2);
    const layer = op ? (op.kind === 'door' ? 'DOOR' : 'WIN') : 'WALL';
    for (const off of op ? [-t, -t / 3, t / 3, t] : [-t, t]) {
      if (horiz) segs[layer].push(e.x1, e.y1 + off, e.x2, e.y2 + off);
      else segs[layer].push(e.x1 + off, e.y1, e.x2 + off, e.y2);
    }
  }
  for (const name of new Set(p.rooms.map((r) => r.name))) {
    const rs = p.rooms.filter((r) => r.name === name);
    texts.push({ layer: 'ROOM', x: avg(rs.map((r) => r.x)), y: avg(rs.map((r) => r.y)), h: 300, rot: 0, text: name, align: 'center' });
  }
  texts.push({ layer: 'TIT', x: (x0 + x1) / 2, y: y0 - ext - 900, h: 450, rot: 0, text: title, align: 'center' });
  const out: Record<string, Float64Array> = {};
  for (const [k, v] of Object.entries(segs)) if (v.length) out[k] = Float64Array.from(v);
  const layers = [
    { name: 'CEN', color: 0xff0000 }, { name: 'WALL', color: 0xffffff }, { name: 'WIN', color: 0x00ffff }, { name: 'DOOR', color: 0xffff00 },
    { name: 'COL', color: 0x00ff00 }, { name: '주열마크', color: 0xffffff }, { name: '주열번호', color: 0xff00ff }, { name: 'ROOM', color: 0xffffff }, { name: 'TIT', color: 0xffffff },
  ].map((l) => ({ ...l, count: (segs[l.name]?.length ?? 0) / 4 + circles.filter((c) => c.layer === l.name).length + texts.filter((t) => t.layer === l.name).length }));
  const pad = ext + 1500;
  return {
    fileName: title, format: 'MODEL', version: '모델에서 생성한 평면도', unitScale: 1,
    layers, segs: out, circles, polys, texts, dims: [],
    extents: { minX: x0 - pad, minY: y0 - pad - 900, maxX: x1 + pad, maxY: y1 + pad },
    stats: { entities: Object.values(segs).reduce((s, v) => s + v.length / 4, 0) + circles.length + texts.length, byType: {}, skipped: {} },
  };
}
