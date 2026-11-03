// 대화상자와 알림. 파괴적 동작은 confirmDialog로 확인을 받는다.

import { h, icon } from './dom';

export function openModal(title: string, body: Node, actions: HTMLElement[] = [], opts: { wide?: boolean; onClose?: () => void; dismissable?: boolean } = {}) {
  const prevFocus = document.activeElement as HTMLElement | null;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && opts.dismissable !== false) { e.stopPropagation(); close(); } };
  const dialog = h('div', { class: `modal ${opts.wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'modal-head' }, h('h2', null, title),
      opts.dismissable === false ? null : h('button', { class: 'btn icon', type: 'button', 'aria-label': '닫기', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('footer', { class: 'modal-foot' }, ...actions) : null,
  );
  const overlay = h('div', { class: 'modal-overlay', onmousedown: (e: MouseEvent) => { if (e.target === overlay && opts.dismissable !== false) close(); } }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  // 선택자를 우선순위대로 하나씩 찾는다(한 번에 쓰면 문서 순서로 잡혀 닫기 버튼에 초점이 간다).
  setTimeout(() => {
    for (const sel of ['[autofocus]', '.modal-foot .btn.primary', '.modal-body input', '.modal-foot button', 'button']) {
      const el = dialog.querySelector<HTMLElement>(sel);
      if (el) { el.focus(); break; }
    }
  }, 30);
  return { close, dialog };
}

export function confirmDialog(title: string, message: string, okLabel = '확인', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); m.close(); } };
    const m = openModal(title, h('p', { class: 'modal-text' }, message), [
      h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, '취소'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', autofocus: true, onclick: () => finish(true) }, okLabel),
    ], { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

export function promptNumber(title: string, message: string, unit: string, initial?: number): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const err = h('div', { class: 'field-error', role: 'alert' });
    const input = h('input', { class: 'input', type: 'number', min: 1, step: 1, value: initial ?? '', autofocus: true, 'aria-label': title });
    const ok = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v <= 0) { err.textContent = '0보다 큰 숫자를 입력해 주세요.'; return; }
      done = true; resolve(v); m.close();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const m = openModal(title, h('div', null, h('p', { class: 'modal-text' }, message), h('div', { class: 'num-field' }, input, h('span', { class: 'unit' }, unit)), err), [
      h('button', { class: 'btn', type: 'button', onclick: () => { done = true; resolve(null); m.close(); } }, '취소'),
      h('button', { class: 'btn primary', type: 'button', onclick: ok }, '적용'),
    ], { onClose: () => { if (!done) resolve(null); } });
  });
}

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'ok' | 'warn' | 'error' = 'info', action?: { label: string; run: () => void }) {
  document.querySelector('.toast')?.remove();
  const ic = kind === 'ok' ? 'pass' : kind === 'warn' ? 'alert' : kind === 'error' ? 'fail' : 'info';
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, icon(ic, 16), h('span', null, msg),
    action ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { action.run(); el.remove(); } }, action.label) : null);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3800);
}
