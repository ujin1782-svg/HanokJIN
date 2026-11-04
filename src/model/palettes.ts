// 한옥 색감 프리셋. 전통 천연 안료·목재(육송/홍송)·한지·수제 암수키와·화강암의 실제 물리 알베도(Albedo)와 색온도를 반영해 조율한 값이다.
// 4면 사진에서 자동 추출한 커스텀 색감도 함께 지원한다.

import type { MaterialKey, PaletteState } from '../core/types';

export interface Palette {
  id: string;
  name: string;
  desc: string;
  colors: Record<MaterialKey, string>;
  /** 단청처럼 부재 끝에 색띠를 두르는지 */
  accent?: { band: string; band2: string };
}

export const PALETTES: Palette[] = [
  {
    id: 'baekgol',
    name: '백골 민가 (육송·회벽)',
    desc: '송진이 배어든 따뜻한 육송(소나무) 결, 천연 회벽과 그을린 전통 수제 먹기와 색감입니다.',
    colors: {
      pillar: '#c48e5a', beam: '#b37e4c', rafter: '#a87444', bracket: '#bc8653',
      wall: '#f3ede1', wallFrame: '#96683e', window: '#f8efd8',
      roof: '#444b52', ridge: '#32373d', stone: '#c8c1b4', plinth: '#aba394',
      maru: '#cd9b64', ondol: '#e6c98a', ground: '#d5cdbd',
    },
  },
  {
    id: 'dancheong',
    name: '궁궐 단청 (석간주·뇌록)',
    desc: '석간주(붉은 황토) 기둥과 뇌록(청록) 보·서까래, 머리초 색띠가 어우러진 격조 높은 궁궐 색감입니다.',
    colors: {
      pillar: '#983828', beam: '#367866', rafter: '#3b826f', bracket: '#2d6859',
      wall: '#f1e9d7', wallFrame: '#923526', window: '#f6ebd0',
      roof: '#3d434a', ridge: '#2d3238', stone: '#c4bdb0', plinth: '#a49d90',
      maru: '#bf8d58', ondol: '#e0c385', ground: '#cfc8b7',
    },
    accent: { band: '#29588a', band2: '#d14938' },
  },
  {
    id: 'gotaek',
    name: '고택 고색창연 (오동유·황토)',
    desc: '수백 년 세월과 들기름·오동유에 깊이 숙성된 고목재와 따뜻한 황토 미장벽의 중후한 색감입니다.',
    colors: {
      pillar: '#754d30', beam: '#664228', rafter: '#5c3b23', bracket: '#6e472c',
      wall: '#e2d2b5', wallFrame: '#543620', window: '#eee0c0',
      roof: '#383c40', ridge: '#282b2e', stone: '#a69f92', plinth: '#8a8377',
      maru: '#94683f', ondol: '#cfb178', ground: '#c2b9a6',
    },
  },
  {
    id: 'modern',
    name: '현대 신한옥 (백송·밝은 화강석)',
    desc: '밝고 화사한 백송/히노끼 톤 목재와 정갈한 백회벽, 정다듬 포천석 기단이 조화된 현대 한옥입니다.',
    colors: {
      pillar: '#d8b486', beam: '#cfa879', rafter: '#c8a070', bracket: '#d3ad7e',
      wall: '#f9f7f2', wallFrame: '#be9668', window: '#fcf8ee',
      roof: '#525960', ridge: '#3d4248', stone: '#d8d3c9', plinth: '#c1bbb0',
      maru: '#deb98b', ondol: '#eedbad', ground: '#dcd6c8',
    },
  },
];

export const MATERIAL_LABEL: Record<MaterialKey, string> = {
  pillar: '기둥', beam: '보·도리', rafter: '서까래', bracket: '공포', wall: '벽', wallFrame: '인방·문얼굴',
  window: '창호지', roof: '기와', ridge: '마루기와', stone: '기단', plinth: '초석', maru: '마루', ondol: '온돌 장판', ground: '마당',
};

/** 재료 성격 분류: UI 스와치에서 나무결/기와결/석재결/한지 광택을 사실적으로 표현하는 데 사용한다 */
export const MATERIAL_SURFACE: Record<MaterialKey, 'wood' | 'tile' | 'plaster' | 'stone' | 'paper'> = {
  pillar: 'wood', beam: 'wood', rafter: 'wood', bracket: 'wood', wallFrame: 'wood', maru: 'wood',
  roof: 'tile', ridge: 'tile',
  wall: 'plaster', ground: 'plaster',
  stone: 'stone', plinth: 'stone',
  window: 'paper', ondol: 'paper',
};

/** 사용자가 직접 바꿀 수 있는 대표 재료(나머지는 프리셋을 따른다) */
export const EDITABLE_MATERIALS: MaterialKey[] = ['pillar', 'beam', 'rafter', 'wall', 'window', 'roof', 'stone', 'maru'];

export function defaultPalette(): PaletteState { return { id: 'baekgol', custom: {} }; }

export function resolvePalette(state: PaletteState): { colors: Record<MaterialKey, string>; accent?: Palette['accent'] } {
  const base = PALETTES.find((p) => p.id === state.id) ?? PALETTES[0];
  return { colors: { ...base.colors, ...state.custom }, accent: base.accent };
}
