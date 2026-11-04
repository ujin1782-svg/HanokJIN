// IFC4 내보내기. 모든 부재를 실제 형상(IfcTriangulatedFaceSet)과 함께 기록한다.
// 좌표는 m, Z가 위(IFC 규약)이다.

import * as THREE from 'three';
import type { Project } from '../core/types';
import type { Build, PartInfo } from '../model/hanok';

const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
function guid() {
  const r = crypto.getRandomValues(new Uint8Array(22));
  let s = ALPHA[r[0] % 4];
  for (let i = 1; i < 22; i++) s += ALPHA[r[i] % 64];
  return s;
}

/** STEP 문자열: 비ASCII는 \X2\…\X0\ 로 */
export function stepString(s: string) {
  let out = '', run = '';
  const flush = () => { if (run) { out += `\\X2\\${run}\\X0\\`; run = ''; } };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], c = s.charCodeAt(i);   // UTF-16 단위 그대로(서로게이트 포함)
    if (c >= 32 && c < 127) {
      flush();
      out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch;
    } else run += c.toString(16).toUpperCase().padStart(4, '0');
  }
  flush();
  return `'${out}'`;
}

const f = (v: number) => {
  const s = (Math.round(v * 10000) / 10000).toString();
  return s.includes('.') || s.includes('e') ? s : `${s}.`;
};

const CLASS_ARGS: Record<string, string> = {
  IfcColumn: '$,$', IfcBeam: '$,$', IfcMember: '$,$', IfcSlab: '$,$', IfcWall: '$,$', IfcRoof: '$,$',
  IfcCovering: '$,$', IfcFooting: '$,.NOTDEFINED.', IfcBuildingElementProxy: '$,$',
  IfcWindow: '$,$,$,$,$,$', IfcDoor: '$,$,$,$,$,$',
};

export function exportIfc(p: Project, b: Build, onlyVisible: boolean): string {
  let id = 0;
  const lines: string[] = [];
  const add = (s: string) => { id++; lines.push(`#${id}=${s};`); return `#${id}`; };
  const ts = Math.floor(Date.now() / 1000);

  const person = add("IFCPERSON($,$,'',$,$,$,$,$)");
  const org = add(`IFCORGANIZATION($,${stepString('HanokJIN')},$,$,$)`);
  const po = add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const app = add(`IFCAPPLICATION(${org},'3.0',${stepString('HanokJIN')},'HanokJIN')`);
  const oh = add(`IFCOWNERHISTORY(${po},${app},$,.ADDED.,$,${po},${app},${ts})`);
  const units = [
    add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)'), add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'),
    add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'), add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)'),
  ];
  const ua = add(`IFCUNITASSIGNMENT((${units.join(',')}))`);
  const o = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const z = add('IFCDIRECTION((0.,0.,1.))'), x = add('IFCDIRECTION((1.,0.,0.))');
  const ax = add(`IFCAXIS2PLACEMENT3D(${o},${z},${x})`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ax},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const proj = add(`IFCPROJECT('${guid()}',${oh},${stepString(p.name)},${stepString('HanokJIN 한옥 모델')},$,$,$,(${ctx}),${ua})`);
  const sitePl = add(`IFCLOCALPLACEMENT($,${ax})`);
  const site = add(`IFCSITE('${guid()}',${oh},${stepString('대지')},$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = add(`IFCLOCALPLACEMENT(${sitePl},${ax})`);
  const bld = add(`IFCBUILDING('${guid()}',${oh},${stepString(p.name)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  const stPl = add(`IFCLOCALPLACEMENT(${bldPl},${ax})`);
  const storey = add(`IFCBUILDINGSTOREY('${guid()}',${oh},${stepString('1층')},$,$,${stPl},$,$,.ELEMENT.,0.)`);
  add(`IFCRELAGGREGATES('${guid()}',${oh},$,$,${proj},(${site}))`);
  add(`IFCRELAGGREGATES('${guid()}',${oh},$,$,${site},(${bld}))`);
  add(`IFCRELAGGREGATES('${guid()}',${oh},$,$,${bld},(${storey}))`);

  const elems: string[] = [];
  const v = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  b.root.updateMatrixWorld(true);

  const emit = (geo: THREE.BufferGeometry, matrix: THREE.Matrix4, info: PartInfo | undefined, groupName: string) => {
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    if (!pos || pos.count < 3) return;
    const pts: string[] = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      pts.push(`(${f(v.x)},${f(-v.z)},${f(v.y)})`);
    }
    const tri: string[] = [];
    if (idx) for (let i = 0; i < idx.count; i += 3) tri.push(`(${idx.getX(i) + 1},${idx.getX(i + 1) + 1},${idx.getX(i + 2) + 1})`);
    else for (let i = 0; i < pos.count; i += 3) tri.push(`(${i + 1},${i + 2},${i + 3})`);
    const pl = add(`IFCCARTESIANPOINTLIST3D((${pts.join(',')}))`);
    const fs = add(`IFCTRIANGULATEDFACESET(${pl},$,$,(${tri.join(',')}),$)`);
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${fs}))`);
    const pds = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const cls = info?.ifc && CLASS_ARGS[info.ifc] ? info.ifc : 'IfcBuildingElementProxy';
    const name = info?.name ?? groupName;
    const el = add(`${cls.toUpperCase()}('${guid()}',${oh},${stepString(name)},${stepString(info?.spec ?? '')},$,${stPl},${pds},$,${CLASS_ARGS[cls]})`);
    elems.push(el);
    if (info?.spec) {
      const p1 = add(`IFCPROPERTYSINGLEVALUE(${stepString('부재명')},$,IFCLABEL(${stepString(name)}),$)`);
      const p2 = add(`IFCPROPERTYSINGLEVALUE(${stepString('규격')},$,IFCLABEL(${stepString(info.spec)}),$)`);
      const ps = add(`IFCPROPERTYSET('${guid()}',${oh},'Pset_HanokJIN',$,(${p1},${p2}))`);
      add(`IFCRELDEFINESBYPROPERTIES('${guid()}',${oh},$,$,(${el}),${ps})`);
    }
  };

  for (const g of Object.values(b.groups)) {
    if (onlyVisible && !g.visible) continue;
    g.traverse((obj) => {
      if (onlyVisible && !obj.visible) return;
      if (obj.userData.decor) return;   // 단청 색띠 같은 표현용 형상은 BIM 부재가 아니다
      const info = obj.userData.part as PartInfo | undefined;
      if (obj instanceof THREE.InstancedMesh) {
        for (let k = 0; k < obj.count; k++) {
          obj.getMatrixAt(k, m4);
          emit(obj.geometry, m4.premultiply(obj.matrixWorld), info, g.name);
        }
      } else if (obj instanceof THREE.Mesh) {
        emit(obj.geometry, obj.matrixWorld, info, g.name);
      }
    });
  }
  if (elems.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',${oh},$,$,(${elems.join(',')}),${storey})`);

  const now = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;', 'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${stepString(`${p.name}.ifc`)},'${now}',(''),(''),'HanokJIN 3.0','HanokJIN','');`,
    "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;', ...lines, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
}
