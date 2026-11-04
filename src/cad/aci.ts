// AutoCAD Color Index(ACI) → RGB. 1~9는 표준값, 10~249는 색상환 규칙, 250~255는 회색조.

const BASE: Record<number, number> = {
  1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff, 5: 0x0000ff,
  6: 0xff00ff, 7: 0xffffff, 8: 0x808080, 9: 0xc0c0c0,
};
const GRAYS = [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff];

function hsvToRgb(h: number, s: number, v: number): number {
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

export function aciToRgb(index: number): number {
  if (BASE[index] !== undefined) return BASE[index];
  if (index >= 250 && index <= 255) return GRAYS[index - 250];
  if (index >= 10 && index <= 249) {
    const hue = Math.floor((index - 10) / 10) * 15;
    const step = (index - 10) % 10;
    const v = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][step];
    const s = step % 2 === 0 ? 1 : 0.5;
    return hsvToRgb(hue, s, v);
  }
  return 0xffffff;
}
