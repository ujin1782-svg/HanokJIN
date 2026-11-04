// 앱 조립: 머리글·단계 안내·작업 공간·패널·대화상자·단축키·자동 저장.
// 두 가지 모드: 모델링(도면·4면 사진 → 3D) / 손상 조사(부재별 손상 사진·표준 용어 판정 → 조사표·학습 데이터).

import type { CheckResult, DamageRecord, DamageTarget, Pillar } from '../core/types';
import { STAGE_LABEL, SUPPORTED, checkFile, type Stage, type ParseResult } from '../cad/pipeline';
import { scaleDoc } from '../cad/normalize';
import { segmentSheets } from '../cad/sheets';
import { recognize } from '../cad/recognize';
import { drawingFromProject } from '../model/plan-drawing';
import { FORMATS, runExport, type ExportFormat } from '../export/files';
import { store, type Layout, type Mode } from './store';
import { loadCad, LoadError } from './loader';
import { loadSession, saveSession, clearSession, putPhoto, prunePhotos, type Session } from './persist';
import { h, icon, iconBtn } from '../ui/dom';
import { DrawingView } from '../ui/drawing';
import { Viewport } from '../ui/viewport';
import { Inspector } from '../ui/inspector';
import { BottomPanel } from '../ui/bottom';
import { confirmDialog, openModal, promptNumber, toast } from '../ui/modal';
import { openPhotoModelingModal } from '../ui/photo-modal';
import { openDamageEditor, type PendingPhoto } from '../ui/damage-editor';
import { openDamageGuide } from '../ui/damage-guide';
import { blankDamage, summarize, targetLabel } from '../damage/records';

export class App {
  private drawing: DrawingView;
  private viewport: Viewport;
  private inspector: Inspector;
  private bottom: BottomPanel;
  private workspace: HTMLElement;
  private start: HTMLElement;
  private header: HTMLElement;
  private saveTimer = 0;
  private pendingFile?: { name: string; bytes: ArrayBuffer };

  constructor(root: HTMLElement) {
    this.drawing = new DrawingView({ addPillar: (x, y) => this.addPillar(x, y), calibrate: (d) => this.calibrate(d) });
    this.viewport = new Viewport({ addDamage: (t) => this.addDamage(t), showDamages: (t) => this.showDamages(t) });
    this.inspector = new Inspector({
      deletePillar: (id) => this.deletePillar(id), focusPillar: (id) => this.focusPillar(id),
      addDamage: (t) => this.addDamage(t), editDamage: (id) => this.editDamage(id), openGuide: () => openDamageGuide(), exportDamage: () => this.openExport(true),
    });
    this.bottom = new BottomPanel({
      focus: (c) => this.focusCheck(c), exportCsv: () => this.doExport('csv'), getBuild: () => this.viewport.build,
      editDamage: (id) => this.editDamage(id), exportDamage: () => this.openExport(true),
    });

    const splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': '창 크기 조절', tabindex: 0 });
    this.workspace = h('main', { class: 'workspace', 'data-layout': 'split' }, this.drawing.el, splitter, this.viewport.el, this.inspector.el);
    this.setupSplitter(splitter);
    this.start = h('div', { class: 'start' });
    this.header = h('header', { class: 'app-header' });
    root.replaceChildren(this.header, h('div', { class: 'body' }, this.workspace, this.start), this.bottom.el);

    store.on('project', () => this.renderHeader());
    store.on('history', () => { this.renderHeader(); this.scheduleSave(); });
    store.on('palette', () => this.renderHeader());
    store.on('save', () => this.renderHeader());
    store.on('model', () => this.renderHeader());
    store.on('damage', () => this.renderHeader());
    let lastMode = store.ui.mode;
    store.on('ui', () => { if (lastMode !== store.ui.mode) { lastMode = store.ui.mode; this.renderHeader(); } this.applyLayout(); });
    window.addEventListener('resize', () => this.applyLayout());
    this.setupKeys();
    this.setupDrop();
    this.renderHeader();
    this.applyLayout();
    void this.renderStart();

    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__hanok = { app: this, store, openFile: (f: File) => this.openFile(f) };
  }

  /* ───── 시작 화면 ───── */
  private async renderStart() {
    const session = await loadSession();
    const entry = (ic: string, title: string, desc: string, note: string, label: string, run: () => void, cls = '') =>
      h('div', { class: `drop-zone ${cls}`, tabindex: 0, role: 'button', 'aria-label': label, onclick: run, onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } } },
        icon(ic, 28), h('b', null, title), h('span', null, desc), h('span', { class: 'muted' }, note));
    const flow = [
      ['upload', '불러오기', 'DWG·DXF 평면도 또는 건물 4면 사진'],
      ['cube', '3D 모델', '격자·기둥 인식 검토, 지붕·공포·재질 편집'],
      ['alert', '손상 조사', '부재별 사진·손상 영역·표준 용어 판정'],
      ['download', '내보내기', 'IFC·glTF·DXF·물량표, 조사표·학습 데이터셋'],
    ] as const;
    this.start.replaceChildren(h('div', { class: 'start-card' },
      h('div', { class: 'start-mark' }, logo(44)),
      h('h1', null, '한옥 3D 모델링과 손상 조사를 한곳에서'),
      h('p', { class: 'lead' }, '도면이나 4면 사진으로 한옥 3D 모델을 만들고, 기둥·부재마다 손상을 사진과 함께 표준 용어로 기록합니다.'),
      session ? h('button', { class: 'btn resume', type: 'button', onclick: () => this.resume(session) }, icon('reset', 16),
        h('span', null, h('b', null, '이어서 작업하기'), h('span', { class: 'muted' }, ` ${session.project.name} · ${new Date(session.savedAt).toLocaleString('ko-KR')}${session.project.damages.length ? ` · 손상 기록 ${session.project.damages.length}건` : ''}`))) : null,
      h('div', { class: 'start-entry-grid' },
        entry('upload', 'CAD 도면 열기', 'DWG · DXF 평면도를 끌어다 놓거나 눌러서 고르세요', 'AutoCAD R13~2018 · ASCII DXF · 80MB 이하', '도면 파일 열기', () => this.pickFile()),
        entry('camera', '4면 사진으로 만들기', '정면·배면·좌측면·우측면을 지정 프레임에 맞춰 촬영하거나 올립니다', '도면이 없는 건물에 알맞습니다', '4면 사진으로 3D 만들기', () => this.openPhotoStudio(), 'photo-entry-zone')),
      h('ol', { class: 'start-flow' }, ...flow.map(([ic, t, d], i) => h('li', null,
        h('span', { class: 'flow-ic' }, icon(ic, 18)), h('b', null, `${i + 1}. ${t}`), h('span', null, d)))),
      h('button', { class: 'btn ghost sm start-guide', type: 'button', onclick: () => openDamageGuide() }, icon('help', 14), '손상 표준 용어 안내 (14개 분류 · 보고서 표기 81종)'),
    ));
    this.applyLayout();
  }

  /** 4면 [전·후·좌·우] 지정 프레임 촬영 스튜디오 열기 */
  openPhotoStudio() {
    openPhotoModelingModal({
      onComplete: ({ project, doc, sheets }) => {
        this.pendingFile = undefined;
        store.open(project, doc, sheets);
        this.afterOpen();
      },
    });
  }

  private async resume(s: Session) {
    if (s.file) {
      const job = loadCad(new File([s.file.bytes], s.file.name), () => {});
      try {
        const r = await job.promise;
        this.pendingFile = s.file;
        store.open(s.project, r.doc, r.sheets);
      } catch {
        toast('저장된 도면을 다시 읽지 못해 모델만 불러왔습니다.', 'warn');
        store.open(s.project, null, []);
      }
    } else {
      // 도면 없이 만든 모델(4면 사진)은 모델에서 평면도를 다시 그린다.
      const doc = drawingFromProject(s.project, `${s.project.name} 평면도`);
      store.open(s.project, doc, [{ id: 'sheet-1', kind: 'PLAN', title: '평면도', bounds: doc.extents, entityCount: doc.stats.entities }]);
    }
    void prunePhotos(new Set(s.project.damages.flatMap((d) => d.photo ? [d.photo.id] : [])));
    this.afterOpen();
  }

  private afterOpen() {
    this.applyLayout();
    store.setUI({ bottom: false, drawer: false, tool: 'select', explode: 0, section: { axis: 'none', pos: 1 } });
    requestAnimationFrame(() => requestAnimationFrame(() => { this.drawing.fit(); this.viewport.fitView(); }));
    this.scheduleSave();
  }

  /* ───── 파일 열기 ───── */
  pickFile() {
    const input = h('input', { type: 'file', accept: SUPPORTED.join(','), hidden: true });
    input.addEventListener('change', () => { const f = input.files?.[0]; if (f) void this.openFile(f); input.remove(); });
    document.body.append(input);
    input.click();
  }

  async openFile(file: File) {
    if (store.project && !(await confirmDialog('새 도면 열기', '지금 작업 중인 프로젝트를 닫고 새 도면을 엽니다. 현재 작업은 이 브라우저에 저장된 상태로 남지 않습니다.', '새 도면 열기'))) return;
    try { checkFile(file.name, file.size); } catch (e) { this.showLoadError(file, e as LoadError); return; }
    const stages: Stage[] = ['read', 'decode', 'normalize', 'sheets', 'recognize'];
    const items = stages.map((s) => h('li', { class: 'stage', 'data-stage': s }, h('span', { class: 'stage-dot' }), STAGE_LABEL[s]));
    const cancel = h('button', { class: 'btn', type: 'button' }, '취소');
    const m = openModal('도면 분석', h('div', { class: 'load' },
      h('div', { class: 'load-file' }, icon('file', 18), h('b', null, file.name), h('span', { class: 'muted' }, `${(file.size / 1048576).toFixed(1)}MB`)),
      h('ol', { class: 'stages' }, ...items),
      h('p', { class: 'hint' }, file.name.toLowerCase().endsWith('.dwg') ? 'DWG를 처음 열 때는 해석 엔진(약 11MB)을 내려받아 조금 더 걸립니다.' : '')), [cancel], { dismissable: false });
    const job = loadCad(file, (st) => {
      const k = stages.indexOf(st);
      items.forEach((li, i) => li.className = `stage ${i < k ? 'done' : i === k ? 'active' : ''}`);
    });
    cancel.onclick = () => job.cancel();
    let r: ParseResult;
    try {
      r = await job.promise;
    } catch (e) {
      m.close();
      if ((e as Error).message !== '취소했습니다.') this.showLoadError(file, e as LoadError);
      return;
    }
    m.close();
    this.pendingFile = { name: file.name, bytes: await file.arrayBuffer() };
    store.open(r.recognition.project, r.doc, r.sheets);
    this.afterOpen();
    const p = r.recognition.project;
    if (!p.pillars.length) toast('도면은 열었지만 기둥을 찾지 못했습니다. "기둥 추가" 도구로 입력하거나 인식 정보를 확인해 주세요.', 'warn');
    else toast(`${r.sheets.length}개 시트, 기둥 ${p.pillars.length}개를 찾았습니다 (${(r.ms / 1000).toFixed(1)}초).`, 'ok');
  }

  private showLoadError(file: File, e: LoadError) {
    openModal('도면을 열 수 없습니다', h('div', { class: 'callout error' }, icon('fail', 18), h('div', null,
      h('b', null, e.message), e.hint ? h('p', null, e.hint) : null,
      h('p', { class: 'muted' }, `파일: ${file.name}`),
      h('p', { class: 'muted' }, `지원 형식: ${SUPPORTED.join(', ')} (건물 외관 사진은 [4면 사진으로 3D 만들기] 기능을 이용해 주세요)`))), [
      h('button', { class: 'btn', type: 'button', onclick: () => { document.querySelector('.modal-overlay')?.remove(); this.openPhotoStudio(); } }, icon('camera', 15), '4면 사진으로 3D 만들기'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { document.querySelector('.modal-overlay')?.remove(); this.pickFile(); } }, '다른 도면 선택'),
    ]);
  }

  private setupDrop() {
    let depth = 0;
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; document.body.classList.add('dragging'); e.preventDefault(); } });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.openFile(f);
    });
  }

  /* ───── 편집 동작 ───── */
  private addPillar(x: number, y: number) {
    const p = store.project!;
    const near = p.pillars.find((q) => Math.hypot(q.x - x, q.y - y) < 300);
    if (near) { toast(`그 자리에 이미 기둥 ${near.id}가 있습니다.`, 'warn'); store.select({ kind: 'pillar', id: near.id }); return; }
    let n = 1;
    while (p.pillars.some((q) => q.id === `U${n}`)) n++;
    const pl: Pillar = { id: `U${n}`, x, y, shape: 'round', size: p.params.baseD, source: 'user', confidence: 1 };
    store.commit(`기둥 ${pl.id} 추가`, (q) => { q.pillars.push(pl); });
    store.select({ kind: 'pillar', id: pl.id });
    toast(`기둥 ${pl.id}를 추가했습니다. 오른쪽에서 모양과 굵기를 확인하세요.`, 'ok', { label: '되돌리기', run: () => store.undo() });
  }

  private async deletePillar(id: string) {
    if (!(await confirmDialog('기둥 삭제', `기둥 ${id}를 삭제할까요? 지붕과 벽이 남은 기둥에 맞춰 다시 만들어집니다. 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.`, '삭제', true))) return;
    store.commit(`기둥 ${id} 삭제`, (q) => { q.pillars = q.pillars.filter((z) => z.id !== id); });
    store.select(null);
    toast(`기둥 ${id}를 삭제했습니다.`, 'info', { label: '되돌리기', run: () => store.undo() });
  }

  private focusPillar(id: string) {
    const p = store.project, pl = p?.pillars.find((q) => q.id === id);
    if (!p || !pl) return;
    store.select({ kind: 'pillar', id });
    this.drawing.focus(pl.x, pl.y);
    const b = this.viewport.build;
    if (b) this.viewport.focusPoint(b.toWorld(pl.x, pl.y, (p.params.gidanHeight + p.params.pillarHeight * 0.6) / 1000), 7);
  }

  private focusCheck(c: CheckResult) {
    if (c.focus?.pillarId) this.focusPillar(c.focus.pillarId);
  }

  /* ───── 손상 조사 ───── */
  setMode(mode: Mode) {
    if (store.ui.mode === mode) return;
    store.setUI({ mode, drawer: mode === 'survey' ? true : store.ui.drawer, bottomTab: mode === 'survey' ? 'damage' : store.ui.bottomTab === 'damage' ? 'checks' : store.ui.bottomTab });
    if (mode === 'survey' && !store.project?.damages.length) toast('도면이나 3D에서 기둥·부재를 누른 뒤 [손상 기록]으로 사진과 손상을 기록하세요.', 'info');
  }

  addDamage(target: DamageTarget) {
    const p = store.project;
    if (!p) return;
    this.openDamage(blankDamage(p, target), true);
  }

  editDamage(id: string) {
    const d = store.project?.damages.find((x) => x.id === id);
    if (d) this.openDamage(d, false);
  }

  private openDamage(rec: DamageRecord, isNew: boolean) {
    const p = store.project!;
    openDamageEditor({
      project: p, record: rec, isNew, partNames: this.viewport.partNames(),
      onSave: (r, photo) => void this.saveDamage(r, photo, isNew),
      onDelete: (id) => {
        store.commit(`손상 기록 ${id} 삭제`, (q) => { q.damages = q.damages.filter((x) => x.id !== id); }, 'damage');
        toast(`손상 기록 ${id}를 삭제했습니다.`, 'info', { label: '되돌리기', run: () => store.undo() });
      },
    });
  }

  private async saveDamage(rec: DamageRecord, photo: PendingPhoto | undefined, isNew: boolean) {
    if (photo) {
      try { await putPhoto(photo.id, photo.blob); }
      catch { toast('사진을 이 브라우저에 저장하지 못했습니다. 새로고침하면 사진이 사라질 수 있습니다.', 'warn'); }
    }
    const p = store.project!;
    const label = `${targetLabel(p, rec.target)} 손상 ${isNew ? '기록' : '수정'}`;
    store.commit(label, (q) => {
      const i = q.damages.findIndex((x) => x.id === rec.id);
      if (i >= 0) q.damages[i] = rec; else q.damages.push(rec);
    }, 'damage');
    if (store.ui.mode !== 'survey') store.setUI({ mode: 'survey', drawer: true });
    toast(`${rec.id} ${label}을 저장했습니다.`, 'ok', { label: '되돌리기', run: () => store.undo() });
  }

  /** 대상 부재를 선택하고 손상 기록 목록을 보여 준다. */
  private showDamages(t: DamageTarget) {
    if (store.ui.mode !== 'survey') this.setMode('survey');
    if (t.kind === 'pillar') store.select({ kind: 'pillar', id: t.id });
    store.setUI({ drawer: true });
  }

  private async calibrate(worldDist: number) {
    if (!store.cad) return;
    const real = await promptNumber('축척 보정', `두 점 사이의 도면상 길이는 ${Math.round(worldDist).toLocaleString()} (도면 단위)입니다. 실제 길이를 mm로 입력하세요.`, 'mm');
    if (!real) return;
    const k = real / worldDist;
    if (Math.abs(k - 1) < 0.002) { toast('축척이 이미 맞습니다.', 'ok'); return; }
    if (!(await confirmDialog('축척 적용', `도면 전체를 ${k.toFixed(4)}배로 맞춘 뒤 격자와 기둥을 다시 인식합니다. 지금까지 고친 기둥·값은 새 인식 결과로 바뀝니다.`, '적용'))) return;
    const doc = scaleDoc(store.cad, k);
    const sheets = segmentSheets(doc);
    const r = recognize(doc, sheets);
    r.project.recognitionNotes.unshift(`사용자 축척 보정 ×${k.toFixed(4)} 적용`);
    store.open(r.project, doc, sheets);
    this.afterOpen();
    toast('축척을 보정하고 다시 인식했습니다.', 'ok');
  }

  /* ───── 내보내기 ───── */
  openExport(damageFirst = store.ui.mode === 'survey') {
    const b = this.viewport.build, p = store.project;
    if (!p || !b) { toast('내보낼 모델이 없습니다. 먼저 도면을 열거나 4면 사진으로 모델을 만드세요.', 'warn'); return; }
    const sum = summarize(p.damages);
    const formats = FORMATS.filter((f) => !f.damage || sum.total);
    const groups = [
      { title: '손상 조사', items: formats.filter((f) => f.damage) },
      { title: '3D 모델·도면', items: formats.filter((f) => !f.damage) },
    ];
    if (!damageFirst) groups.reverse();
    let fmt: ExportFormat = groups.find((g) => g.items.length)!.items[0].id;
    const visibleOnly = h('input', { type: 'checkbox', checked: true });
    const verifiedOnly = h('input', { type: 'checkbox', checked: false, disabled: !sum.verified });
    const hidden = store.ui.hiddenGroups.size;
    const list = h('div', { class: 'format-list', role: 'radiogroup', 'aria-label': '파일 형식' }, ...groups.filter((g) => g.items.length).flatMap((g) => [
      h('div', { class: 'format-group' }, g.title),
      ...g.items.map((f) => h('label', { class: 'format' }, h('input', { type: 'radio', name: 'fmt', value: f.id, checked: f.id === fmt, onchange: () => { fmt = f.id; } }),
        h('span', null, h('b', null, f.label), h('span', null, f.desc), h('span', { class: 'muted' }, `쓰는 곳: ${f.usage}`))))]));
    const run = h('button', { class: 'btn primary', type: 'button' }, icon('download', 16), '내보내기');
    const m = openModal('내보내기', h('div', null,
      list,
      h('label', { class: 'check' }, visibleOnly, h('span', null, `숨긴 부재 제외 (IFC·glTF)${hidden ? ` — 현재 ${hidden}개 묶음 숨김` : ''}`)),
      sum.total ? h('label', { class: 'check' }, verifiedOnly, h('span', null, `손상 기록은 검수 완료만 (${sum.verified} / ${sum.total}건)`)) : null,
      h('p', { class: 'hint' }, '단위는 IFC·glTF는 m, DXF·물량표는 mm입니다. 기와 매수는 지붕 면적에서 낸 추정값입니다.',
        sum.total ? ` 학습 데이터셋에는 사진이 있는 기록 ${sum.withPhoto}건이 들어갑니다.` : '')), [
      h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, '닫기'), run]);
    run.onclick = async () => { run.disabled = true; const ok = await this.doExport(fmt, visibleOnly.checked, verifiedOnly.checked); run.disabled = false; if (ok) m.close(); };
  }

  private async doExport(fmt: ExportFormat, onlyVisible = true, verifiedOnly = false): Promise<boolean> {
    const b = this.viewport.build, p = store.project;
    if (!p || !b) return false;
    try {
      const r = await this.viewport.withCleanState(() => runExport(fmt, p, b, onlyVisible, verifiedOnly));
      store.setUI({ exported: true });
      toast(`${r.name} 저장 완료 (${(r.size / 1024).toFixed(0)}KB)`, 'ok');
      return true;
    } catch (e) {
      console.error(e);
      toast(`내보내기에 실패했습니다: ${(e as Error).message}.`, 'error');
      return false;
    }
  }

  /* ───── 도움말 ───── */
  openHelp() {
    const term = (a: string, b: string) => h('div', { class: 'kv' }, h('span', null, a), h('b', null, b));
    openModal('도움말', h('div', { class: 'help-body' },
      h('h3', null, '작업 순서'),
      h('ol', null,
        h('li', null, h('b', null, '도면 또는 4면 사진 준비'), ' — DWG·DXF를 열거나 [4면 사진] 버튼으로 전·후·좌·우 건물 사진을 지정 프레임에 맞춰 촬영·업로드합니다.'),
        h('li', null, h('b', null, '인식 검토'), ' — 노란 ! 표시 기둥은 확인이 필요합니다. 아래 "검증 결과"에서 눌러 위치로 이동합니다.'),
        h('li', null, h('b', null, '3D 생성'), ' — 격자와 기둥으로 지붕·보·벽을 자동으로 만듭니다.'),
        h('li', null, h('b', null, '꾸미기·편집'), ' — 오른쪽 위 "꾸미기·설정"에서 사실적인 PBR 재질 프리셋, 지붕 형식, 높이를 바꿉니다.'),
        h('li', null, h('b', null, '손상 조사'), ' — 위쪽에서 [손상 조사]로 바꾸고 기둥·부재를 눌러 사진·손상 영역·표준 용어·정도를 기록합니다. 기존 보고서 표기(할열, 기울음, 부식 등)는 표준 용어로 교정해 제안합니다.'),
        h('li', null, h('b', null, '내보내기'), ' — IFC(BIM), glTF(3D), DXF(평면), CSV(물량표), 손상 조사표(CSV), 손상 학습 데이터셋(YOLO·COCO·VLM ZIP).')),
      h('p', { class: 'hint' }, '손상 판정은 조사자가 합니다. 이 앱은 사진을 자동으로 판정하지 않으며, 용어 교정 제안과 조사내용 문구 초안만 자동으로 만듭니다.'),
      h('h3', null, '마우스'),
      term('도면', '휠: 확대·축소 · 끌기: 이동 · 클릭: 기둥/외벽 칸 선택'),
      term('3D', '끌기: 회전 · 오른쪽 끌기(또는 Shift): 이동 · 휠: 확대 · 클릭: 부재 선택'),
      term('손상 사진', '끌기: 손상 영역 표시 · 영역 클릭: 선택 · Shift+끌기: 영역 안에서 새로 그리기'),
      h('h3', null, '단축키'),
      term('Ctrl+Z / Ctrl+Y', '실행 취소 / 다시 실행'), term('Delete', '선택한 기둥 삭제(확인 후)'), term('Esc', '도구 끝내기 · 선택 해제'), term('F', '도면 화면 맞춤'),
    ), [h('button', { class: 'btn ghost', type: 'button', onclick: () => openDamageGuide() }, icon('help', 15), '손상 용어 안내'),
      h('button', { class: 'btn danger ghost', type: 'button', onclick: async () => {
      if (await confirmDialog('저장된 작업 지우기', '이 브라우저에 저장된 프로젝트와 도면을 지우고 처음 화면으로 돌아갑니다. 되돌릴 수 없습니다.', '지우기', true)) await this.resetAll();
    } }, icon('trash', 15), '저장된 작업 지우기')], { wide: true });
  }

  /* ───── 머리글 ───── */
  private renderHeader() {
    const p = store.project;
    const b = this.viewport.build;
    const review = p?.pillars.filter((q) => q.review).length ?? 0;
    const warns = this.bottom.results.filter((c) => c.status === 'fail').length;
    const touched = !!p && (p.palette.id !== 'baekgol' || Object.keys(p.palette.custom).length > 0 || (Object.keys(p.params) as (keyof typeof p.params)[]).some((k) => p.params[k] !== p.baseline[k]));
    const steps = [
      { label: '도면·4면 사진', done: !!p, action: () => this.openPhotoStudio() },
      { label: '인식 검토', done: !!p && review === 0, action: () => store.setUI({ bottom: true, bottomTab: 'checks' }) },
      { label: '3D 생성', done: !!b, action: () => store.setUI({ layout: store.ui.layout === 'drawing' ? 'split' : store.ui.layout }) },
      { label: '꾸미기·편집', done: touched, action: () => { store.select(null); store.setUI({ drawer: true }); } },
      { label: '내보내기', done: store.ui.exported, action: () => this.openExport() },
    ];
    const current = steps.findIndex((s) => !s.done);
    const mode = store.ui.mode;
    const modeSeg = p ? h('div', { class: 'seg mode-seg', role: 'group', 'aria-label': '작업 모드' }, ...([['model', 'cube', '모델링'], ['survey', 'alert', '손상 조사']] as [Mode, string, string][]).map(([id, ic, label]) =>
      h('button', { class: `seg-btn ${mode === id ? 'active' : ''}`, type: 'button', 'aria-pressed': String(mode === id), onclick: () => this.setMode(id) }, icon(ic, 15), h('span', null, label),
        id === 'survey' && p.damages.length ? h('span', { class: 'seg-count' }, String(p.damages.length)) : null))) : null;
    const stepper = mode === 'survey' && p ? h('div', { class: 'survey-hint' }, icon('pointer', 15), h('span', null, '도면이나 3D에서 기둥·부재를 눌러 손상을 기록하세요'))
      : h('nav', { class: 'stepper', 'aria-label': '작업 단계' }, ...steps.map((s, i) =>
      h('button', { class: `step ${s.done ? 'done' : i === current ? 'current' : ''}`, type: 'button', disabled: !p && i > 0, 'aria-current': i === current ? 'step' : undefined, 'aria-label': `${i + 1}단계 ${s.label}${s.done ? ' (완료)' : ''}`, 'data-tip': `${i + 1}단계 ${s.label}`, onclick: s.action },
        h('span', { class: 'step-n' }, s.done ? icon('check', 12) : String(i + 1)), h('span', { class: 'step-label' }, s.label))));

    const save = store.saveState;
    const saveEl = !p ? null : save === 'saving' ? h('span', { class: 'save' }, '저장 중…')
      : save === 'error' ? h('button', { class: 'save error', type: 'button', onclick: () => this.saveNow(), 'data-tip': '이 브라우저 저장소를 쓸 수 없습니다' }, '저장 실패 · 다시 시도')
      : save === 'saved' ? h('span', { class: 'save', 'data-tip': '이 브라우저에 자동 저장됩니다' }, icon('check', 13), '저장됨') : null;

    const layoutSeg = p ? h('div', { class: 'seg layout-seg', role: 'group', 'aria-label': '화면 배치' }, ...([['drawing', 'plan', '도면'], ['split', 'split', '나란히'], ['model', 'cube', '3D']] as [Layout, string, string][]).map(([id, ic, label]) =>
      h('button', { class: `seg-btn ${store.ui.layout === id ? 'active' : ''} ${id === 'split' ? 'split-opt' : ''}`, type: 'button', 'aria-pressed': String(store.ui.layout === id), 'aria-label': label, 'data-tip': `${label} 보기`, onclick: () => store.setUI({ layout: id }) }, icon(ic, 16), h('span', { class: 'seg-label' }, label)))) : null;

    const undo = iconBtn('undo', store.canUndo() ? `실행 취소: ${store.undoLabel()}` : '실행 취소', () => { const l = store.undo(); if (l) toast(`취소: ${l}`); }, { shortcut: 'Ctrl+Z' });
    undo.disabled = !store.canUndo();
    const redo = iconBtn('redo', store.canRedo() ? `다시 실행: ${store.redoLabel()}` : '다시 실행', () => { const l = store.redo(); if (l) toast(`다시 실행: ${l}`); }, { shortcut: 'Ctrl+Y' });
    redo.disabled = !store.canRedo();

    const photoBtn = h('button', {
      class: 'btn photo-header-btn',
      type: 'button',
      'data-tip': '건물 4면[전·후·좌·우]을 지정 프레임으로 촬영해 3D 모델을 만듭니다',
      onclick: () => this.openPhotoStudio(),
    }, icon('camera', 16), h('span', { class: 'hide-md' }, '4면 사진 3D'));

    let primary: HTMLElement;
    if (!p) primary = h('button', { class: 'btn primary', type: 'button', onclick: () => this.pickFile() }, icon('upload', 16), h('span', null, '도면 열기'));
    else if (mode === 'survey') primary = h('button', { class: 'btn primary', type: 'button', disabled: !p.damages.length, onclick: () => this.openExport(true) }, icon('download', 16), h('span', null, '조사 내보내기'));
    else if (review) primary = h('button', { class: 'btn primary warn', type: 'button', onclick: () => store.setUI({ bottom: true, bottomTab: 'checks' }) }, icon('alert', 16), h('span', null, `검토할 항목 ${review}개`));
    else primary = h('button', { class: 'btn primary', type: 'button', onclick: () => this.openExport() }, icon('download', 16), h('span', null, '내보내기'));

    this.header.replaceChildren(
      h('div', { class: 'brand' }, logo(26), h('span', { class: 'brand-name' }, 'HanokJIN')),
      p ? h('div', { class: 'project' },
        h('span', { class: 'project-name', title: p.name }, p.name),
        saveEl,
        warns ? h('span', { class: 'badge fail' }, `간섭 ${warns}`) : null) : h('div', { class: 'project' }),
      modeSeg ?? '',
      stepper,
      h('div', { class: 'actions' },
        layoutSeg,
        p ? h('div', { class: 'btn-group hide-sm' }, undo, redo) : null,
        mode === 'survey' ? null : photoBtn,
        p && mode !== 'survey' ? h('button', { class: `btn ${store.ui.drawer ? 'active' : ''}`, type: 'button', 'aria-pressed': String(store.ui.drawer), 'data-tip': '색감·형태·높이 설정', onclick: () => { if (store.ui.drawer && !store.selection) store.setUI({ drawer: false }); else { store.select(null); store.setUI({ drawer: true }); } } }, icon('palette', 16), h('span', { class: 'hide-md' }, '꾸미기·설정')) : null,
        p && mode !== 'survey' ? iconBtn('upload', '다른 도면 열기', () => this.pickFile(), { cls: 'hide-sm' }) : null,
        primary,
        iconBtn('help', '도움말', () => this.openHelp()),
      ),
    );
    document.title = p ? `${p.name} — HanokJIN` : 'HanokJIN — 한옥 3D 모델링 · 손상 조사';
  }

  private applyLayout() {
    const has = !!store.project;
    this.start.hidden = has;
    this.workspace.hidden = !has;
    this.bottom.el.hidden = !has;
    const narrow = window.innerWidth < 1024;
    let layout = store.ui.layout;
    if (narrow && layout === 'split') layout = 'model';
    this.workspace.dataset.layout = layout;
    document.body.classList.toggle('narrow', narrow);
    this.renderHeaderLight();
  }

  private renderHeaderLight() {
    this.header.querySelectorAll<HTMLButtonElement>('.layout-seg .seg-btn').forEach((b, i) => {
      const id = (['drawing', 'split', 'model'] as const)[i];
      const active = this.workspace.dataset.layout === id;
      b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
    });
    const drawerBtn = this.header.querySelector('[data-tip="색감·형태·높이 설정"]');
    drawerBtn?.classList.toggle('active', store.ui.drawer);
  }

  private setupSplitter(sp: HTMLElement) {
    const setRatio = (r: number) => { const v = Math.min(0.75, Math.max(0.2, r)); this.workspace.style.setProperty('--split', `${v * 100}%`); try { localStorage.setItem('hanokjin.split', String(v)); } catch { /* 저장 불가 */ } };
    try { const v = Number(localStorage.getItem('hanokjin.split')); if (v) setRatio(v); } catch { /* 저장 불가 */ }
    sp.addEventListener('pointerdown', (e) => {
      sp.setPointerCapture(e.pointerId);
      const r = this.workspace.getBoundingClientRect();
      const move = (ev: PointerEvent) => setRatio((ev.clientX - r.left) / r.width);
      const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); };
      sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
    });
    sp.addEventListener('keydown', (e) => {
      const cur = parseFloat(getComputedStyle(this.workspace).getPropertyValue('--split')) / 100 || 0.4;
      if (e.key === 'ArrowLeft') setRatio(cur - 0.03);
      if (e.key === 'ArrowRight') setRatio(cur + 0.03);
    });
  }

  private setupKeys() {
    document.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (document.querySelector('.modal-overlay')) return;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); const l = e.shiftKey ? store.redo() : store.undo(); if (l) toast(`${e.shiftKey ? '다시 실행' : '취소'}: ${l}`); return; }
      if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); const l = store.redo(); if (l) toast(`다시 실행: ${l}`); return; }
      if (typing) return;
      if (e.key === 'Escape') { if (store.ui.tool !== 'select') store.setUI({ tool: 'select' }); else store.select(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selection?.kind === 'pillar') { e.preventDefault(); void this.deletePillar(store.selection.id); }
      if (e.key.toLowerCase() === 'f' && !mod) this.drawing.fit();
    });
  }

  /* ───── 저장 ───── */
  private scheduleSave() {
    if (!store.project) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 700);
  }

  private async saveNow() {
    const p = store.project;
    if (!p) return;
    store.setSave('saving');
    try { await saveSession(p, this.pendingFile); this.pendingFile = undefined; store.setSave('saved'); }
    catch { store.setSave('error'); }
  }

  async resetAll() { await clearSession(); location.reload(); }
}

function logo(size: number) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('width', String(size)); s.setAttribute('height', String(size)); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M4 15c4 0 6-1.5 8-5h8c2 3.5 4 5 8 5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 14v10M23 14v10M7 24h18M13 18h6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>';
  return s;
}
