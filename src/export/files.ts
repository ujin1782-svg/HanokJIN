// 내보내기 형식 목록과 파일 저장. 각 형식은 실제 파일을 만든다(가짜 성공 없음).

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { BomRow, Project } from '../core/types';
import type { Build } from '../model/hanok';
import { jae } from '../model/hanok';
import { exportIfc } from './ifc';
import { exportDxf } from './dxf';
import { makeZip } from './zip';
import { datasetEntries, surveyCsv } from '../damage/dataset';
import { getPhoto } from '../app/persist';

export type ExportFormat = 'ifc' | 'glb' | 'dxf' | 'csv' | 'damage-csv' | 'damage-zip';

export const FORMATS: { id: ExportFormat; label: string; ext: string; desc: string; usage: string; damage?: boolean }[] = [
  { id: 'ifc', label: 'IFC 4 (BIM)', ext: 'ifc', desc: '기둥·보·벽·창호·지붕을 BIM 부재로 저장합니다. 부재마다 이름과 규격 속성이 들어갑니다.', usage: 'Revit, ArchiCAD, BIMcollab 등 BIM 프로그램' },
  { id: 'glb', label: 'glTF 3D 모델 (.glb)', ext: 'glb', desc: '색감과 재질을 포함한 3D 모델 한 파일입니다.', usage: 'Blender, 웹 뷰어, 시각화·VR' },
  { id: 'dxf', label: 'DXF 평면도', ext: 'dxf', desc: '보정한 격자·기둥·외벽·창호·실 이름을 2D 평면도로 저장합니다.', usage: 'AutoCAD 등 CAD 프로그램' },
  { id: 'csv', label: '물량 명세서 (CSV)', ext: 'csv', desc: '부재별 수량·규격·재적(m³, 재)과 기와 추정 매수를 표로 저장합니다.', usage: 'Excel, 견적 작업' },
  { id: 'damage-csv', label: '손상 조사표 (CSV)', ext: 'csv', desc: '손상 기록마다 부재·위치·원문 표기·표준 용어·계층·정도·조사내용을 표로 저장합니다.', usage: '정기조사 보고서, Excel', damage: true },
  { id: 'damage-zip', label: '손상 학습 데이터셋 (ZIP)', ext: 'zip', desc: '사진과 손상 영역을 YOLO 라벨·COCO JSON·VLM 대화(JSONL)로 묶고 조사표를 함께 넣습니다.', usage: 'YOLO·COCO 객체 탐지, 비전-언어 모델 미세조정', damage: true },
];

export function fileName(p: Project, ext: string) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const base = p.name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'hanok';
  return `${base}_${ymd}.${ext}`;
}

export function download(name: string, data: BlobPart, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return blob.size;
}

export function bomCsv(rows: BomRow[]): string {
  const head = ['분류', '부재명', '규격(mm)', '수량', '단위', '체적(m³)', '재(才)', '산출 상태', '산출 근거'];
  const body = rows.map((r) => [r.category, r.name, r.spec, r.count, r.unit, r.volumeM3 ? r.volumeM3.toFixed(3) : '', r.volumeM3 ? jae(r.volumeM3).toFixed(1) : '', r.estimated ? '추정' : '모델 산출', r.basis ?? '']);
  const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  return '﻿' + [head, ...body].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

export async function runExport(fmt: ExportFormat, p: Project, b: Build, onlyVisible: boolean, verifiedOnly = false): Promise<{ name: string; size: number }> {
  const def = FORMATS.find((x) => x.id === fmt)!;
  if (def.damage) return exportDamage(fmt, p, verifiedOnly);
  const name = fileName(p, def.ext);
  if (fmt === 'csv') return { name, size: download(name, bomCsv(b.bom), 'text/csv;charset=utf-8') };
  if (fmt === 'dxf') return { name, size: download(name, exportDxf(p), 'application/dxf') };
  if (fmt === 'ifc') return { name, size: download(name, exportIfc(p, b, onlyVisible), 'application/x-step') };
  const data = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(b.root as THREE.Object3D, (r) => resolve(r as ArrayBuffer), (e) => reject(e), { binary: true, onlyVisible });
  });
  return { name, size: download(name, data, 'model/gltf-binary') };
}

/** 손상 조사 내보내기. 사진은 브라우저 저장소에서 읽는다. */
export async function exportDamage(fmt: ExportFormat, p: Project, verifiedOnly: boolean): Promise<{ name: string; size: number }> {
  const list = verifiedOnly ? p.damages.filter((d) => d.status === 'verified') : p.damages;
  if (!list.length) throw new Error(verifiedOnly ? '검수 완료된 손상 기록이 없습니다' : '손상 기록이 없습니다');
  const base = fileName(p, 'x').replace(/\.x$/, '');
  if (fmt === 'damage-csv') { const name = `${base}_손상조사표.csv`; return { name, size: download(name, surveyCsv(p, list), 'text/csv;charset=utf-8') }; }
  const photos = new Map<string, Uint8Array>();
  for (const d of list) {
    if (!d.photo) continue;
    const blob = await getPhoto(d.photo.id);
    if (blob) photos.set(d.photo.id, new Uint8Array(await blob.arrayBuffer()));
  }
  const name = `${base}_손상데이터셋.zip`;
  return { name, size: download(name, makeZip(datasetEntries(p, list, photos)), 'application/zip') };
}
