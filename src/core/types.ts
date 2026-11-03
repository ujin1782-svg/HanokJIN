// 공용 데이터 모델. 단위는 별도 표기가 없으면 mm, 평면 좌표는 x=동쪽, y=북쪽.

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/* ───────────── 정규화된 CAD 문서 (DWG/DXF 공통) ───────────── */

export interface CadLayer { name: string; color: number; count: number }

export interface CadText {
  layer: string;
  x: number; y: number;        // 정렬 기준점(가운데 정렬이면 가운데)
  h: number; rot: number;      // 글자 높이, 회전(rad)
  text: string;
  align: 'left' | 'center' | 'right';
}

export interface CadCircle { layer: string; x: number; y: number; r: number }

/** 닫힌 폴리라인(기둥·초석 같은 작은 도형 인식용). pts = [x0,y0,x1,y1,...] */
export interface CadPoly { layer: string; pts: number[] }

/** 치수. a,b는 치수보조선 원점, value는 측정값 */
export interface CadDim { layer: string; ax: number; ay: number; bx: number; by: number; lineX: number; lineY: number; orient: 'h' | 'v' | 'a'; value: number }

export interface CadDoc {
  fileName: string;
  format: 'DWG' | 'DXF' | 'DEMO';
  version: string;
  unitScale: number;                       // 원본 단위 → mm 배율(정규화 시 이미 적용됨)
  layers: CadLayer[];
  segs: Record<string, Float64Array>;      // 레이어별 선분 [x1,y1,x2,y2,...]
  circles: CadCircle[];
  polys: CadPoly[];
  texts: CadText[];
  dims: CadDim[];
  extents: Bounds;
  stats: { entities: number; byType: Record<string, number>; skipped: Record<string, number> };
}

export type SheetKind = 'PLAN' | 'ROOF_PLAN' | 'CEILING' | 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'SECTION' | 'OTHER';

export interface Sheet { id: string; kind: SheetKind; title: string; bounds: Bounds; entityCount: number }

/* ───────────── 한옥 프로젝트 모델 ───────────── */

export type PillarShape = 'round' | 'square';
export type PillarRole = 'corner' | 'edge' | 'inner';
export type Source = 'drawing' | 'default' | 'user';

export interface Pillar {
  id: string;
  x: number; y: number;          // 격자 원점(X1·Y1) 기준 mm
  shape: PillarShape;
  size: number;                  // 원주=지름, 방주=한 변
  source: Source;
  confidence: number;            // 0~1
  review?: string;               // 사람이 확인해야 하는 이유
}

export type RoomType = 'maru' | 'ondol' | 'wet' | 'kitchen' | 'other';
export interface Room { id: string; name: string; type: RoomType; x: number; y: number }

export type OpeningKind = 'window' | 'door' | 'open';
export interface Opening { id: string; x1: number; y1: number; x2: number; y2: number; kind: OpeningKind; label?: string; source: Source }

export type RoofType = 'paljak' | 'ujingak' | 'matbae';
export type Gongpo = 'mindori' | 'ikgong' | 'iikgong' | 'jusimpo';
export type Heullim = 'baeheullim' | 'minheullim' | 'none';
export type Lattice = 'tti' | 'se' | 'wanja' | 'yongja';

export interface Params {
  baseD: number;          // 주경 D (기준 기둥 굵기)
  pillarHeight: number;   // 기단 윗면 ~ 기둥 머리
  gidanHeight: number;    // 지면 ~ 기단 윗면
  roofHeight: number;     // 기둥 머리 ~ 용마루 (본채 기준)
  eaves: number;          // 처마 내밀기(주심 ~ 처마 끝, 수평)
  anggok: number;         // 앙곡: 처마 귀가 들리는 높이
  anheori: number;        // 안허리곡: 처마 귀가 밖으로 뻗는 정도(평면)
  roofType: RoofType;
  ryangga: 3 | 5 | 7;
  gongpo: Gongpo;
  heullim: Heullim;
  lattice: Lattice;
  clearance: number;      // 결구 유격(mm)
}

export interface MemberCallout { name: string; w: number; h: number; text: string }

export interface PaletteState { id: string; custom: Partial<Record<MaterialKey, string>> }

export type MaterialKey =
  | 'pillar' | 'beam' | 'rafter' | 'bracket' | 'wall' | 'wallFrame' | 'window'
  | 'roof' | 'ridge' | 'stone' | 'plinth' | 'maru' | 'ondol' | 'ground';

export interface Project {
  version: 3;
  id: string;
  name: string;
  demo: boolean;
  source: { fileName?: string; format?: string; sheetId?: string; area?: string };
  /** 평면도에서 X1·Y1 교차점의 CAD 좌표(도면 위 오버레이 정렬용) */
  origin: { x: number; y: number };
  grid: { xs: number[]; ys: number[]; labelsX: string[]; labelsY: string[]; source: Source };
  pillars: Pillar[];
  rooms: Room[];
  openings: Opening[];
  params: Params;
  /** 도면 인식(또는 예제) 직후의 값. '도면 값으로 되돌리기'에 쓴다. */
  baseline: Params;
  paramSource: Partial<Record<keyof Params, { source: Source; note?: string }>>;
  members: MemberCallout[];
  palette: PaletteState;
  recognitionNotes: string[];
  reviewed: boolean;
}

/* ───────────── 3D 결과에서 뽑는 정보 ───────────── */

export interface BomRow {
  key: string; category: string; name: string; spec: string;
  count: number; unit: string;
  volumeM3: number;       // 목재·석재만
  estimated: boolean;
  basis?: string;
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';
export interface CheckResult {
  id: string; status: CheckStatus; title: string; detail: string;
  focus?: { pillarId?: string; x?: number; y?: number };
}
