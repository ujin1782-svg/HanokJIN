// 프로젝트(기둥·격자·파라미터) → 한옥 3D 모델.
// 어떤 평면이든 격자/기둥에서 채(날개)를 나눠 같은 규칙으로 짓는다(특정 도면 좌표를 넣지 않는다).
// 물량(BOM)은 실제로 만든 부재에서 집계한다.

import * as THREE from 'three';
import type { BomRow, Project, RoomType } from '../core/types';
import { JAE_M3 } from '../core/params';
import { computeFootprint, pillarIndex, type Footprint, type Wing } from './footprint';
import type { MaterialSet } from './materials';
import { buildRoof, surfaceHeight, type RoofResult } from './roof';

export type GroupKey = 'base' | 'floor' | 'pillar' | 'wall' | 'bracket' | 'frame' | 'rafter' | 'roof';

export const GROUPS: { key: GroupKey; label: string; desc: string; lift: number }[] = [
  { key: 'base', label: '기단·초석', desc: '땅을 돋운 기단과 기둥을 받치는 초석을 놓습니다.', lift: 0 },
  { key: 'floor', label: '마루·바닥', desc: '대청 우물마루와 온돌방 바닥을 깝니다.', lift: 0.5 },
  { key: 'pillar', label: '기둥', desc: '초석 위에 기둥을 세웁니다. 흘림(배흘림·민흘림)으로 굵기가 변합니다.', lift: 1.1 },
  { key: 'wall', label: '벽·창호', desc: '기둥 사이에 인방을 걸고 흙벽과 한지 창호를 채웁니다.', lift: 1.8 },
  { key: 'bracket', label: '공포', desc: '기둥 머리에 주두와 익공을 짜 올려 보와 도리를 받칩니다.', lift: 2.6 },
  { key: 'frame', label: '보·도리', desc: '대들보·종보를 걸고 도리를 얹어 지붕 뼈대를 만듭니다.', lift: 3.5 },
  { key: 'rafter', label: '서까래·추녀', desc: '도리 위에 서까래를 걸고 모서리에 추녀를 겁니다.', lift: 4.6 },
  { key: 'roof', label: '지붕·기와', desc: '기와를 잇고 용마루·추녀마루를 쌓아 마무리합니다.', lift: 5.8 },
];

export interface PartInfo {
  name: string; spec: string; group: GroupKey; ifc: string;
  pillarId?: string; edgeKey?: string;
}

export interface Build {
  root: THREE.Group;
  groups: Record<GroupKey, THREE.Group>;
  bom: BomRow[];
  footprint: Footprint;
  pillarMeshes: Map<string, THREE.Mesh>;
  bounds: THREE.Box3;
  metrics: {
    roofAreaM2: number; eaveTipHeight: number; eaveAngleDeg: number; roofPitchDeg: number;
    maxBeamSpan: number; beamDepth: number; maxDoriSpan: number; doriDiameter: number;
    eaveLength: number; ridgeLength: number;
  };
  /** 평면 mm → 월드 좌표 */
  toWorld: (xMm: number, yMm: number, y?: number) => THREE.Vector3;
}

const ROLE_LABEL = { corner: '귀기둥(우주)', edge: '평주', inner: '고주(내진)' } as const;

export function buildHanok(p: Project, m: MaterialSet): Build {
  const fp = computeFootprint(p);
  const P = p.params;
  const root = new THREE.Group();
  root.name = p.name;
  const groups = {} as Record<GroupKey, THREE.Group>;
  for (const g of GROUPS) { groups[g.key] = new THREE.Group(); groups[g.key].name = g.label; root.add(groups[g.key]); }

  const xs = p.grid.xs.length ? p.grid.xs : [0, 1], ys = p.grid.ys.length ? p.grid.ys : [0, 1];
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const toWorld = (x: number, y: number, h = 0) => new THREE.Vector3((x - cx) / 1000, h, -(y - cy) / 1000);

  const bom = new Bom();
  const pillarMeshes = new Map<string, THREE.Mesh>();

  const G = P.gidanHeight / 1000, H = P.pillarHeight / 1000, T = G + H, D = P.baseD / 1000;
  const FL = G + 0.3;                                       // 마루·방바닥 높이
  const member = (name: string) => p.members.find((x) => x.name === name) ?? p.members.find((x) => x.name.startsWith(name) && !/장여|장혀/.test(x.name));
  const daeryang = member('대량') ?? member('대들보');
  const jongryang = member('종량') ?? member('종보');
  const jongdori = member('종도리');
  const yeonmok = member('연목');
  const beamW = (daeryang?.w ?? D * 900) / 1000, beamH = (daeryang?.h ?? D * 1100) / 1000;
  const upW = (jongryang?.w ?? D * 700) / 1000, upH = (jongryang?.h ?? D * 900) / 1000;
  const doriR = (D * 0.85) / 2;
  const ridgeDoriR = jongdori ? Math.max(jongdori.w, jongdori.h) / 2000 : doriR * 0.8;
  const rafterR = (yeonmok?.w ?? D * 400) / 2000;
  const chW = D * 0.55, chH = D * 0.75;                      // 창방
  const bracketH = { mindori: 0.1, ikgong: 0.28, iikgong: 0.46, jusimpo: 0.62 }[P.gongpo];
  const roofThick = 0.3;
  const E = P.eaves / 1000;

  const add = (g: GroupKey, geo: THREE.BufferGeometry, mat: THREE.Material, info?: Omit<PartInfo, 'group'>) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (info) mesh.userData.part = { ...info, group: g } satisfies PartInfo;
    groups[g].add(mesh);
    return mesh;
  };
  const along = (a: THREE.Vector3, b: THREE.Vector3, geoAlongZ: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(geoAlongZ);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.lookAt(b);
    mesh.updateMatrix();
    geoAlongZ.applyMatrix4(mesh.matrix);
    return geoAlongZ;
  };
  const boxBetween = (a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, extra = 0) =>
    along(a, b, scaledBox(w, h, a.distanceTo(b) + extra, 0.6));
  const cylBetween = (a: THREE.Vector3, b: THREE.Vector3, r: number, extra = 0, seg = 14) => {
    const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b) + extra, seg, 1);
    g.rotateX(Math.PI / 2);
    return along(a, b, g);
  };

  /* ───── 지붕 단면(채마다) ───── */
  const wings = fp.wings;
  const main = wings[0];
  const halfOf = (w: Wing) => (w.axis === 'x' ? w.y2 - w.y1 : w.x2 - w.x1) / 2000;
  const hP = T + bracketH + 2 * doriR + 0.42;                  // 주심 위 지붕면 높이
  const hRmain = Math.max(hP + 0.6, T + P.roofHeight / 1000 - 0.42);
  const K = 1.45;
  const profiles = new Map<string, { h: (t: number) => number; Dv: number; tP: number; hR: number }>();
  for (const w of wings) {
    const half = halfOf(w);
    const hR = hP + (hRmain - hP) * (half / Math.max(0.5, halfOf(main)));
    const Dv = half + E, tP = E / Dv, a = Math.pow(tP, K);
    const hE = Math.max(T - 0.4, (hP - hR * a) / (1 - a));
    profiles.set(w.id, { h: (t) => hE + (hR - hE) * Math.pow(Math.max(0, t), K), Dv, tP, hR });
  }

  const wingFrame = (w: Wing) => w.axis === 'x'
    ? { u0: w.x1 / 1000, u1: w.x2 / 1000, v0: w.y1 / 1000, v1: w.y2 / 1000, toWorld: (u: number, v: number, y: number) => toWorld(u * 1000, v * 1000, y) }
    : { u0: w.y1 / 1000, u1: w.y2 / 1000, v0: w.x1 / 1000, v1: w.x2 / 1000, toWorld: (u: number, v: number, y: number) => toWorld(v * 1000, u * 1000, y) };

  /** 먼저 지은(더 큰) 채의 지붕면보다 아래에 있으면 가려진다(회첨부 겹침) */
  const builtRoofs: { w: Wing; frame: RoofResult['frame']; h: (t: number) => number }[] = [];
  const hiddenBy = (idx: number, pt: THREE.Vector3) => {
    const x = pt.x + cx / 1000, y = -pt.z + cy / 1000;
    for (let k = 0; k < Math.min(idx, builtRoofs.length); k++) {
      const o = builtRoofs[k];
      const [u, v] = o.w.axis === 'x' ? [x, y] : [y, x];
      const hs = surfaceHeight(o.frame, o.h, u, v);
      if (hs !== null && pt.y < hs - 0.03) return true;
    }
    return false;
  };

  /* ───── 기단·바닥 ───── */
  const nx = xs.length - 1, ny = ys.length - 1;
  const occ = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && fp.occ[i]?.[j];
  const MARGIN = 0.75;
  const roomOfCell = (i: number, j: number): { type: RoomType; name?: string } => {
    const r = p.rooms.find((q) => q.x >= xs[i] && q.x <= xs[i + 1] && q.y >= ys[j] && q.y <= ys[j + 1]);
    return r ? { type: r.type, name: r.name } : { type: 'other' };
  };
  let floorArea = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    if (!occ(i, j)) continue;
    const x0 = xs[i] / 1000 - (occ(i - 1, j) ? 0 : MARGIN), x1 = xs[i + 1] / 1000 + (occ(i + 1, j) ? 0 : MARGIN);
    const y0 = ys[j] / 1000 - (occ(i, j - 1) ? 0 : MARGIN), y1 = ys[j + 1] / 1000 + (occ(i, j + 1) ? 0 : MARGIN);
    const c = toWorld(((x0 + x1) / 2) * 1000, ((y0 + y1) / 2) * 1000, G / 2);
    const gidan = add('base', scaledBox(x1 - x0, G, y1 - y0, 1.2), m.stone, { name: '기단(장대석)', spec: `높이 ${P.gidanHeight}mm`, ifc: 'IfcFooting' });
    gidan.position.copy(c);
    bom.add('gidan', '기단·초석', '기단(장대석 쌓기)', `높이 ${P.gidanHeight}`, (x1 - x0) * (y1 - y0) * G, '㎥', (x1 - x0) * (y1 - y0) * G);

    const room = roomOfCell(i, j);
    const fw = (xs[i + 1] - xs[i]) / 1000, fd = (ys[j + 1] - ys[j]) / 1000;
    const fmat = room.type === 'maru' ? m.maru : room.type === 'wet' ? m.plinth : m.ondol;
    const fl = add('floor', scaledBox(fw - 0.02, FL - G, fd - 0.02, room.type === 'maru' ? 1.4 : 1), fmat, {
      name: room.name ? `${room.name} 바닥` : '바닥', spec: `${Math.round(fw * 1000)}×${Math.round(fd * 1000)}mm`, ifc: 'IfcSlab',
    });
    fl.position.copy(toWorld((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, G + (FL - G) / 2));
    floorArea += fw * fd;
  }
  if (floorArea) bom.add('floor', '창호·마루', '바닥(마루·온돌)', '칸별 마감', +floorArea.toFixed(2), '㎡', 0);

  /* ───── 초석·기둥·공포 ───── */
  const isOccAround = (i: number, j: number) => ({ ne: !!occ(i, j), nw: !!occ(i - 1, j), se: !!occ(i, j - 1), sw: !!occ(i - 1, j - 1) });
  for (const pl of p.pillars) {
    const role = fp.roles.get(pl.id) ?? 'inner';
    const r0 = pl.size / 2000;
    const base = toWorld(pl.x, pl.y);
    // 초석
    const pGeo = pl.shape === 'round'
      ? new THREE.CylinderGeometry(r0 * 1.45, r0 * 1.7, 0.3, 20)
      : scaledBox(pl.size / 1000 * 1.7, 0.3, pl.size / 1000 * 1.7, 0.6);
    const plinth = add('base', pGeo, m.plinth, { name: `초석 (${pl.id})`, spec: pl.shape === 'round' ? `원형 Ø${Math.round(pl.size * 1.6)}` : `방형 ${Math.round(pl.size * 1.7)}`, ifc: 'IfcFooting', pillarId: pl.id });
    plinth.position.set(base.x, G - 0.07, base.z);
    bom.add(`plinth-${pl.shape}`, '기단·초석', pl.shape === 'round' ? '원형 초석' : '방형 초석', pl.shape === 'round' ? `Ø${Math.round(pl.size * 1.6)}×300` : `${Math.round(pl.size * 1.7)}각×300`, 1, '개', 0);

    // 기둥(흘림)
    const hp = T - (G + 0.08);
    let geo: THREE.BufferGeometry;
    if (pl.shape === 'round') {
      const pts: THREE.Vector2[] = [];
      for (let k = 0; k <= 16; k++) {
        const u = k / 16;
        const sc = P.heullim === 'baeheullim' ? 0.94 + 0.08 * Math.sin(Math.PI * Math.min(1, u * 1.5)) - 0.06 * u
          : P.heullim === 'minheullim' ? 1 - 0.1 * u : 1;
        pts.push(new THREE.Vector2(r0 * sc, u * hp));
      }
      geo = new THREE.LatheGeometry(pts, 20);
    } else {
      geo = scaledBox(pl.size / 1000, hp, pl.size / 1000, 0.6);
      geo.translate(0, hp / 2, 0);
      if (P.heullim !== 'none') taperTop(geo, hp, 0.92);
    }
    const pm = add('pillar', geo, m.pillar, {
      name: `${ROLE_LABEL[role]} ${pl.id}`, spec: `${pl.shape === 'round' ? `원주 Ø${pl.size}` : `방주 ${pl.size}×${pl.size}`} × ${Math.round(hp * 1000)}mm`, ifc: 'IfcColumn', pillarId: pl.id,
    });
    pm.position.set(base.x, G + 0.08, base.z);
    pillarMeshes.set(pl.id, pm);
    const vol = pl.shape === 'round' ? Math.PI * r0 * r0 * hp * 0.95 : (pl.size / 1000) ** 2 * hp * 0.93;
    bom.add(`pillar-${pl.shape}-${pl.size}`, '기둥', pl.shape === 'round' ? '원기둥' : '사각기둥', `${pl.shape === 'round' ? 'Ø' : '□'}${pl.size}×${Math.round(hp * 1000)}`, 1, '본', vol);

    // 공포
    if (P.gongpo !== 'mindori') {
      const judu = add('bracket', scaledBox(D * 1.35, 0.16, D * 1.35, 0.4), m.bracket, { name: `주두 (${pl.id})`, spec: `${Math.round(D * 1350)}각`, ifc: 'IfcMember', pillarId: pl.id });
      judu.position.set(base.x, T + 0.08, base.z);
      const ij = pillarIndex(p, pl);
      const dirs: THREE.Vector3[] = [];
      if (ij) {
        const o = isOccAround(ij[0], ij[1]);
        if (!o.ne && !o.nw) dirs.push(new THREE.Vector3(0, 0, -1));
        if (!o.se && !o.sw) dirs.push(new THREE.Vector3(0, 0, 1));
        if (!o.ne && !o.se) dirs.push(new THREE.Vector3(1, 0, 0));
        if (!o.nw && !o.sw) dirs.push(new THREE.Vector3(-1, 0, 0));
      }
      const tiers = P.gongpo === 'ikgong' ? 1 : P.gongpo === 'iikgong' ? 2 : 3;
      for (const d of dirs) {
        for (let k = 0; k < tiers; k++) {
          const len = 0.85 + k * 0.28;
          const a = new THREE.Vector3(base.x, T + 0.12 + k * 0.17, base.z).addScaledVector(d, -len * 0.3);
          const b = a.clone().addScaledVector(d, len);
          add('bracket', boxBetween(a, b, D * 0.34, 0.16), m.bracket, { name: P.gongpo === 'jusimpo' ? `살미 (${pl.id})` : `익공 (${pl.id})`, spec: `${Math.round(len * 1000)}mm`, ifc: 'IfcMember', pillarId: pl.id });
          if (P.gongpo === 'jusimpo') {
            const side = new THREE.Vector3(-d.z, 0, d.x);
            const c = a.clone().lerp(b, 0.62);
            add('bracket', boxBetween(c.clone().addScaledVector(side, -0.45), c.clone().addScaledVector(side, 0.45), 0.12, 0.13), m.bracket, { name: `첨차 (${pl.id})`, spec: '900mm', ifc: 'IfcMember', pillarId: pl.id });
          }
        }
      }
      bom.add(`gongpo-${P.gongpo}`, '공포', { ikgong: '초익공 공포', iikgong: '이익공 공포', jusimpo: '주심포 공포', mindori: '' }[P.gongpo], `주두 ${Math.round(D * 1350)}각`, 1, '조', D * 1.35 * D * 1.35 * 0.16 + dirs.length * tiers * 0.9 * D * 0.34 * 0.16);
    }
  }

  /* ───── 창방(외곽 칸) ───── */
  let maxDoriSpan = 0;
  for (const e of fp.edges) {
    const a = toWorld(e.x1, e.y1, T - chH / 2), b = toWorld(e.x2, e.y2, T - chH / 2);
    const len = a.distanceTo(b);
    maxDoriSpan = Math.max(maxDoriSpan, len);
    add('frame', boxBetween(a, b, chW, chH, 0.1), m.beam, { name: '창방', spec: `${Math.round(chW * 1000)}×${Math.round(chH * 1000)}×${Math.round(len * 1000)}`, ifc: 'IfcBeam' });
    for (const end of [a, b]) {
      const dir = (end === a ? b.clone().sub(a) : a.clone().sub(b)).setLength(0.22);
      add('frame', boxBetween(end.clone().add(dir.clone().multiplyScalar(0.3)), end.clone().add(dir), chW + 0.012, chH + 0.012), m.accent2).userData.decor = true;
    }
    bom.add('changbang', '보·도리', '창방', `${Math.round(chW * 1000)}×${Math.round(chH * 1000)}`, 1, '본', chW * chH * len);
  }

  /* ───── 벽·창호 ───── */
  let wallArea = 0, windowLeaves = 0, doorLeaves = 0;
  const wallTop = T - chH;
  for (const e of fp.edges) {
    const op = p.openings.find((o) => sameEdge(o, e));
    const kind = op?.kind ?? 'solid';
    const a = toWorld(e.x1, e.y1), b = toWorld(e.x2, e.y2);
    const dir = b.clone().sub(a).normalize();
    const span = a.distanceTo(b);
    const clear = Math.max(0.3, span - D);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const yaw = Math.atan2(dir.x, dir.z);
    const panel = (w: number, h: number, y: number, offset: number, mat: THREE.Material, t: number, info?: Omit<PartInfo, 'group'>, uvRepeat?: number) => {
      const geo = uvRepeat ? paneBox(w, h, t, uvRepeat) : scaledBox(t, h, w, 1);
      if (uvRepeat) geo.rotateY(Math.PI / 2);
      const mesh = add('wall', geo, mat, info);
      mesh.position.copy(mid).addScaledVector(dir, offset);
      mesh.position.y = y;
      mesh.rotation.y = yaw;
      return mesh;
    };
    // 하방(문지방)과 상인방
    panel(clear, FL - G, G + (FL - G) / 2, 0, m.wallFrame, 0.18, { name: '하방(문지방)', spec: `${Math.round(clear * 1000)}mm`, ifc: 'IfcMember' });
    panel(clear, 0.14, wallTop - 0.07, 0, m.wallFrame, 0.16, { name: '상인방', spec: `${Math.round(clear * 1000)}mm`, ifc: 'IfcMember' });
    const h0 = FL, h1 = wallTop - 0.14;
    if (kind === 'solid' || clear < 0.8) {
      const mid1 = h0 + (h1 - h0) * 0.42;
      panel(clear, 0.12, mid1, 0, m.wallFrame, 0.15, { name: '중인방', spec: `${Math.round(clear * 1000)}mm`, ifc: 'IfcMember' });
      panel(clear, mid1 - 0.06 - h0, (h0 + mid1 - 0.06) / 2, 0, m.wall, 0.12, { name: '흙벽(회벽 마감)', spec: `${Math.round(clear * 1000)}mm 칸`, ifc: 'IfcWall' });
      panel(clear, h1 - mid1 - 0.06, (mid1 + 0.06 + h1) / 2, 0, m.wall, 0.12, { name: '흙벽(회벽 마감)', spec: `${Math.round(clear * 1000)}mm 칸`, ifc: 'IfcWall' });
      wallArea += clear * (h1 - h0);
      continue;
    }
    const isDoor = kind === 'door' || kind === 'open';
    const sill = isDoor ? h0 : h0 + 0.48;
    const head = Math.min(h1 - 0.2, sill + (isDoor ? 2.0 : 1.35));
    const w = clear * (clear > 3 ? 0.9 : 0.84);
    const leaves = Math.max(2, Math.round(w / (isDoor ? 0.75 : 0.7)) - (Math.round(w / 0.7) % 2));
    if (!isDoor) panel(clear, sill - h0, (h0 + sill) / 2, 0, m.wall, 0.12, { name: '머름 벽', spec: `${Math.round(clear * 1000)}mm`, ifc: 'IfcWall' });
    panel(clear, 0.1, sill - 0.05, 0, m.wallFrame, 0.15, { name: isDoor ? '문지방' : '머름중방', spec: '', ifc: 'IfcMember' });
    panel(clear, 0.12, head + 0.06, 0, m.wallFrame, 0.15, { name: '문상방', spec: '', ifc: 'IfcMember' });
    panel(w, head - sill, (sill + head) / 2, 0, m.windowPane, 0.05, {
      name: isDoor ? `${op?.label ?? '한지 문'} (${leaves}짝)` : `${op?.label ?? '한지 창호'} (${leaves}짝)`,
      spec: `${Math.round(w * 1000)}×${Math.round((head - sill) * 1000)}mm`, ifc: isDoor ? 'IfcDoor' : 'IfcWindow',
    }, leaves);
    const side = (clear - w) / 2;
    if (side > 0.02) for (const s of [-1, 1]) panel(side, head - sill, (sill + head) / 2, s * (w / 2 + side / 2), m.wall, 0.12, { name: '창호 옆 벽', spec: '', ifc: 'IfcWall' });
    panel(clear, h1 - head - 0.12, (head + 0.12 + h1) / 2, 0, m.wall, 0.12, { name: '인방 위 벽', spec: '', ifc: 'IfcWall' });
    wallArea += clear * (h1 - h0) - w * (head - sill);
    if (isDoor) doorLeaves += leaves; else windowLeaves += leaves;
    if (isDoor) {
      // 댓돌
      const out = outward(e.out);
      const st = add('base', scaledBox(Math.min(1.4, w), G * 0.5, 0.5, 0.6), m.plinth, { name: '댓돌', spec: '디딤돌', ifc: 'IfcSlab' });
      st.position.copy(mid).add(out.multiplyScalar(MARGIN + 0.25));
      st.position.y = G * 0.25;
      st.rotation.y = yaw;
    }
  }
  if (wallArea > 0) bom.add('wall', '벽·창호', '흙벽(회벽 마감)', '두께 120', +wallArea.toFixed(2), '㎡', 0);
  if (windowLeaves) bom.add('window', '벽·창호', `한지 창호 (${latticeName(P.lattice)})`, '창짝', windowLeaves, '짝', 0);
  if (doorLeaves) bom.add('door', '벽·창호', `한지 문 (${latticeName(P.lattice)})`, '문짝', doorLeaves, '짝', 0);

  /* ───── 채마다: 지붕·도리·보·서까래 ───── */
  let roofArea = 0, eaveLen = 0, ridgeLen = 0, maxBeamSpan = 0;
  let minEaveTip = Infinity;
  const rafterPairs: [THREE.Vector3, THREE.Vector3][] = [];
  wings.forEach((w, idx) => {
    const f = wingFrame(w);
    const prof = profiles.get(w.id)!;
    const joinMin = w.joins.find((j) => j.side === (w.axis === 'x' ? 'minX' : 'minY'));
    const joinMax = w.joins.find((j) => j.side === (w.axis === 'x' ? 'maxX' : 'maxY'));
    const roof: RoofResult = buildRoof({
      u0: f.u0, u1: f.u1, v0: f.v0, v1: f.v1, eaves: E,
      joinMin: joinMin ? joinMin.to / 1000 : undefined, joinMax: joinMax ? joinMax.to / 1000 : undefined,
      type: P.roofType, h: prof.h, anggok: P.anggok / 1000, anheori: P.anheori / 1000, thick: roofThick, toWorld: f.toWorld,
    });
    const tiles = add('roof', roof.top, m.roof, { name: `기와 지붕 (${w.id})`, spec: `${{ paljak: '팔작', ujingak: '우진각', matbae: '맞배' }[P.roofType]}지붕`, ifc: 'IfcRoof' });
    tiles.userData.wing = w.id;
    add('roof', roof.under, m.underside, { name: '개판(서까래 위 판재)', spec: 'T30', ifc: 'IfcCovering' });
    add('roof', roof.fascia, m.underside, { name: '처마 끝(평고대·연함)', spec: '', ifc: 'IfcCovering' });
    if (roof.gable) add('roof', roof.gable, m.wall, { name: P.roofType === 'matbae' ? '박공벽' : '합각벽', spec: '', ifc: 'IfcWall' });
    roofArea += visibleArea(roof.top, (pt) => hiddenBy(idx, pt));
    minEaveTip = Math.min(minEaveTip, prof.h(0));
    builtRoofs.push({ w, frame: roof.frame, h: prof.h });

    for (const r of roof.ridges) {
      if (r.kind === '용마루') {
        const [a, b] = r.pts;
        add('roof', boxBetween(a, b, 0.34, 0.44, 0.4), m.ridge, { name: '용마루', spec: `${Math.round(a.distanceTo(b) * 1000 + 400)}mm`, ifc: 'IfcRoof' });
        for (const end of [a, b]) {
          if (hiddenBy(idx, end)) continue;
          const mw = add('roof', scaledBox(0.42, 0.62, 0.42, 0.5), m.ridge, { name: '망와', spec: '', ifc: 'IfcRoof' });
          mw.position.copy(end).add(new THREE.Vector3(0, 0.12, 0)).add((end === a ? a.clone().sub(b) : b.clone().sub(a)).setLength(0.2));
        }
        ridgeLen += a.distanceTo(b) + 0.4;
      } else {
        const pts = r.pts.filter((pt) => !hiddenBy(idx, pt));
        if (pts.length < 2) continue;
        const curve = new THREE.CatmullRomCurve3(pts);
        add('roof', new THREE.TubeGeometry(curve, Math.max(6, pts.length * 2), 0.11, 6, false), m.ridge, { name: r.kind, spec: '', ifc: 'IfcRoof' });
        ridgeLen += curve.getLength();
      }
    }
    for (const [a, b] of roof.hips) {
      if (hiddenBy(idx, a)) continue;
      add('rafter', boxBetween(a, b, 0.26, 0.32, 0.2), m.beam, { name: '추녀', spec: `260×320×${Math.round(a.distanceTo(b) * 1000)}`, ifc: 'IfcMember' });
      bom.add('chunyeo', '서까래·추녀', '추녀', '260×320', 1, '본', 0.26 * 0.32 * a.distanceTo(b));
    }
    for (const pr of roof.rafters) if (!hiddenBy(idx, pr[0])) rafterPairs.push(pr);
    eaveLen += 2 * (f.u1 - f.u0 + 2 * E) + (P.roofType === 'matbae' ? 0 : 2 * (f.v1 - f.v0 + 2 * E));

    // 도리·보 높이는 지붕 단면을 따른다.
    const half = (f.v1 - f.v0) / 2, vc = (f.v0 + f.v1) / 2;
    const levels = P.ryangga === 3 ? [0, 1] : P.ryangga === 5 ? [0, 0.5, 1] : [0, 1 / 3, 2 / 3, 1];
    const doriY = (lv: number) => prof.h((E + lv * half) / prof.Dv) - roofThick - rafterR * 2 - (lv === 1 ? ridgeDoriR : doriR);
    // 도리가 지붕면을 뚫지 않도록: 우진각·팔작 끝에서는 그 높이의 지붕면(추녀 쪽 경사·합각)이 시작되는 곳까지만 둔다.
    const fr = roof.frame;
    const tLv = (lv: number) => (E + lv * half) / prof.Dv;
    const inset = (lv: number) => (lv === 0 ? -0.15 : Math.min(tLv(lv), fr.tG) * prof.Dv - E + 0.05);
    const endMin = (lv: number) => joinMin ? joinMin.to / 1000 : P.roofType === 'matbae' ? fr.U0 + 0.05 : f.u0 + (fr.hipL ? inset(lv) : 0);
    const endMax = (lv: number) => joinMax ? joinMax.to / 1000 : P.roofType === 'matbae' ? fr.U1 - 0.05 : f.u1 - (fr.hipR ? inset(lv) : 0);
    const fits = (u: number, lv: number) => u >= endMin(lv) - 0.06 && u <= endMax(lv) + 0.06;
    for (const lv of levels) {
      const vs = lv === 1 ? [vc] : [f.v0 + lv * half, f.v1 - lv * half];
      const r = lv === 1 ? ridgeDoriR : lv === 0 ? doriR : doriR * 0.92;
      const name = lv === 0 ? '주심도리' : lv === 1 ? '종도리' : '중도리';
      const uStart = endMin(lv), uEnd = endMax(lv);
      if (uEnd - uStart < 0.3) continue;
      for (const v of vs) {
        const a = f.toWorld(uStart, v, doriY(lv)), b = f.toWorld(uEnd, v, doriY(lv));
        add('frame', cylBetween(a, b, r), m.beam, { name, spec: `Ø${Math.round(r * 2000)}×${Math.round(a.distanceTo(b) * 1000)}`, ifc: 'IfcMember' });
        bom.add(`dori-${name}`, '보·도리', name, `Ø${Math.round(r * 2000)}`, 1, '본', Math.PI * r * r * a.distanceTo(b));
        // 장여
        const jy = doriY(lv) - r - 0.06;
        add('frame', boxBetween(f.toWorld(uStart, v, jy), f.toWorld(uEnd, v, jy), D * 0.4, 0.12), m.beam, { name: `${name} 장여`, spec: `${Math.round(D * 400)}×120`, ifc: 'IfcMember' });
      }
    }
    // 측면 주심도리(우진각·팔작의 박공 없는 끝)
    if (P.roofType !== 'matbae') {
      for (const [u, joined] of [[f.u0, !!joinMin], [f.u1, !!joinMax]] as const) {
        if (joined) continue;
        const a = f.toWorld(u, f.v0 - 0.35, doriY(0)), b = f.toWorld(u, f.v1 + 0.35, doriY(0));
        add('frame', cylBetween(a, b, doriR), m.beam, { name: '측면 주심도리', spec: `Ø${Math.round(doriR * 2000)}`, ifc: 'IfcMember' });
        bom.add('dori-주심도리', '보·도리', '주심도리', `Ø${Math.round(doriR * 2000)}`, 1, '본', Math.PI * doriR * doriR * a.distanceTo(b));
      }
    }
    // 보 걸 위치: 양쪽 기둥 열에 기둥이 있는 격자선 + 양 끝
    const gridU = (w.axis === 'x' ? p.grid.xs : p.grid.ys).map((v) => v / 1000).filter((u) => u >= f.u0 - 1e-6 && u <= f.u1 + 1e-6);
    const hasPillar = (u: number, v: number) => p.pillars.some((q) => {
      const [qu, qv] = w.axis === 'x' ? [q.x / 1000, q.y / 1000] : [q.y / 1000, q.x / 1000];
      return Math.abs(qu - u) < 0.35 && Math.abs(qv - v) < 0.35;
    });
    const truss = gridU.filter((u, k) => k === 0 || k === gridU.length - 1 || (hasPillar(u, f.v0) && hasPillar(u, f.v1)));
    for (const u of truss) {
      const yB = doriY(0) - doriR - beamH / 2 + 0.04;
      const a = f.toWorld(u, f.v0 - 0.25, yB), b = f.toWorld(u, f.v1 + 0.25, yB);
      maxBeamSpan = Math.max(maxBeamSpan, f.v1 - f.v0);
      add('frame', boxBetween(a, b, beamW, beamH), m.beam, { name: '대들보', spec: `${Math.round(beamW * 1000)}×${Math.round(beamH * 1000)}×${Math.round(a.distanceTo(b) * 1000)}`, ifc: 'IfcBeam' });
      for (const end of [a, b]) {
        const d = (end === a ? b.clone().sub(a) : a.clone().sub(b)).setLength(0.35);
        add('frame', boxBetween(end.clone().add(d.clone().multiplyScalar(0.55)), end.clone().add(d.clone().multiplyScalar(1.3)), beamW + 0.012, beamH + 0.012), m.accent2).userData.decor = true;
      }
      bom.add('beam-dae', '보·도리', '대들보', `${Math.round(beamW * 1000)}×${Math.round(beamH * 1000)}`, 1, '본', beamW * beamH * a.distanceTo(b));
      let below = yB + beamH / 2;
      for (let k = 1; k < levels.length; k++) {
        const lv = levels[k];
        if (!fits(u, lv)) break;   // 끝 칸 위쪽 부재는 합각·추녀 경사 아래에 들어가지 않는다
        if (lv === 1) {
          const top = doriY(1) - ridgeDoriR - 0.12;
          if (top - below > 0.05) {
            add('frame', boxBetween(f.toWorld(u, vc, below), f.toWorld(u, vc, top), 0.3, D * 0.7), m.beam, { name: '판대공', spec: `${Math.round((top - below) * 1000)}mm`, ifc: 'IfcMember' });
            bom.add('daegong', '보·도리', '판대공', '', 1, '개', 0.3 * D * 0.7 * (top - below));
          }
          continue;
        }
        const yU = doriY(lv) - doriR - upH / 2 + 0.04;
        const va = f.v0 + lv * half, vb = f.v1 - lv * half;
        for (const v of [va, vb]) {
          if (yU - upH / 2 - below > 0.04) {
            add('frame', boxBetween(f.toWorld(u, v, below), f.toWorld(u, v, yU - upH / 2), D * 0.6, D * 0.6), m.beam, { name: '동자주', spec: `${Math.round(D * 600)}각`, ifc: 'IfcColumn' });
            bom.add('dongja', '보·도리', '동자주', `${Math.round(D * 600)}각`, 1, '본', (D * 0.6) ** 2 * (yU - upH / 2 - below));
          }
        }
        const ua = f.toWorld(u, va - 0.2, yU), ub = f.toWorld(u, vb + 0.2, yU);
        add('frame', boxBetween(ua, ub, upW, upH), m.beam, { name: '종보', spec: `${Math.round(upW * 1000)}×${Math.round(upH * 1000)}×${Math.round(ua.distanceTo(ub) * 1000)}`, ifc: 'IfcBeam' });
        bom.add('beam-jong', '보·도리', '종보', `${Math.round(upW * 1000)}×${Math.round(upH * 1000)}`, 1, '본', upW * upH * ua.distanceTo(ub));
        below = yU + upH / 2;
      }
    }
  });

  // 서까래(인스턴싱)
  if (rafterPairs.length) {
    const geo = new THREE.CylinderGeometry(rafterR, rafterR * 1.05, 1, 8);
    geo.rotateX(Math.PI / 2);
    const inst = new THREE.InstancedMesh(geo, m.rafter, rafterPairs.length);
    const tipGeo = new THREE.CylinderGeometry(rafterR * 1.02, rafterR * 1.02, 0.05, 8);
    tipGeo.rotateX(Math.PI / 2);
    const tips = new THREE.InstancedMesh(tipGeo, m.accent, rafterPairs.length);
    const o = new THREE.Object3D();
    let totalLen = 0;
    rafterPairs.forEach(([a, b], k) => {
      const len = a.distanceTo(b);
      totalLen += len;
      o.position.copy(a).add(b).multiplyScalar(0.5); o.lookAt(b); o.scale.set(1, 1, len); o.updateMatrix();
      inst.setMatrixAt(k, o.matrix);
      o.position.copy(a).addScaledVector(b.clone().sub(a).normalize(), 0.02); o.scale.set(1, 1, 1); o.updateMatrix();
      tips.setMatrixAt(k, o.matrix);
    });
    inst.castShadow = true; inst.receiveShadow = true;
    inst.userData.part = { name: '서까래(연목)', spec: `Ø${Math.round(rafterR * 2000)} · ${rafterPairs.length}본`, group: 'rafter', ifc: 'IfcMember' } satisfies PartInfo;
    tips.userData.decor = true;   // 서까래 마구리 색(단청용), BIM에는 넣지 않는다
    groups.rafter.add(inst, tips);
    bom.add('rafter', '서까래·추녀', '서까래(연목)', `Ø${Math.round(rafterR * 2000)}×평균 ${Math.round((totalLen / rafterPairs.length) * 1000)}`, rafterPairs.length, '본', Math.PI * rafterR * rafterR * totalLen);
  }

  // 기와(추정)
  if (roofArea > 0) {
    const basis = '골 간격 300mm, 암키와 노출 100mm, 수키와 노출 300mm 가정. 겹치는 회첨부는 한쪽만 셈.';
    bom.add('roof-area', '지붕·기와', '지붕 면적(기와 잇기)', '경사면 실면적', +roofArea.toFixed(1), '㎡', 0, true, basis);
    bom.add('tile-am', '지붕·기와', '암키와', '중와', Math.round(roofArea * 33.3), '매', 0, true, basis);
    bom.add('tile-su', '지붕·기와', '수키와', '중와', Math.round(roofArea * 11.1), '매', 0, true, basis);
    bom.add('tile-mak', '지붕·기와', '막새(암·수)', '처마 끝', Math.round((eaveLen / 0.3) * 2), '매', 0, true, '처마 길이 ÷ 골 간격 300mm × 2');
    bom.add('tile-maru', '지붕·기와', '마루기와(적새)', '용마루·추녀마루', +ridgeLen.toFixed(1), 'm', 0, true, '마루 길이 합계');
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const halfMain = main ? halfOf(main) : 1;
  const tipY = Number.isFinite(minEaveTip) ? minEaveTip : T;
  return {
    root, groups, bom: bom.rows(), footprint: fp, pillarMeshes, bounds, toWorld,
    metrics: {
      roofAreaM2: roofArea,
      eaveTipHeight: tipY,
      eaveAngleDeg: (Math.atan2(E, Math.max(0.1, tipY - G)) * 180) / Math.PI,
      roofPitchDeg: (Math.atan2(hRmain - hP, Math.max(0.1, halfMain)) * 180) / Math.PI,
      maxBeamSpan, beamDepth: beamH, maxDoriSpan, doriDiameter: doriR * 2,
      eaveLength: eaveLen, ridgeLength: ridgeLen,
    },
  };
}

/* ───────────── 도우미 ───────────── */

class Bom {
  private map = new Map<string, BomRow>();
  add(key: string, category: string, name: string, spec: string, count: number, unit: string, volumeM3: number, estimated = false, basis?: string) {
    const r = this.map.get(key);
    if (r) { r.count += count; r.volumeM3 += volumeM3; return; }
    this.map.set(key, { key, category, name, spec, count, unit, volumeM3, estimated, basis });
  }
  rows() {
    return [...this.map.values()].map((r) => ({ ...r, count: unitIsCount(r.unit) ? Math.round(r.count) : +r.count.toFixed(2), volumeM3: +r.volumeM3.toFixed(3) }));
  }
}
const unitIsCount = (u: string) => ['개', '본', '조', '짝', '매'].includes(u);

export function jae(m3: number) { return m3 / JAE_M3; }

function sameEdge(o: { x1: number; y1: number; x2: number; y2: number }, e: { x1: number; y1: number; x2: number; y2: number }) {
  const d = (a: number, b: number) => Math.abs(a - b) < 1;
  return (d(o.x1, e.x1) && d(o.y1, e.y1) && d(o.x2, e.x2) && d(o.y2, e.y2)) || (d(o.x1, e.x2) && d(o.y1, e.y2) && d(o.x2, e.x1) && d(o.y2, e.y1));
}

function outward(out: 'S' | 'N' | 'W' | 'E') {
  return { S: new THREE.Vector3(0, 0, 1), N: new THREE.Vector3(0, 0, -1), W: new THREE.Vector3(-1, 0, 0), E: new THREE.Vector3(1, 0, 0) }[out];
}

function latticeName(l: string) { return { tti: '띠살', se: '세살', wanja: '완자살', yongja: '용자살' }[l] ?? l; }

/** 텍스처가 크기에 맞게 반복되도록 UV를 면 크기/unit 배로 늘린 상자 */
export function scaledBox(w: number, h: number, d: number, unit: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / unit, uv.getY(i) * dims[f][1] / unit);
  }
  return g;
}

/** 창호 판: 앞뒤 면에만 창살 텍스처를 짝 수만큼 반복 */
function paneBox(w: number, h: number, t: number, repeat: number) {
  const g = new THREE.BoxGeometry(w, h, t);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 16; i < 24; i++) uv.setX(i, uv.getX(i) * repeat);
  return g;
}

function taperTop(geo: THREE.BufferGeometry, h: number, k: number) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const s = 1 - (1 - k) * (y / h);
    pos.setX(i, pos.getX(i) * s); pos.setZ(i, pos.getZ(i) * s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function visibleArea(geo: THREE.BufferGeometry, hidden: (p: THREE.Vector3) => boolean) {
  const pos = geo.getAttribute('position'); const idx = geo.getIndex();
  if (!idx) return 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cen = new THREE.Vector3();
  let area = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
    cen.copy(a).add(b).add(c).divideScalar(3);
    if (hidden(cen)) continue;
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  return area;
}
