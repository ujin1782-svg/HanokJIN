// 외부 이미지 없이 캔버스로 그리는 재질 텍스처. 대부분 회색조로 그려 재질 색이 곱해지게 한다.
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

/** 기와: 가로 1칸 = 수키와 골 한 줄, 세로 1칸 = 암키와 한 단 */
export function tileTexture() {
  return cached('tile', () => {
    const [c, g] = canvas(128, 128);
    const grad = g.createLinearGradient(0, 0, 128, 0);
    // 암키와 골(어둡게) → 수키와 등(밝게) → 골
    grad.addColorStop(0, '#5a5a5a'); grad.addColorStop(0.18, '#7a7a7a');
    grad.addColorStop(0.32, '#d8d8d8'); grad.addColorStop(0.5, '#ffffff'); grad.addColorStop(0.68, '#d0d0d0');
    grad.addColorStop(0.82, '#7a7a7a'); grad.addColorStop(1, '#5a5a5a');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    // 기와 단 이음(아래쪽이 겹치는 그림자)
    for (let y = 0; y < 128; y += 32) {
      const sh = g.createLinearGradient(0, y, 0, y + 10);
      sh.addColorStop(0, 'rgba(0,0,0,0.38)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh; g.fillRect(0, y, 128, 10);
    }
    const r = rng(7);
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.06})`; g.fillRect(r() * 128, r() * 128, 2, 2); }
    return toTexture(c);
  });
}

export function woodTexture() {
  return cached('wood', () => {
    const [c, g] = canvas(64, 256);
    g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, 64, 256);
    const r = rng(3);
    for (let i = 0; i < 26; i++) {
      const x = r() * 64, w = 0.6 + r() * 1.8;
      g.strokeStyle = `rgba(60,40,20,${0.08 + r() * 0.14})`; g.lineWidth = w;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= 256; y += 16) g.lineTo(x + Math.sin(y / 40 + i) * 2.5, y);
      g.stroke();
    }
    return toTexture(c);
  });
}

export function plasterTexture() {
  return cached('plaster', () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 128, 128);
    const r = rng(11);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(90,80,60,${r() * 0.05})`; g.fillRect(r() * 128, r() * 128, 1 + r() * 2, 1 + r() * 2); }
    return toTexture(c);
  });
}

/** 장대석 기단 */
export function stoneTexture() {
  return cached('stone', () => {
    const [c, g] = canvas(256, 128);
    g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, 256, 128);
    const r = rng(5);
    for (let i = 0; i < 2000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.07})`; g.fillRect(r() * 256, r() * 128, 1.5, 1.5); }
    g.strokeStyle = 'rgba(50,50,50,0.55)'; g.lineWidth = 2;
    for (let row = 0; row < 2; row++) {
      const y = row * 64;
      g.beginPath(); g.moveTo(0, y + 1); g.lineTo(256, y + 1); g.stroke();
      const off = row % 2 ? 90 : 0;
      for (let x = off; x < 256; x += 180) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); }
    }
    return toTexture(c);
  });
}

/** 우물마루: 장귀틀 사이 청판 */
export function maruTexture() {
  return cached('maru', () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(70,45,20,0.35)';
    g.fillRect(0, 0, 256, 14); g.fillRect(0, 0, 14, 256);
    g.strokeStyle = 'rgba(70,45,20,0.22)'; g.lineWidth = 1.5;
    for (let y = 14; y < 256; y += 40) { g.beginPath(); g.moveTo(14, y); g.lineTo(256, y); g.stroke(); }
    return toTexture(c);
  });
}

export function ondolTexture() {
  return cached('ondol', () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#f0f0f0'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(120,90,40,0.25)'; g.lineWidth = 1;
    for (let x = 0; x <= 128; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    for (let y = 0; y <= 128; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
    return toTexture(c);
  });
}

export function groundTexture() {
  return cached('ground', () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#ececec'; g.fillRect(0, 0, 256, 256);
    const r = rng(21);
    for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(80,70,50,${r() * 0.08})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2); }
    return toTexture(c);
  });
}

/** 창호: 창살 무늬 + 창호지. 창살 색과 종이 색을 직접 그린다(색 곱하지 않음). */
export function latticeTexture(pattern: Lattice, bar: string, paper: string): THREE.Texture | null {
  if (!hasDom) return null;
  const key = `lattice:${pattern}:${bar}:${paper}`;
  return cached(key, () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    g.fillStyle = paper; g.fillRect(0, 0, S, S);
    g.strokeStyle = bar; g.lineCap = 'square';
    const frame = 14;
    g.lineWidth = frame; g.strokeRect(frame / 2, frame / 2, S - frame, S - frame);
    g.lineWidth = 4;
    const line = (x1: number, y1: number, x2: number, y2: number) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
    const inner = (fn: (a: number, b: number) => void) => fn(frame, S - frame);
    if (pattern === 'tti') {
      inner((a, b) => {
        for (let x = a + 18; x < b; x += 18) line(x, a, x, b);
        for (const yy of [0.18, 0.24, 0.5, 0.76, 0.82]) line(a, S * yy, b, S * yy);
      });
    } else if (pattern === 'se') {
      inner((a, b) => { for (let x = a + 22; x < b; x += 22) line(x, a, x, b); for (let y = a + 30; y < b; y += 30) line(a, y, b, y); });
    } else if (pattern === 'yongja') {
      inner((a, b) => { line((a + b) / 2, a, (a + b) / 2, b); for (let y = a + 46; y < b; y += 46) line(a, y, b, y); });
    } else {
      // 완자살(卍 무늬 반복)
      inner((a, b) => {
        const st = (b - a) / 4;
        for (let i = 0; i <= 4; i++) { line(a + i * st, a, a + i * st, b); line(a, a + i * st, b, a + i * st); }
        g.lineWidth = 3;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          const x = a + i * st, y = a + j * st, h = st / 2;
          line(x + h, y, x + h, y + h); line(x + h, y + h, x + st, y + h);
          line(x + h, y + st, x + h, y + h); line(x + h, y + h, x, y + h);
        }
      });
    }
    return toTexture(c, false);
  });
}
