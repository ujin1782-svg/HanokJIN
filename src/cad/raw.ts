// DWG(LibreDWG)와 DXF(자체 파서)가 공통으로 내놓는 원시 엔티티 형식.
// 각도는 모두 라디안. LibreDWG-web의 DwgDatabase 필드 이름을 그대로 따른다.

export interface P { x: number; y: number; z?: number }

export interface RawEntity {
  type: string;
  layer: string;
  colorIndex?: number;
  // LINE
  startPoint?: P; endPoint?: P;
  // CIRCLE / ARC / ELLIPSE
  center?: P; radius?: number; startAngle?: number; endAngle?: number;
  majorAxisEndPoint?: P; axisRatio?: number;
  // LWPOLYLINE / POLYLINE / SPLINE
  vertices?: { x: number; y: number; bulge?: number }[];
  flag?: number;
  controlPoints?: P[]; fitPoints?: P[];
  // TEXT / MTEXT
  text?: string; textHeight?: number; rotation?: number;
  halign?: number; valign?: number; attachmentPoint?: number;
  insertionPoint?: P; direction?: P;
  // INSERT
  name?: string; xScale?: number; yScale?: number;
  attribs?: RawEntity[];
  // DIMENSION
  definitionPoint?: P; subDefinitionPoint1?: P; subDefinitionPoint2?: P; measurement?: number;
  // SOLID / 3DFACE
  corner1?: P; corner2?: P; corner3?: P; corner4?: P;
}

export interface RawBlock { name: string; basePoint: P; entities: RawEntity[] }

export interface RawDrawing {
  format: 'DWG' | 'DXF';
  version: string;
  insUnits: number;
  layers: { name: string; colorIndex: number; off?: boolean; frozen?: boolean }[];
  blocks: Map<string, RawBlock>;
  entities: RawEntity[];
}
