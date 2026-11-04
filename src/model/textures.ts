// 외부 이미지 없이 캔버스로 그리는 고해상도 PBR 재질 텍스처(Albedo + Bump/Roughness).
// 단색처럼 보이지 않도록 다중 주파수 나뭇결·옹이, 수키와·암키와 골 음영, 화강암 결정 입자,
// 회벽/황토 미장 질감, 한지 운룡지 섬유질과 창살 입체 그림자를 함께 생성한다.
// Node(테스트) 환경에서는 null을 돌려준다.

import * as THREE from 'three';
import type { Lattice } from '../core/types';

const hasDom = typeof document !== 'undefined';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function toTexture(c: HTMLCanvasElement, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture | null {
  if (!hasDom) return null;
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}

/** 기와 알베도: 가로 1칸 = 수키와 골 한 줄, 세로 1칸 = 암키와 한 단. 자연스러운 풍화·탄소 톤 변화 포함 */
export function tileTexture() {
  return cached('tile-v2', () => {
    const W = 256, H = 256;
    const [c, g] = canvas(W, H);
    // 암키와 골(깊고 어두운 차콜) → 경사면 → 수키와 등(하이라이트) → 골
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0.00, '#3e4247');
    grad.addColorStop(0.14, '#5a6067');
    grad.addColorStop(0.28, '#8d949c');
    grad.addColorStop(0.36, '#484d52'); // 수키와 옆 그림자
    grad.addColorStop(0.42, '#c8ced4');
    grad.addColorStop(0.50, '#f4f7fa'); // 수키와 마루 하이라이트
    grad.addColorStop(0.58, '#c5cbd1');
    grad.addColorStop(0.64, '#484d52');
    grad.addColorStop(0.72, '#8d949c');
    grad.addColorStop(0.86, '#5a6067');
    grad.addColorStop(1.00, '#3e4247');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // 암키와·수키와 단 이음매(겹침 그림자와 물끊기 단차)
    const step = 64;
    for (let y = 0; y < H; y += step) {
      // 암키와 겹침 그림자
      const sh = g.createLinearGradient(0, y, 0, y + 22);
      sh.addColorStop(0, 'rgba(12,15,18,0.58)');
      sh.addColorStop(0.35, 'rgba(18,22,26,0.24)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh;
      g.fillRect(0, y, W, 22);

      // 기와 코 하이라이트 림
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(0, (y + step - 2) % H, W, 2);

      // 수키와 마디 반원형 테두리 강조
      g.strokeStyle = 'rgba(20,24,28,0.45)';
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(W * 0.5, y + 4, W * 0.13, 0, Math.PI);
      g.stroke();
    }

    // 전통 토기 표면의 미세 입자 및 세월 흔적(이끼·빗물 얼룩)
    const r = rng(71);
    for (let i = 0; i < 2400; i++) {
      const x = r() * W, y = r() * H;
      const dark = r() > 0.45;
      g.fillStyle = dark ? `rgba(15,18,22,${r() * 0.09})` : `rgba(255,252,245,${r() * 0.07})`;
      g.fillRect(x, y, 1 + r() * 2.5, 1 + r() * 3.5);
    }
    return toTexture(c);
  });
}

/** 기와 범프맵: 수키와가 솟아오르고 암키와 골이 깊이 패인 높이맵 */
export function tileBumpTexture() {
  return cached('tile-bump', () => {
    const W = 256, H = 256;
    const [c, g] = canvas(W, H);
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0.00, '#181818');
    grad.addColorStop(0.25, '#555555');
    grad.addColorStop(0.37, '#383838');
    grad.addColorStop(0.50, '#ffffff');
    grad.addColorStop(0.63, '#383838');
    grad.addColorStop(0.75, '#555555');
    grad.addColorStop(1.00, '#181818');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 64) {
      const sh = g.createLinearGradient(0, y, 0, y + 14);
      sh.addColorStop(0, '#000000');
      sh.addColorStop(1, 'rgba(128,128,128,0)');
      g.fillStyle = sh;
      g.fillRect(0, y, W, 14);
    }
    return toTexture(c, true, false);
  });
}

/** 소나무 목재 알베도: 춘재·추재 나이테 결, 옹이, 부재 결 방향 음영 */
export function woodTexture() {
  return cached('wood-v2', () => {
    const W = 256, H = 512;
    const [c, g] = canvas(W, H);
    // 따뜻한 밝은 회갈색 베이스(재질 색상과 곱해질 때 채도와 깊이를 살림)
    const baseGrad = g.createLinearGradient(0, 0, W, 0);
    baseGrad.addColorStop(0.0, '#d8d0c5');
    baseGrad.addColorStop(0.25, '#ece6dc');
    baseGrad.addColorStop(0.55, '#f5f0e8');
    baseGrad.addColorStop(0.82, '#e5ddd2');
    baseGrad.addColorStop(1.0, '#d4cbc0');
    g.fillStyle = baseGrad;
    g.fillRect(0, 0, W, H);

    const r = rng(33);
    // 넓은 결(심재·변재 톤 변화)
    for (let i = 0; i < 18; i++) {
      const x = r() * W;
      const w = 8 + r() * 22;
      const alpha = 0.04 + r() * 0.06;
      g.fillStyle = i % 2 === 0 ? `rgba(75,45,20,${alpha})` : `rgba(255,248,235,${alpha})`;
      g.fillRect(x - w / 2, 0, w, H);
    }

    // 옹이(Knot) 2곳 생성 및 주변 휘어지는 나이테
    const knots = [
      { x: W * 0.28, y: H * 0.32, rx: 10, ry: 22 },
      { x: W * 0.74, y: H * 0.76, rx: 8, ry: 18 },
    ];

    // 세밀한 소나무 나이테 곡선
    for (let i = 0; i < 95; i++) {
      const x0 = (i / 95) * W + (r() - 0.5) * 3;
      const w = 0.7 + r() * 1.9;
      const dark = i % 3 === 0;
      g.strokeStyle = dark
        ? `rgba(62,36,14,${0.10 + r() * 0.16})`
        : `rgba(110,72,38,${0.05 + r() * 0.09})`;
      g.lineWidth = w;
      g.beginPath();
      for (let y = 0; y <= H; y += 8) {
        let dx = Math.sin(y / 52 + i * 0.35) * 3.2 + Math.cos(y / 19 - i * 0.2) * 1.1;
        for (const k of knots) {
          const dy = y - k.y;
          const dist = Math.hypot((x0 - k.x) * 1.6, dy * 0.65);
          if (dist < 48) {
            const push = (1 - dist / 48) * (k.rx + 6);
            dx += (x0 >= k.x ? 1 : -1) * push * Math.cos((dy / 48) * (Math.PI / 2));
          }
        }
        if (y === 0) g.moveTo(x0 + dx, y);
        else g.lineTo(x0 + dx, y);
      }
      g.stroke();
    }

    // 옹이 중심부 그리기
    for (const k of knots) {
      g.save();
      g.translate(k.x, k.y);
      g.scale(1, k.ry / k.rx);
      const kg = g.createRadialGradient(0, 0, 1, 0, 0, k.rx);
      kg.addColorStop(0, 'rgba(48,26,10,0.42)');
      kg.addColorStop(0.55, 'rgba(72,42,18,0.22)');
      kg.addColorStop(1, 'rgba(72,42,18,0)');
      g.fillStyle = kg;
      g.beginPath();
      g.arc(0, 0, k.rx, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // 미세 목재 섬유 도관(Pores)
    for (let i = 0; i < 1200; i++) {
      g.fillStyle = `rgba(50,30,12,${r() * 0.07})`;
      g.fillRect(r() * W, r() * H, 1, 4 + r() * 10);
    }
    return toTexture(c);
  });
}

/** 목재 범프맵: 나뭇결 방향의 미세한 요철 */
export function woodBumpTexture() {
  return cached('wood-bump', () => {
    const W = 128, H = 256;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, W, H);
    const r = rng(39);
    for (let i = 0; i < 70; i++) {
      const x = (i / 70) * W;
      g.strokeStyle = i % 2 === 0 ? `rgba(255,255,255,${0.12 + r() * 0.15})` : `rgba(0,0,0,${0.12 + r() * 0.15})`;
      g.lineWidth = 1 + r() * 1.5;
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= H; y += 12) g.lineTo(x + Math.sin(y / 42 + i * 0.3) * 2.4, y);
      g.stroke();
    }
    return toTexture(c, true, false);
  });
}

/** 회벽/황토벽 알베도: 흙미장 구름 무늬, 모래 알갱이, 미세한 짚풀 질감 */
export function plasterTexture() {
  return cached('plaster-v2', () => {
    const W = 256, H = 256;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#f2efe9';
    g.fillRect(0, 0, W, H);
    const r = rng(11);
    // 흙손 미장 얼룩(부드러운 구름 톤 변화)
    for (let i = 0; i < 45; i++) {
      const x = r() * W, y = r() * H, rad = 24 + r() * 55;
      const grd = g.createRadialGradient(x, y, 2, x, y, rad);
      const warm = r() > 0.5;
      grd.addColorStop(0, warm ? 'rgba(150,130,100,0.06)' : 'rgba(255,255,255,0.08)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 모래 입자 및 짚풀 섬유 흔적
    for (let i = 0; i < 4200; i++) {
      g.fillStyle = `rgba(85,72,52,${r() * 0.08})`;
      g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
    }
    g.strokeStyle = 'rgba(120,98,65,0.10)';
    g.lineWidth = 0.8;
    for (let i = 0; i < 140; i++) {
      const x = r() * W, y = r() * H, ang = r() * Math.PI * 2, len = 4 + r() * 8;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.stroke();
    }
    return toTexture(c);
  });
}

/** 회벽 범프맵 */
export function plasterBumpTexture() {
  return cached('plaster-bump', () => {
    const W = 128, H = 128;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, W, H);
    const r = rng(19);
    for (let i = 0; i < 3000; i++) {
      const v = Math.floor(95 + (r() - 0.5) * 90);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(r() * W, r() * H, 1.5, 1.5);
    }
    return toTexture(c, true, false);
  });
}

/** 장대석 기단 및 화강암 석재 알베도: 포천석/화강암 석영·운모 스펙클 + 정교한 줄눈과 모서리 음영 */
export function stoneTexture() {
  return cached('stone-v2', () => {
    const W = 512, H = 256;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#dcd8d0';
    g.fillRect(0, 0, W, H);
    const r = rng(53);

    // 블록별 미세한 명도 차이
    const rows = 2;
    const rowH = H / rows;
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? 160 : 0;
      const y = row * rowH;
      for (let x = -off; x < W; x += 256) {
        const shade = (r() - 0.5) * 16;
        g.fillStyle = shade > 0 ? `rgba(255,252,245,${shade / 255})` : `rgba(40,36,30,${-shade / 255})`;
        g.fillRect(Math.max(0, x), y, Math.min(W - x, 256), rowH);
      }
    }

    // 화강암 흑운모·장석·석영 결정 입자
    for (let i = 0; i < 9000; i++) {
      const x = r() * W, y = r() * H;
      const k = r();
      if (k < 0.45) g.fillStyle = `rgba(25,24,22,${0.06 + r() * 0.14})`; // 흑운모
      else if (k < 0.8) g.fillStyle = `rgba(255,253,248,${0.08 + r() * 0.14})`; // 백색 장석
      else g.fillStyle = `rgba(130,115,95,${0.06 + r() * 0.10})`; // 황토빛 풍화
      const sz = 1 + r() * 2.4;
      g.fillRect(x, y, sz, sz);
    }

    // 장대석 줄눈(Mortar joint)과 베벨 하이라이트
    for (let row = 0; row < rows; row++) {
      const y = row * rowH;
      // 가로 줄눈
      g.fillStyle = 'rgba(35,32,28,0.68)';
      g.fillRect(0, y, W, 3);
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(0, y + 3, W, 2);

      const off = row % 2 ? 128 : 0;
      for (let x = off; x < W; x += 256) {
        g.fillStyle = 'rgba(35,32,28,0.62)';
        g.fillRect(x, y, 3, rowH);
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.fillRect(x + 3, y, 2, rowH);
      }
    }
    return toTexture(c);
  });
}

/** 석재 범프맵: 정교한 정다듬 화강암 요철과 줄눈 깊이 */
export function stoneBumpTexture() {
  return cached('stone-bump', () => {
    const W = 256, H = 128;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#909090';
    g.fillRect(0, 0, W, H);
    const r = rng(59);
    for (let i = 0; i < 4000; i++) {
      const v = Math.floor(110 + (r() - 0.5) * 100);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(r() * W, r() * H, 2, 2);
    }
    g.fillStyle = '#151515';
    for (let row = 0; row < 2; row++) {
      const y = row * 64;
      g.fillRect(0, y, W, 3);
      const off = row % 2 ? 64 : 0;
      for (let x = off; x < W; x += 128) g.fillRect(x, y, 3, 64);
    }
    return toTexture(c, true, false);
  });
}

/** 우물마루: 장귀틀·동귀틀과 그 사이의 청판(쪽마루) 나뭇결 대비 */
export function maruTexture() {
  return cached('maru-v2', () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    g.fillStyle = '#e8dfd2';
    g.fillRect(0, 0, S, S);
    const r = rng(83);

    // 청판 판재마다 미묘한 톤 변화와 가로 나뭇결
    const stepY = 36;
    for (let y = 18; y < S; y += stepY) {
      const tone = (r() - 0.5) * 18;
      g.fillStyle = tone > 0 ? `rgba(255,248,235,${tone / 200})` : `rgba(80,45,15,${-tone / 200})`;
      g.fillRect(18, y, S - 18, stepY - 2);
      // 가로 결
      for (let k = 0; k < 10; k++) {
        const py = y + 3 + r() * (stepY - 6);
        g.strokeStyle = `rgba(75,45,18,${0.06 + r() * 0.08})`;
        g.lineWidth = 0.8 + r();
        g.beginPath();
        g.moveTo(18, py);
        g.lineTo(S, py + (r() - 0.5) * 2);
        g.stroke();
      }
      // 청판 이음매 홈
      g.fillStyle = 'rgba(45,26,10,0.42)';
      g.fillRect(18, y, S - 18, 2);
      g.fillStyle = 'rgba(255,250,240,0.22)';
      g.fillRect(18, y + 2, S - 18, 1);
    }

    // 장귀틀·동귀틀(굵은 프레임 부재)
    g.fillStyle = 'rgba(72,44,18,0.28)';
    g.fillRect(0, 0, S, 18);
    g.fillRect(0, 0, 18, S);
    g.strokeStyle = 'rgba(40,22,8,0.5)';
    g.lineWidth = 1.5;
    g.strokeRect(0.5, 0.5, S - 1, 18);
    g.strokeRect(0.5, 0.5, 18, S - 1);
    return toTexture(c);
  });
}

/** 온돌 콩댐 한지 장판 텍스처 */
export function ondolTexture() {
  return cached('ondol-v2', () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    g.fillStyle = '#efe8da';
    g.fillRect(0, 0, S, S);
    const r = rng(97);
    // 장판 한지 결 및 은은한 콩기름 윤기
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(130,90,30,${r() * 0.05})`;
      g.fillRect(r() * S, r() * S, 2 + r() * 4, 1 + r() * 2);
    }
    g.strokeStyle = 'rgba(110,75,30,0.28)';
    g.lineWidth = 1.5;
    for (let x = 0; x <= S; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
    for (let y = 0; y <= S; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
    return toTexture(c);
  });
}

/** 마당 백토(마사토) 다짐 텍스처 */
export function groundTexture() {
  return cached('ground-v2', () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    g.fillStyle = '#e7e2d8';
    g.fillRect(0, 0, S, S);
    const r = rng(21);
    for (let i = 0; i < 6500; i++) {
      const dark = r() > 0.4;
      g.fillStyle = dark ? `rgba(75,64,46,${r() * 0.11})` : `rgba(255,252,244,${r() * 0.12})`;
      g.fillRect(r() * S, r() * S, 1 + r() * 2.4, 1 + r() * 2.4);
    }
    return toTexture(c);
  });
}

/** 창호: 한지(운룡지) 섬유 결과 은은한 채광 그라디언트 + 입체 창살 */
export function latticeTexture(pattern: Lattice, bar: string, paper: string): THREE.Texture | null {
  if (!hasDom) return null;
  const key = `lattice-v2:${pattern}:${bar}:${paper}`;
  return cached(key, () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    g.fillStyle = paper;
    g.fillRect(0, 0, S, S);

    // 창호지 중앙부 은은한 채광 효과(Subsurface/Translucency 느낌)
    const glow = g.createRadialGradient(S * 0.5, S * 0.45, 12, S * 0.5, S * 0.5, S * 0.65);
    glow.addColorStop(0, 'rgba(255,253,245,0.32)');
    glow.addColorStop(0.6, 'rgba(255,248,230,0.10)');
    glow.addColorStop(1, 'rgba(60,42,20,0.12)');
    g.fillStyle = glow;
    g.fillRect(0, 0, S, S);

    // 한지 닥나무 섬유질 표현
    const r = rng(109);
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 0.7;
    for (let i = 0; i < 220; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI * 2, l = 5 + r() * 14;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a + 0.4) * (l * 0.5), y + Math.sin(a + 0.4) * (l * 0.5), x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }

    const frame = 14;
    // 창살 그림자 + 본체 그리기 도우미
    const line = (x1: number, y1: number, x2: number, y2: number, w = 4.2) => {
      g.save();
      g.strokeStyle = 'rgba(25,15,5,0.26)';
      g.lineWidth = w + 2;
      g.beginPath(); g.moveTo(x1 + 1.5, y1 + 1.5); g.lineTo(x2 + 1.5, y2 + 1.5); g.stroke();
      g.strokeStyle = bar;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.restore();
    };

    const inner = (fn: (a: number, b: number) => void) => fn(frame, S - frame);
    if (pattern === 'tti') {
      inner((a, b) => {
        for (let x = a + 18; x < b; x += 18) line(x, a, x, b, 3.8);
        for (const yy of [0.18, 0.24, 0.5, 0.76, 0.82]) line(a, S * yy, b, S * yy, 4.4);
      });
    } else if (pattern === 'se') {
      inner((a, b) => {
        for (let x = a + 22; x < b; x += 22) line(x, a, x, b, 3.6);
        for (let y = a + 30; y < b; y += 30) line(a, y, b, y, 3.6);
      });
    } else if (pattern === 'yongja') {
      inner((a, b) => {
        line((a + b) / 2, a, (a + b) / 2, b, 4.6);
        for (let y = a + 46; y < b; y += 46) line(a, y, b, y, 4.2);
      });
    } else {
      inner((a, b) => {
        const st = (b - a) / 4;
        for (let i = 0; i <= 4; i++) { line(a + i * st, a, a + i * st, b, 3.8); line(a, a + i * st, b, a + i * st, 3.8); }
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          const x = a + i * st, y = a + j * st, h = st / 2;
          line(x + h, y, x + h, y + h, 3); line(x + h, y + h, x + st, y + h, 3);
          line(x + h, y + st, x + h, y + h, 3); line(x + h, y + h, x, y + h, 3);
        }
      });
    }

    // 바깥 문얼굴(울거미) 테두리
    g.strokeStyle = 'rgba(20,10,4,0.35)';
    g.lineWidth = frame + 3;
    g.strokeRect(frame / 2, frame / 2, S - frame, S - frame);
    g.strokeStyle = bar;
    g.lineCap = 'square';
    g.lineWidth = frame;
    g.strokeRect(frame / 2, frame / 2, S - frame, S - frame);

    return toTexture(c, false);
  });
}
