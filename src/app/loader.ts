// 워커로 도면을 읽는다. 취소하면 워커를 끝내 메모리를 돌려받는다.

import type { ParseResult, Stage } from '../cad/pipeline';
import type { WorkerIn, WorkerOut } from '../cad/worker';

export interface LoadJob { promise: Promise<ParseResult>; cancel: () => void }

export class LoadError extends Error { constructor(message: string, public hint?: string) { super(message); } }

export function loadCad(file: File, onStage: (s: Stage) => void): LoadJob {
  const worker = new Worker(new URL('../cad/worker.ts', import.meta.url), { type: 'module' });
  let cancelled = false;
  let rejectFn: (e: Error) => void = () => {};
  const promise = new Promise<ParseResult>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.type === 'progress') onStage(m.stage);
      else if (m.type === 'done') { worker.terminate(); resolve(m.result); }
      else { worker.terminate(); reject(new LoadError(m.message, m.hint)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new LoadError(`도면 해석 중 오류가 났습니다: ${e.message || '알 수 없는 오류'}`)); };
    onStage('read');
    file.arrayBuffer().then((buffer) => {
      if (cancelled) return;
      worker.postMessage({ buffer, name: file.name } satisfies WorkerIn, [buffer]);
    }, (e) => reject(new LoadError(`파일을 읽을 수 없습니다: ${(e as Error).message}`, '파일 접근 권한을 확인해 주세요.')));
  });
  return {
    promise,
    cancel: () => { cancelled = true; worker.terminate(); rejectFn(new LoadError('취소했습니다.')); },
  };
}
