// 결구 상세: 대표 맞춤·이음 다섯 가지를 작은 3D로 보여 준다(설명용 형상).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { store } from '../app/store';
import { resolvePalette } from '../model/palettes';

export const JOINERY = [
  { id: 'sagae', name: '사개맞춤', desc: '기둥 머리를 십자(+)로 따내 네 귀를 남기고, 그 홈에 창방·장여·보를 끼워 서로 물리게 하는 맞춤입니다.', parts: '기둥 · 창방 · 장여 · 대들보', used: ['pillar-'] },
  { id: 'jumeok', name: '주먹장맞춤', desc: '끝이 넓은 사다리꼴 촉(주먹장)을 같은 모양 홈에 내려 끼워, 당겨도 빠지지 않게 하는 맞춤입니다.', parts: '대들보 · 도리 · 창방', used: ['beam-', 'changbang'] },
  { id: 'jangbu', name: '장부맞춤', desc: '한 부재에 만든 촉(장부)을 다른 부재 구멍에 끼워 넣어 옆으로 밀리지 않게 합니다.', parts: '기둥 · 주두 · 동자주 · 대공', used: ['gongpo-', 'dongja', 'daegong'] },
  { id: 'banteok', name: '반턱이음', desc: '두 부재 끝을 절반씩 따내 겹쳐 길이 방향으로 잇는 이음입니다. 긴 도리를 이을 때 씁니다.', parts: '주심도리 · 중도리 · 종도리', used: ['dori-'] },
  { id: 'grengi', name: '그렝이질', desc: '울퉁불퉁한 초석 윗면 모양을 기둥 밑동에 그대로 본떠 깎아 꼭 맞게 앉히는 기법입니다.', parts: '초석 · 기둥', used: ['plinth-'] },
];

export class JoineryView {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
  private controls: OrbitControls;
  private group = new THREE.Group();
  private parts: { mesh: THREE.Object3D; dir: THREE.Vector3 }[] = [];
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private host: HTMLElement | null = null;

  constructor() {
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 1.4));
    const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(3, 5, 4); this.scene.add(d, this.group);
    this.camera.position.set(2.6, 2.0, 2.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.2, 0);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.request());
    this.renderer.domElement.setAttribute('aria-label', '결구 확대 보기. 끌어서 회전');
  }

  mount(host: HTMLElement, id: string) {
    this.host = host;
    host.replaceChildren(this.renderer.domElement);
    this.ro?.disconnect();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.build(id);
    this.resize();
  }

  private build(id: string) {
    this.group.clear(); this.parts = [];
    const c = store.project ? resolvePalette(store.project.palette).colors : null;
    const wood = new THREE.MeshStandardMaterial({ color: c?.pillar ?? '#b98a5e', roughness: 0.7 });
    const wood2 = new THREE.MeshStandardMaterial({ color: c?.beam ?? '#a87b52', roughness: 0.7 });
    const cut = new THREE.MeshStandardMaterial({ color: '#e7b86a', roughness: 0.6 });
    const stone = new THREE.MeshStandardMaterial({ color: c?.plinth ?? '#a59e90', roughness: 0.95 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], dir: [number, number, number] = [0, 0, 0], rot?: [number, number, number]) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(...pos);
      if (rot) mesh.rotation.set(...rot);
      mesh.userData.base = mesh.position.clone();
      this.group.add(mesh);
      this.parts.push({ mesh, dir: new THREE.Vector3(...dir) });
    };
    if (id === 'sagae') {
      add(new THREE.CylinderGeometry(0.26, 0.28, 1.1, 24), wood, [0, -0.55, 0]);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(new THREE.BoxGeometry(0.13, 0.3, 0.13), cut, [sx * 0.13, 0.15, sz * 0.13]);
      add(new THREE.BoxGeometry(1.7, 0.22, 0.14), wood2, [0, 0.16, 0], [0, 0.5, 0]);
      add(new THREE.BoxGeometry(0.26, 0.34, 1.5), wood2, [0, 0.28, 0], [0, 0.95, 0.35]);
      add(new THREE.CylinderGeometry(0.2, 0.2, 1.7, 20), wood, [0, 0.62, 0], [0, 1.4, 0], [0, 0, Math.PI / 2]);
    } else if (id === 'jumeok') {
      add(new THREE.BoxGeometry(1.6, 0.36, 0.36), wood2, [0, -0.1, 0]);
      add(new THREE.BoxGeometry(0.28, 0.2, 0.24), cut, [0, 0.03, 0.06]);
      const beam = new THREE.Group();
      beam.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 1.2), wood));
      const tenon = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.11, 0.26, 4), cut); tenon.rotation.y = Math.PI / 4; tenon.position.set(0, -0.06, -0.72);
      beam.add(tenon);
      beam.position.set(0, 0.1, 0.78); beam.userData.base = beam.position.clone();
      this.group.add(beam); this.parts.push({ mesh: beam, dir: new THREE.Vector3(0, 0.6, 0.5) });
    } else if (id === 'jangbu') {
      add(new THREE.CylinderGeometry(0.26, 0.27, 1.0, 24), wood, [0, -0.5, 0]);
      add(new THREE.BoxGeometry(0.15, 0.26, 0.15), cut, [0, 0.12, 0]);
      add(new THREE.BoxGeometry(0.66, 0.24, 0.66), wood2, [0, 0.26, 0], [0, 0.6, 0]);
      add(new THREE.BoxGeometry(0.22, 0.24, 1.5), wood2, [0, 0.5, 0], [0, 1.15, 0]);
    } else if (id === 'banteok') {
      add(new THREE.BoxGeometry(1.0, 0.34, 0.32), wood, [-0.5, 0, 0], [-0.4, 0, 0]);
      add(new THREE.BoxGeometry(0.36, 0.17, 0.32), cut, [0.18, -0.085, 0], [-0.4, 0, 0]);
      add(new THREE.BoxGeometry(1.0, 0.34, 0.32), wood2, [0.68, 0, 0], [0.4, 0.45, 0]);
      add(new THREE.BoxGeometry(0.36, 0.17, 0.32), cut, [0, 0.085, 0], [0.4, 0.45, 0]);
    } else {
      const s = new THREE.DodecahedronGeometry(0.55, 1); s.scale(1.25, 0.5, 1.25);
      add(s, stone, [0, -0.3, 0]);
      add(new THREE.CylinderGeometry(0.27, 0.3, 1.2, 24), wood, [0, 0.42, 0], [0, 0.8, 0]);
      add(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 12), cut, [0, -0.25, 0], [0, 0.5, 0]);
    }
  }

  setExplode(f: number) {
    for (const p of this.parts) p.mesh.position.copy((p.mesh.userData.base as THREE.Vector3).clone().addScaledVector(p.dir, f));
    this.request();
  }

  private resize() {
    if (!this.host) return;
    const r = this.host.getBoundingClientRect();
    if (r.width < 2) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix();
    this.request();
  }

  private request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const moving = this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (moving) this.request();
    });
  }

  dispose() {
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
