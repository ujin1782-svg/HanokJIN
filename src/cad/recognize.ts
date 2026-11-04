// 정규화 도면에서 한옥 모델 입력값을 찾는다.
// 규칙 기반 인식이며, 찾은 값마다 근거(source/note)와 신뢰도를 남긴다.
// 확실하지 않은 항목은 review 메시지를 달아 사람이 확인하게 한다.

import type { Bounds, CadDoc, CadText, MemberCallout, Opening, OpeningKind, Params, Pillar, Project, Room, RoomType, Sheet, SheetKind } from '../core/types';
import { DEFAULT_PARAMS } from '../core/params';
import { computeFootprint } from '../model/footprint';
import { defaultPalette } from '../model/palettes';

const inB = (b: Bounds, x: number, y: number, pad = 0) => x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad;
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const norm = (s: string) => s.replace(/\s+/g, '');

const COLUMN_LAYER = /기둥|COL|PILLAR|초석/i;
const OPENING_LAYER = /WIN|WID|WINDOW|DOOR|창|문|^DR/i;
const NON_GEOMETRY_LAYER = /CEN|DIM|주열|TIT|TEX|TXT|HAT|DEFPOINT|치수|문자/i;

export interface Recognition {
  project: Project;
  planSheet: Sheet | null;
  unitScaleApplied: number;
}

/* ───────────── 격자(주열) ───────────── */

interface GridAxis { values: number[]; labels: string[]; source: 'labels' | 'pillars' | 'none' }

function gridFromLabels(doc: CadDoc, b: Bounds): { x: GridAxis; y: GridAxis } {
  const xs = new Map<number, number>(), ys = new Map<number, number>();
  const bubbles = doc.circles.filter((c) => inB(b, c.x, c.y) && c.r > 80 && c.r < 1500);
  const center = (t: CadText) => {
    const c = bubbles.find((q) => Math.hypot(q.x - t.x, q.y - t.y) < q.r * 1.15);
    return c ? { x: c.x, y: c.y } : { x: t.x, y: t.y };
  };
  for (const t of doc.texts) {
    if (!inB(b, t.x, t.y)) continue;
    const m = /^([XYxy])\s*-?\s*(\d{1,2})$/.exec(t.text.trim());
    if (!m) continue;
    const n = parseInt(m[2], 10);
    const p = center(t);
    if (m[1].toUpperCase() === 'X') { if (!xs.has(n)) xs.set(n, p.x); }
    else if (!ys.has(n)) ys.set(n, p.y);
  }
  const axis = (mp: Map<number, number>, letter: string): GridAxis => {
    const e = [...mp.entries()].sort((a, c) => a[0] - c[0]);
    return { values: e.map((v) => v[1]), labels: e.map((v) => `${letter}${v[0]}`), source: e.length >= 2 ? 'labels' : 'none' };
  };
  const res = { x: axis(xs, 'X'), y: axis(ys, 'Y') };
  // 라벨 위치를 근처의 긴 중심선에 맞춘다.
  res.x.values = res.x.values.map((v) => snapToAxisLine(doc, b, v, 'x'));
  res.y.values = res.y.values.map((v) => snapToAxisLine(doc, b, v, 'y'));
  return res;
}

function snapToAxisLine(doc: CadDoc, b: Bounds, v: number, axis: 'x' | 'y'): number {
  const hits: number[] = [];
  const minLen = 0.25 * (axis === 'x' ? b.maxY - b.minY : b.maxX - b.minX);
  for (const [layer, arr] of Object.entries(doc.segs)) {
    if (!/CEN|중심|GRID|주열/i.test(layer)) continue;
    for (let i = 0; i < arr.length; i += 4) {
      const x1 = arr[i], y1 = arr[i + 1], x2 = arr[i + 2], y2 = arr[i + 3];
      if (!inB(b, x1, y1)) continue;
      if (axis === 'x' && Math.abs(x1 - x2) < 1 && Math.abs(y2 - y1) > minLen && Math.abs(x1 - v) < 150) hits.push(x1);
      if (axis === 'y' && Math.abs(y1 - y2) < 1 && Math.abs(x2 - x1) > minLen && Math.abs(y1 - v) < 150) hits.push(y1);
    }
  }
  return hits.length ? median(hits) : v;
}

/** 라벨이 없을 때: 기둥 후보 좌표가 2개 이상 겹치는 열을 격자로 본다. */
function gridFromCandidates(cands: Candidate[]): { x: GridAxis; y: GridAxis } {
  const cluster = (vals: number[]) => {
    const s = [...vals].sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const v of s) {
      const g = groups[groups.length - 1];
      if (g && v - g[g.length - 1] < 120) g.push(v); else groups.push([v]);
    }
    return groups.filter((g) => g.length >= 2).map(median);
  };
  const xv = cluster(cands.map((c) => c.x)), yv = cluster(cands.map((c) => c.y));
  return {
    x: { values: xv, labels: xv.map((_, i) => `X${i + 1}`), source: xv.length >= 2 ? 'pillars' : 'none' },
    y: { values: yv, labels: yv.map((_, i) => `Y${i + 1}`), source: yv.length >= 2 ? 'pillars' : 'none' },
  };
}

/* ───────────── 기둥 후보 ───────────── */

interface Candidate { x: number; y: number; size: number; shape: 'round' | 'square'; layer: string; colLayer: boolean }

export function pillarCandidates(doc: CadDoc, b: Bounds): Candidate[] {
  const out: Candidate[] = [];
  for (const c of doc.circles) {
    if (!inB(b, c.x, c.y) || c.r < 75 || c.r > 330) continue;
    out.push({ x: c.x, y: c.y, size: c.r * 2, shape: 'round', layer: c.layer, colLayer: COLUMN_LAYER.test(c.layer) });
  }
  for (const p of doc.polys) {
    const pts: [number, number][] = [];
    for (let i = 0; i < p.pts.length; i += 2) {
      const q: [number, number] = [p.pts[i], p.pts[i + 1]];
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 1e-3) pts.push(q);
    }
    if (pts.length > 4 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-3) pts.pop();
    if (pts.length !== 4) continue;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    // 축에 나란한 사각형만(회전된 가구 등 제외)
    const axisAligned = pts.every((q, i) => { const n = pts[(i + 1) % 4]; return Math.abs(q[0] - n[0]) < 2 || Math.abs(q[1] - n[1]) < 2; });
    if (!axisAligned || w < 150 || w > 650 || h < 150 || h > 650 || w / h < 0.75 || w / h > 1.33) continue;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    if (!inB(b, cx, cy)) continue;
    out.push({ x: cx, y: cy, size: (w + h) / 2, shape: 'square', layer: p.layer, colLayer: COLUMN_LAYER.test(p.layer) });
  }
  // 낱개 선 4개로 그린 사각 기둥(오래된 도면에 흔함)
  for (const q of squaresFromLines(doc, b)) {
    if (out.some((c) => Math.hypot(c.x - q.x, c.y - q.y) < 30 && Math.abs(c.size - q.size) < 30)) continue;
    out.push(q);
  }
  return out;
}

function squaresFromLines(doc: CadDoc, b: Bounds): Candidate[] {
  const key = (a: number, c: number) => `${Math.round(a / 10)},${Math.round(c / 10)}`;
  type H = { x1: number; x2: number; y: number; layer: string };
  const hs: H[] = [];
  const vs = new Set<string>();
  for (const [layer, arr] of Object.entries(doc.segs)) {
    for (let i = 0; i < arr.length; i += 4) {
      const x1 = arr[i], y1 = arr[i + 1], x2 = arr[i + 2], y2 = arr[i + 3];
      if (!inB(b, x1, y1)) continue;
      const lx = Math.abs(x2 - x1), ly = Math.abs(y2 - y1);
      if (ly < 2 && lx >= 150 && lx <= 650) hs.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y: y1, layer });
      else if (lx < 2 && ly >= 150 && ly <= 650) vs.add(`${key(x1, Math.min(y1, y2))}|${Math.round(ly / 10)}`);
    }
  }
  const byX = new Map<string, H[]>();
  for (const h of hs) { const k = key(h.x1, h.x2); (byX.get(k) ?? byX.set(k, []).get(k)!).push(h); }
  const out: Candidate[] = [];
  for (const group of byX.values()) {
    group.sort((a, c) => a.y - c.y);
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], c = group[j];
      const w = a.x2 - a.x1, h = c.y - a.y;
      if (h < w * 0.75) continue;
      if (h > w * 1.33) break;
      const lh = Math.round(h / 10);
      const hasV = (x: number) => [-1, 0, 1].some((dl) => vs.has(`${key(x, a.y)}|${lh + dl}`));
      if (hasV(a.x1) && hasV(a.x2)) {
        out.push({ x: (a.x1 + a.x2) / 2, y: (a.y + c.y) / 2, size: (w + h) / 2, shape: 'square', layer: a.layer, colLayer: COLUMN_LAYER.test(a.layer) });
      }
    }
  }
  return out;
}

function pickPillars(cands: Candidate[], gx: number[], gy: number[], ox: number, oy: number, labelsX: string[], labelsY: string[]): Pillar[] {
  const pillars: Pillar[] = [];
  const used = new Set<Candidate>();
  const typical = (s: number) => s >= 200 && s <= 480;
  const reach = (c: Candidate) => Math.max(350, c.size * 0.9);
  for (let i = 0; i < gx.length; i++) for (let j = 0; j < gy.length; j++) {
    const near = cands
      .map((c) => ({ c, d: Math.hypot(c.x - gx[i], c.y - gy[j]) }))
      .filter(({ c, d }) => d <= reach(c));
    if (!near.length) continue;
    const score = ({ c, d }: { c: Candidate; d: number }) =>
      (c.colLayer ? 0.3 : 0) + (typical(c.size) ? 0.15 : 0) + (c.shape === 'round' ? 0.03 : 0) + 0.4 * (1 - d / reach(c));
    near.sort((a, b) => score(b) - score(a));
    let best = near[0];
    // 초석 테두리처럼 겹친 동심원이 있으면 가장 안쪽 원이 기둥이다.
    const inner = near.filter((n) => n.c.shape === best.c.shape && n.c.size >= 150 && Math.hypot(n.c.x - best.c.x, n.c.y - best.c.y) < 60);
    best = inner.reduce((a, b) => (b.c.size < a.c.size ? b : a), best);
    near.forEach((n) => used.add(n.c));
    const off = best.d;
    const conf = Math.min(0.99, 0.5 + (best.c.colLayer ? 0.25 : 0) + 0.2 * (1 - off / reach(best.c)) + (typical(best.c.size) ? 0.05 : 0));
    let review: string | undefined;
    if (off > 150) review = `격자 교차점에서 ${Math.round(off)}mm 벗어나 있습니다(편심 기둥). 도면 의도가 맞는지 확인해 주세요.`;
    else if (conf < 0.7) review = '기둥 레이어가 아니고 모양도 불확실합니다. 실제 기둥인지 확인해 주세요.';
    pillars.push({
      id: `${labelsX[i]}-${labelsY[j]}`,
      // 교차점에 가까우면 격자에 맞추고, 벗어난 기둥은 실제 위치를 유지한다.
      x: Math.round((off > 150 ? best.c.x : gx[i]) - ox), y: Math.round((off > 150 ? best.c.y : gy[j]) - oy),
      shape: best.c.shape, size: Math.round(best.c.size / 5) * 5,
      source: 'drawing', confidence: +conf.toFixed(2), review,
    });
  }
  // 격자에서 벗어난 기둥 레이어 도형(편심 기둥 등)
  const minX = Math.min(...gx), maxX = Math.max(...gx), minY = Math.min(...gy), maxY = Math.max(...gy);
  let k = 1;
  for (const c of cands) {
    if (used.has(c) || !c.colLayer) continue;
    if (c.x < minX - 300 || c.x > maxX + 300 || c.y < minY - 300 || c.y > maxY + 300) continue;
    if (pillars.some((p) => Math.hypot(p.x + ox - c.x, p.y + oy - c.y) < 300)) continue;
    pillars.push({
      id: `P-${k++}`, x: Math.round(c.x - ox), y: Math.round(c.y - oy), shape: c.shape, size: Math.round(c.size / 5) * 5,
      source: 'drawing', confidence: 0.5, review: '격자 교차점에서 벗어난 기둥입니다. 위치와 필요 여부를 확인해 주세요.',
    });
  }
  return pillars;
}

/* ───────────── 실(방) 이름 ───────────── */

const ROOM_RULES: [RegExp, RoomType][] = [
  [/대청|거실|마루/, 'maru'],
  [/욕실|화장실|다용도|보일러|세탁|전실|현관|창고/, 'wet'],
  [/주방|부엌|식당/, 'kitchen'],
  [/방|침실|서재/, 'ondol'],
];
const NOT_ROOM = /문|창|굴뚝|아궁이|놓는|곳|쌓기|가구|M\*|\d+M/i;

function recognizeRooms(doc: CadDoc, b: Bounds, ox: number, oy: number, gx: number[], gy: number[]): Room[] {
  const minX = Math.min(...gx), maxX = Math.max(...gx), minY = Math.min(...gy), maxY = Math.max(...gy);
  const rooms: Room[] = [];
  for (const t of doc.texts) {
    if (!inB(b, t.x, t.y) || t.x < minX || t.x > maxX || t.y < minY || t.y > maxY) continue;
    const s = norm(t.text).replace(/[()]/g, '');
    if (s.length > 10 || NOT_ROOM.test(s)) continue;
    const rule = ROOM_RULES.find(([re]) => re.test(s));
    if (!rule) continue;
    rooms.push({ id: `R${rooms.length + 1}`, name: s, type: rule[1], x: Math.round(t.x - ox), y: Math.round(t.y - oy) });
  }
  return rooms;
}

/* ───────────── 창호(외벽 개구부) ───────────── */

/** '2중문 한지 창호'는 문, '상부창(문4짝)'은 창: 먼저 나오는 글자를 따른다. */
function openingKind(s: string): OpeningKind {
  const iw = s.search(/창|WIN/i), id = s.search(/문|DOOR/i);
  return id >= 0 && (iw < 0 || id < iw) ? 'door' : 'window';
}

function recognizeOpenings(doc: CadDoc, b: Bounds, project: Project): Opening[] {
  const fp = computeFootprint(project);
  const ox = project.origin.x, oy = project.origin.y;
  const found = new Map<number, { kind: OpeningKind; label?: string }>();
  const edgeOf = (x: number, y: number, maxOff: number) => {
    let best = -1, bd = maxOff;
    fp.edges.forEach((e, k) => {
      const horiz = e.y1 === e.y2;
      const along = horiz ? x - e.x1 : y - e.y1, len = horiz ? e.x2 - e.x1 : e.y2 - e.y1;
      const off = horiz ? Math.abs(y - e.y1) : Math.abs(x - e.x1);
      if (along > -200 && along < len + 200 && off < bd) { bd = off; best = k; }
    });
    return best;
  };

  // 1) 창호 이름표: 외벽 가까이 있는 '창/문' 글자
  for (const t of doc.texts) {
    if (!inB(b, t.x, t.y)) continue;
    const s = norm(t.text);
    if (s.length > 18 || !/창|문|WIN|DOOR/i.test(s) || classifyLike(s)) continue;
    const k = edgeOf(t.x - ox, t.y - oy, 1300);
    if (k >= 0 && !found.has(k)) found.set(k, { kind: openingKind(s), label: s });
  }

  // 2) 이름표가 없는 칸: 창호 레이어(WIN, 창, 문…)에 벽과 나란한 짧은 선(창살·문짝)이 여럿 있으면 창호로 본다.
  //    레이어 이름이 숫자뿐인 도면은 벽선과 창살을 구분할 근거가 없어 이름표만 믿는다.
  fp.edges.forEach((e, k) => {
    if (found.has(k)) return;
    const horiz = e.y1 === e.y2;
    const len = horiz ? e.x2 - e.x1 : e.y2 - e.y1;
    let hits = 0;
    for (const [layer, arr] of Object.entries(doc.segs)) {
      if (!OPENING_LAYER.test(layer)) continue;
      for (let i = 0; i < arr.length; i += 4) {
        const x1 = arr[i] - ox, y1 = arr[i + 1] - oy, x2 = arr[i + 2] - ox, y2 = arr[i + 3] - oy;
        const parallel = horiz ? Math.abs(y1 - y2) < 5 : Math.abs(x1 - x2) < 5;
        if (!parallel) continue;
        const segLen = horiz ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
        const mid = horiz ? (x1 + x2) / 2 - e.x1 : (y1 + y2) / 2 - e.y1;
        const off = horiz ? Math.abs((y1 + y2) / 2 - e.y1) : Math.abs((x1 + x2) / 2 - e.x1);
        if (off < 220 && mid > 200 && mid < len - 200 && segLen >= 300 && segLen < len * 0.95) hits++;
      }
    }
    if (hits >= 4) found.set(k, { kind: 'window' });
  });

  return [...found.entries()].sort((a, c) => a[0] - c[0]).map(([k, v], n) => {
    const e = fp.edges[k];
    return { id: `O${n + 1}`, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, kind: v.kind, label: v.label, source: 'drawing' as const };
  });
}

/** 제목·표제란 글자는 창호 이름표로 쓰지 않는다. */
function classifyLike(s: string) { return /도$|축척|SCALE|도면/.test(s); }

/* ───────────── 높이(입면 치수 체인) ───────────── */

function heightsFromElevation(doc: CadDoc, sheets: Sheet[]): { gidan?: number; pillar?: number; roof?: number; sheet?: string } {
  const order: SheetKind[] = ['FRONT', 'REAR', 'RIGHT', 'LEFT', 'SECTION'];
  for (const kind of order) {
    for (const s of sheets.filter((q) => q.kind === kind)) {
      const iv = doc.dims
        .filter((d) => d.orient === 'v' && inB(s.bounds, d.lineX, d.lineY) && d.value > 20)
        .map((d) => [Math.min(d.ay, d.by), Math.max(d.ay, d.by)] as [number, number]);
      if (iv.length < 3) continue;
      const start = Math.min(...iv.map((v) => v[0]));
      const chain: number[] = [];
      let cur = start;
      for (let guard = 0; guard < 20; guard++) {
        const next = iv.filter((v) => Math.abs(v[0] - cur) < 25).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))[0];
        if (!next) break;
        chain.push(next[1] - next[0]);
        cur = next[1];
      }
      if (chain.length < 2) continue;
      let k = 0, gidan = 0;
      while (k < chain.length && chain[k] < 1200 && gidan + chain[k] <= 1500) gidan += chain[k++];
      const pillar = chain[k] >= 1800 && chain[k] <= 4500 ? chain[k] : undefined;
      if (pillar === undefined) continue;
      const roofParts = chain.slice(k + 1);
      const roof = roofParts.reduce((a, b) => a + b, 0);
      return { gidan: gidan >= 150 ? gidan : undefined, pillar, roof: roof >= 1200 && roof <= 7000 ? roof : undefined, sheet: s.title };
    }
  }
  return {};
}

/* ───────────── 처마 길이(지붕 평면도) ───────────── */

function eavesFromRoofPlan(doc: CadDoc, sheets: Sheet[]): number | undefined {
  const s = sheets.find((q) => q.kind === 'ROOF_PLAN');
  if (!s) return undefined;
  const g = gridFromLabels(doc, s.bounds);
  if (g.x.values.length < 2 || g.y.values.length < 2) return undefined;
  const gx0 = Math.min(...g.x.values), gx1 = Math.max(...g.x.values), gy0 = Math.min(...g.y.values), gy1 = Math.max(...g.y.values);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [layer, arr] of Object.entries(doc.segs)) {
    if (NON_GEOMETRY_LAYER.test(layer)) continue;
    for (let i = 0; i < arr.length; i += 2) {
      const x = arr[i], y = arr[i + 1];
      if (x < gx0 - 3500 || x > gx1 + 3500 || y < gy0 - 3500 || y > gy1 + 3500) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return undefined;
  const e = median([gx0 - minX, maxX - gx1, gy0 - minY, maxY - gy1]);
  return e >= 500 && e <= 2800 ? Math.round(e / 10) * 10 : undefined;
}

/* ───────────── 부재 표기(270X330 대량 등) ───────────── */

function memberCallouts(doc: CadDoc): MemberCallout[] {
  const out: MemberCallout[] = [];
  const seen = new Set<string>();
  for (const t of doc.texts) {
    const s = t.text.trim();
    let m = /(\d{2,3})\s*[xX×*]\s*(\d{2,3})\s*([가-힣][가-힣\s]{0,10})/.exec(s);
    if (m) {
      const name = norm(m[3]);
      if (!seen.has(name)) { seen.add(name); out.push({ name, w: +m[1], h: +m[2], text: s }); }
      continue;
    }
    m = /Ø\s*(\d{2,3})\s*([가-힣]{1,8})/.exec(s);
    if (m && !seen.has(m[2])) { seen.add(m[2]); out.push({ name: m[2], w: +m[1], h: +m[1], text: s }); }
  }
  return out;
}

/* ───────────── 진입점 ───────────── */

export function recognize(doc: CadDoc, sheets: Sheet[]): Recognition {
  const notes: string[] = [];
  let plan = sheets.find((s) => s.kind === 'PLAN') ?? null;
  if (!plan) {
    // 평면도 제목이 없으면 기둥 후보가 가장 많은 시트
    plan = [...sheets].sort((a, b) => pillarCandidates(doc, b.bounds).length - pillarCandidates(doc, a.bounds).length)[0] ?? null;
    if (plan) notes.push(`'평면도' 제목을 찾지 못해 '${plan.title}' 시트를 평면도로 사용했습니다.`);
  }
  const params: Params = { ...DEFAULT_PARAMS };
  const paramSource: Project['paramSource'] = {};
  const project: Project = {
    version: 3, id: `prj-${Date.now().toString(36)}`, name: doc.fileName.replace(/\.(dwg|dxf)$/i, ''),
    source: { fileName: doc.fileName, format: `${doc.format} · ${doc.version}`, sheetId: plan?.id },
    origin: { x: 0, y: 0 },
    grid: { xs: [], ys: [], labelsX: [], labelsY: [], source: 'drawing' },
    pillars: [], rooms: [], openings: [], params, baseline: { ...params }, paramSource, members: [],
    palette: defaultPalette(), recognitionNotes: notes, reviewed: false, damages: [],
  };
  if (!plan) {
    notes.push('도면에서 시트를 찾지 못했습니다.');
    return { project, planSheet: null, unitScaleApplied: 1 };
  }

  const b = plan.bounds;
  const cands = pillarCandidates(doc, b);
  let g = gridFromLabels(doc, b);
  if (g.x.values.length < 2 || g.y.values.length < 2) {
    const fb = gridFromCandidates(cands);
    if (fb.x.values.length >= 2 && fb.y.values.length >= 2) {
      g = fb;
      notes.push('주열 번호(X1, Y1…)가 없어 기둥 위치로 격자를 추정했습니다. 격자선을 확인해 주세요.');
    }
  }
  if (g.x.values.length < 2 || g.y.values.length < 2) {
    notes.push('평면도에서 격자(주열)와 기둥을 찾지 못했습니다. "기둥 추가" 도구로 직접 입력하거나 예제 프로젝트로 시작해 보세요.');
    return { project, planSheet: plan, unitScaleApplied: 1 };
  }

  const ox = g.x.values[0], oy = g.y.values[0];
  project.origin = { x: ox, y: oy };
  project.grid = {
    xs: g.x.values.map((v) => Math.round(v - ox)), ys: g.y.values.map((v) => Math.round(v - oy)),
    labelsX: g.x.labels, labelsY: g.y.labels, source: 'drawing',
  };
  notes.push(`격자: ${g.x.labels[0]}~${g.x.labels[g.x.labels.length - 1]} × ${g.y.labels[0]}~${g.y.labels[g.y.labels.length - 1]} (${g.x.source === 'labels' ? '주열 번호' : '기둥 위치'}에서 인식)`);

  project.pillars = pickPillars(cands, g.x.values, g.y.values, ox, oy, g.x.labels, g.y.labels);
  const nRound = project.pillars.filter((p) => p.shape === 'round').length;
  notes.push(`기둥 ${project.pillars.length}개 (원주 ${nRound}, 방주 ${project.pillars.length - nRound})`);

  const sizes = project.pillars.filter((p) => p.shape === 'round').map((p) => p.size);
  const allSizes = project.pillars.map((p) => p.size);
  const D = median(sizes.length >= 3 ? sizes : allSizes);
  if (D) { params.baseD = D; paramSource.baseD = { source: 'drawing', note: '인식한 기둥 지름의 중앙값' }; }

  project.rooms = recognizeRooms(doc, b, ox, oy, g.x.values, g.y.values);
  if (project.rooms.length) notes.push(`실 이름 ${project.rooms.length}개: ${project.rooms.map((r) => r.name).join(', ')}`);
  project.openings = recognizeOpenings(doc, b, project);
  if (project.openings.length) notes.push(`외벽 창호 ${project.openings.length}칸`);

  const h = heightsFromElevation(doc, sheets);
  if (h.gidan) { params.gidanHeight = Math.round(h.gidan); paramSource.gidanHeight = { source: 'drawing', note: `${h.sheet} 높이 치수` }; }
  if (h.pillar) { params.pillarHeight = Math.round(h.pillar); paramSource.pillarHeight = { source: 'drawing', note: `${h.sheet} 높이 치수` }; }
  if (h.roof) { params.roofHeight = Math.round(h.roof); paramSource.roofHeight = { source: 'drawing', note: `${h.sheet} 높이 치수` }; }
  if (h.pillar) notes.push(`높이: 기단 ${h.gidan ?? '-'} / 기둥 ${h.pillar} / 지붕 ${h.roof ?? '-'} mm (${h.sheet})`);
  else notes.push('입면도에서 높이 치수를 찾지 못해 기본 비례로 높이를 정했습니다.');

  const eaves = eavesFromRoofPlan(doc, sheets);
  if (eaves) { params.eaves = eaves; paramSource.eaves = { source: 'drawing', note: '지붕 평면도 외곽과 격자 차이' }; notes.push(`처마 내밀기 약 ${eaves} mm (지붕 평면도)`); }

  project.members = memberCallouts(doc);
  if (project.members.length) notes.push(`부재 표기 ${project.members.length}개: ${project.members.slice(0, 6).map((m) => `${m.name} ${m.w}×${m.h}`).join(', ')}`);

  const allText = doc.texts.map((t) => norm(t.text)).join('|');
  if (/7량가/.test(allText)) { params.ryangga = 7; paramSource.ryangga = { source: 'drawing', note: "'7량가' 표기" }; }
  else if (/5량가|종량|종보|중도리/.test(allText)) { params.ryangga = 5; paramSource.ryangga = { source: 'drawing', note: "'종량/중도리' 표기로 5량가 추정" }; }
  else if (/3량가/.test(allText)) { params.ryangga = 3; paramSource.ryangga = { source: 'drawing', note: "'3량가' 표기" }; }
  if (/맞배/.test(allText)) { params.roofType = 'matbae'; paramSource.roofType = { source: 'drawing', note: "'맞배' 표기" }; }
  else if (/우진각/.test(allText)) { params.roofType = 'ujingak'; paramSource.roofType = { source: 'drawing', note: "'우진각' 표기" }; }
  else if (/팔작|합각/.test(allText)) { params.roofType = 'paljak'; paramSource.roofType = { source: 'drawing', note: "'팔작/합각' 표기" }; }
  if (/이익공/.test(allText)) { params.gongpo = 'iikgong'; paramSource.gongpo = { source: 'drawing', note: "'이익공' 표기" }; }
  else if (/초익공|익공/.test(allText)) { params.gongpo = 'ikgong'; paramSource.gongpo = { source: 'drawing', note: "'익공' 표기" }; }
  else if (/주심포/.test(allText)) { params.gongpo = 'jusimpo'; paramSource.gongpo = { source: 'drawing', note: "'주심포' 표기" }; }

  const area = /건축\s*면적\s*[:：]?\s*([\d.,]+\s*(?:㎡|m2|M2)(?:\s*\([^)]*\))?)/.exec(doc.texts.map((t) => t.text).join('\n'));
  if (area) { project.source.area = area[1].replace(/\s+/g, ''); notes.push(`건축 면적 표기: ${project.source.area}`); }

  project.baseline = { ...params };
  return { project, planSheet: plan, unitScaleApplied: 1 };
}

/** 격자 간격으로 도면 단위를 추정해 mm 배율을 돌려준다(이미 mm면 1). */
export function guessUnitScale(doc: CadDoc, sheets: Sheet[]): number {
  const plan = sheets.find((s) => s.kind === 'PLAN') ?? sheets[0];
  if (!plan) return 1;
  const g = gridFromLabels(doc, plan.bounds);
  const vals = g.x.values.length >= 2 ? g.x.values : g.y.values;
  if (vals.length < 2) return 1;
  const gaps = vals.slice(1).map((v, i) => Math.abs(v - vals[i]));
  const s = median(gaps);
  if (s >= 1000 && s <= 12000) return 1;
  if (s >= 100 && s < 1000) return 10;   // cm
  if (s >= 0.8 && s <= 12) return 1000;  // m
  return 1;
}
