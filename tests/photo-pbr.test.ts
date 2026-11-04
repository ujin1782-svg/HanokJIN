import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildProjectFromFourViews,
  createDefaultGuide,
  createInitialSlots,
  FACE_META,
  type FaceKey,
} from '../src/photo/photo-modeler';
import { buildHanok } from '../src/model/hanok';
import { applyPalette, createMaterials } from '../src/model/materials';
import { MATERIAL_SURFACE, PALETTES, resolvePalette } from '../src/model/palettes';
import { validate } from '../src/model/validate';
import { exportIfc } from '../src/export/ifc';
import { exportDxf } from '../src/export/dxf';
import { bomCsv } from '../src/export/files';

const mats = createMaterials();

describe('4면 [전·후·좌·우] 지정 프레임 촬영 기반 3D 모델 생성 및 PBR 재질 검증', () => {
  it('전·후·좌·우 4개 방향 메타데이터와 초기 슬롯을 올바르게 생성한다', () => {
    const slots = createInitialSlots();
    expect(FACE_META.map((m) => m.key)).toEqual(['front', 'rear', 'left', 'right']);
    expect(FACE_META.map((m) => m.dir)).toEqual(['S', 'N', 'W', 'E']);
    for (const k of ['front', 'rear', 'left', 'right'] as FaceKey[]) {
      const g = slots[k].guide;
      expect(g.ridgeY).toBeLessThan(g.eaveY);
      expect(g.eaveY).toBeLessThan(g.gidanY);
      expect(g.gidanY).toBeLessThan(g.groundY);
      expect(g.leftX).toBeLessThan(g.rightX);
    }
  });

  it('4면 프레임 설정(정면 5칸 × 측면 2칸 팔작 한옥)에서 Project·CadDoc·3D 형상·BOM·IFC를 생성한다', () => {
    const slots = createInitialSlots();
    slots.front.guide.bays = 5;
    slots.front.guide.bayTypes = ['window', 'door', 'door', 'door', 'window'];
    slots.rear.guide.bays = 5;
    slots.rear.guide.bayTypes = ['window', 'wall', 'window', 'wall', 'window'];
    slots.left.guide.bays = 2;
    slots.left.guide.bayTypes = ['wall', 'window'];
    slots.right.guide.bays = 2;
    slots.right.guide.bayTypes = ['window', 'wall'];

    slots.front.sampledColors = { roof: '#424850', wall: '#f2ece0', pillar: '#b98453', stone: '#c5beb0' };

    const { project, doc, sheets } = buildProjectFromFourViews(slots, {
      projectName: '4면 촬영 5칸 한옥 테스트',
      refSpanMm: 13800,
      roofType: 'paljak',
      useExtractedColors: true,
      roundFrontPillars: true,
    });

    expect(project.grid.xs.length).toBe(6); // 5칸 = 주열 6개
    expect(project.grid.ys.length).toBe(3); // 2칸 = 주열 3개
    expect(project.grid.xs[project.grid.xs.length - 1]).toBe(13800);
    expect(project.pillars.length).toBe(18);
    expect(project.openings.some((o) => o.kind === 'door')).toBe(true);
    expect(project.openings.some((o) => o.kind === 'window')).toBe(true);
    expect(project.palette.custom.roof).toBe('#424850');
    expect(sheets[0].kind).toBe('PLAN');
    expect(doc.stats.entities).toBeGreaterThan(10);

    // 3D 모델 빌드 및 검증
    applyPalette(mats, project.palette, project.params.lattice);
    const b = buildHanok(project, mats);
    const size = b.bounds.getSize(new THREE.Vector3());
    expect(Number.isFinite(size.x + size.y + size.z)).toBe(true);
    expect(b.metrics.roofAreaM2).toBeGreaterThan(50);

    const checks = validate(project, b);
    expect(checks.some((c) => c.status === 'fail')).toBe(false);

    // 내보내기(IFC, DXF, CSV) 호환 검증
    const ifc = exportIfc(project, b, true);
    expect(ifc).toContain("FILE_SCHEMA(('IFC4'));");
    const dxf = exportDxf(project);
    expect(dxf).toContain('EOF');
    const csv = bomCsv(b.bom);
    expect(csv).toContain('기둥');
  });

  it('4면 프레임 기준선 비율 변화에 따라 기단·기둥·지붕 높이가 비례하여 산출된다', () => {
    const slotsLow = createInitialSlots();
    const slotsTall = createInitialSlots();
    for (const k of ['front', 'rear'] as FaceKey[]) {
      slotsLow[k].guide = { ...createDefaultGuide(k), ridgeY: 0.28, eaveY: 0.52, gidanY: 0.74, groundY: 0.80 };
      slotsTall[k].guide = { ...createDefaultGuide(k), ridgeY: 0.14, eaveY: 0.46, gidanY: 0.80, groundY: 0.90 };
    }
    const pLow = buildProjectFromFourViews(slotsLow, { projectName: '낮은 한옥', refSpanMm: 9000, roofType: 'matbae', useExtractedColors: false, roundFrontPillars: false }).project;
    const pTall = buildProjectFromFourViews(slotsTall, { projectName: '높은 한옥', refSpanMm: 9000, roofType: 'paljak', useExtractedColors: false, roundFrontPillars: true }).project;

    expect(pTall.params.pillarHeight).toBeGreaterThan(pLow.params.pillarHeight);
    expect(pTall.params.roofHeight).toBeGreaterThan(pLow.params.roofHeight);
    expect(pTall.params.gidanHeight).toBeGreaterThan(pLow.params.gidanHeight);
  });

  it('PBR 재질(materials.ts)과 팔레트(palettes.ts)가 물리 반사도 및 표면 분류를 올바르게 갖춘다', () => {
    for (const pal of PALETTES) {
      applyPalette(mats, { id: pal.id, custom: {} }, 'tti');
      const resolved = resolvePalette({ id: pal.id, custom: {} });
      expect(mats.pillar.roughness).toBeLessThan(0.7);
      expect(mats.roof.metalness).toBeGreaterThan(0);
      expect(mats.maru.roughness).toBeLessThan(0.5);
      expect(mats.windowPane.emissiveIntensity).toBeGreaterThan(0);
      expect(Object.keys(resolved.colors).length).toBe(14);
    }
    expect(MATERIAL_SURFACE.pillar).toBe('wood');
    expect(MATERIAL_SURFACE.roof).toBe('tile');
    expect(MATERIAL_SURFACE.stone).toBe('stone');
    expect(MATERIAL_SURFACE.wall).toBe('plaster');
    expect(MATERIAL_SURFACE.window).toBe('paper');
  });
});
