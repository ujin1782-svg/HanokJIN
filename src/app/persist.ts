// 브라우저 안 자동 저장(IndexedDB). 원본 도면 파일과 프로젝트를 함께 저장해 새로고침 후 이어서 작업한다.
// 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 실패하고 상태 표시로만 알린다.
// 손상 조사 사진은 되돌리기 기록에 넣지 않도록 별도 저장소(photos)에 사진 id로 저장한다.

import type { Project } from '../core/types';

const DB = 'hanokjin', STORE = 'session', PHOTOS = 'photos', KEY = 'last';

export interface Session { project: Project; file?: { name: string; bytes: ArrayBuffer }; savedAt: number }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export async function loadSession(): Promise<Session | null> {
  try {
    const s = (await tx<Session | undefined>('readonly', (st) => st.get(KEY))) ?? null;
    if (s) s.project.damages ??= [];   // 손상 조사 기능 이전에 저장된 프로젝트
    return s;
  } catch { return null; }
}

let fileCache: Session['file'];

export async function saveSession(project: Project, file?: Session['file']): Promise<void> {
  if (file) fileCache = file;
  const data: Session = { project, file: fileCache, savedAt: Date.now() };
  await tx('readwrite', (s) => s.put(data, KEY));
}

export function forgetFile() { fileCache = undefined; }

export async function clearSession(): Promise<void> {
  fileCache = undefined;
  try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* 저장소를 쓸 수 없음 */ }
  try { await tx('readwrite', (s) => s.clear(), PHOTOS); } catch { /* 저장소를 쓸 수 없음 */ }
  photoUrls.forEach((u) => URL.revokeObjectURL(u));
  photoUrls.clear(); photoMem.clear();
}

/* ───── 손상 조사 사진 ───── */

// 저장소를 쓸 수 없어도 이번 세션 동안은 사진을 쓸 수 있도록 메모리에도 둔다.
const photoMem = new Map<string, Blob>();
const photoUrls = new Map<string, string>();

export async function putPhoto(id: string, blob: Blob): Promise<void> {
  photoMem.set(id, blob);
  try { await tx('readwrite', (s) => s.put(blob, id), PHOTOS); } catch { /* 메모리에만 보관 */ }
}

export async function getPhoto(id: string): Promise<Blob | null> {
  const m = photoMem.get(id);
  if (m) return m;
  try {
    const b = (await tx<Blob | undefined>('readonly', (s) => s.get(id), PHOTOS)) ?? null;
    if (b) photoMem.set(id, b);
    return b;
  } catch { return null; }
}

/** 사진 표시용 객체 URL(같은 사진은 한 번만 만든다). */
export async function photoUrl(id: string): Promise<string | null> {
  const u = photoUrls.get(id);
  if (u) return u;
  const b = await getPhoto(id);
  if (!b) return null;
  const url = URL.createObjectURL(b);
  photoUrls.set(id, url);
  return url;
}

/** 어떤 손상 기록에도 쓰이지 않는 사진을 지운다. 되돌리기로 다시 필요할 수 있으므로 저장된 작업을 다시 열 때만 정리한다. */
export async function prunePhotos(keep: Set<string>): Promise<void> {
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys(), PHOTOS);
    const drop = keys.map(String).filter((k) => !keep.has(k));
    for (const k of drop) await tx('readwrite', (s) => s.delete(k), PHOTOS);
  } catch { /* 저장소를 쓸 수 없음 */ }
}
