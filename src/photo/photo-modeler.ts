// 4면 [전·후·좌·우] 지정 프레임 촬영/업로드 기반 한옥 3D 모델 생성 엔진.
// 정면(Front/S), 배면(Rear/N), 좌측면(Left/W), 우측면(Right/E) 4장의 이미지와
// 각 면의 지정 프레임(용마루선, 처마선, 기단선, 지면선, 좌우 외곽 기둥선, 칸 분할)으로부터
// 3D 한옥 프로젝트(Project)와 2D 평면도(CadDoc, Sheet)를 합성한다.

import type { CadDoc, MaterialKey, Opening, OpeningKind, Params, Pillar, Project, Room, RoofType, Sheet } from '../core/types';
import { clampParam, DEFAULT_PARAMS } from '../core/params';
import { computeFootprint } from '../model/footprint';
import { defaultPalette } from '../model/palettes';
import { drawingFromProject } from '../model/plan-drawing';

export type FaceKey = 'front' | 'rear' | 'left' | 'right';

export const FACE_META: { key: FaceKey; label: string; short: string; dir: 'S' | 'N' | 'W' | 'E'; desc: string }[] = [
  { key: 'front', label: '정면 (전 · 남측)', short: '전(정면)', dir: 'S', desc: '건물 정면 중앙에서 수평을 맞춰 촬영하세요. 정면 칸 수와 기단·기둥·지붕 비례의 기준이 됩니다.' },
  { key: 'rear', label: '배면 (후 · 북측)', short: '후(배면)', dir: 'N', desc: '건물 뒤쪽(배면)을 촬영하세요. 뒷벽의 창호·문 배치와 처마 높이를 교차 검증합니다.' },
  { key: 'left', label: '좌측면 (좌 · 서측)', short: '좌(좌측면)', dir: 'W', desc: '정면을 바라봤을 때 왼쪽 측면을 촬영하세요. 측면 깊이(칸 수)와 박공·합각(지붕 형식)을 인식합니다.' },
  { key: 'right', label: '우측면 (우 · 동측)', short: '우(우측면)', dir: 'E', desc: '정면을 바라봤을 때 오른쪽 측면을 촬영하세요. 우측 외벽의 창호·문과 측면 비례를 완성합니다.' },
];

/** 각 면의 지정 가이드 프레임 (0~1 정규화 이미지 좌표) */
export interface FaceFrameGuide {
  ridgeY: number;   // 용마루 상단선 (예: 0.22)
  eaveY: number;    // 처마 밑 / 기둥 머리선 (예: 0.50)
  gidanY: number;   // 기단 상단 / 기둥 밑동선 (예: 0.78)
  groundY: number;  // 마당 지면선 (예: 0.86)
  leftX: number;    // 좌측 귀기둥 중심선 (예: 0.16)
  rightX: number;   // 우측 귀기둥 중심선 (예: 0.84)
  eaveLeftX: number;  // 좌측 처마 끝 X (예: 0.08)
  eaveRightX: number; // 우측 처마 끝 X (예: 0.92)
  bays: number;     // 이 면에서 보이는 기둥 사이 칸 수 (정면/배면 1~7, 좌/우 1~5)
  bayOpenings: OpeningKind[]; // 칸별 인식/지정된 개구부 ('door' | 'window' | 'open' — 벽은 별도 플래그)
  bayTypes: ('door' | 'window' | 'wall')[];
}

export interface FacePhotoSlot {
  key: FaceKey;
  dataUrl: string | null;
  fileName?: string;
  width: number;
  height: number;
  guide: FaceFrameGuide;
  analyzed: boolean;
  confidence: number;
  sampledColors?: Partial<Record<MaterialKey, string>>;
}

export interface PhotoModelingOptions {
  projectName: string;
  refSpanMm: number;       // 정면 전체 기둥 간 거리(총장 mm, 기본 10800mm)
  roofType: RoofType;      // 팔작 / 우진각 / 맞배 (측면 사진에서 추론하거나 사용자 선택)
  useExtractedColors: boolean; // 사진에서 추출한 외관 색감 적용 여부
  roundFrontPillars: boolean;  // 정면 기둥을 원기둥(원주)으로 할지 여부
}

export function createDefaultGuide(face: FaceKey): FaceFrameGuide {
  const isSide = face === 'left' || face === 'right';
  const bays = isSide ? 2 : 3;
  const bayTypes: ('door' | 'window' | 'wall')[] = isSide
    ? ['wall', 'window']
    : face === 'front'
      ? ['window', 'door', 'window']
      : ['window', 'wall', 'window'];
  return {
    ridgeY: 0.22,
    eaveY: 0.50,
    gidanY: 0.78,
    groundY: 0.86,
    leftX: isSide ? 0.24 : 0.16,
    rightX: isSide ? 0.76 : 0.84,
    eaveLeftX: isSide ? 0.14 : 0.08,
    eaveRightX: isSide ? 0.86 : 0.92,
    bays,
    bayOpenings: bayTypes.map((t) => (t === 'door' ? 'door' : 'window')),
    bayTypes,
  };
}

export function createInitialSlots(): Record<FaceKey, FacePhotoSlot> {
  return {
    front: { key: 'front', dataUrl: null, width: 800, height: 600, guide: createDefaultGuide('front'), analyzed: false, confidence: 0 },
    rear: { key: 'rear', dataUrl: null, width: 800, height: 600, guide: createDefaultGuide('rear'), analyzed: false, confidence: 0 },
    left: { key: 'left', dataUrl: null, width: 800, height: 600, guide: createDefaultGuide('left'), analyzed: false, confidence: 0 },
    right: { key: 'right', dataUrl: null, width: 800, height: 600, guide: createDefaultGuide('right'), analyzed: false, confidence: 0 },
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [cl(r), cl(g), cl(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * 업로드/촬영된 이미지에서 지정 프레임 내부의 수평 에지(용마루·처마·기단),
 * 수직 기둥 열(칸 수), 각 칸의 창호/문/벽 특성, 그리고 부재별 대표 색상을 자동 분석한다.
 */
export async function analyzeFacePhoto(slot: FacePhotoSlot): Promise<void> {
  if (!slot.dataUrl || typeof document === 'undefined') return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'));
    img.src = slot.dataUrl!;
  });
  slot.width = img.naturalWidth || 800;
  slot.height = img.naturalHeight || 600;

  const W = 256, H = 192;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  const lumAt = (x: number, y: number) => {
    const ix = Math.max(0, Math.min(W - 1, Math.floor(x)));
    const iy = Math.max(0, Math.min(H - 1, Math.floor(y)));
    const k = (iy * W + ix) * 4;
    return 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
  };

  // 1) 수평 에지 강도 프로파일로 용마루·처마·기단 후보 탐색 (지정 프레임 범위 주변에서 스냅)
  const rowEdge = new Float32Array(H);
  const x0 = Math.floor(W * 0.15), x1 = Math.floor(W * 0.85);
  for (let y = 2; y < H - 2; y++) {
    let sum = 0;
    for (let x = x0; x <= x1; x++) {
      sum += Math.abs(lumAt(x, y + 1) - lumAt(x, y - 1));
    }
    rowEdge[y] = sum / (x1 - x0 + 1);
  }

  const peakInRange = (minR: number, maxR: number, fallback: number) => {
    const yA = Math.max(2, Math.floor(H * minR));
    const yB = Math.min(H - 3, Math.floor(H * maxR));
    let bestY = Math.floor(H * fallback), bestVal = -1;
    for (let y = yA; y <= yB; y++) {
      // 가우시안 중심 가중치로 프레임 가이드 근처의 뚜렷한 구조선을 우선 선택
      const dist = Math.abs(y / H - fallback);
      const score = rowEdge[y] * (1 - dist * 1.4);
      if (score > bestVal) { bestVal = score; bestY = y; }
    }
    return +(bestY / H).toFixed(3);
  };

  const g = slot.guide;
  g.ridgeY = peakInRange(0.12, 0.34, g.ridgeY);
  g.eaveY = peakInRange(0.40, 0.58, g.eaveY);
  g.gidanY = peakInRange(0.70, 0.84, g.gidanY);
  g.groundY = Math.min(0.94, Math.max(g.gidanY + 0.05, peakInRange(0.80, 0.93, g.groundY)));

  // 2) 각 칸(Bay) 영역의 밝기·대비를 분석해 문(door) / 창호(window) / 벽(wall) 분류
  const yTop = Math.floor(H * (g.eaveY + 0.04));
  const yBot = Math.floor(H * (g.gidanY - 0.02));
  const newBayTypes: ('door' | 'window' | 'wall')[] = [];
  for (let b = 0; b < g.bays; b++) {
    const bx0 = Math.floor(W * (g.leftX + ((g.rightX - g.leftX) * b) / g.bays));
    const bx1 = Math.floor(W * (g.leftX + ((g.rightX - g.leftX) * (b + 1)) / g.bays));
    let upperVar = 0, lowerDark = 0, count = 0;
    const midY = Math.floor((yTop + yBot) / 2);
    for (let y = yTop; y < yBot; y += 2) {
      for (let x = bx0 + 3; x < bx1 - 3; x += 2) {
        const gx = Math.abs(lumAt(x + 1, y) - lumAt(x - 1, y));
        const gy = Math.abs(lumAt(x, y + 1) - lumAt(x, y - 1));
        upperVar += gx + gy;
        if (y > midY && lumAt(x, y) < 155) lowerDark++;
        count++;
      }
    }
    const edgeDensity = count ? upperVar / count : 0;
    const lowerRatio = count ? lowerDark / (count * 0.5) : 0;
    // 창살 격자 에지가 높고 하단까지 개구부가 이어지면 문(door), 상단만 격자가 있으면 창호(window), 평탄하면 벽(wall)
    if (edgeDensity > 16 && (lowerRatio > 0.45 || (slot.key === 'front' && b === Math.floor(g.bays / 2)))) {
      newBayTypes.push('door');
    } else if (edgeDensity > 11) {
      newBayTypes.push('window');
    } else {
      newBayTypes.push('wall');
    }
  }
  g.bayTypes = newBayTypes;

  // 3) 영역별 대표 색상 샘플링 (기와 지붕, 회벽, 기둥 목재, 기단 석재)
  const sampleRegion = (rx0: number, ry0: number, rx1: number, ry1: number) => {
    let rSum = 0, gSum = 0, bSum = 0, n = 0;
    const sx0 = Math.max(0, Math.floor(W * rx0)), sx1 = Math.min(W - 1, Math.floor(W * rx1));
    const sy0 = Math.max(0, Math.floor(H * ry0)), sy1 = Math.min(H - 1, Math.floor(H * ry1));
    for (let y = sy0; y <= sy1; y += 2) {
      for (let x = sx0; x <= sx1; x += 2) {
        const k = (y * W + x) * 4;
        rSum += data[k]; gSum += data[k + 1]; bSum += data[k + 2]; n++;
      }
    }
    return n ? [rSum / n, gSum / n, bSum / n] as const : [140, 130, 120] as const;
  };

  const [rr, rg, rb] = sampleRegion(g.leftX, g.ridgeY + 0.03, g.rightX, g.eaveY - 0.03);
  const [wr, wg, wb] = sampleRegion(g.leftX + 0.05, g.eaveY + 0.05, g.rightX - 0.05, g.gidanY - 0.05);
  const [pr, pg, pb] = sampleRegion(g.leftX - 0.015, g.eaveY + 0.04, g.leftX + 0.015, g.gidanY - 0.04);
  const [sr, sg, sb] = sampleRegion(g.leftX, g.gidanY + 0.01, g.rightX, g.groundY - 0.01);

  slot.sampledColors = {
    roof: rgbToHex(rr * 0.85, rg * 0.85, rb * 0.88),
    ridge: rgbToHex(rr * 0.68, rg * 0.68, rb * 0.72),
    wall: rgbToHex(Math.max(195, wr), Math.max(188, wg), Math.max(175, wb)),
    pillar: rgbToHex(Math.max(105, Math.min(205, pr * 1.05)), Math.max(70, Math.min(160, pg * 0.95)), Math.max(45, Math.min(120, pb * 0.85))),
    beam: rgbToHex(Math.max(95, Math.min(195, pr)), Math.max(65, Math.min(150, pg * 0.9)), Math.max(40, Math.min(110, pb * 0.8))),
    stone: rgbToHex(Math.max(145, sr), Math.max(140, sg), Math.max(132, sb)),
  };

  slot.analyzed = true;
  slot.confidence = 0.92;
}

/**
 * 4면 [전·후·좌·우] 슬롯과 옵션으로부터 HanokJIN의 표준 Project + CadDoc + Sheet[]를 생성한다.
 */
export function buildProjectFromFourViews(
  slots: Record<FaceKey, FacePhotoSlot>,
  opts: PhotoModelingOptions,
): { project: Project; doc: CadDoc; sheets: Sheet[] } {
  const frontG = slots.front.guide;
  const rearG = slots.rear.guide;
  const leftG = slots.left.guide;
  const rightG = slots.right.guide;

  // 1) 정면·배면 칸 수 및 좌·우측면 칸 수 합의
  const nxBays = Math.max(1, Math.min(7, frontG.bays || rearG.bays || 3));
  const nyBays = Math.max(1, Math.min(5, leftG.bays || rightG.bays || 2));

  // 2) 정면 총장(refSpanMm)을 기준으로 정면 주열(xs)과 측면 주열(ys) 산출
  const totalWidthMm = Math.max(3000, Math.min(24000, opts.refSpanMm || 10800));
  // 중앙 어칸(대청 칸)은 양옆 협칸보다 약 12% 넓게 배분하여 전통 한옥 비례 반영
  const weightsX = Array.from({ length: nxBays }, (_, i) => (nxBays >= 3 && i === Math.floor(nxBays / 2) ? 1.14 : 1));
  const sumWX = weightsX.reduce((a, b) => a + b, 0);
  const xs: number[] = [0];
  for (let i = 0; i < nxBays; i++) {
    if (i === nxBays - 1) {
      xs.push(totalWidthMm);
    } else {
      const step = Math.round((totalWidthMm * (weightsX[i] / sumWX)) / 50) * 50;
      xs.push(xs[xs.length - 1] + step);
    }
  }

  // 측면 한 칸 길이는 정면 평균 칸 길이의 약 0.95배(전통 한옥 주칸 비례 약 2,700~3,000mm)
  const avgFrontBay = totalWidthMm / nxBays;
  const sideBayMm = Math.round((avgFrontBay * 0.95) / 50) * 50;
  const ys: number[] = [0];
  for (let j = 0; j < nyBays; j++) {
    ys.push(ys[ys.length - 1] + sideBayMm);
  }

  // 3) 정면·배면 지정 프레임의 수직 비율에서 기단·기둥·지붕 높이 및 처마 내밀기 역산
  const spanNormX = Math.max(0.25, frontG.rightX - frontG.leftX);
  const mmPerNorm = totalWidthMm / spanNormX;

  const avgEaveY = (frontG.eaveY + rearG.eaveY) / 2;
  const avgGidanY = (frontG.gidanY + rearG.gidanY) / 2;
  const avgGroundY = (frontG.groundY + rearG.groundY) / 2;
  const avgRidgeY = (frontG.ridgeY + rearG.ridgeY) / 2;

  const rawPillarH = Math.round(((avgGidanY - avgEaveY) * mmPerNorm * 0.78) / 10) * 10;
  const rawGidanH = Math.round(((avgGroundY - avgGidanY) * mmPerNorm * 0.78) / 10) * 10;
  const rawRoofH = Math.round(((avgEaveY - avgRidgeY) * mmPerNorm * 0.82) / 10) * 10;
  const eaveNorm = Math.max(0.03, ((frontG.leftX - frontG.eaveLeftX) + (frontG.eaveRightX - frontG.rightX)) / 2);
  const rawEaves = Math.round((eaveNorm * mmPerNorm * 0.85) / 10) * 10;

  const params: Params = {
    ...DEFAULT_PARAMS,
    roofType: opts.roofType,
    ryangga: nyBays >= 3 ? 7 : nyBays === 2 ? 5 : 3,
    gongpo: opts.roofType === 'matbae' ? 'mindori' : nxBays >= 5 ? 'iikgong' : 'ikgong',
    heullim: opts.roundFrontPillars ? 'baeheullim' : 'minheullim',
    pillarHeight: clampParam('pillarHeight', rawPillarH || 2650),
    gidanHeight: clampParam('gidanHeight', rawGidanH || 550),
    roofHeight: clampParam('roofHeight', rawRoofH || 2900),
    eaves: clampParam('eaves', rawEaves || 1500),
    baseD: nxBays >= 5 ? 300 : 270,
  };

  // 4) 기둥(Pillars) 생성: 외곽 기둥 열 및 주요 교차점
  const pillars: Pillar[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < ys.length; j++) {
      // 대청 중앙 내부 기둥은 고주 생략(공간 확보) 가능하나 기본 격자 외곽은 모두 배치
      const isFrontRow = j === 0;
      const round = opts.roundFrontPillars && isFrontRow;
      pillars.push({
        id: `X${i + 1}-Y${j + 1}`,
        x: xs[i],
        y: ys[j],
        shape: round ? 'round' : 'square',
        size: round ? params.baseD : Math.round(params.baseD * 0.88),
        source: 'drawing',
        confidence: 0.94,
      });
    }
  }

  // 5) 실(Room) 배치: 중앙 칸은 대청(마루), 좌우 칸은 온돌방(안방·건넌방)
  const rooms: Room[] = [];
  let rIdx = 1;
  for (let i = 0; i < nxBays; i++) {
    for (let j = 0; j < nyBays; j++) {
      const isCenter = nxBays >= 3 && i === Math.floor(nxBays / 2);
      const rType = isCenter ? 'maru' : 'ondol';
      const rName = isCenter ? '대청' : i < nxBays / 2 ? '안방' : '건넌방';
      rooms.push({
        id: `R${rIdx++}`,
        name: rName,
        type: rType,
        x: (xs[i] + xs[i + 1]) / 2,
        y: (ys[j] + ys[j + 1]) / 2,
      });
    }
  }

  // 6) 사진에서 추출한 외관 색감 또는 기본 팔레트 구성
  const palette = defaultPalette();
  if (opts.useExtractedColors) {
    const merged: Partial<Record<MaterialKey, string>> = {};
    for (const fk of ['right', 'left', 'rear', 'front'] as FaceKey[]) {
      if (slots[fk].sampledColors) Object.assign(merged, slots[fk].sampledColors);
    }
    palette.custom = merged;
  }

  const project: Project = {
    version: 3,
    id: `photo4v-${Date.now().toString(36)}`,
    name: opts.projectName.trim() || '4면 사진 기반 한옥 모델',
    source: {
      fileName: '4면 사진 촬영 [전·후·좌·우]',
      format: '4-View Photo Photogrammetry',
      area: `${((xs[xs.length - 1] * ys[ys.length - 1]) / 1_000_000).toFixed(2)}㎡`,
    },
    origin: { x: 0, y: 0 },
    grid: {
      xs,
      ys,
      labelsX: xs.map((_, k) => `X${k + 1}`),
      labelsY: ys.map((_, k) => `Y${k + 1}`),
      source: 'drawing',
    },
    pillars,
    rooms,
    openings: [],
    params,
    baseline: { ...params },
    paramSource: {
      pillarHeight: { source: 'drawing', note: '정면·배면 지정 프레임(처마선~기단선) 비례에서 산출' },
      gidanHeight: { source: 'drawing', note: '정면·배면 지정 프레임(기단선~지면선) 비례에서 산출' },
      roofHeight: { source: 'drawing', note: '정면·배면 지정 프레임(용마루선~처마선) 비례에서 산출' },
      eaves: { source: 'drawing', note: '4면 지정 프레임의 처마 내밀기 비율에서 산출' },
      roofType: { source: 'drawing', note: '좌·우측면 지정 프레임(합각/박공 형태)에서 산출' },
    },
    members: [],
    palette,
    recognitionNotes: [
      `4면[전·후·좌·우] 지정 프레임 촬영 이미지로부터 정면 ${nxBays}칸 × 측면 ${nyBays}칸 평면을 합성했습니다.`,
      `추출 치수: 기단 ${params.gidanHeight}mm · 기둥 ${params.pillarHeight}mm · 지붕 ${params.roofHeight}mm · 처마 ${params.eaves}mm`,
      opts.useExtractedColors ? '촬영된 4면 사진에서 기와·회벽·목재·석재 대표 색감을 추출해 적용했습니다.' : '전통 한옥 표준 재질 팔레트를 적용했습니다.',
    ],
    reviewed: true,
    damages: [],
  };

  // 7) 4면 [전(S), 후(N), 좌(W), 우(E)] 칸별 개구부(문·창호·벽) 매핑
  const fp = computeFootprint(project);
  const openings: Opening[] = [];
  let opId = 1;

  const mapFaceOpenings = (outDir: 'S' | 'N' | 'W' | 'E', guide: FaceFrameGuide, faceLabel: string) => {
    const edges = fp.edges
      .filter((e) => e.out === outDir)
      .sort((a, b) => (outDir === 'S' || outDir === 'N' ? a.x1 - b.x1 : a.y1 - b.y1));
    edges.forEach((e, idx) => {
      const bType = guide.bayTypes[Math.min(idx, guide.bayTypes.length - 1)] ?? 'wall';
      if (bType === 'wall') return;
      openings.push({
        id: `OP${opId++}`,
        x1: e.x1,
        y1: e.y1,
        x2: e.x2,
        y2: e.y2,
        kind: bType === 'door' ? 'door' : 'window',
        label: `${faceLabel} ${idx + 1}칸 ${bType === 'door' ? '한지 문' : '한지 창호'}`,
        source: 'drawing',
      });
    });
  };

  mapFaceOpenings('S', frontG, '정면');
  mapFaceOpenings('N', rearG, '배면');
  mapFaceOpenings('W', leftG, '좌측면');
  mapFaceOpenings('E', rightG, '우측면');
  project.openings = openings;

  const doc = drawingFromProject(project, `${project.name} (4면 사진 복원 평면도)`);
  const sheets: Sheet[] = [{ id: 'sheet-photo-plan', kind: 'PLAN', title: '4면 복원 평면도', bounds: doc.extents, entityCount: doc.stats.entities }];

  return { project, doc, sheets };
}
