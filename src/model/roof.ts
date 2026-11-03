// 한 채(날개)의 지붕면 생성. 국부 좌표 u=용마루 방향, v=용마루에 직각(m).
// 지붕면 높이는 처마(t=0)→용마루(t=1) 단면 곡선 h(t)에 앙곡(들림)을 더한다.
// 앙곡·안허리곡은 평면 위치(u,v)만의 함수라서 이웃한 면의 경계가 정확히 일치한다.

import * as THREE from 'three';
import type { RoofType } from '../core/types';

export interface RoofSpec {
  u0: number; u1: number; v0: number; v1: number;  // 기둥 열(주심) 사각형
  eaves: number;                                    // 처마 내밀기
  joinMin?: number; joinMax?: number;               // 다른 채에 붙는 쪽: 지붕을 이 u까지 늘이고 처마를 두지 않는다
  type: RoofType;
  h: (t: number) => number;                         // 단면 곡선(지붕면 윗면 높이)
  anggok: number; anheori: number;                  // m
  thick: number;                                    // 기와+개판 두께
  toWorld: (u: number, v: number, y: number) => THREE.Vector3;
}

export interface RoofResult {
  top: THREE.BufferGeometry;
  under: THREE.BufferGeometry;
  fascia: THREE.BufferGeometry;
  gable: THREE.BufferGeometry | null;
  ridges: { kind: '용마루' | '추녀마루' | '내림마루'; pts: THREE.Vector3[] }[];
  rafters: [THREE.Vector3, THREE.Vector3][];
  hips: [THREE.Vector3, THREE.Vector3][];
  frame: { V0: number; V1: number; vc: number; Dv: number; U0: number; U1: number; tG: number; hipL: boolean; hipR: boolean };
}

/** 평면 (u,v)에서 이 지붕 윗면의 높이(앙곡 제외). 지붕 밖이면 null */
export function surfaceHeight(fr: RoofResult['frame'], h: (t: number) => number, u: number, v: number): number | null {
  if (u < fr.U0 || u > fr.U1 || v < fr.V0 || v > fr.V1) return null;
  const tv = Math.min(v - fr.V0, fr.V1 - v) / fr.Dv;
  const tu = Math.min(fr.hipL ? u - fr.U0 : Infinity, fr.hipR ? fr.U1 - u : Infinity) / fr.Dv;
  return h(Math.min(1, tu < fr.tG ? Math.min(tv, tu) : tv));
}

const P_EXP = 2.4, Q_EXP = 2.2;

export function buildRoof(s: RoofSpec): RoofResult {
  const E = s.eaves;
  const sideE = s.type === 'matbae' ? E * 0.45 : E;
  const U0 = s.joinMin ?? s.u0 - sideE;
  const U1 = s.joinMax ?? s.u1 + sideE;
  const V0 = s.v0 - E, V1 = s.v1 + E, vc = (s.v0 + s.v1) / 2, Dv = vc - V0;
  const hipL = s.joinMin === undefined && s.type !== 'matbae';
  const hipR = s.joinMax === undefined && s.type !== 'matbae';
  let tG = s.type === 'ujingak' ? 1 : s.type === 'paljak' ? 0.5 : 0;
  const nHip = (hipL ? 1 : 0) + (hipR ? 1 : 0);
  if (nHip) tG = Math.min(tG, ((U1 - U0) / (nHip * Dv)) * 0.98);

  const uc = (U0 + U1) / 2;
  const cornerL = s.joinMin === undefined, cornerR = s.joinMax === undefined;
  const fu = (u: number) => (u >= uc ? (cornerR ? (u - uc) / (U1 - uc) : 0) : (cornerL ? (uc - u) / (uc - U0) : 0));
  const fv = (v: number) => Math.min(1, Math.abs(v - vc) / Dv);
  const hz = s.type === 'matbae' ? s.anggok * 0.35 : s.anggok;
  const hy = s.type === 'matbae' ? 0 : s.anheori;

  /** 평면 (u,v), 단면 비율 t → 지붕 윗면 점 */
  const point = (u: number, v: number, t: number, dy = 0) => {
    const a = Math.max(0, Math.min(1, fu(u))), b = fv(v);
    const lift = hz * Math.pow(a * b, P_EXP);
    const du = Math.sign(u - uc) * hy * Math.pow(b, Q_EXP) * Math.pow(a, 4);
    const dv = Math.sign(v - vc) * hy * Math.pow(a, Q_EXP) * Math.pow(b, 4);
    return s.toWorld(u + du, v + dv, s.h(t) + lift + dy);
  };

  const uL = (t: number) => (hipL ? U0 + Math.min(t, tG) * Dv : U0);
  const uR = (t: number) => (hipR ? U1 - Math.min(t, tG) * Dv : U1);

  const top = new Grid(), under = new Grid(), fascia = new Grid();
  const ridges: RoofResult['ridges'] = [];
  const rafters: RoofResult['rafters'] = [];
  const hips: RoofResult['hips'] = [];
  const tPillar = E / Dv;
  const tRows = (t0: number, t1: number, n: number) => Array.from({ length: n + 1 }, (_, i) => t0 + (t1 - t0) * Math.pow(i / n, 1.15));

  // 앞·뒤 긴 면
  for (const side of [-1, 1] as const) {
    const vAt = (t: number) => (side < 0 ? V0 + t * Dv : V1 - t * Dv);
    const ts = tRows(0, 1, 16);
    const ns = Math.max(8, Math.ceil((U1 - U0) / 0.3));
    const map = (sI: number, t: number, dy: number) => point(uL(t) + (uR(t) - uL(t)) * sI, vAt(t), t, dy);
    const uvU = (sI: number, t: number) => (uL(t) + (uR(t) - uL(t)) * sI) / 0.3;
    top.patch(ns, ts, (sI, t) => map(sI, t, 0), (sI, t) => [uvU(sI, t), (t * Dv * 1.25) / 0.32], side > 0);
    under.patch(ns, ts, (sI, t) => map(sI, t, -s.thick), (sI, t) => [uvU(sI, t) * 0.3, t * Dv], side < 0);
    fascia.strip(ns, (sI) => map(sI, 0, 0), (sI) => map(sI, 0, -s.thick));
    // 서까래: 처마 끝에서 주심 안쪽까지
    const nr = Math.max(4, Math.round((U1 - U0) / 0.42));
    for (let k = 0; k <= nr; k++) {
      const sI = k / nr;
      const a = map(sI, 0, -s.thick - 0.05), b = map(sI, Math.min(1, tPillar + 0.12), -s.thick - 0.05);
      rafters.push([a.clone().add(a.clone().sub(b).setLength(0.05)), b]);
    }
    if (hipL) {
      ridges.push({ kind: '추녀마루', pts: tRows(0, tG, 8).map((t) => point(uL(t), vAt(t), t, 0.06)) });
      hips.push([point(uL(0), vAt(0), 0, -s.thick - 0.1), point(uL(Math.min(tG, tPillar + 0.25)), vAt(Math.min(tG, tPillar + 0.25)), Math.min(tG, tPillar + 0.25), -s.thick - 0.1)]);
    }
    if (hipR) {
      ridges.push({ kind: '추녀마루', pts: tRows(0, tG, 8).map((t) => point(uR(t), vAt(t), t, 0.06)) });
      hips.push([point(uR(0), vAt(0), 0, -s.thick - 0.1), point(uR(Math.min(tG, tPillar + 0.25)), vAt(Math.min(tG, tPillar + 0.25)), Math.min(tG, tPillar + 0.25), -s.thick - 0.1)]);
    }
    if (s.type === 'paljak' && (hipL || hipR)) {
      if (hipL) ridges.push({ kind: '내림마루', pts: tRows(tG, 1, 8).map((t) => point(uL(t), vAt(t), t, 0.06)) });
      if (hipR) ridges.push({ kind: '내림마루', pts: tRows(tG, 1, 8).map((t) => point(uR(t), vAt(t), t, 0.06)) });
    }
    if (s.type === 'matbae') {
      if (cornerL) ridges.push({ kind: '내림마루', pts: tRows(0, 1, 10).map((t) => point(U0, vAt(t), t, 0.06)) });
      if (cornerR) ridges.push({ kind: '내림마루', pts: tRows(0, 1, 10).map((t) => point(U1, vAt(t), t, 0.06)) });
    }
  }

  // 양 끝 짧은 면(우진각·팔작의 아랫부분)
  for (const end of [-1, 1] as const) {
    if (tG <= 0 || (end < 0 ? !hipL : !hipR)) continue;
    const uAt = (t: number) => (end < 0 ? U0 + t * Dv : U1 - t * Dv);
    const ts = tRows(0, tG, Math.max(4, Math.round(16 * tG)));
    const ns = Math.max(6, Math.ceil((V1 - V0) / 0.3));
    const map = (sI: number, t: number, dy: number) => point(uAt(t), V0 + t * Dv + (V1 - V0 - 2 * t * Dv) * sI, t, dy);
    const uvU = (sI: number, t: number) => (V0 + t * Dv + (V1 - V0 - 2 * t * Dv) * sI) / 0.3;
    top.patch(ns, ts, (sI, t) => map(sI, t, 0), (sI, t) => [uvU(sI, t), (t * Dv * 1.25) / 0.32], end < 0);
    under.patch(ns, ts, (sI, t) => map(sI, t, -s.thick), (sI, t) => [uvU(sI, t) * 0.3, t * Dv], end > 0);
    fascia.strip(ns, (sI) => map(sI, 0, 0), (sI) => map(sI, 0, -s.thick));
    const nr = Math.max(3, Math.round((V1 - V0) / 0.42));
    for (let k = 1; k < nr; k++) {
      const sI = k / nr;
      const tt = Math.min(tG, tPillar + 0.12);
      const a = map(sI, 0, -s.thick - 0.05), b = map(sI, tt, -s.thick - 0.05);
      rafters.push([a.clone().add(a.clone().sub(b).setLength(0.05)), b]);
    }
  }

  // 용마루
  ridges.push({ kind: '용마루', pts: [point(uL(1), vc, 1, 0.1), point(uR(1), vc, 1, 0.1)] });

  // 합각벽(팔작) / 박공벽(맞배)
  let gable: THREE.BufferGeometry | null = null;
  const g = new Grid();
  const fanWall = (u: number, baseY: number, topAt: (t: number) => THREE.Vector3, t0: number) => {
    const ts = tRows(t0, 1, 10);
    const front = ts.map((t) => topAt(t));
    const back = ts.map((t) => topAt(-t)).reverse();
    const outline = [...front, ...back.slice(1)];
    const baseMid = s.toWorld(u, vc, baseY);
    const left = s.toWorld(u, V0 + t0 * Dv, baseY), right = s.toWorld(u, V1 - t0 * Dv, baseY);
    g.fan(baseMid, [left, ...outline, right]);
  };
  if (s.type === 'paljak' && tG > 0 && tG < 1) {
    for (const end of [-1, 1] as const) {
      if (end < 0 ? !hipL : !hipR) continue;
      const u = (end < 0 ? U0 + tG * Dv : U1 - tG * Dv) - end * 0.18;
      const yb = s.h(tG) - s.thick;
      fanWall(u, yb, (tt) => { const t = Math.abs(tt); return s.toWorld(u, tt >= 0 ? V0 + t * Dv : V1 - t * Dv, s.h(t) - s.thick - 0.02); }, tG);
    }
  } else if (s.type === 'matbae') {
    for (const end of [-1, 1] as const) {
      if (end < 0 ? !cornerL : !cornerR) continue;
      const u = end < 0 ? s.u0 : s.u1;
      const t0 = E / Dv;
      fanWall(u, s.h(t0) - s.thick - 0.3, (tt) => { const t = Math.max(t0, Math.abs(tt)); return s.toWorld(u, tt >= 0 ? V0 + t * Dv : V1 - t * Dv, s.h(t) - s.thick - 0.02); }, t0);
    }
  }
  if (g.count) gable = g.build();

  return {
    top: top.build(), under: under.build(), fascia: fascia.build(), gable, ridges, rafters, hips,
    frame: { V0, V1, vc, Dv, U0, U1, tG, hipL, hipR },
  };
}

/** 격자 패치를 모아 하나의 BufferGeometry로 만든다. */
class Grid {
  pos: number[] = []; uv: number[] = []; idx: number[] = [];
  get count() { return this.idx.length; }

  patch(ns: number, ts: number[], f: (s: number, t: number) => THREE.Vector3, uvf: (s: number, t: number) => [number, number], flip: boolean) {
    const base = this.pos.length / 3;
    for (const t of ts) for (let i = 0; i <= ns; i++) {
      const p = f(i / ns, t);
      this.pos.push(p.x, p.y, p.z);
      const [a, b] = uvf(i / ns, t);
      this.uv.push(a, b);
    }
    const w = ns + 1;
    for (let r = 0; r < ts.length - 1; r++) for (let i = 0; i < ns; i++) {
      const a = base + r * w + i, b = a + 1, c = a + w, d = c + 1;
      if (flip) this.idx.push(a, c, b, b, c, d); else this.idx.push(a, b, c, b, d, c);
    }
  }

  strip(n: number, upper: (s: number) => THREE.Vector3, lower: (s: number) => THREE.Vector3) {
    const base = this.pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const a = upper(i / n), b = lower(i / n);
      this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      this.uv.push(i / n * 8, 0, i / n * 8, 0.1);
    }
    for (let i = 0; i < n; i++) { const a = base + i * 2; this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }

  fan(center: THREE.Vector3, ring: THREE.Vector3[]) {
    const base = this.pos.length / 3;
    this.pos.push(center.x, center.y, center.z); this.uv.push(0, 0);
    for (const p of ring) { this.pos.push(p.x, p.y, p.z); this.uv.push(p.x, p.y); }
    for (let i = 0; i < ring.length - 1; i++) this.idx.push(base, base + 1 + i, base + 2 + i);
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    geo.computeVertexNormals();
    return geo;
  }
}
