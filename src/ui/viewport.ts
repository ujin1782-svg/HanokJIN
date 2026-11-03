// 3D 보기: 낮 하늘 조명, 궤도 카메라, 시점 프리셋, 부재 선택, 결구 살펴보기(분해), 단면.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { store } from '../app/store';
import { buildHanok, GROUPS, type Build, type GroupKey, type PartInfo } from '../model/hanok';
import { applyPalette, createMaterials, type MaterialSet } from '../model/materials';
import { h, icon } from './dom';

const PRESETS: { id: string; label: string; az: number; el: number; dist: number }[] = [
  { id: 'bird', label: '조감도', az: 35, el: 28, dist: 1.0 },
  { id: 'front', label: '정면', az: 0, el: 6, dist: 0.95 },
  { id: 'right', label: '우측면', az: 90, el: 6, dist: 0.95 },
  { id: 'back', label: '배면', az: 180, el: 6, dist: 0.95 },
  { id: 'left', label: '좌측면', az: -90, el: 6, dist: 0.95 },
  { id: 'top', label: '지붕 위', az: 0, el: 89, dist: 1.0 },
];

export class Viewport {
  readonly el: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  private controls: OrbitControls | null = null;
  private sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  private mats: MaterialSet = createMaterials();
  build: Build | null = null;
  private holder = new THREE.Group();
  private ground!: THREE.Mesh;
  private raf = 0;
  private anim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number } | null = null;
  private selected: { obj: THREE.Mesh; mat: THREE.Material | THREE.Material[] } | null = null;
  private highlight = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xb45309, emissiveIntensity: 0.55, roughness: 0.5 });
  private info: HTMLElement;
  private explodeLabel: HTMLElement;
  private explodeInput!: HTMLInputElement;
  private playing = 0;
  private rebuildTimer = 0;
  private sectionPlane = new THREE.Plane();
  private clipOn = false;

  constructor() {
    this.info = h('div', { class: 'pick-card', hidden: true });
    this.explodeLabel = h('div', { class: 'explode-desc' });
    const presetBar = h('div', { class: 'preset-bar', role: 'toolbar', 'aria-label': '시점' },
      ...PRESETS.map((p) => h('button', { class: 'chip', type: 'button', onclick: () => this.preset(p.id) }, p.label)));
    const treePop = h('div', { class: 'popover tree-pop', hidden: true });
    const treeBtn = h('button', { class: 'btn sm', type: 'button', 'aria-label': '구조 보기', 'data-tip': '부재 묶음 보이기·숨기기', onclick: (e: MouseEvent) => { e.stopPropagation(); treePop.hidden = !treePop.hidden; if (!treePop.hidden) this.renderTree(treePop); } }, icon('tree', 15), h('span', null, '구조 보기'));
    document.addEventListener('click', (e) => { if (!treePop.contains(e.target as Node)) treePop.hidden = true; });
    const toolbar = h('div', { class: 'pane-toolbar' },
      h('div', { class: 'pane-title' }, icon('cube', 16), h('span', null, '3D 모델')),
      presetBar,
      h('div', { class: 'pop-anchor right' }, treeBtn, treePop),
    );
    this.el = h('section', { class: 'pane model-pane', 'aria-label': '3D 모델 창' }, toolbar,
      h('div', { class: 'canvas-wrap three-wrap' }), this.info,
      h('div', { class: 'view-hint' }, '끌기: 회전 · 오른쪽 끌기: 이동 · 휠: 확대'),
      this.bottomControls(),
    );

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    } catch {
      this.el.querySelector('.three-wrap')!.append(h('div', { class: 'empty-msg' }, '이 브라우저에서 3D(WebGL)를 쓸 수 없습니다. 최신 Chrome·Edge·Safari에서 열어 주세요.'));
      return;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true;
    this.el.querySelector('.three-wrap')!.append(r.domElement);
    r.domElement.setAttribute('aria-label', '3D 한옥 모델. 끌어서 회전, 휠로 확대, 클릭으로 부재 선택');

    this.setupScene();
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.request());
    this.setupPicking(r.domElement);
    new ResizeObserver(() => this.resize()).observe(this.el);

    store.on('project', () => this.rebuild(0));
    store.on('params', () => this.rebuild(90));
    store.on('palette', () => this.recolor());
    store.on('ui', () => this.applyUI());
    store.on('selection', () => this.syncSelection());
  }

  /* ───── 장면 ───── */
  private setupScene() {
    const sky = document.createElement('canvas');
    sky.width = 2; sky.height = 256;
    const g = sky.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#9fc3e6'); grad.addColorStop(0.55, '#dbe7f1'); grad.addColorStop(1, '#efe9de');
    g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog(0xe9e5dc, 80, 220);

    this.scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x9a8b70, 1.15));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const gTex = this.mats.ground.map;
    if (gTex) gTex.repeat.set(40, 40);
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), this.mats.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.005;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.holder);
  }

  private fitLights(b: THREE.Box3) {
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const R = Math.max(s.x, s.z, 6) * 0.9;
    this.sun.position.set(c.x - R * 0.9, R * 1.6, c.z + R * 1.1);
    this.sun.target.position.copy(c);
    const cam = this.sun.shadow.camera;
    cam.left = -R * 1.3; cam.right = R * 1.3; cam.top = R * 1.3; cam.bottom = -R * 1.3; cam.near = 0.5; cam.far = R * 5;
    cam.updateProjectionMatrix();
  }

  rebuild(delay: number) {
    clearTimeout(this.rebuildTimer);
    if (delay) { this.rebuildTimer = window.setTimeout(() => this.rebuild(0), delay); return; }
    const p = store.project;
    this.clearSelectionHighlight();
    if (this.build) { this.holder.remove(this.build.root); disposeTree(this.build.root); this.build = null; }
    if (!p) { this.request(); return; }
    const first = !this.holder.children.length && !this.lastFitFor;
    try {
      this.build = buildHanok(p, this.mats);
    } catch (e) {
      console.error(e);
      this.build = null;
      store.emit('ui');
      return;
    }
    this.holder.add(this.build.root);
    applyPalette(this.mats, p.palette, p.params.lattice);
    this.fitLights(this.build.bounds);
    if (first || this.lastFitFor !== p.id) { this.lastFitFor = p.id; this.preset('bird', false); }
    this.applyUI();
    this.syncSelection();
    store.emit('model');
    this.request();
  }
  private lastFitFor = '';

  recolor() {
    const p = store.project;
    if (!p) return;
    applyPalette(this.mats, p.palette, p.params.lattice);
    this.request();
  }

  private applyUI() {
    if (!this.build || !this.renderer) return;
    const u = store.ui;
    for (const g of GROUPS) {
      const grp = this.build.groups[g.key];
      grp.visible = !u.hiddenGroups.has(g.key);
      grp.position.y = g.lift * u.explode * 1.3;
    }
    const stage = Math.min(GROUPS.length - 1, Math.floor(u.explode * GROUPS.length));
    const g = GROUPS[stage];
    this.explodeLabel.textContent = u.explode > 0.001 ? `${stage + 1}/${GROUPS.length}단계 ${g.label} — ${g.desc}` : '';
    if (this.explodeInput && document.activeElement !== this.explodeInput) this.explodeInput.value = String(Math.round(u.explode * 100));
    // 단면: 모델 재질에만 적용(마당은 자르지 않음)
    const b = this.build.bounds;
    const s = u.section;
    const on = s.axis !== 'none';
    if (on) {
      const n = s.axis === 'x' ? new THREE.Vector3(-1, 0, 0) : s.axis === 'y' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, -1);
      const lo = s.axis === 'x' ? b.min.x : s.axis === 'y' ? b.min.y : b.min.z;
      const hi = s.axis === 'x' ? b.max.x : s.axis === 'y' ? b.max.y + GROUPS[GROUPS.length - 1].lift * u.explode * 1.3 : b.max.z;
      this.sectionPlane.set(n, lo + (hi - lo) * s.pos);
    }
    if (on !== this.clipOn) {
      this.clipOn = on;
      for (const [k, m] of Object.entries(this.mats)) {
        if (k === 'ground') continue;
        m.clippingPlanes = on ? [this.sectionPlane] : [];
        m.clipShadows = on;
        m.needsUpdate = true;
      }
      this.highlight.clippingPlanes = on ? [this.sectionPlane] : [];
      this.highlight.needsUpdate = true;
    }
    this.request();
  }

  /* ───── 카메라 ───── */
  preset(id: string, animate = true) {
    if (!this.build || !this.controls) return;
    const p = PRESETS.find((q) => q.id === id) ?? PRESETS[0];
    const b = this.build.bounds;
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const radius = size.length() * 0.5;   // 경계 구 반지름: 어느 방향에서 봐도 잘리지 않는다
    // 세로·가로 화각 중 좁은 쪽에 맞춘다(나란히 보기처럼 좁은 창에서도 집 전체가 보이게).
    const vf = (this.camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(vf, hf) / 2)) * 0.92 * p.dist;
    const az = (p.az * Math.PI) / 180, el = (p.el * Math.PI) / 180;
    const target = new THREE.Vector3(c.x, Math.min(c.y, size.y * 0.42), c.z);
    const pos = new THREE.Vector3(target.x + dist * Math.cos(el) * Math.sin(az), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(az));
    if (id === 'top') pos.z += 0.01;
    this.moveCamera(pos, target, animate);
  }

  /** 창 크기를 다시 재고 집 전체가 보이게 맞춘다 */
  fitView() { this.resize(); this.preset('bird', false); }

  /** 월드 좌표 점을 가까이서 보기 */
  focusPoint(p: THREE.Vector3, dist = 6) {
    if (!this.controls) return;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.moveCamera(p.clone().addScaledVector(dir, dist), p.clone(), true);
  }

  private moveCamera(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    if (!this.controls) return;
    if (!animate) {
      this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); this.request(); return;
    }
    this.anim = { from: this.camera.position.clone(), to: pos, tFrom: this.controls.target.clone(), tTo: target, t0: performance.now() };
    this.request();
  }

  /* ───── 선택 ───── */
  private setupPicking(dom: HTMLCanvasElement) {
    let down: { x: number; y: number } | null = null;
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', (e) => {
      if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || !this.build) return;
      const r = dom.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hits = ray.intersectObject(this.build.root, true).filter((h0) => {
        if (!h0.object.visible || !(h0.object.parent?.visible ?? true)) return false;
        if (this.clipOn && this.sectionPlane.distanceToPoint(h0.point) < 0) return false;
        return !!(h0.object.userData.part || h0.object.parent?.userData.part);
      });
      const part = (hits[0]?.object.userData.part ?? null) as PartInfo | null;
      if (part?.pillarId) store.select({ kind: 'pillar', id: part.pillarId });
      else if (part) store.select({ kind: 'part', ...part });
      else store.select(null);
      if (hits[0]) this.setHighlight(hits[0].object as THREE.Mesh);
    });
  }

  private clearSelectionHighlight() {
    if (this.selected) { this.selected.obj.material = this.selected.mat; this.selected = null; }
  }

  private setHighlight(obj: THREE.Mesh | null) {
    this.clearSelectionHighlight();
    if (obj && !(obj instanceof THREE.InstancedMesh)) {
      this.selected = { obj, mat: obj.material };
      obj.material = this.highlight;
    }
    this.request();
  }

  private syncSelection() {
    const s = store.selection;
    if (!this.build) return;
    if (!s) { this.setHighlight(null); this.info.hidden = true; return; }
    if (s.kind === 'pillar') {
      const m = this.build.pillarMeshes.get(s.id);
      if (m && this.selected?.obj !== m) this.setHighlight(m);
      const part = m?.userData.part as PartInfo | undefined;
      this.showInfo(part?.name ?? `기둥 ${s.id}`, part?.spec ?? '', 'IfcColumn');
    } else if (s.kind === 'part') {
      this.showInfo(s.name, s.spec, s.ifc);
    } else {
      this.setHighlight(null);
      this.info.hidden = true;
    }
  }

  private showInfo(name: string, spec: string, ifc: string) {
    this.info.hidden = false;
    this.info.replaceChildren(
      h('div', { class: 'pick-name' }, name),
      spec ? h('div', { class: 'pick-spec' }, spec) : '',
      h('div', { class: 'pick-ifc' }, `BIM 분류: ${ifc}`),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => store.select(null) }, '선택 해제'),
    );
  }

  /* ───── 하단 조작 ───── */
  private bottomControls() {
    this.explodeInput = h('input', {
      type: 'range', min: 0, max: 100, value: 0, 'aria-label': '결구 구조 살펴보기(분해 정도)',
      oninput: (e: Event) => { this.stopPlay(); store.setUI({ explode: +(e.target as HTMLInputElement).value / 100 }); },
    });
    const play = h('button', { class: 'btn icon sm', type: 'button', 'aria-label': '조립 순서 재생', 'data-tip': '조립 순서 재생' }, icon('play', 16));
    play.onclick = () => {
      if (this.playing) { this.stopPlay(); return; }
      play.replaceChildren(icon('pause', 16));
      // 다 벌려 놓은 상태에서 기단부터 지붕까지 차례로 맞춰 내려온다.
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / 7000;
        store.setUI({ explode: Math.max(0, 1 - t) });
        if (t < 1 && this.playing) this.playing = requestAnimationFrame(tick); else this.stopPlay();
      };
      this.playing = requestAnimationFrame(tick);
    };
    this.stopPlay = () => { if (this.playing) cancelAnimationFrame(this.playing); this.playing = 0; play.replaceChildren(icon('play', 16)); };
    const reset = h('button', { class: 'btn icon sm', type: 'button', 'aria-label': '분해 초기화', 'data-tip': '처음 모습으로', onclick: () => { this.stopPlay(); store.setUI({ explode: 0 }); } }, icon('reset', 16));

    const axisSel = h('select', { class: 'select sm', 'aria-label': '단면 방향', onchange: (e: Event) => store.setUI({ section: { ...store.ui.section, axis: (e.target as HTMLSelectElement).value as 'none' } }) },
      h('option', { value: 'none' }, '단면 끄기'), h('option', { value: 'x' }, '좌우(X)로 자르기'), h('option', { value: 'z' }, '앞뒤(Y)로 자르기'), h('option', { value: 'y' }, '높이(Z)로 자르기'));
    const pos = h('input', { type: 'range', min: 2, max: 100, value: 100, 'aria-label': '단면 위치', oninput: (e: Event) => store.setUI({ section: { ...store.ui.section, pos: +(e.target as HTMLInputElement).value / 100 } }) });
    store.on('ui', () => { axisSel.value = store.ui.section.axis; pos.disabled = store.ui.section.axis === 'none'; if (document.activeElement !== pos) pos.value = String(Math.round(store.ui.section.pos * 100)); });
    pos.disabled = true;

    return h('div', { class: 'model-controls' },
      h('div', { class: 'ctrl-block' },
        h('div', { class: 'ctrl-head' }, icon('explode', 15), h('span', { class: 'ctrl-title', 'data-tip': '부재를 분리해 내부 연결을 확인하는 보기(Exploded View)' }, '결구 구조 살펴보기'), play, reset),
        this.explodeInput, this.explodeLabel),
      h('div', { class: 'ctrl-block narrow' },
        h('div', { class: 'ctrl-head' }, icon('scissors', 15), h('span', { class: 'ctrl-title' }, '단면 보기')),
        axisSel, pos),
    );
  }
  private stopPlay: () => void = () => {};

  /* ───── 렌더 ───── */
  private resize() {
    if (!this.renderer) return;
    const wrap = this.el.querySelector('.three-wrap') as HTMLElement;
    const r = wrap.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.renderer.domElement.style.width = `${r.width}px`; this.renderer.domElement.style.height = `${r.height}px`;
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.request();
  }

  request() { if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); }

  private frame() {
    this.raf = 0;
    if (!this.renderer || !this.controls) return;
    let again = false;
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.t0) / 550);
      const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.camera.position.lerpVectors(this.anim.from, this.anim.to, k);
      this.controls.target.lerpVectors(this.anim.tFrom, this.anim.tTo, k);
      if (t >= 1) this.anim = null; else again = true;
    }
    if (this.controls.update()) again = true;
    this.renderer.render(this.scene, this.camera);
    if (again) this.request();
  }

  /** 내보내기 전에 분해·단면을 잠시 풀었다가 되돌린다. */
  async withCleanState<T>(fn: () => Promise<T>): Promise<T> {
    const prev = store.ui.explode;
    if (this.build) for (const g of GROUPS) this.build.groups[g.key].position.y = 0;
    this.clearSelectionHighlight();
    try { return await fn(); } finally {
      store.ui.explode = prev;
      this.applyUI(); this.syncSelection();
    }
  }

  private renderTree(pop: HTMLElement) {
    const counts = this.groupCounts();
    pop.replaceChildren(
      h('div', { class: 'pop-title' }, '부재 묶음'),
      ...GROUPS.map((g) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !store.ui.hiddenGroups.has(g.key), onchange: (e: Event) => {
          const s = new Set(store.ui.hiddenGroups);
          if ((e.target as HTMLInputElement).checked) s.delete(g.key); else s.add(g.key);
          store.setUI({ hiddenGroups: s });
        } }),
        h('span', null, g.label), h('span', { class: 'muted' }, `${counts[g.key]}`))),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { store.setUI({ hiddenGroups: new Set() }); this.renderTree(pop); } }, '모두 보이기'),
    );
  }

  groupCounts(): Record<GroupKey, number> {
    const out = {} as Record<GroupKey, number>;
    for (const g of GROUPS) {
      let n = 0;
      this.build?.groups[g.key].traverse((o) => { if (o.userData.part) n += o instanceof THREE.InstancedMesh ? o.count : 1; });
      out[g.key] = n;
    }
    return out;
  }
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => { if (c instanceof THREE.Mesh) c.geometry.dispose(); });
}
