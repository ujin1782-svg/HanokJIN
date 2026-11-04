// 모델 검증. 모든 결과는 현재 프로젝트와 생성된 모델에서 계산한다(고정 문구 없음).
// 구조 항목은 전통 목구조 경험식에 따른 참고 판정이며 구조계산을 대신하지 않는다.

import type { CheckResult, Project } from '../core/types';
import type { Build } from './hanok';

export function validate(p: Project, b: Build): CheckResult[] {
  const out: CheckResult[] = [];
  const P = p.params;
  const fp = b.footprint;

  if (p.grid.xs.length < 2 || p.grid.ys.length < 2) {
    out.push({ id: 'grid', status: 'fail', title: '격자(주열)가 없습니다', detail: '평면도에서 주열을 찾지 못해 모델을 만들 수 없습니다. 기둥을 직접 추가하거나 예제 프로젝트를 열어 보세요.' });
    return out;
  }
  if (!fp.wings.length) {
    out.push({ id: 'footprint', status: 'fail', title: '건물 외곽을 만들 수 없습니다', detail: `기둥 ${p.pillars.length}개로는 닫힌 평면이 되지 않습니다. 모서리 기둥이 빠졌는지 확인해 주세요.` });
  } else {
    out.push({ id: 'footprint', status: 'info', title: `평면 형태: ${fp.shape}`, detail: `${fp.wings.length}채, 외벽 ${fp.edges.length}칸, 기둥 ${p.pillars.length}개로 지붕을 구성했습니다.` });
  }

  // 인식 검토 항목
  for (const pl of p.pillars.filter((q) => q.review)) {
    out.push({ id: `review-${pl.id}`, status: 'warn', title: `기둥 ${pl.id} 확인 필요`, detail: pl.review!, focus: { pillarId: pl.id } });
  }

  // 겹친 기둥(구조 간섭)
  for (let i = 0; i < p.pillars.length; i++) for (let j = i + 1; j < p.pillars.length; j++) {
    const a = p.pillars[i], c = p.pillars[j];
    const d = Math.hypot(a.x - c.x, a.y - c.y);
    if (d < (a.size + c.size) / 2 + 50) {
      out.push({ id: `clash-${a.id}-${c.id}`, status: 'fail', title: `구조 간섭: ${a.id} ↔ ${c.id}`, detail: `두 기둥 중심 거리 ${Math.round(d)}mm로 서로 겹칩니다. 하나를 지우거나 옮겨 주세요.`, focus: { pillarId: a.id } });
    }
  }

  // 격자 밖으로 벗어나 외곽에 쓰이지 않은 기둥
  const unused = p.pillars.filter((q) => ![...fp.at.values()].includes(q));
  for (const q of unused) {
    if (q.review) continue;
    out.push({ id: `offgrid-${q.id}`, status: 'warn', title: `기둥 ${q.id}가 격자 밖에 있습니다`, detail: '격자 교차점에 놓이지 않은 기둥은 보·도리 배치에 반영되지 않습니다.', focus: { pillarId: q.id } });
  }

  if (fp.wings.length) {
    const m = b.metrics;
    // 도리 경간: 경험적으로 도리 지름의 약 15배 이내
    const doriRatio = (m.maxDoriSpan * 1000) / (m.doriDiameter * 1000);
    out.push({
      id: 'dori-span', status: doriRatio <= 15 ? 'pass' : 'warn',
      title: '도리 경간(칸 너비) 참고 검토',
      detail: `가장 넓은 칸 ${Math.round(m.maxDoriSpan * 1000)}mm ÷ 주심도리 지름 ${Math.round(m.doriDiameter * 1000)}mm = ${doriRatio.toFixed(1)} (경험 기준 15 이하${doriRatio <= 15 ? ' 충족' : ' 초과 — 칸을 나누거나 기준 기둥 굵기 D를 키우세요'})`,
    });
    const beamRatio = (m.maxBeamSpan * 1000) / (m.beamDepth * 1000);
    out.push({
      id: 'beam-span', status: beamRatio <= 20 ? 'pass' : 'warn',
      title: '대들보 경간 대비 춤 참고 검토',
      detail: `경간 ${Math.round(m.maxBeamSpan * 1000)}mm ÷ 보 춤 ${Math.round(m.beamDepth * 1000)}mm = ${beamRatio.toFixed(1)} (경험 기준 20 이하${beamRatio <= 20 ? ' 충족' : ' 초과'})`,
    });
    // 처마 깊이: 기둥 밑동과 처마 끝을 잇는 선이 기둥과 이루는 각(전통적으로 약 28~33°)
    const ang = m.eaveAngleDeg;
    out.push({
      id: 'eave-angle', status: ang >= 26 && ang <= 35 ? 'pass' : 'warn',
      title: '처마 깊이(내밀기 각도)',
      detail: `기둥 밑동에서 처마 끝을 본 각 ${ang.toFixed(1)}° (전통 비례 약 28~33°, 허용 26~35°). ${ang < 26 ? '처마를 더 길게 하거나 기둥을 낮추면 비례가 좋아집니다.' : ang > 35 ? '처마가 깊어 실내가 어두울 수 있습니다. 처마 길이를 줄여 보세요.' : ''}`,
    });
    const pitch = m.roofPitchDeg;
    out.push({
      id: 'roof-pitch', status: pitch >= 20 && pitch <= 42 ? 'pass' : 'warn',
      title: '지붕 물매(평균 경사)',
      detail: `본채 주심~용마루 평균 경사 ${pitch.toFixed(1)}° (일반적인 기와지붕 약 20~42°)`,
    });
    if (m.eaveTipHeight < 2.2) {
      out.push({ id: 'eave-low', status: 'warn', title: '처마 끝이 낮습니다', detail: `처마 끝 높이 약 ${m.eaveTipHeight.toFixed(2)}m. 사람이 드나드는 쪽은 2.2m 이상을 권장합니다.` });
    }
  }

  const clrOk = P.clearance >= 0.3 && P.clearance <= 1.2;
  out.push({ id: 'clearance', status: clrOk ? 'pass' : 'warn', title: '결구 유격', detail: `설정값 ${P.clearance.toFixed(1)}mm (시공 권장 0.3~1.2mm)` });

  if (fp.wings.length && !p.openings.some((o) => o.kind === 'door')) {
    out.push({ id: 'no-door', status: 'info', title: '출입문으로 인식된 칸이 없습니다', detail: '도면 이름표에서 문을 찾지 못했습니다. 외벽 칸을 선택해 창호 종류를 지정할 수 있습니다.' });
  }

  return out;
}
