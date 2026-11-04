// 손상 기록 도우미: 대상 부재 이름, 새 기록, 집계.

import type { DamageRecord, DamageTarget, Pillar, Project } from '../core/types';
import { CLASSES, type ClassId } from './taxonomy';

/** 기둥의 주열 위치 이름(예: X2-Y1). 격자선에서 멀면 좌표 대신 기둥 번호만 쓴다. */
export function pillarGridName(p: Project, pl: Pillar): string {
  const near = (vs: number[], v: number) => {
    let k = -1, d = Infinity;
    vs.forEach((x, i) => { const e = Math.abs(x - v); if (e < d) { d = e; k = i; } });
    return d < 400 ? k : -1;
  };
  const i = near(p.grid.xs, pl.x), j = near(p.grid.ys, pl.y);
  return i >= 0 && j >= 0 ? `${p.grid.labelsX[i]}-${p.grid.labelsY[j]}` : '';
}

export function targetLabel(p: Project, t: DamageTarget): string {
  if (t.kind === 'pillar') {
    const pl = p.pillars.find((q) => q.id === t.id);
    const grid = pl ? pillarGridName(p, pl) : '';
    return grid ? `기둥 ${grid}` : `기둥 ${t.id}`;
  }
  return t.name || '건물 전체';
}

export function sameTarget(a: DamageTarget, b: DamageTarget): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'pillar' ? a.id === (b as typeof a).id : a.name === (b as { name: string }).name;
}

export function damagesOf(p: Project, t: DamageTarget): DamageRecord[] {
  return p.damages.filter((d) => sameTarget(d.target, t));
}

/** 기둥별 가장 심한 손상 정도(3D·평면 표시용) */
export function pillarSeverity(p: Project): Map<string, DamageRecord['severity']> {
  const rank = { minor: 0, moderate: 1, severe: 2 } as const;
  const m = new Map<string, DamageRecord['severity']>();
  for (const d of p.damages) {
    if (d.target.kind !== 'pillar') continue;
    const cur = m.get(d.target.id);
    if (!cur || rank[d.severity] > rank[cur]) m.set(d.target.id, d.severity);
  }
  return m;
}

export function newDamageId(p: Project): string {
  let n = p.damages.length + 1;
  while (p.damages.some((d) => d.id === `D${String(n).padStart(3, '0')}`)) n++;
  return `D${String(n).padStart(3, '0')}`;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function blankDamage(p: Project, target: DamageTarget): DamageRecord {
  return { id: newDamageId(p), target, location: '', rawTerm: '', cls: 3, severity: 'moderate', statement: '', status: 'draft', boxes: [], surveyedAt: today() };
}

export interface DamageSummary { total: number; verified: number; withPhoto: number; boxes: number; byClass: { cls: ClassId; count: number }[] }

export function summarize(list: DamageRecord[]): DamageSummary {
  const counts = new Map<number, number>();
  for (const d of list) counts.set(d.cls, (counts.get(d.cls) ?? 0) + 1);
  return {
    total: list.length,
    verified: list.filter((d) => d.status === 'verified').length,
    withPhoto: list.filter((d) => d.photo).length,
    boxes: list.reduce((s, d) => s + d.boxes.length, 0),
    byClass: CLASSES.filter((c) => counts.has(c.id)).map((c) => ({ cls: c.id, count: counts.get(c.id)! })).sort((a, b) => b.count - a.count),
  };
}
