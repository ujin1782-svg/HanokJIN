// 앱 상태: 프로젝트(되돌리기 가능), 도면, 선택, 화면 상태. 변경은 이벤트로 알린다.

import type { CadDoc, Project, Sheet } from '../core/types';
import type { GroupKey } from '../model/hanok';

export type Selection =
  | { kind: 'pillar'; id: string }
  | { kind: 'edge'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'part'; name: string; spec: string; ifc: string; group: GroupKey; pillarId?: string }
  | null;

export type Layout = 'split' | 'drawing' | 'model';
export type Tool = 'select' | 'addPillar' | 'calibrate';
export type BottomTab = 'checks' | 'bom' | 'joinery';
export type SaveState = 'none' | 'saving' | 'saved' | 'error';

export interface UIState {
  layout: Layout;
  drawer: boolean;
  drawerTab: 'color' | 'shape' | 'advanced';
  bottom: boolean;
  bottomTab: BottomTab;
  tool: Tool;
  hiddenLayers: Set<string>;
  layerColors: boolean;
  overlay: { grid: boolean; pillars: boolean; walls: boolean };
  hiddenGroups: Set<GroupKey>;
  explode: number;           // 0~1
  section: { axis: 'none' | 'x' | 'y' | 'z'; pos: number };
  exported: boolean;
}

type EventName = 'project' | 'params' | 'palette' | 'cad' | 'selection' | 'ui' | 'save' | 'history' | 'model';

const HISTORY_LIMIT = 80;

export class Store {
  project: Project | null = null;
  cad: CadDoc | null = null;
  sheets: Sheet[] = [];
  sheetId = '';
  selection: Selection = null;
  saveState: SaveState = 'none';
  ui: UIState = {
    layout: 'split', drawer: false, drawerTab: 'color', bottom: false, bottomTab: 'checks', tool: 'select',
    hiddenLayers: new Set(), layerColors: false, overlay: { grid: true, pillars: true, walls: true },
    hiddenGroups: new Set(), explode: 0, section: { axis: 'none', pos: 1 }, exported: false,
  };
  private past: { label: string; json: string }[] = [];
  private future: { label: string; json: string }[] = [];
  private listeners = new Map<EventName, Set<() => void>>();

  on(ev: EventName, fn: () => void) {
    let s = this.listeners.get(ev);
    if (!s) { s = new Set(); this.listeners.set(ev, s); }
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit(...evs: EventName[]) { for (const ev of evs) this.listeners.get(ev)?.forEach((f) => f()); }

  open(project: Project, cad: CadDoc | null, sheets: Sheet[]) {
    this.project = project;
    this.cad = cad;
    this.sheets = sheets;
    this.sheetId = project.source.sheetId ?? sheets[0]?.id ?? '';
    this.selection = null;
    this.past = []; this.future = [];
    this.ui.hiddenLayers = new Set();
    this.ui.exported = false;
    this.emit('cad', 'project', 'selection', 'history', 'ui');
  }

  /** 되돌리기 가능한 변경. kind로 다시 그릴 범위를 알린다. */
  commit(label: string, fn: (p: Project) => void, kind: 'project' | 'params' | 'palette' = 'project') {
    if (!this.project) return;
    this.past.push({ label, json: JSON.stringify(this.project) });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    fn(this.project);
    this.emit(kind, 'history');
  }

  /** 슬라이더를 끄는 동안의 미리보기(기록 없음). 놓을 때 commit으로 확정한다. */
  preview(fn: (p: Project) => void, kind: 'params' | 'palette' = 'params') {
    if (!this.project) return;
    fn(this.project);
    this.emit(kind);
  }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }
  undoLabel() { return this.past[this.past.length - 1]?.label; }
  redoLabel() { return this.future[this.future.length - 1]?.label; }

  undo() {
    const prev = this.past.pop();
    if (!prev || !this.project) return;
    this.future.push({ label: prev.label, json: JSON.stringify(this.project) });
    this.project = JSON.parse(prev.json);
    this.fixSelection();
    this.emit('project', 'history', 'selection');
    return prev.label;
  }

  redo() {
    const next = this.future.pop();
    if (!next || !this.project) return;
    this.past.push({ label: next.label, json: JSON.stringify(this.project) });
    this.project = JSON.parse(next.json);
    this.fixSelection();
    this.emit('project', 'history', 'selection');
    return next.label;
  }

  private fixSelection() {
    const s = this.selection;
    if (s?.kind === 'pillar' && !this.project?.pillars.some((p) => p.id === s.id)) this.selection = null;
  }

  select(s: Selection) { this.selection = s; this.emit('selection'); }
  setUI(patch: Partial<UIState>) { Object.assign(this.ui, patch); this.emit('ui'); }
  setSave(s: SaveState) { this.saveState = s; this.emit('save'); }
}

export const store = new Store();
