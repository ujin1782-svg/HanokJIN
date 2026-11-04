# HanokJIN
한옥의 CAD 도면(`DWG`·`DXF`)을 업로드하거나 **건물의 4면[전·후·좌·우] 사진**을 지정된 가이드 프레임에 맞춰 촬영하면, 사실적인 물리 기반 질감(PBR)과 조명을 갖춘 **한옥 3D 모델**로 만들고, 기둥·부재마다 **손상을 사진과 표준 용어로 기록**하는 웹 애플리케이션입니다.

DWG·DXF 평면도 또는 4면 외관 사진에서 격자(주열)와 기둥·창호·지붕 비례를 찾아 한옥 3D 모델을 만들고, 사람이 인식 결과를 확인·수정한 뒤 사실적인 전통 재질 색감과 시간대별 자연광을 골라 **BIM(IFC4) · 3D(glTF/.glb) · 평면(DXF) · 물량표(CSV)**로 내보냅니다.

```
도면 준비 / 4면[전·후·좌·우] 프레임 촬영 → 인식·프레임 검토 → 3D 생성 → PBR 재질·조명 편집 → 손상 조사 → 내보내기
```

## 주요 기능

0. **부재별 손상 조사 (`src/damage/`, `src/ui/damage-editor.ts`)** — 위쪽 [손상 조사] 모드
   - 도면이나 3D에서 기둥·부재를 눌러 손상을 기록합니다. 사진을 올리고 손상 영역을 끌어서 표시하며, 영역마다 손상 종류를 지정합니다.
   - **표준 분류 14종**: 손상(총칭) › 열화·풍화·훼손(중위) › 할렬·윤할·분할·갈램·균열·터짐·압괴·기욺·처짐·이격·박락/탈락·부후·충해·변색/오염. 정의·판별 요령과 사진만으로 부족할 때 병행할 계측(수직도, 천공저항 등)을 함께 보여 줍니다.
   - **보고서 용어 교정**: 정기조사 보고서에 쓰인 81개 표기(8,010회 언급)를 사전으로 담아, 원문 표기(예: `할열`, `기울음`, `목재 부식`, 목부재 `균열`)를 표준 용어로 교정해 제안합니다.
   - **조사내용 문구 초안**: 부재·위치·분류·손상 정도로 정기조사 보존사항 문구를 자동으로 씁니다(수정 가능).
   - 손상 기둥은 손상 정도 색으로 3D·평면에 표시됩니다. 판정은 조사자가 하며, 앱은 사진을 자동 판정하지 않습니다.
   - **내보내기**: 손상 조사표(CSV), 학습 데이터셋 ZIP(사진 + YOLO 라벨 + COCO JSON + VLM 지시 학습 JSONL + 조사표).
   - 분류 체계 출처: 최현서·김소현·김윤상(2025), 「목조 건축문화유산 손상 진단을 위한 용어 표준 체계화 기초 연구」, 건축역사연구 34(3) pp.19-30.

1. **건물 4면 [전·후·좌·우] 지정 프레임 촬영 → 3D 모델 생성 (`src/photo/photo-modeler.ts`, `src/ui/photo-modal.ts`)**
   - **4면 슬롯 관리**: 정면(남), 배면(북), 좌측면(서), 우측면(동) 4개 시점의 사진 촬영·업로드를 지원합니다.
   - **지정 프레임 가이드 오버레이**: 용마루선, 처마·기둥머리선, 기단 상단선, 지면선, 좌·우 귀기둥 기준선과 칸(주열) 분할선을 화면 위에서 직접 끌어 맞출 수 있습니다.
   - **자동 비례·개구부·색감 추출**: 4면 사진의 수평/수직 에지와 영역별 색상을 분석해 기단·기둥·지붕 높이, 처마 길이, 칸별 창호/문/흙벽, 외관 대표 색감을 자동으로 추출합니다.
2. **사실적인 PBR 재질·텍스처 및 자연광 조명 (`src/model/textures.ts`, `src/model/materials.ts`, `src/ui/viewport.ts`)**
   - **다중 채널 절차적 PBR 텍스처**: 단색처럼 보이던 기존 재질을 개선하여 소나무 나이테·옹이·결(`woodTexture` + `woodBumpTexture`), 암키와·수키와 골 입체 음영(`tileTexture` + `tileBumpTexture`), 포천석 화강암 결정과 장대석 줄눈(`stoneTexture` + `stoneBumpTexture`), 회벽/황토 미장 질감, 닥나무 한지(운룡지) 창호 투광 효과를 적용했습니다.
   - **절차적 HDRI 환경광(PMREM) 및 시간대별 조명**: 처마 밑 서까래·공포까지 은은한 마당 반사광(Bounce Light)이 닿도록 개선했으며, **맑은 한낮 · 아침 햇살 · 석양 노을 · 차분한 흐린 날** 4가지 조명 프리셋을 제공합니다.
   - **입체 재질 구(Material Sphere) UI 스와치**: 오른쪽 설정 서랍의 색감 카드와 재료 색상 선택기에 나뭇결·기와골·석재 입자와 빛의 하이라이트가 살아 있는 3D 재질 구 스와치를 적용했습니다.

## 시작하기

Node.js 20 이상이 필요합니다.

```bash
npm install
```

```bash
npm run dev
```

브라우저에서 `http://localhost:5173`을 열고 도면 파일을 끌어다 놓거나 **`[4면 사진으로 만들기]`**를 고르세요.

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사 + 배포용 빌드(`dist/`) |
| `npm test` | 단위 테스트 |
| `npm run typecheck` | 타입 검사만 |

## 구조

```
src/
  cad/            도면 읽기와 인식 (DWG LibreDWG WebAssembly / ASCII DXF 자체 파서)
  photo/          4면 [전·후·좌·우] 지정 프레임 촬영 분석 및 3D 프로젝트 복원 엔진
    photo-modeler.ts  4면 프레임 비례 역산, 칸별 창호/문 판별, 외관 색감 추출
  model/          한옥 3D 생성 및 PBR 재질
    footprint.ts    기둥 배치 → 외곽 칸 → 채(날개) 분할
    roof.ts         팔작·우진각·맞배 지붕면(앙곡·안허리곡)
    hanok.ts        기단·기둥·공포·보·도리·서까래·벽·창호·지붕 + 물량 집계
    textures.ts     고해상도 절차적 PBR 알베도 + 범프(Bump) 텍스처 생성
    materials.ts    부재별 물리 기반 재질(MeshStandardMaterial + Bump + EnvMap)
    palettes.ts     전통 천연 안료·목재·석재 기반 사실적 색감 프리셋
    validate.ts     검증(간섭·경간·처마 각도·물매 등)
    plan-drawing.ts 모델에서 2D 평면도 생성(4면 사진 모델·DXF 내보내기)
  damage/         손상 조사
    taxonomy.ts     14개 표준 분류, 용어 교정 규칙, 조사내용 문구
    terms.ts        보고서 손상 표기 81종 사전(논문 표 6)
    records.ts      손상 기록 도우미(대상 부재 이름, 집계)
    dataset.ts      조사표 CSV, YOLO·COCO·VLM JSONL 데이터셋
  export/         IFC4 · glTF(.glb) · DXF · CSV · ZIP
  ui/             도면 창, 3D 창(시간대 조명·IBL), 4면 사진 스튜디오, 손상 기록 편집기·용어 안내, 설정 서랍, 아래 패널
  app/            상태(되돌리기), 자동 저장, 조립
docs/
  REQUIREMENTS_AND_SPECS.md  4면 사진 3D 모델링 및 PBR 개선 요구사항·유스케이스·기능 명세서
tests/            DXF 왕복·인식, 모델·IFC, 손상 용어·데이터셋·ZIP, 실제 DWG(선택)
  fixtures/       테스트용 예제 프로젝트(앱에는 들어가지 않음)
```


## GitHub Pages 무료 도메인 배포 (`ujin1782-svg.github.io/HanokJIN`)

이 저장소에는 `main` 브랜치에 푸시할 때마다 자동으로 테스트·빌드 후 GitHub Pages로 배포하는 `.github/workflows/deploy.yml` 워크플로우가 포함되어 있습니다 (`vite.config.ts`에 `base: './'`가 설정되어 있어 하위 경로에서도 에셋과 Web Worker가 바로 동작합니다).

1. **GitHub 저장소에 코드 푸시**
   ```bash
   git init
   git add .
   git commit -m "feat: add 4-view photo 3D modeling, PBR materials, and GitHub Pages deploy"
   git branch -M main
   git remote add origin https://github.com/ujin1782-svg/HanokJIN.git
   git push -u origin main
   ```
2. **GitHub Pages 활성화**
   - GitHub 저장소 페이지의 **Settings → Pages** 메뉴로 이동합니다 (무료 플랜에서는 저장소가 **Public**이어야 무료 배포가 활성화됩니다).
   - **Build and deployment → Source**를 **`GitHub Actions`**로 변경합니다.
3. **배포 주소 확인**
   - **Actions** 탭에서 `Deploy HanokJIN to GitHub Pages` 워크플로우가 완료되면 아래 무료 도메인에서 바로 접속할 수 있습니다:
   - **`https://ujin1782-svg.github.io/HanokJIN/`**
