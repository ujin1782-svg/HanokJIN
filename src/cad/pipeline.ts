// 파일 바이트 → 정규화 문서 → 시트 → 인식 결과. 워커와 테스트가 같이 쓴다.

import type { CadDoc, Sheet } from '../core/types';
import { readDwg, dwgVersion, EngineError } from './dwg-reader';
import { readDxf } from './dxf-reader';
import { normalize, scaleDoc } from './normalize';
import { segmentSheets } from './sheets';
import { recognize, guessUnitScale, type Recognition } from './recognize';

export type Stage = 'read' | 'decode' | 'normalize' | 'sheets' | 'recognize' | 'done';
export const STAGE_LABEL: Record<Stage, string> = {
  read: '파일 읽는 중', decode: '도면 해석 중', normalize: '도형 정리 중', sheets: '도면 시트 나누는 중', recognize: '기둥·격자 인식 중', done: '완료',
};

export interface ParseResult { doc: CadDoc; sheets: Sheet[]; recognition: Recognition; ms: number }

export class UserFacingError extends Error {
  constructor(message: string, public hint?: string) { super(message); }
}

export const SUPPORTED = ['.dwg', '.dxf'];
export const MAX_BYTES = 80 * 1024 * 1024;

export function checkFile(name: string, size: number): void {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  if (['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp'].includes(ext)) {
    throw new UserFacingError('PDF·이미지 도면은 아직 읽을 수 없습니다.', 'CAD 프로그램에서 DWG 또는 DXF로 저장한 파일을 올려 주세요.');
  }
  if (!SUPPORTED.includes(ext)) throw new UserFacingError(`지원하지 않는 파일 형식입니다 (${ext || '확장자 없음'}).`, 'DWG(AutoCAD R13~2018) 또는 ASCII DXF 파일을 올려 주세요.');
  if (size > MAX_BYTES) throw new UserFacingError(`파일이 너무 큽니다 (${(size / 1048576).toFixed(1)}MB).`, '80MB 이하로 줄이거나 필요한 시트만 남겨 저장해 주세요.');
  if (size === 0) throw new UserFacingError('빈 파일입니다.');
}

export async function parseCadFile(buffer: ArrayBuffer, fileName: string, wasmDir: string | undefined, progress: (s: Stage) => void = () => {}): Promise<ParseResult> {
  const t0 = Date.now();
  checkFile(fileName, buffer.byteLength);
  progress('decode');
  const isDwg = dwgVersion(new Uint8Array(buffer)) !== null;
  let raw;
  try {
    raw = isDwg ? await readDwg(buffer, wasmDir) : readDxf(buffer);
  } catch (e) {
    if (e instanceof EngineError) throw new UserFacingError(e.message, '네트워크 연결을 확인하고 페이지를 새로고침한 뒤 다시 시도해 주세요. 계속되면 DXF로 저장해 올려 주세요.');
    throw new UserFacingError((e as Error).message, isDwg ? 'AutoCAD에서 파일을 열어 "AutoCAD 2013 DWG" 형식으로 다시 저장하면 해결되는 경우가 많습니다.' : undefined);
  }
  progress('normalize');
  let doc = normalize(raw, fileName);
  if (doc.stats.entities === 0) throw new UserFacingError('도면에 표시할 도형이 없습니다.', '모델 공간(Model)에 도면이 있는지 확인해 주세요.');
  progress('sheets');
  let sheets = segmentSheets(doc);
  const k = guessUnitScale(doc, sheets);
  if (k !== 1) {
    doc = scaleDoc(doc, k);
    sheets = segmentSheets(doc);
  }
  progress('recognize');
  const recognition = recognize(doc, sheets);
  if (k !== 1) recognition.project.recognitionNotes.unshift(`도면 단위를 ${k === 10 ? 'cm' : 'm'}로 판단해 mm로 바꿨습니다.`);
  recognition.unitScaleApplied = k;
  progress('done');
  return { doc, sheets, recognition, ms: Date.now() - t0 };
}
