// 3D 보기: 절차적 HDRI 환경광(PMREM), 시간대별 자연광 조명 프리셋(맑은 한낮·아침·노을·흐린 날),
// 처마 밑 간접 반사광(Bounce Light), 궤도 카메라, 시점 프리셋, 부재 선택, 결구 살펴보기(분해), 단면.

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

export type LightMoodId = 'noon' | 'morning' | 'sunset' | 'overcast';

interface LightMood {
  id: LightMoodId;
  label: string;
  skyTop: string;
  skyMid: string;
  skyBot: string;
  fog: number;
  sunColor: number;
  sunIntensity: number;
  sunAz: number; // 라디안
  sunEl: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  bounceColor: number;
  bounceIntensity: number;
  exposure: number;
}

const LIGHT_MOODS: LightMood[] = [
  {
    id: 'noon', label: '맑은 한낮',
    skyTop: '#7caee0', skyMid: '#c8def2', skyBot: '#ece5d8', fog: 0xe8e2d6,
    sunColor: 0xfff5e4, sunIntensity: 2.75, sunAz: -0.65, sunEl: 1.05,
    hemiSky: 0xdcebf7, hemiGround: 0xa89274, hemiIntensity: 1.15,
    bounceColor: 0xffe4bc, bounceIntensity: 0.65, exposure: 1.08,
  },
  {
    id: 'morning', label: '아침 햇살',
    skyTop: '#6d9fd4', skyMid: '#cbe0f0', skyBot: '#f5e4cf', fog: 0xeee2d3,
    sunColor: 0xffdfba, sunIntensity: 2.5, sunAz: 0.85, sunEl: 0.58,
    hemiSky: 0xd5e6f5, hemiGround: 0x9c866b, hemiIntensity: 1.05,
    bounceColor: 0xffd5a8, bounceIntensity: 0.6, exposure: 1.05,
  },
  {
    id: 'sunset', label: '석양 노을',
    skyTop: '#4c5f8a', skyMid: '#c97b63', skyBot: '#f5be8a', fog: 0xe6bea0,
    sunColor: 0xff9e5e, sunIntensity: 2.8, sunAz: -1.15, sunEl: 0.36,
    hemiSky: 0xd49b82, hemiGround: 0x7d5840, hemiIntensity: 0.95,
    bounceColor: 0xffad75, bounceIntensity: 0.72, exposure: 1.04,
  },
  {
    id: 'overcast', label: '차분한 흐린 날',
    skyTop: '#9aaaba', skyMid: '#cbd4dc', skyBot: '#e4e2dc', fog: 0xe2e0da,
    sunColor: 0xf4f6f8, sunIntensity: 1.35, sunAz: -0.4, sunEl: 1.15,
    hemiSky: 0xe2e8f0, hemiGround: 0x9e978b, hemiIntensity: 1.55,
    bounceColor: 0xe8dfd1, bounceIntensity: 0.5, exposure: 1.12,
  },
];

export class Viewport {
  readonly el: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  private controls: OrbitControls | null = null;
  private sun = new THREE.DirectionalLight(0xfff5e4, 2.75);
  private hemi = new THREE.HemisphereLight(0xdcebf7, 0xa89274, 1.15);
  private bounce = new THREE.DirectionalLight(0xffe4bc, 0.65);
  private rim = new THREE.DirectionalLight(0xdbeafe, 0.42);
  private moodId: LightMoodId = 'noon';
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

    const moodSel = h('select', {
      class: 'select sm mood-select',
      'aria-label': '조명 시간대',
      'data-tip': '태양 각도와 하늘빛·간접광을 바꿔 재질 색감을 확인합니다',
      onchange: (e: Event) => this.setLightMood((e.target as HTMLSelectElement).value as LightMoodId),
    }, ...LIGHT_MOODS.map((m) => h('option', { value: m.id }, `조명: ${m.label}`)));

    const treePop = h('div', { class: 'popover tree-pop', hidden: true });
    const treeBtn = h('button', { class: 'btn sm', type: 'button', 'aria-label': '구조 보기', 'data-tip': '부재 묶음 보이기·숨기기', onclick: (e: MouseEvent) => { e.stopPropagation(); treePop.hidden = !treePop.hidden; if (!treePop.hidden) this.renderTree(treePop); } }, icon('tree', 15), h('span', null, '구조 보기'));
    document.addEventListener('click', (e) => { if (!treePop.contains(e.target as Node)) treePop.hidden = true; });
    const toolbar = h('div', { class: 'pane-toolbar' },
      h('div', { class: 'pane-title' }, icon('cube', 16), h('span', null, '3D 모델')),
      presetBar,
      h('div', { class: 'pop-anchor right' }, moodSel, treeBtn, treePop),
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
    r.toneMappingExposure = 1.08;
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

  /* ───── 장면 및 PBR 환경광(IBL) ───── */
  private setupScene() {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.025;
    // 마당 백토에서 처마 밑으로 반사되는 따뜻한 간접광(서까래·공포의 입체감을 살림)
    this.bounce.castShadow = false;
    this.rim.castShadow = false;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.bounce, this.bounce.target, this.rim, this.rim.target);

    const gTex = this.mats.ground.map;
    if (gTex) gTex.repeat.set(42, 42);
    if (this.mats.ground.bumpMap) this.mats.ground.bumpMap.repeat.set(42, 42);
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), this.mats.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.005;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.holder);

    this.setLightMood('noon');
  }

  /** 시간대별 하늘 배경 + PMREM 절차적 환경맵(IBL) + 태양/반사광 설정 */
  setLightMood(id: LightMoodId) {
    this.moodId = id;
    const m = LIGHT_MOODS.find((x) => x.id === id) ?? LIGHT_MOODS[0];

    // 1) 하늘 배경 및 Equirectangular 환경 텍스처 생성
    const envCanvas = document.createElement('canvas');
    envCanvas.width = 512; envCanvas.height = 256;
    const g = envCanvas.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.00, m.skyTop);
    grad.addColorStop(0.48, m.skyMid);
    grad.addColorStop(0.52, m.skyBot);
    grad.addColorStop(0.56, '#c8beae'); // 지평선 아래 마당 반사광
    grad.addColorStop(1.00, '#8f8270');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);

    // 태양 글로우 스팟을 환경맵에 그려 기와와 마루에 자연스러운 스페큘러 하이라이트 형성
    const sx = ((m.sunAz + Math.PI) / (Math.PI * 2)) * 512;
    const sy = (1 - (m.sunEl / (Math.PI / 2))) * 128;
    const sunGlow = g.createRadialGradient(sx, sy, 2, sx, sy, 68);
    sunGlow.addColorStop(0, 'rgba(255,250,235,0.95)');
    sunGlow.addColorStop(0.3, 'rgba(255,235,200,0.35)');
    sunGlow.addColorStop(1, 'rgba(255,235,200,0)');
    g.fillStyle = sunGlow;
    g.fillRect(0, 0, 512, 140);

    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 2; skyCanvas.height = 256;
    const sg = skyCanvas.getContext('2d')!;
    const sGrad = sg.createLinearGradient(0, 0, 0, 256);
    sGrad.addColorStop(0, m.skyTop);
    sGrad.addColorStop(0.55, m.skyMid);
    sGrad.addColorStop(1, m.skyBot);
    sg.fillStyle = sGrad;
    sg.fillRect(0, 0, 2, 256);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog(m.fog, 75, 210);

    if (this.renderer) {
      this.renderer.toneMappingExposure = m.exposure;
      try {
        const envTex = new THREE.CanvasTexture(envCanvas);
        envTex.mapping = THREE.EquirectangularReflectionMapping;
        envTex.colorSpace = THREE.SRGBColorSpace;
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const rt = pmrem.fromEquirectangular(envTex);
        this.scene.environment = rt.texture;
        envTex.dispose();
        pmrem.dispose();
      } catch {
        // 일부 제한된 WebGL 환경에서는 기본 조명만 사용
      }
    }

    this.sun.color.setHex(m.sunColor);
    this.sun.intensity = m.sunIntensity;
    this.hemi.color.setHex(m.hemiSky);
    this.hemi.groundColor.setHex(m.hemiGround);
    this.hemi.intensity = m.hemiIntensity;
    this.bounce.color.setHex(m.bounceColor);
    this.bounce.intensity = m.bounceIntensity;

    if (this.build) this.fitLights(this.build.bounds);
    this.request();
  }

  private fitLights(b: THREE.Box3) {
    const m = LIGHT_MOODS.find((x) => x.id === this.moodId) ?? LIGHT_MOODS[0];
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const R = Math.max(s.x, s.z, 6) * 0.95;
    const dist = R * 2.1;
    this.sun.position.set(
      c.x + dist * Math.cos(m.sunEl) * Math.sin(m.sunAz),
      c.y + dist * Math.sin(m.sunEl),
      c.z + dist * Math.cos(m.sunEl) * Math.cos(m.sunAz),
    );
    this.sun.target.position.copy(c);
    // 처마 밑을 아래에서 위로 비추는 마당 반사광(Bounce Light)
    this.bounce.position.set(c.x + R * 0.6, -R * 0.55, c.z + R * 0.8);
    this.bounce.target.position.set(c.x, c.y + s.y * 0.3, c.z);
    // 반대편 외곽 윤곽을 살리는 보조광(Rim Light)
    this.rim.position.set(c.x - this.sun.position.x * 0.6, R * 1.1, c.z - this.sun.position.z * 0.6);
    this.rim.target.position.copy(c);

    const cam = this.sun.shadow.camera;
    cam.left = -R * 1.35; cam.right = R * 1.35; cam.top = R * 1.35; cam.bottom = -R * 1.35; cam.near = 0.5; cam.far = R * 5.5;
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
    const radius = size.length() * 0.5;
    const vf = (this.camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(vf, hf) / 2)) * 0.92 * p.dist;
    const az = (p.az * Math.PI) / 180, el = (p.el * Math.PI) / 180;
    const target = new THREE.Vector3(c.x, Math.min(c.y, size.y * 0.42), c.z);
    const pos = new THREE.Vector3(target.x + dist * Math.cos(el) * Math.sin(az), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(az));
    if (id === 'top') pos.z += 0.01;
    this.moveCamera(pos, target, animate);
  }

  fitView() { this.resize(); this.preset('bird', false); }

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
