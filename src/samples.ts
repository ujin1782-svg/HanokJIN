// 예제(데모) 프로젝트. 실제 도면이 아니며 화면 곳곳에 '데모 데이터'로 표시한다.
// 도면 창이 비지 않도록 격자·기둥·벽을 그린 간단한 평면도도 함께 만든다.

import type { CadDoc, CadText, Opening, Params, Pillar, Project, Room, Sheet } from './core/types';
import { DEFAULT_PARAMS } from './core/params';
import { computeFootprint } from './model/footprint';
import { defaultPalette } from './model/palettes';

interface DemoDef {
  id: string; name: string; desc: string;
  xs: number[]; ys: number[];
  cells: [number, number][];          // 점유 칸
  rooms: { name: string; type: Room['type']; cell: [number, number] }[];
  openings: { cell: [number, number]; out: 'S' | 'N' | 'W' | 'E'; kind: Opening['kind'] }[];
  params: Partial<Params>;
  round?: (i: number, j: number) => boolean;
}

export const DEMOS: DemoDef[] = [
  {
    id: 'demo-5kan', name: '정면 5칸 팔작 한옥', desc: '一자형 · 이익공 · 5량가 · 대청과 양쪽 온돌방',
    xs: [0, 2700, 5400, 8400, 11100, 13800], ys: [0, 3000, 6000],
    cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1]],
    rooms: [
      { name: '안방', type: 'ondol', cell: [0, 0] }, { name: '안방', type: 'ondol', cell: [1, 0] },
      { name: '대청', type: 'maru', cell: [2, 0] }, { name: '대청', type: 'maru', cell: [2, 1] },
      { name: '건넌방', type: 'ondol', cell: [3, 0] }, { name: '건넌방', type: 'ondol', cell: [4, 0] },
    ],
    openings: [
      { cell: [2, 0], out: 'S', kind: 'door' }, { cell: [0, 0], out: 'S', kind: 'window' }, { cell: [1, 0], out: 'S', kind: 'window' },
      { cell: [3, 0], out: 'S', kind: 'window' }, { cell: [4, 0], out: 'S', kind: 'window' }, { cell: [2, 1], out: 'N', kind: 'window' },
    ],
    params: { roofType: 'paljak', gongpo: 'iikgong', ryangga: 5, pillarHeight: 2750, roofHeight: 2900, eaves: 1650, gidanHeight: 600, baseD: 300, heullim: 'baeheullim', lattice: 'tti' },
    round: (_i, j) => j === 0,
  },
  {
    id: 'demo-giyeok', name: 'ㄱ자형 안채', desc: 'ㄱ자형 · 초익공 · 5량가 · 회첨 지붕',
    xs: [0, 3600, 6300, 9000, 12000], ys: [0, 3300, 6300, 9300, 12000],
    cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
    rooms: [
      { name: '부엌', type: 'kitchen', cell: [0, 0] }, { name: '안방', type: 'ondol', cell: [0, 1] },
      { name: '대청', type: 'maru', cell: [1, 2] }, { name: '대청', type: 'maru', cell: [2, 2] }, { name: '대청', type: 'maru', cell: [1, 3] }, { name: '대청', type: 'maru', cell: [2, 3] },
      { name: '건넌방', type: 'ondol', cell: [3, 2] }, { name: '건넌방', type: 'ondol', cell: [3, 3] },
    ],
    openings: [
      { cell: [1, 2], out: 'S', kind: 'door' }, { cell: [2, 2], out: 'S', kind: 'door' }, { cell: [3, 2], out: 'S', kind: 'window' },
      { cell: [0, 1], out: 'E', kind: 'window' }, { cell: [0, 0], out: 'E', kind: 'door' }, { cell: [0, 0], out: 'S', kind: 'window' },
      { cell: [3, 3], out: 'E', kind: 'window' },
    ],
    params: { roofType: 'paljak', gongpo: 'ikgong', ryangga: 5, pillarHeight: 2600, roofHeight: 3000, eaves: 1600, gidanHeight: 550, baseD: 300, heullim: 'minheullim', lattice: 'se' },
    round: (i, j) => j === 2 && i >= 1,
  },
  {
    id: 'demo-matbae', name: '정면 3칸 맞배 민가', desc: '一자형 · 민도리 · 3량가 · 소박한 살림집',
    xs: [0, 2400, 5100, 7500], ys: [0, 2700, 5400],
    cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
    rooms: [
      { name: '방', type: 'ondol', cell: [0, 0] }, { name: '방', type: 'ondol', cell: [0, 1] },
      { name: '마루', type: 'maru', cell: [1, 0] }, { name: '마루', type: 'maru', cell: [1, 1] },
      { name: '건넌방', type: 'ondol', cell: [2, 0] }, { name: '건넌방', type: 'ondol', cell: [2, 1] },
    ],
    openings: [{ cell: [1, 0], out: 'S', kind: 'door' }, { cell: [0, 0], out: 'S', kind: 'window' }, { cell: [2, 0], out: 'S', kind: 'window' }],
    params: { roofType: 'matbae', gongpo: 'mindori', ryangga: 3, pillarHeight: 2450, roofHeight: 2300, eaves: 1200, gidanHeight: 450, baseD: 240, heullim: 'none', lattice: 'yongja' },
  },
];

export function makeDemo(id: string): { project: Project; doc: CadDoc; sheets: Sheet[] } {
  const d = DEMOS.find((q) => q.id === id) ?? DEMOS[0];
  const occ = new Set(d.cells.map(([i, j]) => `${i},${j}`));
  const has = (i: number, j: number) => occ.has(`${i},${j}`);
  const pillars: Pillar[] = [];
  for (let i = 0; i < d.xs.length; i++) for (let j = 0; j < d.ys.length; j++) {
    if (!(has(i, j) || has(i - 1, j) || has(i, j - 1) || has(i - 1, j - 1))) continue;
    const round = d.round?.(i, j) ?? false;
    pillars.push({ id: `X${i + 1}-Y${j + 1}`, x: d.xs[i], y: d.ys[j], shape: round ? 'round' : 'square', size: round ? (d.params.baseD ?? 300) : Math.round((d.params.baseD ?? 300) * 0.8), source: 'drawing', confidence: 1 });
  }
  const params: Params = { ...DEFAULT_PARAMS, ...d.params };
  // 칸마다 실 하나(바닥 재료를 칸 단위로 정하므로)
  const rooms: Room[] = d.rooms.map((r, k) => ({
    id: `R${k + 1}`, name: r.name, type: r.type,
    x: (d.xs[r.cell[0]] + d.xs[r.cell[0] + 1]) / 2, y: (d.ys[r.cell[1]] + d.ys[r.cell[1] + 1]) / 2,
  }));
  const project: Project = {
    version: 3, id: `${d.id}-${Date.now().toString(36)}`, name: `${d.name} (데모)`, demo: true,
    source: { fileName: '예제 프로젝트', format: '데모 데이터' },
    origin: { x: 0, y: 0 },
    grid: { xs: d.xs, ys: d.ys, labelsX: d.xs.map((_, k) => `X${k + 1}`), labelsY: d.ys.map((_, k) => `Y${k + 1}`), source: 'drawing' },
    pillars, rooms, openings: [], params, baseline: { ...params }, paramSource: {}, members: [],
    palette: defaultPalette(), recognitionNotes: ['예제 프로젝트입니다. 실제 도면에서 인식한 값이 아닙니다.'], reviewed: true,
  };
  const fp = computeFootprint(project);
  project.openings = d.openings.flatMap((o, k) => {
    const e = fp.edges.find((q) => q.cell[0] === o.cell[0] && q.cell[1] === o.cell[1] && q.out === o.out);
    return e ? [{ id: `O${k + 1}`, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, kind: o.kind, source: 'drawing' as const }] : [];
  });
  const doc = drawingFromProject(project, `${d.name} 평면도 (데모)`);
  const sheets: Sheet[] = [{ id: 'sheet-1', kind: 'PLAN', title: '평면도(데모)', bounds: doc.extents, entityCount: doc.stats.entities }];
  return { project, doc, sheets };
}

const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

/** 프로젝트에서 평면도를 그린다(데모 도면, DXF 내보내기 공용). */
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
    fileName: title, format: 'DEMO', version: '데모 도면', unitScale: 1,
    layers, segs: out, circles, polys, texts, dims: [],
    extents: { minX: x0 - pad, minY: y0 - pad - 900, maxX: x1 + pad, maxY: y1 + pad },
    stats: { entities: Object.values(segs).reduce((s, v) => s + v.length / 4, 0) + circles.length + texts.length, byType: {}, skipped: {} },
  };
}
