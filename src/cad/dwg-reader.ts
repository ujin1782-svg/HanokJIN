// DWG 읽기 어댑터. LibreDWG(WebAssembly, GPL-3.0)를 사용한다.
// 상용 배포 시 라이선스 검토가 필요하므로 이 파일 하나만 교체하면
// ODA Drawings SDK나 서버 변환기 같은 다른 엔진으로 바꿀 수 있게 분리해 두었다.

import type { RawDrawing, RawEntity, RawBlock } from './raw';

const RELEASES: Record<string, string> = {
  AC1012: 'AutoCAD R13', AC1014: 'AutoCAD R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018',
};

export function dwgVersion(bytes: Uint8Array): string | null {
  if (bytes.length < 6) return null;
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  return /^AC\d{4}$/.test(magic) ? magic : null;
}

export function releaseName(magic: string): string {
  return RELEASES[magic] ? `${RELEASES[magic]} (${magic})` : magic;
}

/** 해석 엔진 자체를 못 불러온 경우(파일 문제가 아님) */
export class EngineError extends Error {}

type LibreModule = typeof import('@mlightcad/libredwg-web');
let libPromise: Promise<{ mod: LibreModule; lib: import('@mlightcad/libredwg-web').LibreDwg }> | null = null;

/** wasmDir: libredwg-web.wasm이 있는 디렉터리. 비우면 번들러가 묶어 둔 wasm을 쓴다(브라우저). */
function loadLib(wasmDir?: string) {
  libPromise ??= (async () => {
    try {
      const mod = await import('@mlightcad/libredwg-web');
      const lib = await mod.LibreDwg.create(wasmDir ? wasmDir.replace(/\/$/, '') : undefined);
      return { mod, lib };
    } catch (e) {
      libPromise = null;   // 다음 시도에서 다시 불러오게
      throw new EngineError(`DWG 해석 엔진을 불러오지 못했습니다 (${(e as Error).message}).`);
    }
  })();
  return libPromise;
}

export async function readDwg(buffer: ArrayBuffer, wasmDir?: string): Promise<RawDrawing> {
  const bytes = new Uint8Array(buffer);
  const magic = dwgVersion(bytes);
  if (!magic) throw new Error('DWG 파일 형식이 아닙니다. 파일이 손상되었거나 확장자만 .dwg일 수 있습니다.');
  if (magic < 'AC1012') throw new Error(`${magic}는 AutoCAD R12 이하 형식이라 읽을 수 없습니다. CAD에서 2000 이상 형식으로 저장해 주세요.`);

  const { mod, lib } = await loadLib(wasmDir);
  const ptr = lib.dwg_read_data(buffer, mod.Dwg_File_Type.DWG);
  if (!ptr) throw new Error('DWG 해석에 실패했습니다. 파일이 손상되었을 수 있습니다.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  try {
    db = lib.convert(ptr);
  } finally {
    lib.dwg_free(ptr);
  }

  const layers = (db.tables?.LAYER?.entries ?? []).map((l: { name: string; colorIndex: number; off?: boolean; frozen?: boolean }) => ({
    name: l.name, colorIndex: Math.abs(l.colorIndex ?? 7), off: !!l.off || (l.colorIndex ?? 0) < 0, frozen: !!l.frozen,
  }));
  const blocks = new Map<string, RawBlock>();
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) {
    if (!b?.name || /^\*(MODEL|PAPER)_SPACE/i.test(b.name)) continue;
    blocks.set(b.name, { name: b.name, basePoint: b.basePoint ?? { x: 0, y: 0 }, entities: (b.entities ?? []) as RawEntity[] });
  }
  return {
    format: 'DWG',
    version: releaseName(magic),
    insUnits: Number(db.header?.INSUNITS ?? 0),
    layers,
    blocks,
    entities: (db.entities ?? []) as RawEntity[],
  };
}
