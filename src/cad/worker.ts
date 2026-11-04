// 도면 해석 워커. 큰 DWG도 화면을 멈추지 않고 읽는다.

import { parseCadFile, UserFacingError, type Stage } from './pipeline';

export type WorkerIn = { buffer: ArrayBuffer; name: string };
export type WorkerOut =
  | { type: 'progress'; stage: Stage }
  | { type: 'done'; result: Awaited<ReturnType<typeof parseCadFile>> }
  | { type: 'error'; message: string; hint?: string };

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const { buffer, name } = ev.data;
  const post = (m: WorkerOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
  try {
    const result = await parseCadFile(buffer, name, undefined, (stage) => post({ type: 'progress', stage }));
    post({ type: 'done', result }, Object.values(result.doc.segs).map((a) => a.buffer));
  } catch (e) {
    const err = e as Error;
    post({ type: 'error', message: err.message || '도면을 읽지 못했습니다.', hint: e instanceof UserFacingError ? e.hint : undefined });
  }
};
