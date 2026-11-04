// 오른쪽 설정 서랍. 선택한 대상에 따라 '모델 설정' / '기둥 속성' / '외벽 칸' / '부재 정보'로 바뀐다.
// 색감 탭의 팔레트 스와치와 재료 색 선택기는 단색 사각형 대신 나뭇결·기와골·석재 입자·빛의 입체 하이라이트가 반영된 사실적 PBR 재질 칩으로 렌더링한다.

import type { MaterialKey, OpeningKind, Params, Pillar, Project } from '../core/types';
import { CHOICES, CHEOK_MM, NUM_PARAMS, clampParam, type NumParamDef } from '../core/params';
import { EDITABLE_MATERIALS, MATERIAL_LABEL, MATERIAL_SURFACE, PALETTES, resolvePalette } from '../model/palettes';
import { computeFootprint } from '../model/footprint';
import { store } from '../app/store';
import { h, icon } from './dom';

export interface InspectorActions {
  deletePillar: (id: string) => void;
  focusPillar: (id: string) => void;
}

const ROLE = { corner: '귀기둥(우주)', edge: '평주', inner: '고주(내진주)' } as const;

export class Inspector {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private title: HTMLElement;

  constructor(private act: InspectorActions) {
    this.title = h('h2', { class: 'drawer-title' });
    this.body = h('div', { class: 'drawer-body' });
    this.el = h('aside', { class: 'drawer', 'aria-label': '설정', hidden: true },
      h('header', { class: 'drawer-head' }, this.title,
        h('button', { class: 'btn icon', type: 'button', 'aria-label': '설정 닫기', onclick: () => store.setUI({ drawer: false }) }, icon('x'))),
      this.body);
    const rerender = () => { if (!this.el.hidden) this.render(); };
    store.on('selection', () => { if (store.selection && store.selection.kind !== 'part') store.setUI({ drawer: true }); rerender(); });
    store.on('history', rerender);
    store.on('project', rerender);
    let lastTab = store.ui.drawerTab;
    store.on('ui', () => {
      const open = store.ui.drawer && !!store.project;
      const tabChanged = lastTab !== store.ui.drawerTab;
      lastTab = store.ui.drawerTab;
      if (this.el.hidden === open) { this.el.hidden = !open; if (open) this.render(); }
      else if (open && tabChanged) this.render();
    });
  }

  render() {
    const p = store.project;
    if (!p) return;
    const s = store.selection;
    if (s?.kind === 'pillar') {
      const pl = p.pillars.find((q) => q.id === s.id);
      if (pl) { this.title.textContent = '기둥 속성'; this.body.replaceChildren(this.pillarPanel(p, pl)); return; }
    }
    if (s?.kind === 'edge') { this.title.textContent = '외벽 칸'; this.body.replaceChildren(this.edgePanel(p, s)); return; }
    if (s?.kind === 'part') {
      this.title.textContent = '부재 정보';
      this.body.replaceChildren(h('div', { class: 'section' },
        h('div', { class: 'kv' }, h('span', null, '부재'), h('b', null, s.name)),
        s.spec ? h('div', { class: 'kv' }, h('span', null, '규격'), h('b', null, s.spec)) : null,
        h('div', { class: 'kv' }, h('span', null, 'BIM 분류'), h('b', null, s.ifc)),
        h('p', { class: 'hint' }, '부재 크기는 "형태" 탭의 기준 기둥 굵기(주경 D)와 도면 부재 표기로 정해집니다.'),
        h('button', { class: 'btn', type: 'button', onclick: () => store.select(null) }, '모델 설정으로 돌아가기')));
      return;
    }
    this.title.textContent = '모델 설정';
    this.body.replaceChildren(this.modelPanel(p));
  }

  /* ───── 모델 설정 ───── */
  private modelPanel(p: Project) {
    const tab = store.ui.drawerTab;
    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      ...([['color', '색감·재질', 'palette'], ['shape', '형태', 'home'], ['advanced', '고급', 'sliders']] as const).map(([id, label, ic]) =>
        h('button', { class: `tab ${tab === id ? 'active' : ''}`, role: 'tab', 'aria-selected': String(tab === id), type: 'button', onclick: () => { store.ui.drawerTab = id; this.render(); } }, icon(ic, 15), label)));
    const content = tab === 'color' ? this.colorTab(p) : tab === 'shape' ? this.shapeTab(p) : this.advancedTab(p);
    return h('div', null, tabs, content);
  }

  private colorTab(p: Project) {
    const cur = p.palette.id;
    const cards = PALETTES.map((pal) => {
      const sw = (['pillar', 'beam', 'wall', 'roof', 'stone'] as MaterialKey[]).map((k) =>
        h('span', {
          class: `sw sw-${MATERIAL_SURFACE[k]}`,
          style: `--sw-color:${pal.colors[k]}`,
          title: `${MATERIAL_LABEL[k]} (${pal.colors[k]})`,
        }));
      if (pal.accent) {
        sw.push(
          h('span', { class: 'sw sw-wood', style: `--sw-color:${pal.accent.band}` }),
          h('span', { class: 'sw sw-wood', style: `--sw-color:${pal.accent.band2}` }),
        );
      }
      return h('button', {
        class: `palette-card ${cur === pal.id ? 'active' : ''}`, type: 'button', 'aria-pressed': String(cur === pal.id),
        onclick: () => store.commit(`색감: ${pal.name}`, (q) => { q.palette = { id: pal.id, custom: {} }; }, 'palette'),
      }, h('div', { class: 'palette-sw' }, ...sw), h('div', { class: 'palette-name' }, pal.name, cur === pal.id ? icon('check', 14) : null), h('div', { class: 'palette-desc' }, pal.desc));
    });
    const colors = resolvePalette(p.palette).colors;
    const pickers = EDITABLE_MATERIALS.map((k) => {
      const surf = MATERIAL_SURFACE[k];
      const sphere = h('span', { class: `mat-sphere mat-${surf}`, style: `--mat-color:${colors[k]}` });
      const input = h('input', { type: 'color', value: colors[k], 'aria-label': `${MATERIAL_LABEL[k]} 색` });
      input.addEventListener('input', () => {
        sphere.style.setProperty('--mat-color', input.value);
        store.preview((q) => { q.palette.custom[k] = input.value; }, 'palette');
      });
      input.addEventListener('change', () => {
        const v = input.value;
        sphere.style.setProperty('--mat-color', v);
        store.preview((q) => { delete q.palette.custom[k]; }, 'palette');
        store.commit(`${MATERIAL_LABEL[k]} 색 변경`, (q) => { q.palette.custom[k] = v; }, 'palette');
      });
      return h('label', { class: 'color-row pbr-color-row' },
        h('span', { class: 'mat-picker-wrap' }, sphere, input),
        h('span', { class: 'mat-label-wrap' },
          h('b', null, MATERIAL_LABEL[k]),
          h('span', { class: 'muted mat-surf-tag' }, { wood: '소나무 결·음영', tile: '암수키와 골·윤기', plaster: '회벽·황토 미장', stone: '화강암·장대석', paper: '닥나무 한지·투광' }[surf]),
        ),
        p.palette.custom[k] ? h('span', { class: 'badge user' }, '직접') : null);
    });
    return h('div', null,
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, '사실적 전통 재질 프리셋 (PBR)'),
        h('p', { class: 'hint' }, '단색이 아닌 나뭇결·기와 골·화강암 입자·창호지 투광과 태양광 방향을 반영합니다.'),
        h('div', { class: 'palette-grid' }, ...cards)),
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, '부재별 재질 색감 미세조정', Object.keys(p.palette.custom).length
          ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => store.commit('재료 색 초기화', (q) => { q.palette.custom = {}; }, 'palette') }, '초기화') : null),
        h('div', { class: 'color-grid pbr-grid' }, ...pickers)),
    );
  }

  private shapeTab(p: Project) {
    const P = p.params;
    const choice = <K extends keyof Params>(key: K, label: string, opts: readonly { v: Params[K]; label: string; help: string }[], thumb?: (v: Params[K]) => SVGElement) =>
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, label, sourceBadge(p, key)),
        h('div', { class: `choice-grid ${thumb ? 'thumbs' : ''}` }, ...opts.map((o) =>
          h('button', {
            class: `choice ${P[key] === o.v ? 'active' : ''}`, type: 'button', 'aria-pressed': String(P[key] === o.v), title: o.help,
            onclick: () => { if (P[key] !== o.v) store.commit(`${label}: ${o.label}`, (q) => { q.params[key] = o.v; }, 'params'); },
          }, thumb ? thumb(o.v) : null, h('span', null, o.label)))),
        h('p', { class: 'hint' }, opts.find((o) => o.v === P[key])?.help ?? ''));
    return h('div', null,
      choice('roofType', '지붕 형식', CHOICES.roofType, (v) => roofThumb(v as string)),
      ...NUM_PARAMS.filter((d) => d.basic).map((d) => this.numRow(p, d)),
      choice('gongpo', '공포 유형', CHOICES.gongpo),
      choice('ryangga', '구조 양식', CHOICES.ryangga),
      choice('heullim', '기둥 흘림', CHOICES.heullim, (v) => heullimThumb(v as string)),
      choice('lattice', '창살 무늬', CHOICES.lattice),
    );
  }

  private advancedTab(p: Project) {
    const changed = (Object.keys(p.params) as (keyof Params)[]).filter((k) => p.params[k] !== p.baseline[k]);
    return h('div', null,
      ...NUM_PARAMS.filter((d) => !d.basic).map((d) => this.numRow(p, d)),
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, '도면·촬영 초기값으로 되돌리기'),
        h('p', { class: 'hint' }, changed.length ? `바꾼 항목 ${changed.length}개를 초기 인식 값으로 되돌립니다.` : '바꾼 값이 없습니다.'),
        h('button', { class: 'btn', type: 'button', disabled: !changed.length, onclick: () => store.commit('모든 값 되돌리기', (q) => { q.params = { ...q.baseline }; }, 'params') }, icon('reset', 15), '되돌리기')),
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, p.demo ? '예제 정보' : '모델 인식·복원 정보'),
        h('div', { class: 'kv' }, h('span', null, '원본'), h('b', null, p.source.fileName ?? '-')),
        h('div', { class: 'kv' }, h('span', null, '형식'), h('b', null, p.source.format ?? '-')),
        p.source.area ? h('div', { class: 'kv' }, h('span', null, '건축 면적'), h('b', null, p.source.area)) : null,
        h('ul', { class: 'notes' }, ...p.recognitionNotes.map((n) => h('li', null, n))),
        p.members.length ? h('div', { class: 'kv' }, h('span', null, '도면 부재 표기'), h('b', null, p.members.map((m) => `${m.name} ${m.w}×${m.h}`).join(', '))) : null),
    );
  }

  private numRow(p: Project, d: NumParamDef) {
    const val = p.params[d.key] as number;
    const err = h('div', { class: 'field-error', role: 'alert' });
    const slider = h('input', { type: 'range', min: d.min, max: d.max, step: d.step, value: val, 'aria-label': d.label });
    const num = h('input', { class: 'input num', type: 'number', min: d.min, max: d.max, step: d.step, value: val, 'aria-label': `${d.label} 값` });
    const cheok = h('span', { class: 'cheok' }, d.key === 'clearance' ? '' : `${(val / CHEOK_MM).toFixed(2)}척`);
    const show = (v: number) => { num.value = String(v); slider.value = String(v); if (d.key !== 'clearance') cheok.textContent = `${(v / CHEOK_MM).toFixed(2)}척`; };
    let before = val;
    slider.addEventListener('pointerdown', () => { before = p.params[d.key] as number; });
    slider.addEventListener('input', () => { const v = +slider.value; show(v); store.preview((q) => { (q.params[d.key] as number) = v; }); });
    slider.addEventListener('change', () => {
      const v = +slider.value;
      store.preview((q) => { (q.params[d.key] as number) = before; });
      store.commit(`${d.label} ${v}mm`, (q) => { (q.params[d.key] as number) = v; }, 'params');
    });
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (!Number.isFinite(v) || v < d.min || v > d.max) {
        err.textContent = `${d.min.toLocaleString()} ~ ${d.max.toLocaleString()} ${d.unit} 사이로 입력해 주세요.`;
        num.classList.add('invalid');
        return;
      }
      err.textContent = ''; num.classList.remove('invalid');
      const c = clampParam(d.key, v);
      store.commit(`${d.label} ${c}mm`, (q) => { (q.params[d.key] as number) = c; }, 'params');
    });
    const base = p.baseline[d.key] as number;
    return h('div', { class: 'section param' },
      h('div', { class: 'param-head' },
        h('span', { class: 'param-label' }, d.label, d.term ? h('span', { class: 'term' }, d.term) : null),
        h('span', { class: 'help', tabindex: 0, 'data-tip': `${d.help} ${d.effect}`, 'aria-label': `${d.label} 도움말: ${d.help}` }, icon('help', 14)),
        sourceBadge(p, d.key),
        val !== base ? h('button', { class: 'btn ghost xs', type: 'button', 'data-tip': `${base.toLocaleString()}${d.unit}로 되돌리기`, onclick: () => store.commit(`${d.label} 되돌리기`, (q) => { (q.params[d.key] as number) = base; }, 'params') }, icon('reset', 13)) : null),
      h('div', { class: 'param-ctrl' }, slider, h('div', { class: 'num-field' }, num, h('span', { class: 'unit' }, d.unit))),
      h('div', { class: 'param-foot' }, h('span', { class: 'hint' }, d.help), cheok),
      err);
  }

  /* ───── 기둥 ───── */
  private pillarPanel(p: Project, pl: Pillar) {
    const fp = computeFootprint(p);
    const role = fp.roles.get(pl.id) ?? 'inner';
    const field = (label: string, key: 'x' | 'y' | 'size', min: number, max: number) => {
      const err = h('div', { class: 'field-error', role: 'alert' });
      const input = h('input', { class: 'input num', type: 'number', value: pl[key], step: 10, min, max, 'aria-label': label });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (!Number.isFinite(v) || v < min || v > max) { err.textContent = `${min.toLocaleString()} ~ ${max.toLocaleString()} mm 사이로 입력해 주세요.`; input.classList.add('invalid'); return; }
        store.commit(`기둥 ${pl.id} ${label}`, (q) => { const t = q.pillars.find((z) => z.id === pl.id); if (t) { t[key] = Math.round(v); t.source = 'user'; } });
      });
      return h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'num-field' }, input, h('span', { class: 'unit' }, 'mm')), err);
    };
    const span = Math.max(...p.grid.xs, ...p.grid.ys, 10000) + 5000;
    return h('div', null,
      h('div', { class: 'section' },
        h('div', { class: 'pillar-head' }, h('span', { class: `dot ${pl.review ? 'warn' : pl.source === 'user' ? 'user' : 'ok'}` }), h('b', null, pl.id), h('span', { class: 'muted' }, ROLE[role])),
        h('div', { class: 'kv' }, h('span', null, '출처'), h('b', null, pl.source === 'user' ? '직접 입력·수정' : `인식 완료 (신뢰도 ${Math.round(pl.confidence * 100)}%)`)),
        pl.review ? h('div', { class: 'callout warn' }, icon('alert', 16), h('div', null, h('b', null, '확인이 필요합니다'), h('p', null, pl.review),
          h('button', { class: 'btn sm', type: 'button', onclick: () => store.commit(`기둥 ${pl.id} 확인`, (q) => { const t = q.pillars.find((z) => z.id === pl.id); if (t) { delete t.review; t.confidence = Math.max(t.confidence, 0.9); } }) }, icon('check', 14), '맞습니다'))) : null),
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, '모양'),
        h('div', { class: 'seg' }, ...(['round', 'square'] as const).map((sh) =>
          h('button', { class: `seg-btn ${pl.shape === sh ? 'active' : ''}`, type: 'button', 'aria-pressed': String(pl.shape === sh), onclick: () => { if (pl.shape !== sh) store.commit(`기둥 ${pl.id} 모양`, (q) => { const t = q.pillars.find((z) => z.id === pl.id); if (t) { t.shape = sh; t.source = 'user'; } }); } },
            sh === 'round' ? '원기둥(원주)' : '사각기둥(방주)')))),
      h('div', { class: 'section grid2' },
        field('X 위치', 'x', -span, span), field('Y 위치', 'y', -span, span), field(pl.shape === 'round' ? '지름' : '한 변', 'size', 120, 800),
        h('p', { class: 'hint col2' }, '위치는 X1·Y1 교차점 기준입니다. 격자에서 벗어난 기둥은 보·도리 배치에 반영되지 않습니다.')),
      h('div', { class: 'section row' },
        h('button', { class: 'btn', type: 'button', onclick: () => this.act.focusPillar(pl.id) }, icon('eye', 15), '위치 보기'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => this.act.deletePillar(pl.id) }, icon('trash', 15), '기둥 삭제')),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => store.select(null) }, '모델 설정으로 돌아가기'),
    );
  }

  /* ───── 외벽 칸 ───── */
  private edgePanel(p: Project, e: { x1: number; y1: number; x2: number; y2: number }) {
    const same = (o: { x1: number; y1: number; x2: number; y2: number }) => Math.abs(o.x1 - e.x1) + Math.abs(o.y1 - e.y1) + Math.abs(o.x2 - e.x2) + Math.abs(o.y2 - e.y2) < 2;
    const op = p.openings.find(same);
    const cur: OpeningKind | 'wall' = op?.kind ?? 'wall';
    const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
    const set = (k: OpeningKind | 'wall') => store.commit(`외벽 칸: ${({ wall: '벽', window: '창', door: '문', open: '트임' })[k]}`, (q) => {
      q.openings = q.openings.filter((o) => !same(o));
      if (k !== 'wall') q.openings.push({ id: `O${Date.now().toString(36)}`, ...e, kind: k, source: 'user', label: op?.label });
    });
    return h('div', null,
      h('div', { class: 'section' },
        h('div', { class: 'kv' }, h('span', null, '칸 너비'), h('b', null, `${Math.round(len).toLocaleString()} mm (${(len / CHEOK_MM).toFixed(1)}척)`)),
        op?.label ? h('div', { class: 'kv' }, h('span', null, '표기'), h('b', null, op.label)) : null,
        h('div', { class: 'kv' }, h('span', null, '출처'), h('b', null, op ? (op.source === 'user' ? '직접 지정' : '인식됨') : '창호 표기 없음(벽)'))),
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, '이 칸 채우기'),
        h('div', { class: 'seg' }, ...([['wall', '흙벽'], ['window', '창호'], ['door', '문']] as const).map(([k, label]) =>
          h('button', { class: `seg-btn ${cur === k ? 'active' : ''}`, type: 'button', 'aria-pressed': String(cur === k), onclick: () => { if (cur !== k) set(k); } }, label))),
        h('p', { class: 'hint' }, '창호·문은 "형태" 탭의 창살 무늬로 만들어집니다.')),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => store.select(null) }, '모델 설정으로 돌아가기'),
    );
  }
}

function sourceBadge(p: Project, key: keyof Params) {
  const s = p.paramSource[key];
  if (p.params[key] !== p.baseline[key]) return h('span', { class: 'badge user', 'data-tip': `직접 바꾼 값입니다 (처음 값: ${p.baseline[key]})` }, '수정함');
  if (s?.source === 'drawing') return h('span', { class: 'badge drawing', 'data-tip': s.note ?? '도면/사진에서 읽은 값입니다' }, '인식값');
  return h('span', { class: 'badge default', 'data-tip': p.demo ? '예제 값입니다' : '기본 비례로 정한 값입니다' }, p.demo ? '예제' : '기본값');
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(paths: string[], w = 64, hgt = 36): SVGElement {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${hgt}`); s.setAttribute('width', String(w)); s.setAttribute('height', String(hgt)); s.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
  }
  return s;
}
function roofThumb(v: string) {
  if (v === 'matbae') return svg(['M6 26 Q32 4 58 26', 'M14 26V34M50 26V34', 'M22 13 L22 26 M42 13 L42 26']);
  if (v === 'ujingak') return svg(['M4 26 Q14 22 20 10 H44 Q50 22 60 26', 'M14 26V34M50 26V34']);
  return svg(['M4 26 Q14 22 18 16 H46 Q50 22 60 26', 'M18 16 L24 8 H40 L46 16', 'M24 8 V16 M40 8 V16', 'M14 26V34M50 26V34']);
}
function heullimThumb(v: string) {
  if (v === 'baeheullim') return svg(['M26 34 Q22 18 27 4 M38 34 Q42 18 37 4'], 64, 36);
  if (v === 'minheullim') return svg(['M24 34 L28 4 M40 34 L36 4'], 64, 36);
  return svg(['M27 34 V4 M37 34 V4'], 64, 36);
}
