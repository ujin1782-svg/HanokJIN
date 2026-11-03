import { describe, expect, it } from 'vitest';
import { exportDxf } from '../src/export/dxf';
import { readDxf } from '../src/cad/dxf-reader';
import { normalize } from '../src/cad/normalize';
import { segmentSheets } from '../src/cad/sheets';
import { recognize } from '../src/cad/recognize';
import { computeFootprint } from '../src/model/footprint';
import { DEMOS, makeDemo } from '../src/samples';

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('DXF 내보내기 → 다시 읽기 → 인식', () => {
  for (const d of DEMOS) {
    it(`${d.name}: 격자·기둥·평면 형태가 그대로 돌아온다`, () => {
      const { project } = makeDemo(d.id);
      const dxf = exportDxf(project);
      const doc = normalize(readDxf(enc(dxf)), 'roundtrip.dxf');
      const sheets = segmentSheets(doc);
      expect(sheets[0].kind).toBe('PLAN');
      const r = recognize(doc, sheets).project;
      expect(r.grid.xs).toEqual(project.grid.xs);
      expect(r.grid.ys).toEqual(project.grid.ys);
      expect(r.pillars.length).toBe(project.pillars.length);
      expect(computeFootprint(r).shape).toBe(computeFootprint(project).shape);
      expect(r.rooms.map((x) => x.name)).toEqual(expect.arrayContaining([...new Set(project.rooms.map((x) => x.name))]));
    });
  }

  it('한글 \\U+ 이스케이프와 CP949 DXF를 읽는다', () => {
    const body = ['0', 'SECTION', '2', 'ENTITIES', '0', 'TEXT', '8', '0', '10', '0', '20', '0', '40', '300', '1', '\\U+B300\\U+CCAD', '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
    const doc = normalize(readDxf(enc(body)), 't.dxf');
    expect(doc.texts[0].text).toBe('대청');
    // EUC-KR 바이트로 된 '안방'
    const head = enc('0\nSECTION\n2\nHEADER\n9\n$DWGCODEPAGE\n3\nANSI_949\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\n0\n10\n0\n20\n0\n40\n300\n1\n');
    const tail = enc('\n0\nENDSEC\n0\nEOF\n');
    const bytes = new Uint8Array([...new Uint8Array(head), 0xbe, 0xc8, 0xb9, 0xe6, ...new Uint8Array(tail)]);
    expect(normalize(readDxf(bytes.buffer), 'k.dxf').texts[0].text).toBe('안방');
  });

  it('낱개 LINE 4개로 그린 사각 기둥도 찾는다', () => {
    const line = (x1: number, y1: number, x2: number, y2: number) => ['0', 'LINE', '8', 'A', '10', x1, '20', y1, '11', x2, '21', y2].join('\n');
    const sq = (cx: number, cy: number) => [line(cx - 120, cy - 120, cx + 120, cy - 120), line(cx + 120, cy - 120, cx + 120, cy + 120), line(cx + 120, cy + 120, cx - 120, cy + 120), line(cx - 120, cy + 120, cx - 120, cy - 120)];
    const ents = [sq(0, 0), sq(3000, 0), sq(0, 2400), sq(3000, 2400)].flat();
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', ...ents, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
    const doc = normalize(readDxf(enc(dxf)), 'lines.dxf');
    const r = recognize(doc, segmentSheets(doc)).project;
    expect(r.grid.xs).toEqual([0, 3000]);
    expect(r.grid.ys).toEqual([0, 2400]);
    expect(r.pillars.map((p) => p.shape)).toEqual(['square', 'square', 'square', 'square']);
    expect(r.pillars[0].size).toBe(240);
  });

  it('바이너리 DXF는 이유와 함께 거절한다', () => {
    expect(() => readDxf(enc('AutoCAD Binary DXF\r\n\x1a\x00'))).toThrow(/ASCII DXF/);
  });
});
