// 2D 평면 DXF(R12 ASCII) 내보내기: 인식·보정한 격자, 기둥, 외벽, 창호, 실 이름.
// 한글은 AutoCAD가 읽는 \U+XXXX 형식으로 적는다.

import type { Project } from '../core/types';
import { drawingFromProject } from '../model/plan-drawing';

const ACI: Record<string, number> = { CEN: 1, WALL: 7, WIN: 4, DOOR: 2, COL: 3, 주열마크: 7, 주열번호: 6, ROOM: 7, TIT: 7 };

function esc(s: string) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c < 128 ? ch : `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

export function exportDxf(p: Project): string {
  const doc = drawingFromProject(p, `${p.name} 평면도`);
  const out: string[] = [];
  const g = (code: number, v: string | number) => out.push(String(code), typeof v === 'number' ? fmt(v) : v);
  const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString();

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 4);
  g(9, '$EXTMIN'); g(10, doc.extents.minX); g(20, doc.extents.minY);
  g(9, '$EXTMAX'); g(10, doc.extents.maxX); g(20, doc.extents.maxY);
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, doc.layers.length);
  for (const l of doc.layers) {
    g(0, 'LAYER'); g(2, esc(l.name)); g(70, 0); g(62, ACI[l.name] ?? 7); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const [layer, arr] of Object.entries(doc.segs)) {
    if (layer === 'COL') continue;   // 사각 기둥 테두리는 아래에서 폴리라인으로 쓴다
    for (let i = 0; i < arr.length; i += 4) {
      g(0, 'LINE'); g(8, esc(layer)); g(10, arr[i]); g(20, arr[i + 1]); g(30, 0); g(11, arr[i + 2]); g(21, arr[i + 3]); g(31, 0);
    }
  }
  for (const c of doc.circles) { g(0, 'CIRCLE'); g(8, esc(c.layer)); g(10, c.x); g(20, c.y); g(30, 0); g(40, c.r); }
  // 사각 기둥은 닫힌 폴리라인으로(CAD에서 하나의 객체로 선택되게)
  for (const pl of doc.polys) {
    g(0, 'POLYLINE'); g(8, esc(pl.layer)); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, 1);
    for (let i = 0; i < pl.pts.length; i += 2) { g(0, 'VERTEX'); g(8, esc(pl.layer)); g(10, pl.pts[i]); g(20, pl.pts[i + 1]); g(30, 0); }
    g(0, 'SEQEND'); g(8, esc(pl.layer));
  }
  for (const t of doc.texts) {
    g(0, 'TEXT'); g(8, esc(t.layer)); g(10, t.x); g(20, t.y); g(30, 0); g(40, t.h); g(1, esc(t.text));
    if (t.align !== 'left') { g(72, t.align === 'center' ? 1 : 2); g(11, t.x); g(21, t.y); g(31, 0); }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
