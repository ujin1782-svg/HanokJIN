// ASCII DXF 파서 (R12 ~ 2018). 결과는 DWG와 같은 RawDrawing 형식이다.
// 각도는 DXF(도) → 라디안으로, LWPOLYLINE 닫힘 플래그는 LibreDWG 규약(512)으로 바꾼다.

import type { RawDrawing, RawEntity, RawBlock, P } from './raw';

const D2R = Math.PI / 180;

function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1] ?? 'AC1009';
  if (ver >= 'AC1021') return new TextDecoder('utf-8').decode(bytes);
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head)?.[1]?.toUpperCase() ?? '';
  const label = cp.includes('949') || cp.includes('KOR') ? 'euc-kr' : cp.includes('932') ? 'shift_jis' : cp.includes('936') ? 'gbk' : cp.includes('950') ? 'big5' : '';
  if (label) return new TextDecoder(label).decode(bytes);
  // 코드페이지 표기가 없으면 UTF-8로 시도하고, 깨지면 EUC-KR로 해석한다.
  const utf = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return utf.includes('�') ? new TextDecoder('euc-kr').decode(bytes) : utf;
}

interface Pair { c: number; v: string }

function* pairs(text: string): Generator<Pair> {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(c)) throw new Error(`DXF ${i + 1}번째 줄의 그룹 코드를 읽을 수 없습니다.`);
    yield { c, v: lines[i + 1] };
  }
}

/** 0 그룹 코드 단위로 묶은 레코드 */
type Rec = { type: string; codes: Pair[] };

function records(text: string): Rec[] {
  const out: Rec[] = [];
  let cur: Rec | null = null;
  for (const p of pairs(text)) {
    if (p.c === 0) { cur = { type: p.v.trim(), codes: [] }; out.push(cur); }
    else if (cur) cur.codes.push(p);
  }
  return out;
}

const num = (codes: Pair[], c: number, d = 0) => {
  const p = codes.find((x) => x.c === c);
  return p ? parseFloat(p.v) : d;
};
const unescape = (s: string) => s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
const str = (codes: Pair[], c: number, d = '') => {
  const v = codes.find((x) => x.c === c)?.v.trim();
  return v === undefined ? d : c === 2 || c === 8 ? unescape(v) : v;
};
const pt = (codes: Pair[], cx: number): P => ({ x: num(codes, cx), y: num(codes, cx + 10), z: num(codes, cx + 20) });

function toEntity(r: Rec): RawEntity | null {
  const c = r.codes;
  const base: RawEntity = { type: r.type, layer: str(c, 8, '0'), colorIndex: num(c, 62, 256) };
  switch (r.type) {
    case 'LINE': return { ...base, startPoint: pt(c, 10), endPoint: pt(c, 11) };
    case 'CIRCLE': return { ...base, center: pt(c, 10), radius: num(c, 40) };
    case 'ARC': return { ...base, center: pt(c, 10), radius: num(c, 40), startAngle: num(c, 50) * D2R, endAngle: num(c, 51) * D2R };
    case 'ELLIPSE': return { ...base, center: pt(c, 10), majorAxisEndPoint: pt(c, 11), axisRatio: num(c, 40, 1), startAngle: num(c, 41, 0), endAngle: num(c, 42, Math.PI * 2) };
    case 'LWPOLYLINE': {
      const vertices: { x: number; y: number; bulge: number }[] = [];
      for (const p of c) {
        if (p.c === 10) vertices.push({ x: parseFloat(p.v), y: 0, bulge: 0 });
        else if (p.c === 20 && vertices.length) vertices[vertices.length - 1].y = parseFloat(p.v);
        else if (p.c === 42 && vertices.length) vertices[vertices.length - 1].bulge = parseFloat(p.v);
      }
      return { ...base, vertices, flag: (num(c, 70) & 1) ? 512 : 0 };
    }
    case 'SPLINE': {
      const cps: P[] = [], fps: P[] = [];
      let target: P[] | null = null;
      for (const p of c) {
        if (p.c === 10) { target = cps; cps.push({ x: parseFloat(p.v), y: 0 }); }
        else if (p.c === 11) { target = fps; fps.push({ x: parseFloat(p.v), y: 0 }); }
        else if ((p.c === 20 || p.c === 21) && target?.length) target[target.length - 1].y = parseFloat(p.v);
      }
      return { ...base, controlPoints: cps, fitPoints: fps };
    }
    case 'TEXT': case 'ATTRIB':
      return { ...base, text: str(c, 1), startPoint: pt(c, 10), endPoint: pt(c, 11), textHeight: num(c, 40, 2.5), rotation: num(c, 50) * D2R, halign: num(c, 72), valign: num(c, 73) };
    case 'MTEXT': {
      const text = c.filter((p) => p.c === 3).map((p) => p.v).join('') + str(c, 1);
      const dir = c.some((p) => p.c === 11) ? pt(c, 11) : undefined;
      return { ...base, text, insertionPoint: pt(c, 10), textHeight: num(c, 40, 2.5), attachmentPoint: num(c, 71, 1), rotation: num(c, 50) * D2R, direction: dir };
    }
    case 'INSERT':
      return { ...base, name: str(c, 2), insertionPoint: pt(c, 10), xScale: num(c, 41, 1), yScale: num(c, 42, 1), rotation: num(c, 50) * D2R };
    case 'DIMENSION':
      return { ...base, name: str(c, 2), definitionPoint: pt(c, 10), subDefinitionPoint1: pt(c, 13), subDefinitionPoint2: pt(c, 14), measurement: num(c, 42, 0) };
    case 'SOLID': case 'TRACE': case '3DFACE':
      return { ...base, corner1: pt(c, 10), corner2: pt(c, 11), corner3: pt(c, 12), corner4: pt(c, 13) };
    default:
      return base;
  }
}

export function readDxf(buffer: ArrayBuffer): RawDrawing {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 22)).startsWith('AutoCAD Binary DXF')) {
    throw new Error('바이너리 DXF는 지원하지 않습니다. CAD에서 ASCII DXF로 다시 저장해 주세요.');
  }
  const recs = records(decode(bytes));

  let version = 'AC1009', insUnits = 0;
  const layers: RawDrawing['layers'] = [];
  const blocks = new Map<string, RawBlock>();
  const entities: RawEntity[] = [];

  let section = '';
  let table = '';
  let block: RawBlock | null = null;
  let polyline: RawEntity | null = null;
  let insertOwner: RawEntity | null = null;

  const emit = (e: RawEntity) => (block ? block.entities : entities).push(e);

  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === 'SECTION') { section = str(r.codes, 2); continue; }
    if (r.type === 'ENDSEC') { section = ''; continue; }
    if (r.type === 'EOF') break;

    // HEADER 변수는 0 코드가 없어 SECTION 레코드에 모두 붙어 있다(아래에서 따로 읽음).
    if (section === 'HEADER') continue;
    if (section === 'TABLES') {
      if (r.type === 'TABLE') { table = str(r.codes, 2); continue; }
      if (r.type === 'ENDTAB') { table = ''; continue; }
      if (table === 'LAYER' && r.type === 'LAYER') {
        const color = num(r.codes, 62, 7);
        const flags = num(r.codes, 70, 0);
        layers.push({ name: str(r.codes, 2), colorIndex: Math.abs(color), off: color < 0, frozen: (flags & 1) === 1 });
      }
      continue;
    }
    if (section !== 'BLOCKS' && section !== 'ENTITIES') continue;

    if (r.type === 'BLOCK') {
      block = { name: str(r.codes, 2), basePoint: pt(r.codes, 10), entities: [] };
      continue;
    }
    if (r.type === 'ENDBLK') {
      if (block && !/^\*(MODEL|PAPER)_SPACE/i.test(block.name)) blocks.set(block.name, block);
      block = null;
      continue;
    }
    if (r.type === 'POLYLINE') {
      polyline = { type: 'POLYLINE', layer: str(r.codes, 8, '0'), flag: num(r.codes, 70), vertices: [] };
      continue;
    }
    if (r.type === 'VERTEX' && polyline) {
      polyline.vertices!.push({ x: num(r.codes, 10), y: num(r.codes, 20), bulge: num(r.codes, 42) });
      continue;
    }
    if (r.type === 'SEQEND') {
      if (polyline) { emit(polyline); polyline = null; }
      insertOwner = null;
      continue;
    }
    const e = toEntity(r);
    if (!e) continue;
    if (e.type === 'ATTRIB' && insertOwner) { (insertOwner.attribs ??= []).push(e); continue; }
    emit(e);
    insertOwner = e.type === 'INSERT' && num(r.codes, 66) === 1 ? e : null;
  }

  // HEADER 변수는 SECTION 레코드 안에 9 코드로 들어 있다.
  const header = recs.find((r) => r.type === 'SECTION' && str(r.codes, 2) === 'HEADER');
  if (header) {
    for (let k = 0; k < header.codes.length; k++) {
      const p = header.codes[k];
      if (p.c !== 9) continue;
      const next = header.codes[k + 1];
      if (p.v.trim() === '$ACADVER' && next) version = next.v.trim();
      if (p.v.trim() === '$INSUNITS' && next) insUnits = parseInt(next.v, 10) || 0;
    }
  }

  return { format: 'DXF', version: `DXF ${version}`, insUnits, layers, blocks, entities };
}
