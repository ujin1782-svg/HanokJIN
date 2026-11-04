import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildHanok } from '../src/model/hanok';
import { createMaterials } from '../src/model/materials';
import { validate } from '../src/model/validate';
import { exportIfc, stepString } from '../src/export/ifc';
import { bomCsv } from '../src/export/files';
import { DEMOS, makeDemo } from '../src/samples';
import type { RoofType } from '../src/core/types';

const mats = createMaterials();

describe('3D 모델 생성', () => {
  for (const d of DEMOS) {
    for (const roofType of ['paljak', 'ujingak', 'matbae'] as RoofType[]) {
      it(`${d.name} / ${roofType}: 유한한 형상과 물량을 만든다`, () => {
        const { project } = makeDemo(d.id);
        project.params.roofType = roofType;
        const b = buildHanok(project, mats);
        const size = b.bounds.getSize(new THREE.Vector3());
        expect(Number.isFinite(size.x + size.y + size.z)).toBe(true);
        // 높이 = 기단 + 기둥 + 지붕(±망와)
        const expected = (project.params.gidanHeight + project.params.pillarHeight + project.params.roofHeight) / 1000;
        expect(size.y).toBeGreaterThan(expected - 0.3);
        expect(size.y).toBeLessThan(expected + 0.5);
        let bad = 0;
        b.root.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const a = o.geometry.getAttribute('position').array as ArrayLike<number>;
            for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) bad++;
          }
        });
        expect(bad).toBe(0);
        const pillars = b.bom.filter((r) => r.category === '기둥').reduce((s, r) => s + r.count, 0);
        expect(pillars).toBe(project.pillars.length);
        expect(b.bom.find((r) => r.key === 'tile-am')?.estimated).toBe(true);
        expect(b.metrics.roofAreaM2).toBeGreaterThan(0);
      });
    }
  }

  it('기둥을 겹치게 놓으면 구조 간섭으로 판정한다', () => {
    const { project } = makeDemo('demo-5kan');
    project.pillars.push({ ...project.pillars[0], id: 'DUP', x: project.pillars[0].x + 100 });
    const res = validate(project, buildHanok(project, mats));
    expect(res.some((r) => r.status === 'fail' && r.id.startsWith('clash'))).toBe(true);
  });

  it('IFC에 기둥 수만큼 IfcColumn이 형상과 함께 들어간다', () => {
    const { project } = makeDemo('demo-giyeok');
    const b = buildHanok(project, mats);
    const ifc = exportIfc(project, b, true);
    expect(ifc.startsWith('ISO-10303-21;')).toBe(true);
    expect(ifc).toContain("FILE_SCHEMA(('IFC4'));");
    expect((ifc.match(/=IFCCOLUMN\(/g) ?? []).length).toBeGreaterThanOrEqual(project.pillars.length);
    expect((ifc.match(/=IFCTRIANGULATEDFACESET\(/g) ?? []).length).toBeGreaterThan(100);
    // GUID 등 따옴표 문자열은 무작위라 'NaN'이 우연히 섞일 수 있으므로 수치 부분만 검사한다.
    expect(ifc.replace(/'[^']*'/g, "''")).not.toMatch(/NaN|Infinity/);
    expect(stepString("대청's")).toBe("'\\X2\\B300CCAD\\X0\\''s'");
  });

  it('BOM CSV는 엑셀용 BOM과 추정 표시를 포함한다', () => {
    const { project } = makeDemo('demo-matbae');
    const csv = bomCsv(buildHanok(project, mats).bom);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"추정"');
  });
});
