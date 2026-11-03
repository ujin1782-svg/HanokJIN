// 브라우저 안 자동 저장(IndexedDB). 원본 도면 파일과 프로젝트를 함께 저장해 새로고침 후 이어서 작업한다.
// 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 실패하고 상태 표시로만 알린다.

import type { Project } from '../core/types';

const DB = 'hanokjin', STORE = 'session', KEY = 'last';

export interface Session { project: Project; file?: { name: string; bytes: ArrayBuffer }; savedAt: number }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export async function loadSession(): Promise<Session | null> {
  try { return (await tx<Session | undefined>('readonly', (s) => s.get(KEY))) ?? null; } catch { return null; }
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
}
