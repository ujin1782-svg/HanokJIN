// 한옥 색감 프리셋. 전통 안료·재료 색을 참고해 고른 값이다.

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
    name: '백골 민가',
    desc: '칠하지 않은 소나무와 흰 회벽, 먹빛 기와. 살림집 한옥의 담백한 색입니다.',
    colors: {
      pillar: '#b98a5e', beam: '#a87b52', rafter: '#9c7049', bracket: '#b08257',
      wall: '#f1ece2', wallFrame: '#8f6a47', window: '#f4ead2',
      roof: '#5f666d', ridge: '#474d53', stone: '#bdb6a8', plinth: '#a59e90',
      maru: '#c49a6c', ondol: '#e3c98f', ground: '#c9c2b2',
    },
  },
  {
    id: 'dancheong',
    name: '궁궐 단청',
    desc: '석간주 기둥, 뇌록 바탕의 보·도리와 서까래. 궁궐·사찰 건물의 단청 색입니다.',
    colors: {
      pillar: '#8e3b2c', beam: '#3d7f6e', rafter: '#3f806f', bracket: '#2f6f62',
      wall: '#efe7d6', wallFrame: '#8e3b2c', window: '#f2e6c8',
      roof: '#545b62', ridge: '#3f454b', stone: '#b8b1a2', plinth: '#9d968a',
      maru: '#b88a5a', ondol: '#dcc188', ground: '#c4bead',
    },
    accent: { band: '#2c5a8c', band2: '#c8483a' },
  },
  {
    id: 'gotaek',
    name: '고택 먹빛',
    desc: '세월에 그을린 짙은 나무와 누런 흙벽. 오래된 종택의 깊은 색입니다.',
    colors: {
      pillar: '#6d4b33', beam: '#5f412c', rafter: '#563a27', bracket: '#664530',
      wall: '#ddcfb6', wallFrame: '#4e3524', window: '#e9dcbc',
      roof: '#464a4f', ridge: '#33363a', stone: '#958f83', plinth: '#7f796e',
      maru: '#8a6442', ondol: '#c9ad78', ground: '#b5ad9b',
    },
  },
  {
    id: 'modern',
    name: '현대 한옥',
    desc: '밝은 원목, 깨끗한 백색 벽, 짙은 회색 기와. 신축 한옥에 많이 쓰는 색입니다.',
    colors: {
      pillar: '#d2ae84', beam: '#c9a378', rafter: '#c39c70', bracket: '#cba57a',
      wall: '#f8f7f3', wallFrame: '#b8936a', window: '#fbf6ea',
      roof: '#6c7279', ridge: '#53585d', stone: '#cfcac1', plinth: '#b9b3a8',
      maru: '#d8b48a', ondol: '#ead7ad', ground: '#d3cdc0',
    },
  },
];

export const MATERIAL_LABEL: Record<MaterialKey, string> = {
  pillar: '기둥', beam: '보·도리', rafter: '서까래', bracket: '공포', wall: '벽', wallFrame: '인방·문얼굴',
  window: '창호지', roof: '기와', ridge: '마루기와', stone: '기단', plinth: '초석', maru: '마루', ondol: '온돌 장판', ground: '마당',
};

/** 사용자가 직접 바꿀 수 있는 대표 재료(나머지는 프리셋을 따른다) */
export const EDITABLE_MATERIALS: MaterialKey[] = ['pillar', 'beam', 'rafter', 'wall', 'window', 'roof', 'stone', 'maru'];

export function defaultPalette(): PaletteState { return { id: 'baekgol', custom: {} }; }

export function resolvePalette(state: PaletteState): { colors: Record<MaterialKey, string>; accent?: Palette['accent'] } {
  const base = PALETTES.find((p) => p.id === state.id) ?? PALETTES[0];
  return { colors: { ...base.colors, ...state.custom }, accent: base.accent };
}
