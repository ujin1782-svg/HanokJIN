// 손상 기록 편집기: 사진 위에 손상 영역을 끌어서 표시하고, 보고서 표기를 표준 용어로 교정해 판정·문구를 기록한다.
// 판정은 조사자가 한다. 자동으로 하는 일은 용어 교정 제안과 조사내용 문구 초안뿐이다.

import type { DamageBox, DamageRecord, DamageTarget, Project } from '../core/types';
import { CLASSES, FEASIBILITY_LABEL, ISSUE_LABEL, SEVERITY_LABEL, classById, correctTerm, draftStatement, type ClassId } from '../damage/taxonomy';
import { pillarGridName, targetLabel } from '../damage/records';
import { photoUrl } from '../app/persist';
import { h, icon } from './dom';
import { confirmDialog, openModal, toast } from './modal';

/** 클래스별 영역 색(속성군마다 색 계열을 나눈다). */
export const CLASS_COLOR: readonly string[] = [
  '#d9480f', '#e8590c', '#f08c00', '#c2410c', '#b42318', '#c92a2a', '#a61e4d', // 갈라짐 7종
  '#1971c2', '#1864ab',                                                        // 변형·변위
  '#7048e8', '#9c36b5',                                                        // 분리·탈락
  '#2b8a3e', '#5c940d',                                                        // 생물·수분 열화
  '#0c8599',                                                                   // 표면 오염·변색
];

const GROUPS = [...new Set(CLASSES.map((c) => c.group))];
const MAX_SIDE = 2560;

export interface PendingPhoto { id: string; name: string; w: number; h: number; blob: Blob }

export interface DamageEditorOptions {
  project: Project;
  record: DamageRecord;
  isNew: boolean;
  partNames: string[];
  onSave: (rec: DamageRecord, photo?: PendingPhoto) => void;
  onDelete?: (id: string) => void;
}

/** 사진을 긴 변 2560px 이하 JPEG로 맞춘다(저장 공간과 학습 입력 크기 균형). */
async function preparePhoto(file: File): Promise<PendingPhoto> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), hgt = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, hgt);
  bmp.close();
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => b ? resolve(b) : reject(new Error('사진을 변환하지 못했습니다.')), 'image/jpeg', 0.9));
  return { id: `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, w, h: hgt, blob };
}

export function openDamageEditor(o: DamageEditorOptions) {
  const p = o.project;
  const rec: DamageRecord = JSON.parse(JSON.stringify(o.record));
  let pending: PendingPhoto | undefined;
  let photoSrc = '';
  let selBox = -1;
  let statementTouched = !!rec.statement.trim();

  /* ───── 사진과 영역 ───── */
  const img = h('img', { class: 'dmg-img', alt: '손상 사진', draggable: false });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'dmg-svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
  const stage = h('div', { class: 'dmg-stage' }, img, svg);
  const boxList = h('div', { class: 'dmg-box-list' });
  const photoArea = h('div', { class: 'dmg-photo' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });

  const takeFile = async (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('사진 파일(JPG·PNG 등)만 올릴 수 있습니다.', 'warn'); return; }
    try {
      pending = await preparePhoto(f);
      photoSrc = URL.createObjectURL(pending.blob);
      rec.photo = { id: pending.id, name: pending.name, w: pending.w, h: pending.h };
      rec.boxes = [];
      selBox = -1;
      renderPhoto();
    } catch (e) { toast(`사진을 읽지 못했습니다: ${(e as Error).message}`, 'error'); }
  };
  fileInput.addEventListener('change', () => { void takeFile(fileInput.files?.[0]); fileInput.value = ''; });
  camInput.addEventListener('change', () => { void takeFile(camInput.files?.[0]); camInput.value = ''; });

  const drawBoxes = () => {
    svg.replaceChildren();
    rec.boxes.forEach((b, i) => {
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', String(b.x * 100)); r.setAttribute('y', String(b.y * 100));
      r.setAttribute('width', String(b.w * 100)); r.setAttribute('height', String(b.h * 100));
      r.setAttribute('class', `dmg-rect ${i === selBox ? 'sel' : ''}`);
      r.setAttribute('style', `--c:${CLASS_COLOR[b.cls]}`);
      svg.append(r);
    });
    boxList.replaceChildren(
      rec.boxes.length ? h('div', { class: 'dmg-box-head' }, h('b', null, `표시한 영역 ${rec.boxes.length}개`), h('span', { class: 'muted' }, '영역을 눌러 고르고 손상 종류를 바꿀 수 있습니다')) : '',
      ...rec.boxes.map((b, i) => {
        const sel = h('select', { class: 'select sm', 'aria-label': `영역 ${i + 1} 손상 종류` },
          ...CLASSES.map((c) => h('option', { value: c.id, selected: c.id === b.cls }, `${c.ko} (${c.en})`)));
        sel.addEventListener('change', () => { b.cls = +sel.value; drawBoxes(); });
        return h('div', { class: `dmg-box-row ${i === selBox ? 'sel' : ''}`, onclick: () => { selBox = i; drawBoxes(); } },
          h('span', { class: 'dmg-chip', style: `--c:${CLASS_COLOR[b.cls]}` }, String(i + 1)), sel,
          h('span', { class: 'mono muted' }, `${Math.round(b.w * 100)}×${Math.round(b.h * 100)}%`),
          h('button', { class: 'btn icon sm ghost', type: 'button', 'aria-label': `영역 ${i + 1} 지우기`, onclick: (e: MouseEvent) => { e.stopPropagation(); rec.boxes.splice(i, 1); selBox = -1; drawBoxes(); } }, icon('trash', 15)));
      }));
  };

  // 끌어서 새 영역 그리기
  let drag: { x0: number; y0: number; box: DamageBox } | null = null;
  const rel = (e: PointerEvent) => {
    const r = img.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!rec.photo || e.button !== 0) return;
    const { x, y } = rel(e);
    const hit = rec.boxes.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (hit >= 0 && !e.shiftKey) { selBox = hit; drawBoxes(); return; }
    stage.setPointerCapture(e.pointerId);
    drag = { x0: x, y0: y, box: { x, y, w: 0, h: 0, cls: rec.cls } };
    rec.boxes.push(drag.box);
    selBox = rec.boxes.length - 1;
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { x, y } = rel(e);
    Object.assign(drag.box, { x: Math.min(x, drag.x0), y: Math.min(y, drag.y0), w: Math.abs(x - drag.x0), h: Math.abs(y - drag.y0) });
    drawBoxes();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.box.w < 0.01 || drag.box.h < 0.01) { rec.boxes.pop(); selBox = -1; }
    drag = null;
    drawBoxes();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  const renderPhoto = () => {
    if (!rec.photo) {
      const drop = h('div', { class: 'drop-zone dmg-drop', tabindex: 0, role: 'button', 'aria-label': '손상 사진 올리기', onclick: () => fileInput.click(),
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); } },
        icon('camera', 28), h('b', null, '손상 사진 올리기'), h('span', null, '사진을 끌어다 놓거나 눌러서 고르세요'),
        h('span', { class: 'muted' }, '사진이 있어야 학습 데이터셋(YOLO·COCO·VLM)에 들어갑니다'));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
      drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); void takeFile(e.dataTransfer?.files?.[0]); });
      photoArea.replaceChildren(drop,
        h('button', { class: 'btn sm', type: 'button', onclick: () => camInput.click() }, icon('camera', 15), '카메라로 촬영(모바일)'));
      return;
    }
    if (photoSrc) img.src = photoSrc;
    photoArea.replaceChildren(
      h('div', { class: 'dmg-photo-bar' },
        h('span', { class: 'muted dmg-photo-name', title: rec.photo.name }, `${rec.photo.name} · ${rec.photo.w}×${rec.photo.h}`),
        h('button', { class: 'btn sm', type: 'button', onclick: () => fileInput.click() }, icon('upload', 14), '사진 바꾸기'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          if (rec.boxes.length && !(await confirmDialog('사진 빼기', '사진과 표시한 영역을 이 기록에서 뺍니다.', '빼기', true))) return;
          rec.photo = undefined; rec.boxes = []; pending = undefined; photoSrc = ''; selBox = -1; renderPhoto();
        } }, icon('x', 14), '빼기')),
      stage,
      h('p', { class: 'hint' }, '사진 위를 끌어서 손상 영역을 표시합니다. 영역 안에서 새로 그리려면 Shift를 누른 채 끄세요.'),
      boxList);
    drawBoxes();
  };

  /* ───── 판정 양식 ───── */
  const pillarOpts = p.pillars.map((pl) => {
    const g = pillarGridName(p, pl);
    return h('option', { value: `pillar:${pl.id}` }, g && g !== pl.id ? `기둥 ${g} (${pl.id})` : `기둥 ${g || pl.id}`);
  });
  const partOpts = o.partNames.map((n) => h('option', { value: `part:${n}` }, n));
  const targetSel = h('select', { class: 'select', 'aria-label': '대상 부재' },
    pillarOpts.length ? h('optgroup', { label: '기둥' }, ...pillarOpts) : null,
    partOpts.length ? h('optgroup', { label: '부재 종류' }, ...partOpts) : null,
    h('optgroup', { label: '기타' }, h('option', { value: 'other:' }, '직접 입력…')));
  const otherName = h('input', { class: 'input', placeholder: '부재 이름 (예: 대청 마루널, 동측 화방벽)', 'aria-label': '부재 이름 직접 입력' });
  const keyOf = (t: DamageTarget) => t.kind === 'pillar' ? `pillar:${t.id}` : t.kind === 'part' ? `part:${t.name}` : 'other:';
  const tk = keyOf(rec.target);
  if (![...targetSel.querySelectorAll('option')].some((x) => x.value === tk)) {
    targetSel.querySelector('optgroup:last-child')!.prepend(h('option', { value: tk }, targetLabel(p, rec.target)));
  }
  targetSel.value = tk;
  if (rec.target.kind === 'other') otherName.value = rec.target.name;
  const readTarget = (): DamageTarget => {
    const [kind, ...rest] = targetSel.value.split(':');
    const v = rest.join(':');
    if (kind === 'pillar') return { kind: 'pillar', id: v };
    if (kind === 'part') return { kind: 'part', name: v };
    return { kind: 'other', name: otherName.value.trim() };
  };
  const syncOther = () => { otherName.hidden = !targetSel.value.startsWith('other:'); };
  targetSel.addEventListener('change', () => { syncOther(); rec.target = readTarget(); refreshTerm(); autoStatement(); });
  otherName.addEventListener('input', () => { rec.target = readTarget(); autoStatement(); });
  syncOther();

  const location = h('input', { class: 'input', value: rec.location, placeholder: '예: 정면 하부, 초석 맞닿는 부위, 동측 마구리', 'aria-label': '부재 내 위치' });
  location.addEventListener('input', () => { rec.location = location.value; autoStatement(); });

  const raw = h('input', { class: 'input', value: rec.rawTerm, placeholder: '예: 기둥 할열, 판벽 부식, 기둥 기울음', 'aria-label': '보고서·현장 표기' });
  const termCard = h('div', { class: 'dmg-term' });
  const refreshTerm = () => {
    const c = correctTerm(raw.value, targetLabel(p, rec.target));
    if (!raw.value.trim()) { termCard.replaceChildren(h('span', { class: 'muted' }, '기존 보고서나 현장 메모에 적힌 표기를 넣으면 표준 용어로 교정해 드립니다.')); termCard.className = 'dmg-term'; return; }
    const sug = c.cls !== undefined ? classById(c.cls) : null;
    termCard.className = `dmg-term ${c.issue === 'ok' ? 'ok' : 'fix'}`;
    termCard.replaceChildren(
      h('div', { class: 'dmg-term-head' },
        h('span', { class: `badge ${c.issue === 'ok' ? 'drawing' : 'fail'}` }, ISSUE_LABEL[c.issue]),
        c.entry ? h('span', { class: 'muted' }, `‘${c.entry.term}’ · 보고서 ${c.entry.count.toLocaleString()}회 사용`) : null),
      c.reason ? h('p', null, c.reason) : '',
      sug ? h('div', { class: 'dmg-term-sug' }, h('span', null, '제안: ', h('b', null, `${sug.ko} (${sug.en})`)),
        sug.id !== rec.cls ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => setClass(sug.id) }, '이 분류로 판정') : h('span', { class: 'badge drawing' }, '적용됨'))
        : c.entry ? h('p', { class: 'muted' }, `정제 지침: ${c.entry.guide || c.entry.standard}`) : '');
  };
  raw.addEventListener('input', () => { rec.rawTerm = raw.value; refreshTerm(); });

  const classGrid = h('div', { class: 'dmg-classes' });
  const classInfo = h('div', { class: 'dmg-class-info' });
  const setClass = (id: ClassId) => {
    const prev = rec.cls;
    rec.cls = id;
    // 기록 분류와 같던 영역은 함께 바꾼다(따로 바꾼 영역은 그대로 둔다).
    rec.boxes.forEach((b) => { if (b.cls === prev) b.cls = id; });
    renderClasses(); refreshTerm(); autoStatement(); if (rec.photo) drawBoxes();
  };
  const renderClasses = () => {
    classGrid.replaceChildren(...GROUPS.map((g) => h('div', { class: 'dmg-class-group' },
      h('span', { class: 'dmg-group-label' }, g),
      h('div', { class: 'dmg-class-row' }, ...CLASSES.filter((c) => c.group === g).map((c) =>
        h('button', { class: `dmg-class ${c.id === rec.cls ? 'active' : ''}`, type: 'button', 'aria-pressed': String(c.id === rec.cls), style: `--c:${CLASS_COLOR[c.id]}`, 'data-tip': c.tip, onclick: () => setClass(c.id) },
          h('span', { class: 'dmg-dot' }), c.ko))))));
    const c = classById(rec.cls as ClassId);
    classInfo.replaceChildren(
      h('div', { class: 'dmg-path' }, ...c.path.flatMap((s, i) => [i ? h('span', { class: 'muted' }, '›') : null, h('span', { class: i === c.path.length - 1 ? 'b' : '' }, s)])),
      h('p', null, c.definition),
      h('div', { class: 'dmg-feas' },
        h('span', { class: `badge ${c.feasibility === 'high' ? 'drawing' : 'default'}` }, FEASIBILITY_LABEL[c.feasibility]),
        c.measure ? h('span', { class: 'muted' }, c.measure) : null));
  };

  const sevSeg = h('div', { class: 'seg' });
  const renderSev = () => sevSeg.replaceChildren(...(['minor', 'moderate', 'severe'] as const).map((s) =>
    h('button', { class: `seg-btn sevbtn-${s} ${rec.severity === s ? 'active' : ''}`, type: 'button', 'aria-pressed': String(rec.severity === s), onclick: () => { rec.severity = s; renderSev(); autoStatement(); } }, SEVERITY_LABEL[s])));

  const statement = h('textarea', { class: 'input dmg-statement', rows: 4, 'aria-label': '조사내용 문구' });
  statement.value = rec.statement;
  statement.addEventListener('input', () => { rec.statement = statement.value; statementTouched = true; });
  const autoStatement = (force = false) => {
    if (statementTouched && !force) return;
    rec.statement = draftStatement(rec.cls as ClassId, targetLabel(p, rec.target), rec.location, rec.severity);
    statement.value = rec.statement;
    if (force) statementTouched = false;
  };

  const verified = h('input', { type: 'checkbox', checked: rec.status === 'verified' });
  const surveyed = h('input', { class: 'input', type: 'date', value: rec.surveyedAt, 'aria-label': '조사일' });

  const form = h('div', { class: 'dmg-form' },
    h('div', { class: 'section' },
      h('div', { class: 'section-title' }, '1. 대상 부재'),
      h('div', { class: 'dmg-grid2' }, targetSel, surveyed), otherName, location),
    h('div', { class: 'section' },
      h('div', { class: 'section-title' }, '2. 보고서·현장 표기', h('span', { class: 'muted dmg-opt' }, '선택')),
      raw, termCard),
    h('div', { class: 'section' },
      h('div', { class: 'section-title' }, '3. 표준 손상 분류'),
      classGrid, classInfo),
    h('div', { class: 'section' },
      h('div', { class: 'section-title' }, '4. 손상 정도'), sevSeg),
    h('div', { class: 'section' },
      h('div', { class: 'section-title' }, '5. 보존사항 조사내용',
        h('button', { class: 'btn ghost xs', type: 'button', 'data-tip': '분류·부재·정도로 문구를 다시 씁니다', onclick: () => autoStatement(true) }, icon('reset', 13), '다시 쓰기')),
      statement,
      h('label', { class: 'check' }, verified, h('span', null, '검수 완료 (학습 데이터의 정답 라벨로 확정)'))),
  );

  const body = h('div', { class: 'dmg-editor' }, h('div', { class: 'dmg-left' }, photoArea, fileInput, camInput), form);

  const save = h('button', { class: 'btn primary', type: 'button' }, icon('check', 16), '저장');
  const actions: HTMLElement[] = [];
  if (!o.isNew && o.onDelete) actions.push(h('button', { class: 'btn danger ghost dmg-del', type: 'button', onclick: async () => {
    if (!(await confirmDialog('손상 기록 삭제', `${rec.id} 기록을 삭제할까요? 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.`, '삭제', true))) return;
    o.onDelete!(rec.id); m.close();
  } }, icon('trash', 15), '삭제'));
  actions.push(h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, '취소'), save);

  const m = openModal(o.isNew ? '손상 기록 추가' : `손상 기록 ${rec.id}`, body, actions, { wide: true, onClose: () => { if (photoSrc) URL.revokeObjectURL(photoSrc); } });
  m.dialog.classList.add('dmg-modal');

  save.onclick = () => {
    rec.target = readTarget();
    if (rec.target.kind === 'other' && !rec.target.name) { toast('부재 이름을 입력하세요.', 'warn'); otherName.focus(); return; }
    rec.status = verified.checked ? 'verified' : 'draft';
    rec.surveyedAt = surveyed.value || rec.surveyedAt;
    rec.statement = statement.value.trim() || draftStatement(rec.cls as ClassId, targetLabel(p, rec.target), rec.location, rec.severity);
    o.onSave(rec, pending);
    m.close();
  };

  renderClasses(); renderSev(); refreshTerm();
  if (!statementTouched) autoStatement();
  if (rec.photo) {
    void photoUrl(rec.photo.id).then((u) => {
      if (u) { img.src = u; renderPhoto(); }
      else { toast('저장된 사진을 찾지 못했습니다. 사진을 다시 올려 주세요.', 'warn'); rec.photo = undefined; rec.boxes = []; renderPhoto(); }
    });
  }
  renderPhoto();
}
