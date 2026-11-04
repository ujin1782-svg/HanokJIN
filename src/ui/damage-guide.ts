// 손상 용어 안내: 14개 표준 분류의 정의·판별 요령과 보고서 표기 81종 사전(검색).

import { CLASSES, FEASIBILITY_LABEL, ISSUE_LABEL, TERMS, TOTAL_MENTIONS, classById } from '../damage/taxonomy';
import { h } from './dom';
import { openModal } from './modal';
import { CLASS_COLOR } from './damage-editor';

export function openDamageGuide(initialTab: 'classes' | 'terms' = 'classes') {
  let tab = initialTab;
  let query = '';
  const content = h('div', { class: 'guide-content' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  const classesView = () => h('div', { class: 'guide-classes' },
    h('p', { class: 'hint' }, '손상(총칭) › 열화·풍화·훼손(중위) › 현상 속성군 › 표준 용어 순으로 분류합니다. 목재 자체의 건조 갈라짐은 ‘균열’이 아니라 ‘갈램’(방향에 따라 할렬·윤할·분할)입니다.'),
    ...CLASSES.map((c) => h('article', { class: 'guide-class', style: `--c:${CLASS_COLOR[c.id]}` },
      h('header', null, h('span', { class: 'dmg-dot' }), h('b', null, c.ko), h('span', { class: 'muted' }, c.en), h('span', { class: 'mono muted guide-id' }, `#${c.id}`)),
      h('div', { class: 'dmg-path' }, c.path.join(' › ')),
      h('p', null, c.definition),
      h('p', { class: 'guide-tip' }, h('b', null, '판별 요령 '), c.tip),
      h('div', { class: 'dmg-feas' }, h('span', { class: `badge ${c.feasibility === 'high' ? 'drawing' : 'default'}` }, FEASIBILITY_LABEL[c.feasibility]), c.measure ? h('span', { class: 'muted' }, c.measure) : null))));

  const termsView = () => {
    const search = h('input', { class: 'input', type: 'search', placeholder: '용어 검색 (예: 부식, 기울, 갈라)', value: query, 'aria-label': '용어 검색' });
    const tbody = h('tbody');
    const fill = () => {
      const qq = query.trim();
      const rows = TERMS.filter((t) => !qq || `${t.term} ${t.category} ${t.standard}`.includes(qq));
      tbody.replaceChildren(...rows.map((t) => h('tr', null,
        h('td', null, h('b', null, t.term)),
        h('td', { class: 'num' }, t.count.toLocaleString()),
        h('td', null, t.category),
        h('td', null, h('span', { class: `badge ${t.issue === 'ok' ? 'drawing' : t.issue === 'generic' ? 'default' : 'fail'}` }, ISSUE_LABEL[t.issue])),
        h('td', null, t.cls !== undefined ? h('span', { class: 'guide-cls', style: `--c:${CLASS_COLOR[t.cls]}` }, classById(t.cls).ko) : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'guide-guide' }, t.reason ?? t.guide))));
      if (!rows.length) tbody.append(h('tr', null, h('td', { colspan: 6, class: 'muted' }, '검색 결과가 없습니다.')));
    };
    search.addEventListener('input', () => { query = search.value; fill(); });
    fill();
    return h('div', { class: 'guide-terms' },
      h('div', { class: 'guide-terms-bar' }, search, h('span', { class: 'muted' }, `${TERMS.length}개 표기 · 보고서 언급 ${TOTAL_MENTIONS.toLocaleString()}회`)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ...['보고서 표기', '언급', '성격군', '교정', '표준 분류', '정제 지침'].map((x) => h('th', { scope: 'col' }, x)))), tbody)));
  };

  const render = () => {
    tabs.replaceChildren(...([['classes', '표준 분류 14종'], ['terms', '보고서 용어 사전']] as const).map(([id, label]) =>
      h('button', { class: `tab ${tab === id ? 'active' : ''}`, role: 'tab', type: 'button', 'aria-selected': String(tab === id), onclick: () => { tab = id; render(); } }, label)));
    content.replaceChildren(tab === 'classes' ? classesView() : termsView());
  };
  render();
  const m = openModal('손상 용어 안내', h('div', { class: 'guide' }, tabs, content,
    h('p', { class: 'hint guide-src' }, '출처: 최현서·김소현·김윤상(2025), 「목조 건축문화유산 손상 진단을 위한 용어 표준 체계화 기초 연구」, 건축역사연구 34(3) pp.19-30. 언급 횟수는 같은 논문 표 6의 값입니다.')), [], { wide: true });
  m.dialog.classList.add('guide-modal');
}
