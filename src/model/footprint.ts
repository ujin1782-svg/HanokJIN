// 기둥 배치 → 평면 외곽(칸 점유) → 채(날개) 분할 → 외벽 칸 목록.
// 사용자가 기둥을 고치면 매번 다시 계산하므로 순수 함수로 둔다.

import type { Pillar, PillarRole, Project } from '../core/types';

export interface Wing {
  id: string;
  x1: number; y1: number; x2: number; y2: number;   // 기둥 열 기준 사각형(mm)
  axis: 'x' | 'y';                                   // 용마루 방향
  /** 다른 채에 붙어 지붕이 이어지는 쪽: 그 방향으로 지붕을 상대 채 용마루까지 늘인다 */
  joins: { side: 'minX' | 'maxX' | 'minY' | 'maxY'; to: number }[];
}

export interface Edge {
  x1: number; y1: number; x2: number; y2: number;
  out: 'S' | 'N' | 'W' | 'E';   // 바깥쪽 방향
  cell: [number, number];
}

export interface Footprint {
  xs: number[]; ys: number[];
  occ: boolean[][];              // occ[i][j]: x칸 i, y칸 j
  wings: Wing[];
  edges: Edge[];
  /** 격자 교차점에 놓인 기둥 */
  at: Map<string, Pillar>;
  roles: Map<string, PillarRole>;
  shape: '없음' | '一자형' | 'ㄱ자형' | 'ㄷ자형' | 'ㅁ자형' | '복합형';
}

export function nearestIndex(values: number[], v: number): number {
  let best = 0, bd = Infinity;
  values.forEach((x, i) => { const d = Math.abs(x - v); if (d < bd) { bd = d; best = i; } });
  return best;
}

function tolerance(values: number[], i: number) {
  const gaps: number[] = [];
  if (i > 0) gaps.push(values[i] - values[i - 1]);
  if (i < values.length - 1) gaps.push(values[i + 1] - values[i]);
  return Math.min(600, 0.3 * Math.min(...(gaps.length ? gaps : [2000])));
}

export function pillarIndex(p: Project, pl: Pillar): [number, number] | null {
  const { xs, ys } = p.grid;
  if (!xs.length || !ys.length) return null;
  const i = nearestIndex(xs, pl.x), j = nearestIndex(ys, pl.y);
  if (Math.abs(xs[i] - pl.x) > tolerance(xs, i) || Math.abs(ys[j] - pl.y) > tolerance(ys, j)) return null;
  return [i, j];
}

export function computeFootprint(p: Project): Footprint {
  const { xs, ys } = p.grid;
  const nx = xs.length, ny = ys.length;
  const at = new Map<string, Pillar>();
  const present: boolean[][] = Array.from({ length: nx }, () => Array(ny).fill(false));
  for (const pl of p.pillars) {
    const ij = pillarIndex(p, pl);
    if (!ij) continue;
    present[ij[0]][ij[1]] = true;
    at.set(`${ij[0]},${ij[1]}`, pl);
  }

  const span = (vals: boolean[]) => {
    const idx = vals.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
    return idx.length >= 2 ? [idx[0], idx[idx.length - 1]] as const : null;
  };
  const rowSpan = Array.from({ length: ny }, (_, j) => span(present.map((col) => col[j])));
  const colSpan = Array.from({ length: nx }, (_, i) => span(present[i]));
  const covers = (s: readonly [number, number] | null | undefined, a: number, b: number) => !!s && s[0] <= a && s[1] >= b;
  // 중간 격자선에는 기둥이 없을 수 있으므로(대청 등), 기둥이 2개 이상 있는 가장 가까운 선을 쓴다.
  const below = <T>(arr: (T | null)[], k: number) => { for (let q = k; q >= 0; q--) if (arr[q]) return arr[q]; return null; };
  const above = <T>(arr: (T | null)[], k: number) => { for (let q = k; q < arr.length; q++) if (arr[q]) return arr[q]; return null; };

  const occ: boolean[][] = Array.from({ length: Math.max(0, nx - 1) }, (_, i) =>
    Array.from({ length: Math.max(0, ny - 1) }, (_, j) =>
      covers(below(rowSpan, j), i, i + 1) && covers(above(rowSpan, j + 1), i, i + 1) &&
      covers(below(colSpan, i), j, j + 1) && covers(above(colSpan, i + 1), j, j + 1)));

  const wings = splitWings(occ, xs, ys);
  const isOcc = (i: number, j: number) => i >= 0 && j >= 0 && i < nx - 1 && j < ny - 1 && occ[i][j];

  const edges: Edge[] = [];
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny - 1; j++) {
    if (!occ[i][j]) continue;
    if (!isOcc(i, j - 1)) edges.push({ x1: xs[i], y1: ys[j], x2: xs[i + 1], y2: ys[j], out: 'S', cell: [i, j] });
    if (!isOcc(i, j + 1)) edges.push({ x1: xs[i], y1: ys[j + 1], x2: xs[i + 1], y2: ys[j + 1], out: 'N', cell: [i, j] });
    if (!isOcc(i - 1, j)) edges.push({ x1: xs[i], y1: ys[j], x2: xs[i], y2: ys[j + 1], out: 'W', cell: [i, j] });
    if (!isOcc(i + 1, j)) edges.push({ x1: xs[i + 1], y1: ys[j], x2: xs[i + 1], y2: ys[j + 1], out: 'E', cell: [i, j] });
  }

  const roles = new Map<string, PillarRole>();
  for (const [k, pl] of at) {
    const [i, j] = k.split(',').map(Number);
    const around = [isOcc(i - 1, j - 1), isOcc(i, j - 1), isOcc(i - 1, j), isOcc(i, j)].filter(Boolean).length;
    roles.set(pl.id, around === 4 ? 'inner' : around === 2 ? 'edge' : around === 0 ? 'edge' : 'corner');
  }
  for (const pl of p.pillars) if (!roles.has(pl.id)) roles.set(pl.id, 'inner');

  return { xs, ys, occ, wings, edges, at, roles, shape: shapeName(wings) };
}

/** 점유 칸을 큰 직사각형부터 떼어 내 채(날개)로 나눈다. */
function splitWings(occ: boolean[][], xs: number[], ys: number[]): Wing[] {
  const left = occ.map((col) => col.slice());
  const nx = left.length, ny = nx ? left[0].length : 0;
  const rects: [number, number, number, number][] = [];
  for (;;) {
    let best: [number, number, number, number] | null = null, bestA = 0;
    for (let i0 = 0; i0 < nx; i0++) for (let j0 = 0; j0 < ny; j0++) {
      if (!left[i0][j0]) continue;
      for (let i1 = i0; i1 < nx && left[i1][j0]; i1++) {
        let j1 = j0;
        while (j1 + 1 < ny && rowFilled(left, i0, i1, j1 + 1)) j1++;
        const a = (xs[i1 + 1] - xs[i0]) * (ys[j1 + 1] - ys[j0]);
        if (a > bestA) { bestA = a; best = [i0, j0, i1, j1]; }
      }
    }
    if (!best) break;
    const [i0, j0, i1, j1] = best;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) left[i][j] = false;
    rects.push(best);
  }

  const wings: Wing[] = rects.map(([i0, j0, i1, j1], k) => {
    const x1 = xs[i0], x2 = xs[i1 + 1], y1 = ys[j0], y2 = ys[j1 + 1];
    return { id: `W${k + 1}`, x1, y1, x2, y2, axis: x2 - x1 >= y2 - y1 ? 'x' : 'y', joins: [] };
  });

  // 작은 채가 큰 채에 붙어 있으면, 작은 채 지붕을 큰 채 용마루까지 늘여 회첨(골)을 만든다.
  for (let a = 1; a < wings.length; a++) {
    const w = wings[a];
    for (let b = 0; b < a; b++) {
      const m = wings[b];
      const overlapX = Math.min(w.x2, m.x2) - Math.max(w.x1, m.x1) > 1;
      const overlapY = Math.min(w.y2, m.y2) - Math.max(w.y1, m.y1) > 1;
      const ridgeY = (m.y1 + m.y2) / 2, ridgeX = (m.x1 + m.x2) / 2;
      if (overlapX && Math.abs(w.y2 - m.y1) < 1 && m.axis === 'x') w.joins.push({ side: 'maxY', to: ridgeY });
      else if (overlapX && Math.abs(w.y1 - m.y2) < 1 && m.axis === 'x') w.joins.push({ side: 'minY', to: ridgeY });
      else if (overlapY && Math.abs(w.x2 - m.x1) < 1 && m.axis === 'y') w.joins.push({ side: 'maxX', to: ridgeX });
      else if (overlapY && Math.abs(w.x1 - m.x2) < 1 && m.axis === 'y') w.joins.push({ side: 'minX', to: ridgeX });
      else continue;
      // 붙은 방향으로 용마루가 뻗어야 지붕이 자연스럽게 이어진다.
      w.axis = w.joins[0].side === 'minY' || w.joins[0].side === 'maxY' ? 'y' : 'x';
      break;
    }
  }
  return wings;
}

function rowFilled(left: boolean[][], i0: number, i1: number, j: number) {
  for (let i = i0; i <= i1; i++) if (!left[i][j]) return false;
  return true;
}

function shapeName(wings: Wing[]): Footprint['shape'] {
  if (!wings.length) return '없음';
  if (wings.length === 1) return '一자형';
  if (wings.length === 2) return 'ㄱ자형';
  if (wings.length === 3) return 'ㄷ자형';
  if (wings.length === 4) return 'ㅁ자형';
  return '복합형';
}
