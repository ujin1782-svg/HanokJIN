// 4면 [전·후·좌·우] 지정 프레임 촬영 및 3D 한옥 모델 생성 대화상자 UI.
// 사용자는 각 면(정면·배면·좌측면·우측면)을 웹캠/모바일 카메라로 지정 프레임에 맞춰 촬영하거나 사진을 올린다.
// 캔버스 위에서 지정 프레임 기준선(용마루·처마·기단·지면·좌우 귀기둥)을 드래그해 보정할 수 있다.

import type { CadDoc, Project, RoofType, Sheet } from '../core/types';
import {
  analyzeFacePhoto,
  buildProjectFromFourViews,
  createInitialSlots,
  FACE_META,
  type FaceKey,
  type FacePhotoSlot,
  type PhotoModelingOptions,
} from '../photo/photo-modeler';
import { h, icon } from './dom';
import { openModal, toast } from './modal';

export interface PhotoStudioCallbacks {
  onComplete: (res: { project: Project; doc: CadDoc; sheets: Sheet[] }) => void;
}

type DragHandle = 'ridgeY' | 'eaveY' | 'gidanY' | 'groundY' | 'leftX' | 'rightX' | null;

export function openPhotoModelingModal(cb: PhotoStudioCallbacks) {
  const slots: Record<FaceKey, FacePhotoSlot> = createInitialSlots();
  let activeFace: FaceKey = 'front';
  let stream: MediaStream | null = null;
  let cameraOn = false;

  const opts: PhotoModelingOptions = {
    projectName: '4면 촬영 한옥 모델',
    refSpanMm: 10800,
    roofType: 'paljak',
    useExtractedColors: true,
    roundFrontPillars: true,
  };

  // UI 요소 참조
  const faceTabsWrap = h('div', { class: 'photo-face-tabs', role: 'tablist', 'aria-label': '촬영 면 선택' });
  const stageCanvas = h('canvas', { class: 'photo-frame-canvas', width: 720, height: 500, 'aria-label': '지정 프레임 사진 편집기. 기준선을 끌어서 위치를 맞출 수 있습니다.' });
  const videoEl = h('video', { class: 'photo-video', autoplay: true, playsinline: true, muted: true, hidden: true });
  const bayEditorWrap = h('div', { class: 'photo-bay-editor' });
  const summaryBox = h('div', { class: 'photo-summary-box' });
  const statusBadge = h('span', { class: 'badge default' }, '0 / 4면 완료');

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    cameraOn = false;
    videoEl.hidden = true;
    camBtn.replaceChildren(icon('camera', 16), h('span', null, '카메라로 프레임 촬영'));
    captureBtn.hidden = true;
    drawFrameCanvas();
  };

  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      stopCamera();
      const s = slots[activeFace];
      s.dataUrl = String(reader.result);
      s.fileName = f.name;
      await analyzeFacePhoto(s);
      refreshUI();
      toast(`${FACE_META.find((m) => m.key === activeFace)?.short} 사진을 분석해 프레임과 창호·색감을 추출했습니다.`, 'ok');
    };
    reader.readAsDataURL(f);
    fileInput.value = '';
  });

  const camBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => void toggleCamera() },
    icon('camera', 16), h('span', null, '카메라로 프레임 촬영'));

  const captureBtn = h('button', { class: 'btn primary sm', type: 'button', hidden: true, onclick: () => void captureFromVideo() },
    icon('camera', 16), h('span', null, '이 프레임으로 촬영'));

  const uploadBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => fileInput.click() },
    icon('upload', 16), h('span', null, '이 면 사진 올리기'));

  async function toggleCamera() {
    if (cameraOn) {
      stopCamera();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      videoEl.srcObject = stream;
      await videoEl.play();
      cameraOn = true;
      videoEl.hidden = false;
      captureBtn.hidden = false;
      camBtn.replaceChildren(icon('x', 16), h('span', null, '카메라 끄기'));
      requestAnimationFrame(renderLiveCameraFrame);
    } catch {
      toast('카메라 접근 권한이 없거나 지원되지 않는 환경입니다. [이 면 사진 올리기]를 이용해 주세요.', 'warn');
    }
  }

  function renderLiveCameraFrame() {
    if (!cameraOn) return;
    drawFrameCanvas();
    requestAnimationFrame(renderLiveCameraFrame);
  }

  async function captureFromVideo() {
    if (!cameraOn) return;
    const W = videoEl.videoWidth || 800, H = videoEl.videoHeight || 600;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d')!.drawImage(videoEl, 0, 0, W, H);
    const s = slots[activeFace];
    s.dataUrl = c.toDataURL('image/jpeg', 0.92);
    s.fileName = `${activeFace}_capture.jpg`;
    stopCamera();
    await analyzeFacePhoto(s);
    // 다음 미촬영 면으로 자동 이동
    const nextFace = (['front', 'rear', 'left', 'right'] as FaceKey[]).find((k) => !slots[k].dataUrl);
    if (nextFace) activeFace = nextFace;
    refreshUI();
    toast('지정 프레임으로 촬영 및 비례 분석을 완료했습니다.', 'ok');
  }

  // 이미지 캐시(캔버스에 즉시 그리기 위함)
  const imgCache = new Map<string, HTMLImageElement>();
  function getLoadedImg(url: string): HTMLImageElement | null {
    const cached = imgCache.get(url);
    if (cached && cached.complete) return cached;
    if (!cached) {
      const im = new Image();
      im.onload = () => drawFrameCanvas();
      im.src = url;
      imgCache.set(url, im);
    }
    return null;
  }

  /** 지정 프레임과 기준선 오버레이를 캔버스에 렌더링 */
  function drawFrameCanvas() {
    const ctx = stageCanvas.getContext('2d')!;
    const W = stageCanvas.width, H = stageCanvas.height;
    ctx.clearRect(0, 0, W, H);

    const s = slots[activeFace];
    const g = s.guide;

    // 1) 배경: 카메라 영상 또는 업로드된 사진 또는 가이드 빈 화면
    if (cameraOn && !videoEl.hidden && videoEl.readyState >= 2) {
      ctx.drawImage(videoEl, 0, 0, W, H);
    } else if (s.dataUrl) {
      const im = getLoadedImg(s.dataUrl);
      if (im) ctx.drawImage(im, 0, 0, W, H);
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#22262c');
      bg.addColorStop(1, '#17191d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '500 14px "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('카메라를 켜거나 사진을 올려 지정 프레임에 건물 외관을 맞춰 주세요.', W / 2, H / 2 - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '400 12.5px "Noto Sans KR", sans-serif';
      ctx.fillText('정면·배면·좌측면·우측면을 차례로 채우면 정확도가 높아집니다.', W / 2, H / 2 + 16);
    }

    // 2) 프레임 바깥 어두운 마스크 (뷰파인더 효과)
    const lx = g.leftX * W, rx = g.rightX * W;
    const elx = g.eaveLeftX * W, erx = g.eaveRightX * W;
    const ry = g.ridgeY * H, ey = g.eaveY * H, gy = g.gidanY * H, grY = g.groundY * H;

    ctx.fillStyle = 'rgba(10, 12, 16, 0.28)';
    ctx.fillRect(0, 0, W, ry - 18);
    ctx.fillRect(0, grY + 14, W, H - (grY + 14));

    // 3) 지정 프레임 실루엣 (지붕 사다리꼴 + 기둥·벽 사각형 + 기단)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 214, 102, 0.92)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    // 지붕 외곽 가이드
    const rInset = (rx - lx) * (activeFace === 'left' || activeFace === 'right' ? 0.26 : 0.14);
    ctx.beginPath();
    ctx.moveTo(elx, ey);
    ctx.lineTo(lx + rInset, ry);
    ctx.lineTo(rx - rInset, ry);
    ctx.lineTo(erx, ey);
    ctx.closePath();
    ctx.stroke();

    // 몸체(벽·기둥) 및 기단 외곽
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(110, 231, 183, 0.9)';
    ctx.strokeRect(lx, ey, rx - lx, gy - ey);
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.85)';
    ctx.strokeRect(lx - 12, gy, (rx - lx) + 24, grY - gy);
    ctx.restore();

    // 4) 칸(Bay) 수직 분할선 및 칸별 개구부 배지 표시
    const bayW = (rx - lx) / g.bays;
    for (let i = 0; i <= g.bays; i++) {
      const x = lx + i * bayW;
      ctx.strokeStyle = i === 0 || i === g.bays ? '#34d399' : 'rgba(52, 211, 153, 0.72)';
      ctx.lineWidth = i === 0 || i === g.bays ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x, ey);
      ctx.lineTo(x, gy);
      ctx.stroke();

      if (i < g.bays) {
        const bType = g.bayTypes[i] ?? 'wall';
        const cx = x + bayW / 2, cy = (ey + gy) / 2;
        const badgeColor = bType === 'door' ? 'rgba(180, 83, 9, 0.86)' : bType === 'window' ? 'rgba(37, 99, 235, 0.86)' : 'rgba(75, 85, 99, 0.78)';
        const badgeText = bType === 'door' ? `${i + 1}칸: 문` : bType === 'window' ? `${i + 1}칸: 창호` : `${i + 1}칸: 벽`;
        ctx.fillStyle = badgeColor;
        ctx.beginPath();
        ctx.roundRect(cx - 34, cy - 12, 68, 24, 6);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '600 11.5px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(badgeText, cx, cy + 4);
      }
    }

    // 5) 수평 기준선 4개 + 드래그 핸들 라벨
    const drawHorizLine = (y: number, color: string, label: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(W - 24, y);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(W - 138, y - 11, 114, 22, 5);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = '700 11px "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, W - 81, y + 4);
    };

    drawHorizLine(ry, '#fbbf24', '↕ 용마루선 (지붕 마루)');
    drawHorizLine(ey, '#34d399', '↕ 처마·기둥머리선');
    drawHorizLine(gy, '#60a5fa', '↕ 기단 상단선');
    drawHorizLine(grY, '#c084fc', '↕ 지면 기준선');

    // 좌·우 귀기둥 핸들
    for (const [x, txt] of [[lx, '↔ 좌측 귀기둥'], [rx, '↔ 우측 귀기둥']] as const) {
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.roundRect(x - 42, gy + 18, 84, 20, 5);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 10.5px "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(txt, x, gy + 32);
    }
  }

  // 캔버스 포인터 드래그로 프레임 기준선 조정 + 칸 클릭 시 문/창호/벽 순환 전환
  let dragging: DragHandle = null;
  stageCanvas.addEventListener('pointerdown', (e) => {
    const r = stageCanvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * stageCanvas.width;
    const y = ((e.clientY - r.top) / r.height) * stageCanvas.height;
    const W = stageCanvas.width, H = stageCanvas.height;
    const g = slots[activeFace].guide;

    const hitY = (hy: number) => Math.abs(y - hy * H) < 12;
    if (hitY(g.ridgeY)) dragging = 'ridgeY';
    else if (hitY(g.eaveY)) dragging = 'eaveY';
    else if (hitY(g.gidanY)) dragging = 'gidanY';
    else if (hitY(g.groundY)) dragging = 'groundY';
    else if (Math.abs(x - g.leftX * W) < 14 && y >= g.eaveY * H && y <= g.groundY * H + 36) dragging = 'leftX';
    else if (Math.abs(x - g.rightX * W) < 14 && y >= g.eaveY * H && y <= g.groundY * H + 36) dragging = 'rightX';
    else if (y > g.eaveY * H + 14 && y < g.gidanY * H - 14 && x > g.leftX * W && x < g.rightX * W) {
      // 칸 내부 클릭 시 벽 → 창호 → 문 전환
      const idx = Math.min(g.bays - 1, Math.max(0, Math.floor(((x / W - g.leftX) / (g.rightX - g.leftX)) * g.bays)));
      const order: ('wall' | 'window' | 'door')[] = ['wall', 'window', 'door'];
      const cur = g.bayTypes[idx] ?? 'wall';
      g.bayTypes[idx] = order[(order.indexOf(cur) + 1) % order.length];
      refreshUI();
      return;
    }

    if (dragging) stageCanvas.setPointerCapture(e.pointerId);
  });

  stageCanvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = stageCanvas.getBoundingClientRect();
    const nx = Math.max(0.05, Math.min(0.95, (e.clientX - r.left) / r.width));
    const ny = Math.max(0.06, Math.min(0.95, (e.clientY - r.top) / r.height));
    const g = slots[activeFace].guide;
    if (dragging === 'ridgeY') g.ridgeY = Math.min(g.eaveY - 0.08, ny);
    else if (dragging === 'eaveY') g.eaveY = Math.max(g.ridgeY + 0.08, Math.min(g.gidanY - 0.12, ny));
    else if (dragging === 'gidanY') g.gidanY = Math.max(g.eaveY + 0.12, Math.min(g.groundY - 0.03, ny));
    else if (dragging === 'groundY') g.groundY = Math.max(g.gidanY + 0.03, ny);
    else if (dragging === 'leftX') { g.leftX = Math.min(g.rightX - 0.2, nx); g.eaveLeftX = Math.max(0.02, g.leftX - 0.08); }
    else if (dragging === 'rightX') { g.rightX = Math.max(g.leftX + 0.2, nx); g.eaveRightX = Math.min(0.98, g.rightX + 0.08); }
    drawFrameCanvas();
    renderSummary();
  });

  stageCanvas.addEventListener('pointerup', () => { dragging = null; });

  function renderTabs() {
    const doneCount = (['front', 'rear', 'left', 'right'] as FaceKey[]).filter((k) => !!slots[k].dataUrl).length;
    statusBadge.textContent = `${doneCount} / 4면 촬영 완료`;
    statusBadge.className = `badge ${doneCount === 4 ? 'drawing' : 'default'}`;

    faceTabsWrap.replaceChildren(...FACE_META.map((m) => {
      const s = slots[m.key];
      const active = activeFace === m.key;
      return h('button', {
        class: `photo-face-tab ${active ? 'active' : ''} ${s.dataUrl ? 'done' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(active),
        onclick: () => { activeFace = m.key; refreshUI(); },
      },
      h('span', { class: 'face-badge' }, s.dataUrl ? icon('check', 13) : m.dir),
      h('span', { class: 'face-info' },
        h('b', null, m.short),
        h('span', { class: 'muted' }, s.dataUrl ? `${s.guide.bays}칸 인식됨` : '촬영 대기')));
    }));
  }

  function renderBayControls() {
    const s = slots[activeFace];
    const g = s.guide;
    const meta = FACE_META.find((m) => m.key === activeFace)!;
    const isSide = activeFace === 'left' || activeFace === 'right';
    const maxBays = isSide ? 5 : 7;

    const bayCountSel = h('div', { class: 'seg' }, ...Array.from({ length: maxBays }, (_, i) => i + 1).map((n) =>
      h('button', {
        class: `seg-btn ${g.bays === n ? 'active' : ''}`,
        type: 'button',
        onclick: () => {
          g.bays = n;
          while (g.bayTypes.length < n) g.bayTypes.push('window');
          g.bayTypes = g.bayTypes.slice(0, n);
          // 대칭 면(전↔후, 좌↔우) 칸 수도 함께 동기화
          const pair: FaceKey = activeFace === 'front' ? 'rear' : activeFace === 'rear' ? 'front' : activeFace === 'left' ? 'right' : 'left';
          slots[pair].guide.bays = n;
          while (slots[pair].guide.bayTypes.length < n) slots[pair].guide.bayTypes.push('wall');
          slots[pair].guide.bayTypes = slots[pair].guide.bayTypes.slice(0, n);
          refreshUI();
        },
      }, `${n}칸`)));

    const bayChips = g.bayTypes.map((bt, idx) =>
      h('button', {
        class: `chip photo-bay-chip ${bt}`,
        type: 'button',
        title: '누르면 벽 → 창호 → 문 순서로 바뀝니다',
        onclick: () => {
          const next = bt === 'wall' ? 'window' : bt === 'window' ? 'door' : 'wall';
          g.bayTypes[idx] = next;
          refreshUI();
        },
      }, `${idx + 1}칸: ${{ wall: '흙벽', window: '창호', door: '문' }[bt]}`));

    bayEditorWrap.replaceChildren(
      h('div', { class: 'photo-guide-desc' }, h('b', null, meta.label), ' — ', meta.desc),
      h('div', { class: 'photo-bay-row' },
        h('span', { class: 'param-label' }, `${meta.short} 칸 수`),
        bayCountSel,
        h('span', { class: 'muted' }, '캔버스 안의 각 칸을 클릭해 문·창호·벽을 바꿀 수 있습니다.'),
      ),
      h('div', { class: 'photo-bay-chips' }, ...bayChips),
    );
  }

  function renderSummary() {
    const preview = buildProjectFromFourViews(slots, opts).project;
    const P = preview.params;
    const sw = (['roof', 'wall', 'pillar', 'stone'] as const).map((k) => {
      const col = preview.palette.custom[k] ?? '#b88352';
      return h('span', { class: 'photo-color-dot', style: `background:${col}`, title: k });
    });
    summaryBox.replaceChildren(
      h('div', { class: 'section-title' }, '4면 프레임 실시간 3D 추론 치수', h('div', { class: 'photo-color-dots' }, ...sw)),
      h('div', { class: 'kv' }, h('span', null, '평면 구성'), h('b', null, `정면 ${slots.front.guide.bays}칸 × 측면 ${slots.left.guide.bays}칸 (기둥 ${preview.pillars.length}본)`)),
      h('div', { class: 'kv' }, h('span', null, '산출 기단 / 기둥 높이'), h('b', null, `${P.gidanHeight.toLocaleString()}mm / ${P.pillarHeight.toLocaleString()}mm`)),
      h('div', { class: 'kv' }, h('span', null, '산출 지붕 높이 / 처마'), h('b', null, `${P.roofHeight.toLocaleString()}mm / ${P.eaves.toLocaleString()}mm`)),
      h('div', { class: 'kv' }, h('span', null, '인식 개구부 (4면 합계)'), h('b', null, `문·창호 ${preview.openings.length}곳`)),
    );
  }

  function refreshUI() {
    renderTabs();
    renderBayControls();
    drawFrameCanvas();
    renderSummary();
  }

  // 우측 설정 폼
  const nameInput = h('input', {
    class: 'input sm',
    type: 'text',
    value: opts.projectName,
    oninput: (e: Event) => { opts.projectName = (e.target as HTMLInputElement).value; },
  });
  const spanInput = h('input', {
    class: 'input sm num',
    type: 'number',
    min: 3000,
    max: 24000,
    step: 100,
    value: opts.refSpanMm,
    onchange: (e: Event) => { opts.refSpanMm = Number((e.target as HTMLInputElement).value) || 10800; renderSummary(); },
  });
  const roofSel = h('select', {
    class: 'select sm',
    onchange: (e: Event) => { opts.roofType = (e.target as HTMLSelectElement).value as RoofType; renderSummary(); },
  },
    h('option', { value: 'paljak' }, '팔작지붕 (측면 합각벽)'),
    h('option', { value: 'ujingak' }, '우진각지붕 (4면 경사)'),
    h('option', { value: 'matbae' }, '맞배지붕 (측면 박공벽)'),
  );
  const colorChk = h('input', {
    type: 'checkbox',
    checked: opts.useExtractedColors,
    onchange: (e: Event) => { opts.useExtractedColors = (e.target as HTMLInputElement).checked; renderSummary(); },
  });
  const roundChk = h('input', {
    type: 'checkbox',
    checked: opts.roundFrontPillars,
    onchange: (e: Event) => { opts.roundFrontPillars = (e.target as HTMLInputElement).checked; renderSummary(); },
  });

  const body = h('div', { class: 'photo-studio' },
    fileInput,
    h('div', { class: 'photo-top-bar' },
      faceTabsWrap,
      h('div', { class: 'photo-top-actions' }, statusBadge),
    ),
    h('div', { class: 'photo-main-grid' },
      h('div', { class: 'photo-stage-col' },
        h('div', { class: 'photo-canvas-wrap' }, stageCanvas, videoEl),
        h('div', { class: 'photo-Action-bar' }, camBtn, captureBtn, uploadBtn,
          h('span', { class: 'muted photo-drag-tip' }, '팁: 노란·초록·파란 기준선을 위아래로 끌어 건물의 용마루·처마·기단에 맞추세요.')),
        bayEditorWrap,
      ),
      h('div', { class: 'photo-side-col' },
        h('div', { class: 'section' },
          h('div', { class: 'section-title' }, '모델 생성 설정'),
          h('div', { class: 'field' }, h('label', null, '프로젝트 이름'), nameInput),
          h('div', { class: 'field' }, h('label', null, '정면 기준 총장 (좌·우 귀기둥 거리)'),
            h('div', { class: 'num-field' }, spanInput, h('span', { class: 'unit' }, 'mm'))),
          h('div', { class: 'field' }, h('label', null, '지붕 형식 (좌·우측면 판별)'), roofSel),
          h('label', { class: 'check' }, colorChk, h('span', null, '사진에서 추출한 실제 색감(기와·벽·목재) 적용')),
          h('label', { class: 'check' }, roundChk, h('span', null, '정면 기둥을 원기둥(배흘림 원주)으로 생성')),
        ),
        summaryBox,
      ),
    ),
  );

  const createBtn = h('button', {
    class: 'btn primary',
    type: 'button',
    onclick: () => {
      if (!slots.front.dataUrl) { toast('정면 사진이 있어야 모델을 만들 수 있습니다. 정면부터 촬영하거나 올려 주세요.', 'warn'); return; }
      stopCamera();
      const res = buildProjectFromFourViews(slots, opts);
      modal.close();
      cb.onComplete(res);
      toast(`4면 [전·후·좌·우] 사진 분석으로 "${res.project.name}" 3D 모델을 생성했습니다.`, 'ok');
    },
  }, icon('cube', 16), '4면 분석으로 3D 모델 생성');

  const cancelBtn = h('button', {
    class: 'btn',
    type: 'button',
    onclick: () => { stopCamera(); modal.close(); },
  }, '닫기');

  const modal = openModal('4면 [전·후·좌·우] 지정 프레임 촬영 → 3D 모델 생성', body, [cancelBtn, createBtn], {
    wide: true,
    onClose: () => stopCamera(),
  });
  modal.dialog.classList.add('photo-modal');

}
