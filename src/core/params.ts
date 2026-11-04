// 파라미터 정의: 화면 이름, 쉬운 설명, 단위, 허용 범위. UI와 검증이 함께 쓴다.

import type { Params } from './types';

export interface NumParamDef {
  key: keyof Params;
  label: string;
  term?: string;          // 전문 용어(정식 명칭)
  help: string;           // 초보자용 설명
  effect: string;         // 값을 바꾸면 생기는 변화
  min: number; max: number; step: number;
  unit: 'mm';
  basic: boolean;         // 기본 설정에 노출
}

export const NUM_PARAMS: NumParamDef[] = [
  { key: 'pillarHeight', label: '기둥 높이', help: '기단 윗면부터 기둥 머리까지의 높이입니다.', effect: '집 전체가 높아지거나 낮아집니다.', min: 1800, max: 4500, step: 10, unit: 'mm', basic: true },
  { key: 'roofHeight', label: '지붕 높이', help: '기둥 머리부터 용마루 꼭대기까지의 높이입니다.', effect: '값이 클수록 지붕 경사가 가팔라집니다.', min: 1200, max: 7000, step: 10, unit: 'mm', basic: true },
  { key: 'eaves', label: '처마 길이', term: '처마 내밀기', help: '기둥 중심선에서 처마 끝까지 수평으로 뻗은 길이입니다.', effect: '길수록 그늘이 깊고 지붕이 넓어 보입니다.', min: 600, max: 2600, step: 10, unit: 'mm', basic: true },
  { key: 'anggok', label: '처마 귀 들림', term: '앙곡 Hz', help: '처마 끝이 모서리로 갈수록 위로 휘어 올라가는 정도입니다.', effect: '클수록 처마 귀가 날렵하게 들립니다.', min: 0, max: 700, step: 10, unit: 'mm', basic: true },
  { key: 'anheori', label: '처마 귀 뻗음', term: '안허리곡 Hy', help: '지붕을 위에서 볼 때 처마 가운데가 안쪽으로 들어가고 귀가 밖으로 뻗는 정도입니다.', effect: '클수록 모서리가 바깥으로 더 뻗어 나갑니다.', min: 0, max: 500, step: 10, unit: 'mm', basic: false },
  { key: 'gidanHeight', label: '기단 높이', help: '지면부터 기단 윗면까지의 높이입니다.', effect: '집이 땅에서 떠 보이는 높이가 바뀝니다.', min: 150, max: 1500, step: 10, unit: 'mm', basic: false },
  { key: 'baseD', label: '기준 기둥 굵기', term: '주경 D', help: '부재 굵기 비례를 정하는 기준 치수입니다. 도리·보·서까래 굵기가 이 값에 비례합니다.', effect: '골조 부재가 전체적으로 굵어지거나 가늘어집니다.', min: 180, max: 600, step: 5, unit: 'mm', basic: false },
  { key: 'clearance', label: '결구 유격', term: 'Clearance', help: '부재가 서로 맞물릴 때 남기는 틈입니다.', effect: '물량에는 영향이 없고 검증에서 시공 권장 범위(0.3~1.2mm)를 확인합니다.', min: 0, max: 3, step: 0.1, unit: 'mm', basic: false },
];

export const CHOICES = {
  roofType: [
    { v: 'paljak', label: '팔작지붕', help: '아래는 네 면이 경사지고 위쪽 양옆에 삼각형 합각벽이 있는 지붕. 가장 흔한 한옥 지붕입니다.' },
    { v: 'ujingak', label: '우진각지붕', help: '네 면이 모두 경사진 지붕. 용마루가 짧고 측면에 벽이 없습니다.' },
    { v: 'matbae', label: '맞배지붕', help: '앞뒤 두 면만 경사지고 옆면은 박공으로 막힌 단순한 지붕입니다.' },
  ],
  ryangga: [
    { v: 3, label: '3량가', help: '도리 3줄(앞·뒤 주심도리 + 종도리). 작은 집에 씁니다.' },
    { v: 5, label: '5량가', help: '도리 5줄. 중도리가 더해져 깊은 집에 씁니다. 가장 흔합니다.' },
    { v: 7, label: '7량가', help: '도리 7줄. 규모가 큰 건물에 씁니다.' },
  ],
  gongpo: [
    { v: 'mindori', label: '민도리', help: '공포 없이 기둥 위에 바로 보·도리를 얹는 간결한 방식.' },
    { v: 'ikgong', label: '초익공', help: '기둥 머리에 날개 모양 부재(익공) 하나를 끼운 방식.' },
    { v: 'iikgong', label: '이익공', help: '익공을 두 단 겹쳐 더 장식적인 방식.' },
    { v: 'jusimpo', label: '주심포', help: '기둥 위에만 짜 올린 공포. 사찰·관아 건물에 씁니다.' },
  ],
  heullim: [
    { v: 'baeheullim', label: '배흘림', help: '기둥 아래 1/3 지점이 가장 굵고 위아래로 가늘어집니다.' },
    { v: 'minheullim', label: '민흘림', help: '아래가 굵고 위로 갈수록 일정하게 가늘어집니다.' },
    { v: 'none', label: '흘림 없음', help: '위아래 굵기가 같은 곧은 기둥입니다.' },
  ],
  lattice: [
    { v: 'tti', label: '띠살', help: '세로살을 촘촘히 두고 가로살을 띠처럼 몇 줄 두른 창살.' },
    { v: 'se', label: '세살', help: '가는 세로살과 가로살을 고르게 짠 창살.' },
    { v: 'wanja', label: '완자살', help: '卍(완자) 무늬를 이어 짠 창살.' },
    { v: 'yongja', label: '용자살', help: '用(용) 자처럼 성글게 짠 창살.' },
  ],
} as const;

export const DEFAULT_PARAMS: Params = {
  baseD: 300,
  pillarHeight: 2600,
  gidanHeight: 600,
  roofHeight: 3000,
  eaves: 1500,
  anggok: 300,
  anheori: 180,
  roofType: 'paljak',
  ryangga: 5,
  gongpo: 'ikgong',
  heullim: 'minheullim',
  lattice: 'tti',
  clearance: 0.5,
};

export function clampParam(key: keyof Params, v: number): number {
  const d = NUM_PARAMS.find((p) => p.key === key);
  if (!d) return v;
  return Math.min(d.max, Math.max(d.min, v));
}

/** 1척 = 303.03mm (영조척 근대 환산) */
export const CHEOK_MM = 303.03;
export const JAE_M3 = 0.0303 * 0.0303 * 3.636; // 1재 = 1치 × 1치 × 12자 ≈ 0.00334 m³
