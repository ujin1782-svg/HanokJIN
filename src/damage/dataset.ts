// 손상 조사 결과 내보내기: 조사표(CSV)와 학습 데이터셋(YOLO·COCO·VLM JSONL을 사진과 함께 ZIP으로).
// 브라우저 밖(테스트)에서도 돌도록 사진은 바이트로 받는다.

import type { DamageRecord, Project } from '../core/types';
import { CLASSES, FEASIBILITY_LABEL, ISSUE_LABEL, SEVERITY_LABEL, classById, correctTerm, draftStatement, type ClassId } from './taxonomy';
import { targetLabel } from './records';
import type { ZipEntry } from '../export/zip';

const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cls = (d: DamageRecord) => classById(d.cls as ClassId);

export function statementOf(p: Project, d: DamageRecord): string {
  return d.statement.trim() || draftStatement(d.cls as ClassId, targetLabel(p, d.target), d.location, d.severity);
}

export function surveyCsv(p: Project, list = p.damages): string {
  const head = ['기록번호', '조사일', '부위·부재', '부재 내 위치', '원문 표기', '용어 교정', '표준 손상 용어', '영문', '분류 계층', '손상 정도', '사진 판별', '병행 계측', '조사내용', '검수 상태', '사진', '표시 영역 수'];
  const rows = list.map((d) => {
    const c = cls(d), fix = correctTerm(d.rawTerm, targetLabel(p, d.target));
    return [d.id, d.surveyedAt, targetLabel(p, d.target), d.location, d.rawTerm, d.rawTerm ? ISSUE_LABEL[fix.issue] : '', c.ko, c.en, c.path.join(' > '),
      SEVERITY_LABEL[d.severity], FEASIBILITY_LABEL[c.feasibility], c.measure ?? '', statementOf(p, d), d.status === 'verified' ? '검수 완료' : '검토 중', d.photo?.name ?? '', d.boxes.length];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

const r4 = (v: number) => Math.min(1, Math.max(0, v)).toFixed(6);

/** YOLO 라벨: 줄마다 "클래스 중심x 중심y 너비 높이"(0~1). */
export function yoloLabel(d: DamageRecord): string {
  return d.boxes.map((b) => `${b.cls} ${r4(b.x + b.w / 2)} ${r4(b.y + b.h / 2)} ${r4(b.w)} ${r4(b.h)}`).join('\n') + (d.boxes.length ? '\n' : '');
}

export const imageName = (d: DamageRecord) => `${d.id}.jpg`;

export function cocoJson(p: Project, list: DamageRecord[]) {
  const withPhoto = list.filter((d) => d.photo);
  let ann = 1;
  return {
    info: { description: `${p.name} — 목조 건축문화유산 손상 데이터셋 (HanokJIN)`, version: '1.0', date_created: new Date().toISOString().slice(0, 10) },
    categories: CLASSES.map((c) => ({ id: c.id + 1, name: c.key, name_ko: c.ko, supercategory: c.group })),
    images: withPhoto.map((d, i) => ({
      id: i + 1, file_name: `images/${imageName(d)}`, width: d.photo!.w, height: d.photo!.h,
      structural_member: targetLabel(p, d.target), location: d.location, raw_term: d.rawTerm, status: d.status,
    })),
    annotations: withPhoto.flatMap((d, i) => d.boxes.map((b) => {
      const W = d.photo!.w, H = d.photo!.h;
      const bbox = [b.x * W, b.y * H, b.w * W, b.h * H].map((v) => Math.round(v * 10) / 10);
      return { id: ann++, image_id: i + 1, category_id: b.cls + 1, bbox, area: Math.round(bbox[2] * bbox[3]), iscrowd: 0,
        hierarchy: classById(b.cls as ClassId).path, severity: d.severity };
    })),
  };
}

const SYSTEM = '당신은 목조 건축문화유산 손상 진단 전문가입니다. 국가유산 정기조사 표준 손상 용어 체계(손상 > 열화·풍화·훼손 > 14개 시각 클래스)를 따릅니다.';

export function vlmJsonl(p: Project, list: DamageRecord[]): string {
  return list.filter((d) => d.photo).map((d) => {
    const c = cls(d), member = targetLabel(p, d.target);
    const answer = {
      structural_member: member, location: d.location, hierarchy_path: c.path, standard_damage_term: `${c.ko} (${c.en})`,
      corrected_from: d.rawTerm || null, severity: SEVERITY_LABEL[d.severity],
      bboxes_normalized: d.boxes.map((b) => ({ x: +b.x.toFixed(4), y: +b.y.toFixed(4), w: +b.w.toFixed(4), h: +b.h.toFixed(4), label: classById(b.cls as ClassId).ko })),
      survey_report_statement: statementOf(p, d),
    };
    return JSON.stringify({
      id: d.id, image: `images/${imageName(d)}`, verification_status: d.status,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `<image>\n${member}${d.location ? ` (${d.location})` : ''} 사진을 보고 표준 손상 용어와 정기조사 보존사항 문구를 작성하세요.` },
        { role: 'assistant', content: JSON.stringify(answer) },
      ],
    });
  }).join('\n') + '\n';
}

export const classesTxt = () => CLASSES.map((c) => `${c.id}: ${c.key} (${c.ko})`).join('\n') + '\n';

export const dataYaml = () => ['# HanokJIN 목조 문화유산 손상 데이터셋 (YOLO)', 'path: .', 'train: images', 'val: images', `nc: ${CLASSES.length}`, 'names:',
  ...CLASSES.map((c) => `  ${c.id}: ${c.key}`)].join('\n') + '\n';

/** 학습 데이터셋 ZIP 항목. 사진이 없는 기록은 조사표(CSV)에만 들어간다. */
export function datasetEntries(p: Project, list: DamageRecord[], photos: Map<string, Uint8Array>): ZipEntry[] {
  const out: ZipEntry[] = [];
  const usable = list.filter((d) => d.photo && photos.has(d.photo.id));
  for (const d of usable) {
    out.push({ name: `images/${imageName(d)}`, data: photos.get(d.photo!.id)! });
    out.push({ name: `labels/${d.id}.txt`, data: yoloLabel(d) });
  }
  out.push({ name: 'data.yaml', data: dataYaml() });
  out.push({ name: 'classes.txt', data: classesTxt() });
  out.push({ name: 'annotations_coco.json', data: JSON.stringify(cocoJson(p, usable), null, 2) });
  out.push({ name: 'vlm_finetune.jsonl', data: vlmJsonl(p, usable) });
  out.push({ name: 'survey.csv', data: surveyCsv(p, list) });
  out.push({ name: 'README.txt', data: [
    `${p.name} 손상 조사 데이터셋`, '',
    `기록 ${list.length}건 중 사진이 있는 ${usable.length}건을 학습용으로 담았습니다.`,
    'images/  사진(JPEG)', 'labels/  YOLO 라벨(클래스 중심x 중심y 너비 높이, 0~1)', 'data.yaml, classes.txt  YOLO 설정과 14개 표준 클래스',
    'annotations_coco.json  COCO 형식(bbox는 픽셀 단위 [x, y, w, h], category_id = 클래스 번호 + 1)',
    'vlm_finetune.jsonl  비전-언어 모델 지시 학습용 대화 데이터', 'survey.csv  손상 조사표(전체 기록)', '',
    '분류 체계 출처: 최현서·김소현·김윤상(2025), 「목조 건축문화유산 손상 진단을 위한 용어 표준 체계화 기초 연구」, 건축역사연구 34(3).',
  ].join('\n') + '\n' });
  return out;
}
