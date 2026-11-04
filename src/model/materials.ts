// 재질 묶음(PBR 고도화). 모델을 다시 만들지 않고 색감(팔레트)만 바꿀 수 있도록 재질을 공유한다.
// 단색처럼 보이던 기존 문제를 해결하기 위해 부재별 알베도 텍스처 + 범프맵(BumpMap) + 물리 반사도(Roughness/Metalness/EnvMapIntensity)를 적용한다.

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
  return new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, envMapIntensity: 0.9, ...opts });
}

export function createMaterials(): MaterialSet {
  const wood = tex.woodTexture();
  const woodBump = tex.woodBumpTexture();
  const tile = tex.tileTexture();
  const tileBump = tex.tileBumpTexture();
  const plaster = tex.plasterTexture();
  const plasterBump = tex.plasterBumpTexture();
  const stone = tex.stoneTexture();
  const stoneBump = tex.stoneBumpTexture();
  const maru = tex.maruTexture();

  const set = {
    pillar: mat({ map: wood, bumpMap: woodBump, bumpScale: 0.018, roughness: 0.58, metalness: 0.02, envMapIntensity: 1.05 }),
    beam: mat({ map: wood, bumpMap: woodBump, bumpScale: 0.016, roughness: 0.62, metalness: 0.02, envMapIntensity: 0.95 }),
    rafter: mat({ map: wood, bumpMap: woodBump, bumpScale: 0.014, roughness: 0.66, metalness: 0.01, envMapIntensity: 0.9 }),
    bracket: mat({ map: wood, bumpMap: woodBump, bumpScale: 0.015, roughness: 0.60, metalness: 0.02, envMapIntensity: 1.0 }),
    wall: mat({ map: plaster, bumpMap: plasterBump, bumpScale: 0.024, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.65 }),
    wallFrame: mat({ map: wood, bumpMap: woodBump, bumpScale: 0.015, roughness: 0.64, metalness: 0.02 }),
    window: mat({ roughness: 0.82, envMapIntensity: 0.7 }),
    roof: mat({ map: tile, bumpMap: tileBump, bumpScale: 0.048, roughness: 0.46, metalness: 0.08, side: THREE.DoubleSide, envMapIntensity: 1.15 }),
    ridge: mat({ map: stone, bumpMap: tileBump, bumpScale: 0.025, roughness: 0.50, metalness: 0.08, envMapIntensity: 1.1 }),
    stone: mat({ map: stone, bumpMap: stoneBump, bumpScale: 0.036, roughness: 0.84, metalness: 0.02, envMapIntensity: 0.75 }),
    plinth: mat({ map: stone, bumpMap: stoneBump, bumpScale: 0.032, roughness: 0.80, metalness: 0.03, envMapIntensity: 0.8 }),
    maru: mat({ map: maru, bumpMap: woodBump, bumpScale: 0.012, roughness: 0.42, metalness: 0.03, envMapIntensity: 1.15 }),
    ondol: mat({ map: tex.ondolTexture(), bumpMap: plasterBump, bumpScale: 0.008, roughness: 0.52, metalness: 0.02, envMapIntensity: 0.95 }),
    ground: mat({ map: tex.groundTexture(), bumpMap: plasterBump, bumpScale: 0.02, roughness: 0.96, metalness: 0, envMapIntensity: 0.45 }),
    windowPane: mat({ roughness: 0.76, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.8 }),
    accent: mat({ map: wood, bumpMap: woodBump, bumpScale: 0.01, roughness: 0.55 }),
    accent2: mat({ map: wood, bumpMap: woodBump, bumpScale: 0.01, roughness: 0.55 }),
    underside: mat({ map: wood, bumpMap: woodBump, bumpScale: 0.014, roughness: 0.74, side: THREE.DoubleSide }),
  } as MaterialSet;
  return set;
}

export function applyPalette(m: MaterialSet, palette: PaletteState, lattice: Lattice) {
  const { colors, accent } = resolvePalette(palette);
  for (const key of Object.keys(colors) as MaterialKey[]) {
    if (key === 'window') continue;
    m[key].color.set(colors[key]);
  }
  // 처마 밑 개판은 서까래보다 살짝 밝고 따뜻한 톤으로 두어 그늘 속에서도 나무 결이 살아나게 한다.
  m.underside.color.set(colors.rafter).multiplyScalar(0.96);
  // 단청 팔레트가 아니면 색띠를 바탕 부재와 같은 색으로 둬 보이지 않게 한다.
  m.accent.color.set(accent?.band ?? colors.rafter);
  m.accent2.color.set(accent?.band2 ?? colors.beam);
  // 창호는 창살(문얼굴 색)과 창호지 색을 텍스처에 직접 그린다 + 은은한 한지 투광 에미시브 부여
  const lt = tex.latticeTexture(lattice, colors.wallFrame, colors.window);
  m.windowPane.map = lt;
  m.windowPane.color.set(lt ? '#ffffff' : colors.window);
  m.windowPane.emissive.set(colors.window);
  m.windowPane.emissiveIntensity = 0.08;
  m.windowPane.needsUpdate = true;
  m.window.color.set(colors.window);
}
