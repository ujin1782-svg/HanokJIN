// 재질 묶음. 모델을 다시 만들지 않고 색감(팔레트)만 바꿀 수 있도록 재질을 공유한다.

import * as THREE from 'three';
import type { Lattice, MaterialKey, PaletteState } from '../core/types';
import { resolvePalette } from './palettes';
import * as tex from './textures';

export type MaterialSet = Record<MaterialKey, THREE.MeshStandardMaterial> & {
  windowPane: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  accent2: THREE.MeshStandardMaterial;
  underside: THREE.MeshStandardMaterial;
};

function mat(opts: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...opts });
}

export function createMaterials(): MaterialSet {
  const wood = tex.woodTexture();
  const set = {
    pillar: mat({ map: wood, roughness: 0.72 }),
    beam: mat({ map: wood, roughness: 0.72 }),
    rafter: mat({ map: wood, roughness: 0.75 }),
    bracket: mat({ map: wood, roughness: 0.7 }),
    wall: mat({ map: tex.plasterTexture(), roughness: 0.95, side: THREE.DoubleSide }),
    wallFrame: mat({ map: wood, roughness: 0.75 }),
    window: mat({ roughness: 0.9 }),
    roof: mat({ map: tex.tileTexture(), roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide }),
    ridge: mat({ roughness: 0.6, metalness: 0.05 }),
    stone: mat({ map: tex.stoneTexture(), roughness: 0.92 }),
    plinth: mat({ roughness: 0.9 }),
    maru: mat({ map: tex.maruTexture(), roughness: 0.6 }),
    ondol: mat({ map: tex.ondolTexture(), roughness: 0.7 }),
    ground: mat({ map: tex.groundTexture(), roughness: 1 }),
    windowPane: mat({ roughness: 0.9, side: THREE.DoubleSide }),
    accent: mat({ roughness: 0.7 }),
    accent2: mat({ roughness: 0.7 }),
    underside: mat({ map: wood, roughness: 0.85, side: THREE.DoubleSide }),
  } as MaterialSet;
  return set;
}

export function applyPalette(m: MaterialSet, palette: PaletteState, lattice: Lattice) {
  const { colors, accent } = resolvePalette(palette);
  for (const key of Object.keys(colors) as MaterialKey[]) {
    if (key === 'window') continue;
    m[key].color.set(colors[key]);
  }
  m.underside.color.set(colors.rafter).multiplyScalar(0.92);
  // 단청 팔레트가 아니면 색띠를 바탕 부재와 같은 색으로 둬 보이지 않게 한다.
  m.accent.color.set(accent?.band ?? colors.rafter);
  m.accent2.color.set(accent?.band2 ?? colors.beam);
  // 창호는 창살(문얼굴 색)과 창호지 색을 텍스처에 직접 그린다.
  const lt = tex.latticeTexture(lattice, colors.wallFrame, colors.window);
  m.windowPane.map = lt;
  m.windowPane.color.set(lt ? '#ffffff' : colors.window);
  m.windowPane.needsUpdate = true;
  m.window.color.set(colors.window);
}
