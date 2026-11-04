import { describe, expect, it } from 'vitest';
import type { DamageRecord } from '../src/core/types';
import { CLASSES, TERMS, TOTAL_MENTIONS, correctTerm, draftStatement, josa } from '../src/damage/taxonomy';
import { blankDamage, pillarGridName, pillarSeverity, summarize, targetLabel } from '../src/damage/records';
import { cocoJson, datasetEntries, surveyCsv, vlmJsonl, yoloLabel } from '../src/damage/dataset';
import { crc32, makeZip } from '../src/export/zip';
import { makeDemo } from './fixtures/demo-projects';

describe('손상 용어 체계', () => {
  it('논문 표 6의 81개 표기·8,010회 언급을 담는다', () => {
    expect(TERMS).toHaveLength(81);
    expect(TOTAL_MENTIONS).toBe(8010);
    expect(CLASSES.map((c) => c.id)).toEqual([...Array(14).keys()]);
  });

  it('보고서 표기를 표준 용어로 교정한다', () => {
    expect(correctTerm('기둥 할열')).toMatchObject({ cls: 0, issue: 'notation' });
    expect(correctTerm('기둥 기울음')).toMatchObject({ cls: 7, issue: 'grammar' });
    expect(correctTerm('기둥 기울어짐')).toMatchObject({ cls: 7, issue: 'grammar' });
    expect(correctTerm('판벽 부식')).toMatchObject({ cls: 11, issue: 'meaning' });
    expect(correctTerm('기둥 썩음')).toMatchObject({ cls: 11, issue: 'synonym' });
    expect(correctTerm('창방 쪼개짐')).toMatchObject({ cls: 2, issue: 'synonym' });
    expect(correctTerm('기둥 할렬')).toMatchObject({ cls: 0, issue: 'ok' });
  });

  it('균열은 미장부면 균열, 목부재면 갈램으로 나눈다', () => {
    expect(correctTerm('기둥 균열', '기둥 X1-Y1')).toMatchObject({ cls: 3, issue: 'synonym' });
    expect(correctTerm('화방벽 균열')).toMatchObject({ cls: 4, issue: 'ok' });
    expect(correctTerm('균열', '동측 회벽')).toMatchObject({ cls: 4, issue: 'ok' });
  });

  it('철물의 부식은 그대로 두고, 긴 표기를 먼저 찾는다', () => {
    const c = correctTerm('광두정 부식');
    expect(c.cls).toBeUndefined();
    expect(c.issue).toBe('ok');
    expect(correctTerm('누수흔 확인').entry?.term).toBe('누수흔(적)');
    expect(correctTerm('손상').issue).toBe('generic');
    expect(correctTerm('알 수 없는 현상').entry).toBeUndefined();
  });

  it('받침에 맞게 조사를 고르고 조사내용 문구를 만든다', () => {
    expect(josa('할렬(Check)', '이', '가')).toBe('이');
    expect(josa('처짐', '이', '가')).toBe('이');
    expect(josa('기욺', '이', '가')).toBe('이');
    expect(josa('부후(Decay)', '이', '가')).toBe('가');
    const s = draftStatement(0, '기둥 X2-Y1', '정면 하부', 'moderate');
    expect(s).toBe('기둥 X2-Y1 정면 하부에서 목재 건조수축에 의해 섬유 방향과 평행하게 발달한 할렬(Check)이 확인되므로 진행 여부에 대한 정기적인 모니터링이 필요함.');
    expect(draftStatement(7, '기둥 X1-Y1', '', 'severe')).toMatch(/계측 병기를 권장함\.$/);
  });
});

function sample(): { p: ReturnType<typeof makeDemo>['project']; recs: DamageRecord[] } {
  const { project: p } = makeDemo('demo-5kan');
  const a: DamageRecord = { ...blankDamage(p, { kind: 'pillar', id: p.pillars[0].id }), cls: 0, rawTerm: '기둥 할열', severity: 'moderate', status: 'verified',
    photo: { id: 'ph-a', name: 'a.jpg', w: 1000, h: 500 }, boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, cls: 0 }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2, cls: 11 }] };
  p.damages.push(a);
  const b: DamageRecord = { ...blankDamage(p, { kind: 'part', name: '창방' }), cls: 11, severity: 'severe' };
  p.damages.push(b);
  return { p, recs: p.damages };
}

describe('손상 기록', () => {
  it('기둥을 주열 번호로 부르고 가장 심한 정도를 모은다', () => {
    const { p } = sample();
    const pl = p.pillars[0];
    expect(pillarGridName(p, pl)).toMatch(/^X\d+-Y\d+$/);
    expect(targetLabel(p, { kind: 'pillar', id: pl.id })).toBe(`기둥 ${pillarGridName(p, pl)}`);
    expect(p.damages.map((d) => d.id)).toEqual(['D001', 'D002']);
    expect(pillarSeverity(p).get(pl.id)).toBe('moderate');
    const s = summarize(p.damages);
    expect(s).toMatchObject({ total: 2, verified: 1, withPhoto: 1, boxes: 2 });
  });
});

describe('손상 데이터 내보내기', () => {
  it('YOLO 라벨은 중심 좌표와 크기(0~1)다', () => {
    const { recs } = sample();
    expect(yoloLabel(recs[0]).trim().split('\n')).toEqual(['0 0.250000 0.400000 0.300000 0.400000', '11 0.600000 0.600000 0.200000 0.200000']);
  });

  it('COCO bbox는 픽셀 단위이고 사진 있는 기록만 담는다', () => {
    const { p, recs } = sample();
    const c = cocoJson(p, recs);
    expect(c.images).toHaveLength(1);
    expect(c.images[0]).toMatchObject({ file_name: 'images/D001.jpg', width: 1000, height: 500 });
    expect(c.annotations[0]).toMatchObject({ image_id: 1, category_id: 1, bbox: [100, 100, 300, 200] });
    expect(c.categories).toHaveLength(14);
  });

  it('VLM JSONL과 조사표를 만든다', () => {
    const { p, recs } = sample();
    const lines = vlmJsonl(p, recs).trim().split('\n');
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]);
    const answer = JSON.parse(row.messages[2].content);
    expect(answer.standard_damage_term).toBe('할렬 (Check)');
    expect(answer.corrected_from).toBe('기둥 할열');
    const csv = surveyCsv(p);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"표기 혼용"');
    expect(csv.trim().split('\r\n')).toHaveLength(3);
  });

  it('ZIP을 표준 형식으로 묶는다', () => {
    const { p, recs } = sample();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const entries = datasetEntries(p, recs, new Map([['ph-a', jpeg]]));
    expect(entries.map((e) => e.name)).toEqual(['images/D001.jpg', 'labels/D001.txt', 'data.yaml', 'classes.txt', 'annotations_coco.json', 'vlm_finetune.jsonl', 'survey.csv', 'README.txt']);
    const zip = makeZip(entries);
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(entries.length);
    // 첫 항목(사진)을 다시 읽어 CRC와 내용 확인
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const nameLen = view.getUint16(26, true);
    const size = view.getUint32(18, true);
    const data = zip.slice(30 + nameLen, 30 + nameLen + size);
    expect([...data]).toEqual([...jpeg]);
    expect(view.getUint32(14, true)).toBe(crc32(jpeg));
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLen))).toBe('images/D001.jpg');
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
