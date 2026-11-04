// 실제 DWG(담양 32평 ㄱ자형 단독주택)로 인식 결과를 검증한다.
// 고객 도면이라 저장소에 넣지 않는다. HANOK_TEST_DWG 환경변수로 경로를 주면 실행된다.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCadFile, type ParseResult } from '../src/cad/pipeline';
import { computeFootprint } from '../src/model/footprint';

const path = process.env.HANOK_TEST_DWG ?? '';
const run = path && existsSync(path) ? describe : describe.skip;
const wasmDir = resolve(__dirname, '../node_modules/@mlightcad/libredwg-web/wasm');

run('담양 ㄱ자형 DWG', () => {
  let r: ParseResult;
  it('DWG를 읽고 시트 8장을 분류한다', async () => {
    const buf = readFileSync(path);
    r = await parseCadFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'damyang.dwg', wasmDir);
    console.log('sheets', r.sheets.map((s) => `${s.kind}:${s.title}`), r.ms + 'ms');
    console.log(r.recognition.project.recognitionNotes.join('\n'));
    expect(r.doc.version).toContain('AC1014');
    const kinds = r.sheets.map((s) => s.kind).sort();
    expect(kinds).toEqual(['CEILING', 'FRONT', 'LEFT', 'PLAN', 'REAR', 'RIGHT', 'ROOF_PLAN', 'SECTION'].sort());
  });

  it('주열 격자를 도면 치수대로 찾는다', () => {
    const g = r.recognition.project.grid;
    expect(g.xs).toEqual([0, 4200, 6900, 9600, 13200]);
    expect(g.ys).toEqual([0, 3600, 6600, 9600, 12600]);
  });

  it('기둥을 찾고 ㄱ자형 두 채로 나눈다', () => {
    const p = r.recognition.project;
    console.log(p.pillars.map((q) => `${q.id}:${q.shape}${q.size}@${q.confidence}`).join(' '));
    expect(p.pillars.length).toBeGreaterThanOrEqual(15);
    const fp = computeFootprint(p);
    console.log('wings', fp.wings, 'edges', fp.edges.length, 'openings', p.openings.length);
    expect(fp.shape).toBe('ㄱ자형');
    expect(fp.wings[0]).toMatchObject({ x1: 0, x2: 13200, y1: 6600, y2: 12600, axis: 'x' });
    expect(fp.wings[1]).toMatchObject({ x1: 0, x2: 4200, y1: 0, y2: 6600, axis: 'y' });
  });

  it('높이와 부재 표기를 도면에서 읽는다', () => {
    const p = r.recognition.project;
    console.log(p.params, p.paramSource, p.members, p.rooms);
    expect(p.params.gidanHeight).toBe(550);
    expect(p.params.pillarHeight).toBe(2550);
    expect(p.members.find((m) => m.name === '대량')).toMatchObject({ w: 270, h: 330 });
    expect(p.rooms.map((x) => x.name)).toEqual(expect.arrayContaining(['안방', '거실', '손님방']));
  });
});
