// 한 모델 공간 안에 나란히 놓인 여러 도면 시트를 찾아 나누고, 제목으로 종류를 분류한다.

import type { Bounds, CadDoc, Sheet, SheetKind } from '../core/types';

const RULES: [RegExp, SheetKind, string][] = [
  [/지붕(평면|복도)|지붕도|ROOF ?PLAN/i, 'ROOF_PLAN', '지붕 평면도'],
  [/앙시|천장|천정|반자|CEILING|REFLECTED/i, 'CEILING', '앙시도'],
  [/배치/, 'OTHER', '배치도'],
  [/평면|FLOOR ?PLAN/i, 'PLAN', '평면도'],
  [/정면|FRONT/i, 'FRONT', '정면도'],
  [/배면|REAR|BACK/i, 'REAR', '배면도'],
  [/우측|RIGHT/i, 'RIGHT', '우측면도'],
  [/좌측|LEFT/i, 'LEFT', '좌측면도'],
  [/단면|SECTION/i, 'SECTION', '단면도'],
  [/입면|ELEVATION/i, 'FRONT', '입면도'],
];

const KIND_ORDER: SheetKind[] = ['PLAN', 'ROOF_PLAN', 'CEILING', 'FRONT', 'RIGHT', 'LEFT', 'REAR', 'SECTION', 'OTHER'];

export const KIND_LABEL: Record<SheetKind, string> = {
  PLAN: '평면도', ROOF_PLAN: '지붕 평면도', CEILING: '앙시도', FRONT: '정면도', REAR: '배면도',
  LEFT: '좌측면도', RIGHT: '우측면도', SECTION: '단면도', OTHER: '기타 도면',
};

export function classifyTitle(text: string): { kind: SheetKind; title: string } | null {
  const t = text.replace(/\s+/g, '');
  if (t.length < 2 || t.length > 16) return null;
  if (!/도$|PLAN|ELEVATION|SECTION/i.test(t)) return null;
  for (const [re, kind] of RULES) if (re.test(t)) return { kind, title: t };
  return null;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

const inside = (b: Bounds, x: number, y: number) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

export function segmentSheets(doc: CadDoc): Sheet[] {
  // 1) 대표 크기(이상치 제외)로 격자 크기를 정한다.
  const xs: number[] = [], ys: number[] = [];
  for (const arr of Object.values(doc.segs)) {
    for (let i = 0; i < arr.length; i += 4 * 7) { xs.push((arr[i] + arr[i + 2]) / 2); ys.push((arr[i + 1] + arr[i + 3]) / 2); }
  }
  for (const c of doc.circles) { xs.push(c.x); ys.push(c.y); }
  if (xs.length < 2) return [wholeSheet(doc)];
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const w = percentile(xs, 0.99) - percentile(xs, 0.01);
  const h = percentile(ys, 0.99) - percentile(ys, 0.01);
  const cell = Math.max(w, h, 1) / 800;

  // 2) 희소 래스터에 도형을 찍고 8-연결 성분을 찾는다.
  const occ = new Map<string, number>();
  const key = (ix: number, iy: number) => `${ix},${iy}`;
  const mark = (x: number, y: number) => {
    const k = key(Math.floor(x / cell), Math.floor(y / cell));
    occ.set(k, (occ.get(k) ?? 0) + 1);
  };
  for (const arr of Object.values(doc.segs)) {
    for (let i = 0; i < arr.length; i += 4) {
      const x1 = arr[i], y1 = arr[i + 1], x2 = arr[i + 2], y2 = arr[i + 3];
      const n = Math.min(4000, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (cell * 0.5)));
      for (let s = 0; s <= n; s++) mark(x1 + ((x2 - x1) * s) / Math.max(1, n), y1 + ((y2 - y1) * s) / Math.max(1, n));
    }
  }
  for (const c of doc.circles) mark(c.x, c.y);
  for (const t of doc.texts) mark(t.x, t.y);

  const seen = new Set<string>();
  type Comp = { b: Bounds; marks: number };
  const comps: Comp[] = [];
  for (const start of occ.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    let marks = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const [ix, iy] = k.split(',').map(Number);
      marks += occ.get(k) ?? 0;
      b.minX = Math.min(b.minX, ix * cell); b.maxX = Math.max(b.maxX, (ix + 1) * cell);
      b.minY = Math.min(b.minY, iy * cell); b.maxY = Math.max(b.maxY, (iy + 1) * cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nk = key(ix + dx, iy + dy);
        if (!seen.has(nk) && occ.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    comps.push({ b, marks });
  }
  const totalMarks = comps.reduce((s, c) => s + c.marks, 0);

  // 도곽(테두리) 안에 떨어져 있는 내용은 도곽 성분에 합친다.
  comps.sort((a, b) => area(b.b) - area(a.b));
  for (let i = comps.length - 1; i > 0; i--) {
    const c = comps[i];
    const host = comps.slice(0, i).find((h) => contains(h.b, c.b, cell));
    if (host) { host.marks += c.marks; host.b = union(host.b, c.b); comps.splice(i, 1); }
  }

  // 3) 성분마다 제목 글자를 찾는다(가장 큰 글자 우선).
  type Titled = Comp & { kind: SheetKind; title: string; th: number };
  const titled: Titled[] = [];
  const untitled: Comp[] = [];
  for (const c of comps) {
    let best: { kind: SheetKind; title: string; th: number } | null = null;
    for (const t of doc.texts) {
      if (!inside(c.b, t.x, t.y)) continue;
      const m = classifyTitle(t.text);
      if (m && (!best || t.h > best.th)) best = { ...m, th: t.h };
    }
    if (best) titled.push({ ...c, ...best });
    else untitled.push(c);
  }

  if (!titled.length) return [wholeSheet(doc)];

  // 4) 제목 없는 조각은 가까운 시트에 합치고, 큰 조각만 '기타'로 남긴다.
  for (const u of untitled) {
    let target: Titled | null = null, bestD = Infinity;
    for (const t of titled) {
      const dx = Math.max(0, t.b.minX - u.b.maxX, u.b.minX - t.b.maxX);
      const dy = Math.max(0, t.b.minY - u.b.maxY, u.b.minY - t.b.maxY);
      const d = Math.hypot(dx, dy);
      // 도면 아래에 따로 떨어진 제목처럼, 둘 중 큰 쪽 크기를 기준으로 가까우면 같은 시트다.
      const size = Math.max(t.b.maxX - t.b.minX, t.b.maxY - t.b.minY, u.b.maxX - u.b.minX, u.b.maxY - u.b.minY);
      if (d < size * 0.25 && d < bestD) { bestD = d; target = t; }
    }
    if (target) {
      target.b = union(target.b, u.b);
      target.marks += u.marks;
    } else if (u.marks > totalMarks * 0.03) {
      titled.push({ ...u, kind: 'OTHER', title: '제목 없는 도면', th: 0 });
    }
  }

  titled.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.b.minX - b.b.minX);
  return titled.map((t, i) => ({ id: `sheet-${i + 1}`, kind: t.kind, title: t.title, bounds: t.b, entityCount: t.marks }));
}

const area = (b: Bounds) => (b.maxX - b.minX) * (b.maxY - b.minY);
const contains = (o: Bounds, i: Bounds, tol: number) =>
  i.minX >= o.minX - tol && i.maxX <= o.maxX + tol && i.minY >= o.minY - tol && i.maxY <= o.maxY + tol;

function union(a: Bounds, b: Bounds): Bounds {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

function wholeSheet(doc: CadDoc): Sheet {
  return { id: 'sheet-1', kind: 'PLAN', title: '도면 전체', bounds: doc.extents, entityCount: doc.stats.entities };
}

export function sheetLabel(s: Sheet): string {
  return s.title && s.title !== KIND_LABEL[s.kind] ? s.title : KIND_LABEL[s.kind];
}
