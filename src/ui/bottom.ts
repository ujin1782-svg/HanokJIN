// 아래 작업 패널: 접으면 요약 한 줄, 펼치면 검증 결과 / 물량 명세서(BOM) / 결구 상세.

import type { BomRow, CheckResult } from '../core/types';
import { JAE_M3 } from '../core/params';
import { store, type BottomTab } from '../app/store';
import { jae, type Build } from '../model/hanok';
import { validate } from '../model/validate';
import { h, icon, fmtNum } from './dom';
import { JoineryView, JOINERY } from './joinery';

export interface BottomActions {
  focus: (c: CheckResult) => void;
  exportCsv: () => void;
  getBuild: () => Build | null;
}

const STATUS_LABEL = { pass: '통과', warn: '확인 필요', fail: '문제', info: '안내' } as const;
const STATUS_ICON = { pass: 'pass', warn: 'alert', fail: 'fail', info: 'info' } as const;

export class BottomPanel {
  readonly el: HTMLElement;
  private summary: HTMLElement;
  private content: HTMLElement;
  private checks: CheckResult[] = [];
  private sortKey: keyof BomRow | 'jae' = 'category';
  private sortDir = 1;
  private query = '';
  private joinery: JoineryView | null = null;
  private joineryId = JOINERY[0].id;

  constructor(private act: BottomActions) {
    this.summary = h('button', { class: 'summary-bar', type: 'button', 'aria-expanded': 'false', onclick: () => store.setUI({ bottom: !store.ui.bottom }) });
    this.content = h('div', { class: 'bottom-content' });
    this.el = h('section', { class: 'bottom', 'aria-label': '검증 및 물량' }, this.summary, this.content);
    store.on('model', () => this.refresh());
    store.on('project', () => this.refresh());
    store.on('ui', () => this.layout());
    this.layout();
  }

  get results() { return this.checks; }

  refresh() {
    const p = store.project, b = this.act.getBuild();
    this.checks = p && b ? validate(p, b) : [];
    this.renderSummary();
    if (store.ui.bottom) this.renderContent();
  }

  private layout() {
    this.el.classList.toggle('open', store.ui.bottom);
    this.summary.setAttribute('aria-expanded', String(store.ui.bottom));
    this.renderSummary();
    if (store.ui.bottom) this.renderContent();
    else { this.joinery?.dispose(); this.joinery = null; }
  }

  private renderSummary() {
    const p = store.project, b = this.act.getBuild();
    if (!p || !b) { this.summary.replaceChildren(h('span', { class: 'muted' }, '모델이 없습니다')); return; }
    const review = p.pillars.filter((q) => q.review).length;
    const warn = this.checks.filter((c) => c.status === 'warn').length;
    const fail = this.checks.filter((c) => c.status === 'fail').length;
    const wood = b.bom.filter((r) => !['기단·초석'].includes(r.category)).reduce((s, r) => s + r.volumeM3, 0);
    const tiles = b.bom.filter((r) => r.key === 'tile-am' || r.key === 'tile-su').reduce((s, r) => s + r.count, 0);
    const item = (ic: string, text: string, cls = '') => h('span', { class: `sum-item ${cls}` }, icon(ic, 15), text);
    this.summary.replaceChildren(
      p.demo ? h('span', { class: 'badge demo' }, '데모 데이터') : '',
      item('pointer', `기둥 ${p.pillars.length}개`),
      review ? item('alert', `인식 검토 필요 ${review}개`, 'warn') : item('check', '인식 검토 완료', 'ok'),
      item('cube', `목재 ${fmtNum(wood, 1)}㎥ (${fmtNum(jae(wood))}재)`),
      item('home', `기와 약 ${fmtNum(tiles)}매 (추정)`),
      fail ? item('fail', `구조 간섭·문제 ${fail}건`, 'fail') : warn ? item('alert', `검증 확인 ${warn}건`, 'warn') : item('pass', '검증 통과', 'ok'),
      h('span', { class: 'sum-toggle' }, store.ui.bottom ? '접기' : '자세히', icon(store.ui.bottom ? 'chevronDown' : 'chevronUp', 15)),
    );
  }

  private renderContent() {
    const tab = store.ui.bottomTab;
    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      ...([['checks', '검증 결과'], ['bom', '물량 명세서(BOM)'], ['joinery', '결구 상세']] as [BottomTab, string][]).map(([id, label]) =>
        h('button', { class: `tab ${tab === id ? 'active' : ''}`, role: 'tab', type: 'button', 'aria-selected': String(tab === id), onclick: () => store.setUI({ bottomTab: id }) }, label)));
    if (tab !== 'joinery') { this.joinery?.dispose(); this.joinery = null; }
    const body = tab === 'checks' ? this.checksView() : tab === 'bom' ? this.bomView() : this.joineryViewEl();
    this.content.replaceChildren(tabs, body);
  }

  private checksView() {
    if (!this.act.getBuild()) return h('div', { class: 'empty-msg' }, '아직 검증을 실행하지 않았습니다. 도면을 열거나 예제를 불러오면 자동으로 검증합니다.');
    const order = { fail: 0, warn: 1, info: 2, pass: 3 };
    const list = [...this.checks].sort((a, b) => order[a.status] - order[b.status]);
    return h('div', { class: 'check-list' },
      h('p', { class: 'hint' }, '구조 항목은 전통 목구조 경험식에 따른 참고 판정이며 구조계산을 대신하지 않습니다.'),
      ...list.map((c) => h('button', { class: `check-item ${c.status}`, type: 'button', disabled: !c.focus, onclick: () => this.act.focus(c) },
        h('span', { class: 'check-status' }, icon(STATUS_ICON[c.status], 16), STATUS_LABEL[c.status]),
        h('span', { class: 'check-text' }, h('b', null, c.title), h('span', null, c.detail)),
        c.focus ? h('span', { class: 'check-go' }, '위치 보기') : null)));
  }

  private bomView() {
    const b = this.act.getBuild();
    if (!b) return h('div', { class: 'empty-msg' }, '모델이 없어 물량을 계산할 수 없습니다.');
    const q = this.query.trim();
    let rows = b.bom.filter((r) => !q || `${r.category} ${r.name} ${r.spec}`.includes(q));
    const k = this.sortKey;
    rows = [...rows].sort((a, c) => {
      const va = k === 'jae' ? a.volumeM3 : a[k], vc = k === 'jae' ? c.volumeM3 : c[k];
      return (typeof va === 'number' && typeof vc === 'number' ? va - vc : String(va).localeCompare(String(vc), 'ko')) * this.sortDir;
    });
    const th = (label: string, key: typeof this.sortKey, tip?: string) => h('th', { scope: 'col' },
      h('button', { class: 'th-btn', type: 'button', 'data-tip': tip, onclick: () => { this.sortDir = this.sortKey === key ? -this.sortDir : 1; this.sortKey = key; this.renderContent(); } },
        label, this.sortKey === key ? icon(this.sortDir > 0 ? 'chevronUp' : 'chevronDown', 12) : null));
    const totalM3 = b.bom.reduce((s, r) => s + r.volumeM3, 0);
    const woodM3 = b.bom.filter((r) => r.category !== '기단·초석').reduce((s, r) => s + r.volumeM3, 0);
    const search = h('input', { class: 'input sm', type: 'search', placeholder: '부재 검색', value: this.query, 'aria-label': '부재 검색' });
    search.addEventListener('input', () => { this.query = search.value; const pos = search.selectionStart; this.renderContent(); const s2 = this.content.querySelector('input[type=search]') as HTMLInputElement; s2.focus(); s2.setSelectionRange(pos, pos); });
    return h('div', { class: 'bom' },
      h('div', { class: 'bom-bar' }, search,
        h('span', { class: 'muted' }, `목재 ${fmtNum(woodM3, 2)}㎥ · ${fmtNum(jae(woodM3), 1)}재 · 석재 포함 전체 ${fmtNum(totalM3, 2)}㎥`),
        h('span', { class: 'help', tabindex: 0, 'data-tip': `1재(才) = 1치 × 1치 × 12자 ≈ ${JAE_M3.toFixed(5)}㎥` }, icon('help', 14)),
        store.project?.demo ? h('span', { class: 'badge demo' }, '데모 데이터') : null,
        h('button', { class: 'btn sm', type: 'button', onclick: () => this.act.exportCsv() }, icon('download', 14), 'CSV 저장')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, th('분류', 'category'), th('부재명', 'name'), th('규격(mm)', 'spec'), th('수량', 'count'), h('th', null, '단위'), th('체적(㎥)', 'volumeM3'), th('재(才)', 'jae', '1재 ≈ 0.00334㎥'), h('th', null, '상태'))),
        h('tbody', null, ...rows.map((r) => h('tr', null,
          h('td', null, r.category), h('td', null, r.name), h('td', { class: 'mono' }, r.spec), h('td', { class: 'num' }, fmtNum(r.count, r.unit === '㎡' || r.unit === 'm' || r.unit === '㎥' ? 1 : 0)), h('td', null, r.unit),
          h('td', { class: 'num' }, r.volumeM3 ? r.volumeM3.toFixed(3) : '–'), h('td', { class: 'num' }, r.volumeM3 && r.category !== '기단·초석' ? fmtNum(jae(r.volumeM3), 1) : '–'),
          h('td', null, r.estimated ? h('span', { class: 'badge default', 'data-tip': r.basis ?? '' }, '추정') : h('span', { class: 'badge drawing' }, '모델 산출'))))),
        rows.length ? null : h('caption', null, '검색 결과가 없습니다.'))),
    );
  }

  private joineryViewEl() {
    const b = this.act.getBuild();
    const cur = JOINERY.find((j) => j.id === this.joineryId) ?? JOINERY[0];
    const count = (keys: string[]) => (b?.bom ?? []).filter((r) => keys.some((k) => r.key.startsWith(k))).reduce((s, r) => s + (r.unit === '㎡' || r.unit === 'm' || r.unit === '㎥' ? 0 : r.count), 0);
    const host = h('div', { class: 'joinery-3d' });
    const slider = h('input', { type: 'range', min: 0, max: 100, value: 45, 'aria-label': '결구 분해 정도', oninput: (e: Event) => this.joinery?.setExplode(+(e.target as HTMLInputElement).value / 100) });
    const el = h('div', { class: 'joinery' },
      h('div', { class: 'joinery-list', role: 'listbox', 'aria-label': '결구 종류' }, ...JOINERY.map((j) =>
        h('button', { class: `joinery-item ${j.id === cur.id ? 'active' : ''}`, type: 'button', role: 'option', 'aria-selected': String(j.id === cur.id), onclick: () => { this.joineryId = j.id; this.renderContent(); } },
          h('b', null, j.name), h('span', null, `이 모델에서 ${count(j.used)}곳`)))),
      h('div', { class: 'joinery-detail' },
        h('div', { class: 'joinery-text' }, h('h3', null, cur.name), h('p', null, cur.desc), h('p', { class: 'hint' }, `연결 부재: ${cur.parts}`),
          h('label', { class: 'field' }, h('span', null, '분해해서 보기'), slider)),
        host));
    requestAnimationFrame(() => {
      if (!host.isConnected) return;
      if (!this.joinery) this.joinery = new JoineryView();
      this.joinery.mount(host, cur.id);
      this.joinery.setExplode(0.45);
    });
    return el;
  }
}
