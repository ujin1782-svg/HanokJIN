// 앱 조립: 머리글·단계 안내·작업 공간·패널·대화상자·단축키·자동 저장.

import type { CheckResult, Pillar } from '../core/types';
import { STAGE_LABEL, SUPPORTED, checkFile, type Stage, type ParseResult } from '../cad/pipeline';
import { scaleDoc } from '../cad/normalize';
import { segmentSheets } from '../cad/sheets';
import { recognize } from '../cad/recognize';
import { DEMOS, makeDemo } from '../samples';
import { FORMATS, runExport, type ExportFormat } from '../export/files';
import { store, type Layout } from './store';
import { loadCad, LoadError } from './loader';
import { loadSession, saveSession, clearSession, type Session } from './persist';
import { h, icon, iconBtn } from '../ui/dom';
import { DrawingView } from '../ui/drawing';
import { Viewport } from '../ui/viewport';
import { Inspector } from '../ui/inspector';
import { BottomPanel } from '../ui/bottom';
import { confirmDialog, openModal, promptNumber, toast } from '../ui/modal';

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
    this.viewport = new Viewport();
    this.inspector = new Inspector({ deletePillar: (id) => this.deletePillar(id), focusPillar: (id) => this.focusPillar(id) });
    this.bottom = new BottomPanel({ focus: (c) => this.focusCheck(c), exportCsv: () => this.doExport('csv'), getBuild: () => this.viewport.build });

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
    store.on('ui', () => this.applyLayout());
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
    const demoCards = DEMOS.map((d) => h('button', { class: 'demo-card', type: 'button', onclick: () => this.openDemo(d.id) },
      h('b', null, d.name), h('span', null, d.desc), h('span', { class: 'badge demo' }, '데모 데이터')));
    this.start.replaceChildren(h('div', { class: 'start-card' },
      h('div', { class: 'start-mark' }, logo(44)),
      h('h1', null, '한옥 도면을 3D 모델로'),
      h('p', { class: 'lead' }, 'DWG·DXF 평면도를 올리면 격자와 기둥을 찾아 한옥 3D 모델을 만듭니다. 인식 결과를 확인·수정하고, 색감을 고른 뒤 BIM(IFC)·3D·물량표로 내보낼 수 있습니다.'),
      h('div', { class: 'drop-zone', tabindex: 0, role: 'button', 'aria-label': '도면 파일 열기', onclick: () => this.pickFile(), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') this.pickFile(); } },
        icon('upload', 28), h('b', null, '도면 파일 열기'), h('span', null, '또는 이 창에 파일을 끌어다 놓으세요'),
        h('span', { class: 'muted' }, 'DWG (AutoCAD R13~2018) · ASCII DXF · 80MB 이하')),
      session ? h('button', { class: 'btn resume', type: 'button', onclick: () => this.resume(session) }, icon('reset', 16),
        h('span', null, h('b', null, '이어서 작업하기'), h('span', { class: 'muted' }, ` ${session.project.name} · ${new Date(session.savedAt).toLocaleString('ko-KR')}`))) : null,
      h('div', { class: 'start-sub' }, '예제로 먼저 둘러보기'),
      h('div', { class: 'demo-grid' }, ...demoCards),
      h('ol', { class: 'start-steps' }, ...['도면 준비', '인식 검토', '3D 생성', '꾸미기·편집', '내보내기'].map((s, i) => h('li', null, h('span', null, String(i + 1)), s))),
    ));
    this.applyLayout();
  }

  private openDemo(id: string) {
    const { project, doc, sheets } = makeDemo(id);
    this.pendingFile = undefined;
    store.open(project, doc, sheets);
    this.afterOpen();
    toast('예제 프로젝트를 열었습니다. 실제 도면 값이 아닌 데모 데이터입니다.', 'info');
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
    } else if (s.project.demo) {
      const id = DEMOS.find((d) => s.project.id.startsWith(d.id))?.id ?? DEMOS[0].id;
      const { doc, sheets } = makeDemo(id);
      store.open(s.project, doc, sheets);
    } else store.open(s.project, null, []);
    this.afterOpen();
  }

  private afterOpen() {
    this.applyLayout();
    // 기본 화면은 도면과 3D만. 검토 항목은 머리글의 주황 버튼과 아래 요약 줄로 안내한다.
    store.setUI({ bottom: false, drawer: false, tool: 'select', explode: 0, section: { axis: 'none', pos: 1 } });
    // 작업 공간이 보인 뒤(크기 확정 후) 두 창을 화면에 맞춘다.
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
      h('p', { class: 'muted' }, `지원 형식: ${SUPPORTED.join(', ')} (PDF·이미지는 아직 지원하지 않습니다)`))), [
      h('button', { class: 'btn primary', type: 'button', onclick: () => { document.querySelector('.modal-overlay')?.remove(); this.pickFile(); } }, '다른 파일 선택'),
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
  openExport() {
    const b = this.viewport.build, p = store.project;
    if (!p || !b) { toast('내보낼 모델이 없습니다. 먼저 도면을 열거나 예제를 불러오세요.', 'warn'); return; }
    let fmt: ExportFormat = 'ifc';
    const visibleOnly = h('input', { type: 'checkbox', checked: true });
    const hidden = store.ui.hiddenGroups.size;
    const list = h('div', { class: 'format-list', role: 'radiogroup', 'aria-label': '파일 형식' }, ...FORMATS.map((f, i) =>
      h('label', { class: 'format' }, h('input', { type: 'radio', name: 'fmt', value: f.id, checked: i === 0, onchange: () => { fmt = f.id; } }),
        h('span', null, h('b', null, f.label), h('span', null, f.desc), h('span', { class: 'muted' }, `쓰는 곳: ${f.usage}`)))));
    const run = h('button', { class: 'btn primary', type: 'button' }, icon('download', 16), '내보내기');
    const m = openModal('내보내기', h('div', null,
      p.demo ? h('div', { class: 'callout warn' }, icon('alert', 16), h('div', null, '예제(데모) 프로젝트입니다. 실제 도면 값이 아닙니다.')) : null,
      list,
      h('label', { class: 'check' }, visibleOnly, h('span', null, `숨긴 부재 제외 (IFC·glTF)${hidden ? ` — 현재 ${hidden}개 묶음 숨김` : ''}`)),
      h('p', { class: 'hint' }, '단위는 IFC·glTF는 m, DXF·물량표는 mm입니다. 기와 매수는 지붕 면적에서 낸 추정값입니다.')), [
      h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, '닫기'), run]);
    run.onclick = async () => { run.disabled = true; await this.doExport(fmt, visibleOnly.checked); run.disabled = false; m.close(); };
  }

  private async doExport(fmt: ExportFormat, onlyVisible = true) {
    const b = this.viewport.build, p = store.project;
    if (!p || !b) return;
    try {
      const r = await this.viewport.withCleanState(() => runExport(fmt, p, b, onlyVisible));
      store.setUI({ exported: true });
      toast(`${r.name} 저장 완료 (${(r.size / 1024).toFixed(0)}KB)`, 'ok');
    } catch (e) {
      console.error(e);
      toast(`내보내기에 실패했습니다: ${(e as Error).message}. 다른 형식으로 시도해 보세요.`, 'error');
    }
  }

  /* ───── 도움말 ───── */
  openHelp() {
    const term = (a: string, b: string) => h('div', { class: 'kv' }, h('span', null, a), h('b', null, b));
    openModal('도움말', h('div', { class: 'help-body' },
      h('h3', null, '작업 순서'),
      h('ol', null,
        h('li', null, h('b', null, '도면 준비'), ' — DWG·DXF를 엽니다. 여러 장이 한 파일에 있으면 시트를 나눠 평면도를 찾습니다.'),
        h('li', null, h('b', null, '인식 검토'), ' — 노란 ! 표시 기둥은 확인이 필요합니다. 아래 "검증 결과"에서 눌러 위치로 이동합니다.'),
        h('li', null, h('b', null, '3D 생성'), ' — 격자와 기둥으로 지붕·보·벽을 자동으로 만듭니다.'),
        h('li', null, h('b', null, '꾸미기·편집'), ' — 오른쪽 위 "꾸미기·설정"에서 색감, 지붕 형식, 높이를 바꿉니다.'),
        h('li', null, h('b', null, '내보내기'), ' — IFC(BIM), glTF(3D), DXF(평면), CSV(물량표).')),
      h('h3', null, '마우스'),
      term('도면', '휠: 확대·축소 · 끌기: 이동 · 클릭: 기둥/외벽 칸 선택'),
      term('3D', '끌기: 회전 · 오른쪽 끌기(또는 Shift): 이동 · 휠: 확대 · 클릭: 부재 선택'),
      h('h3', null, '단축키'),
      term('Ctrl+Z / Ctrl+Y', '실행 취소 / 다시 실행'), term('Delete', '선택한 기둥 삭제(확인 후)'), term('Esc', '도구 끝내기 · 선택 해제'), term('F', '도면 화면 맞춤'),
      h('h3', null, '용어'),
      term('인식 결과 수정 (HITL)', 'AI·규칙이 찾은 기둥이나 선을 사람이 확인하고 고치는 작업'),
      term('주경 D', '기둥 굵기 비례를 정하는 기준 치수'),
      term('앙곡 Hz', '처마 끝이 모서리로 갈수록 위로 휘어 올라가는 정도'),
      term('안허리곡 Hy', '지붕을 위에서 볼 때 처마 가운데가 안으로 들어가고 귀가 밖으로 뻗는 정도'),
      term('결구 유격 (Clearance)', '부재가 맞물릴 때 남기는 틈'),
      term('구조 간섭 (Clash)', '부재끼리 겹치거나 부딪히는 상태'),
      term('결구 구조 살펴보기', '부재를 분리해 내부 연결을 보는 분해도(Exploded View)'),
      term('물량 명세서 (BOM)', '부재와 자재의 수량·규격 목록. 1재 ≈ 0.00334㎥'),
      h('h3', null, '알아 두기'),
      h('ul', null,
        h('li', null, '인식은 주열 번호(X1, Y1…), 원·사각 기둥 도형, 실 이름, 창호 이름표, 입면도 높이 치수를 근거로 합니다. 근거가 없는 값은 "기본값"으로 표시됩니다.'),
        h('li', null, '구조 검토는 전통 목구조 경험식에 따른 참고 판정이며 구조계산을 대신하지 않습니다.'),
        h('li', null, '작업은 이 브라우저에만 자동 저장됩니다(서버로 전송하지 않음).'),
        h('li', null, 'DWG 해석에는 LibreDWG(GPL-3.0)를 사용합니다.')),
    ), [h('button', { class: 'btn danger ghost', type: 'button', onclick: async () => {
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
      { label: '도면 준비', done: !!p, action: () => this.pickFile() },
      { label: '인식 검토', done: !!p && review === 0, action: () => store.setUI({ bottom: true, bottomTab: 'checks' }) },
      { label: '3D 생성', done: !!b, action: () => store.setUI({ layout: store.ui.layout === 'drawing' ? 'split' : store.ui.layout }) },
      { label: '꾸미기·편집', done: touched, action: () => { store.select(null); store.setUI({ drawer: true }); } },
      { label: '내보내기', done: store.ui.exported, action: () => this.openExport() },
    ];
    const current = steps.findIndex((s) => !s.done);
    const stepper = h('nav', { class: 'stepper', 'aria-label': '작업 단계' }, ...steps.map((s, i) =>
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

    let primary: HTMLElement;
    if (!p) primary = h('button', { class: 'btn primary', type: 'button', onclick: () => this.pickFile() }, icon('upload', 16), h('span', null, '도면 열기'));
    else if (review) primary = h('button', { class: 'btn primary warn', type: 'button', onclick: () => store.setUI({ bottom: true, bottomTab: 'checks' }) }, icon('alert', 16), h('span', null, `검토할 항목 ${review}개`));
    else primary = h('button', { class: 'btn primary', type: 'button', onclick: () => this.openExport() }, icon('download', 16), h('span', null, '내보내기'));

    this.header.replaceChildren(
      h('div', { class: 'brand' }, logo(26), h('span', { class: 'brand-name' }, 'HanokJIN')),
      p ? h('div', { class: 'project' },
        h('span', { class: 'project-name', title: p.name }, p.name),
        p.demo ? h('span', { class: 'badge demo' }, '데모') : null,
        saveEl,
        warns ? h('span', { class: 'badge fail' }, `간섭 ${warns}`) : null) : h('div', { class: 'project' }),
      stepper,
      h('div', { class: 'actions' },
        layoutSeg,
        p ? h('div', { class: 'btn-group hide-sm' }, undo, redo) : null,
        p ? h('button', { class: `btn ${store.ui.drawer ? 'active' : ''}`, type: 'button', 'aria-pressed': String(store.ui.drawer), 'data-tip': '색감·형태·높이 설정', onclick: () => { if (store.ui.drawer && !store.selection) store.setUI({ drawer: false }); else { store.select(null); store.setUI({ drawer: true }); } } }, icon('palette', 16), h('span', { class: 'hide-md' }, '꾸미기·설정')) : null,
        p ? iconBtn('upload', '다른 도면 열기', () => this.pickFile(), { cls: 'hide-sm' }) : null,
        primary,
        iconBtn('help', '도움말', () => this.openHelp()),
      ),
    );
    document.title = p ? `${p.name} — HanokJIN` : 'HanokJIN — 한옥 도면 3D 모델링';
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

  /** 레이아웃만 바뀔 때 버튼 상태만 고친다 */
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
