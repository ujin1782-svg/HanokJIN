// 테스트용 예제 프로젝트(앱에는 들어가지 않는다). 격자·기둥·벽과 간단한 평면도를 만든다.

import type { CadDoc, Opening, Params, Pillar, Project, Room, Sheet } from '../../src/core/types';
import { DEFAULT_PARAMS } from '../../src/core/params';
import { computeFootprint } from '../../src/model/footprint';
import { defaultPalette } from '../../src/model/palettes';
import { drawingFromProject } from '../../src/model/plan-drawing';

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
    version: 3, id: `${d.id}-${Date.now().toString(36)}`, name: d.name,
    source: { fileName: '테스트 예제', format: '테스트' },
    origin: { x: 0, y: 0 },
    grid: { xs: d.xs, ys: d.ys, labelsX: d.xs.map((_, k) => `X${k + 1}`), labelsY: d.ys.map((_, k) => `Y${k + 1}`), source: 'drawing' },
    pillars, rooms, openings: [], params, baseline: { ...params }, paramSource: {}, members: [],
    palette: defaultPalette(), recognitionNotes: [], reviewed: true, damages: [],
  };
  const fp = computeFootprint(project);
  project.openings = d.openings.flatMap((o, k) => {
    const e = fp.edges.find((q) => q.cell[0] === o.cell[0] && q.cell[1] === o.cell[1] && q.out === o.out);
    return e ? [{ id: `O${k + 1}`, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, kind: o.kind, source: 'drawing' as const }] : [];
  });
  const doc = drawingFromProject(project, `${d.name} 평면도`);
  const sheets: Sheet[] = [{ id: 'sheet-1', kind: 'PLAN', title: '평면도', bounds: doc.extents, entityCount: doc.stats.entities }];
  return { project, doc, sheets };
}
