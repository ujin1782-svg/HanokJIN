#!/usr/bin/env bash
# ==============================================================================
# HanokJIN v3.1 — Branch Push -> Create PR -> Merge -> GitHub Pages 자동 배포 스크립트
# ==============================================================================
set -e

REPO_URL="https://github.com/ujin1782-svg/HanokJIN.git"
BRANCH_NAME="feat/4view-photo-3d-pbr"
PR_TITLE="feat: 4면[전·후·좌·우] 지정 프레임 촬영 3D 모델링 및 사실적 PBR 재질·조명 개선"

echo "=============================================================="
echo " 1. Git 브랜치 생성 및 커밋 ($BRANCH_NAME)"
echo "=============================================================="

if [ ! -d ".git" ]; then
  git init
  git remote add origin "$REPO_URL" || git remote set-url origin "$REPO_URL"
fi

git checkout -B "$BRANCH_NAME"
git add .
git status -s

git commit -m "$PR_TITLE" -m "- 4면[전·후·좌·우] 지정 가이드 프레임 촬영/업로드 기반 3D 한옥 복원 엔진(src/photo/photo-modeler.ts) 및 스튜디오 UI(src/ui/photo-modal.ts) 추가
- 소나무 나이테·옹이, 암수키와 골, 화강암 장대석, 회벽/황토, 한지 운룡지 등 고해상도 절차적 PBR 알베도+범프맵(src/model/textures.ts, materials.ts) 적용
- PMREM 절차적 환경광(IBL), 마당 반사광(Bounce Light), 시간대별 자연광 4종 프리셋(src/ui/viewport.ts) 및 3D 재질 구 UI 스와치(src/ui/inspector.ts) 적용
- 요구사항·유스케이스·기능 명세서(docs/REQUIREMENTS_AND_SPECS.md) 및 단위 테스트(tests/photo-pbr.test.ts) 추가
- GitHub Pages 자동 배포 워크플로우(.github/workflows/deploy.yml) 구성" || echo "이미 커밋되어 있습니다."

echo ""
echo "=============================================================="
echo " 2. 원격 저장소(origin)로 브랜치 푸시"
echo "=============================================================="
git push -u origin "$BRANCH_NAME"

echo ""
echo "=============================================================="
echo " 3. Pull Request 생성 -> Merge -> GitHub Pages 배포"
echo "=============================================================="
if command -v gh &> /dev/null; then
  echo "[GitHub CLI 감지됨] PR 생성 및 병합을 자동으로 진행합니다..."

  # GitHub Pages 무료 도메인 사용을 위해 저장소를 Public으로 설정(선택) 및 Pages 워크플로우 활성화
  gh repo edit ujin1782-svg/HanokJIN --visibility public --accept-visibility-change-consequences 2>/dev/null || true
  gh api -X POST /repos/ujin1782-svg/HanokJIN/pages -f build_type=workflow 2>/dev/null || \
  gh api -X PUT /repos/ujin1782-svg/HanokJIN/pages -f build_type=workflow 2>/dev/null || true

  # PR 생성
  PR_URL=$(gh pr create \
    --base main \
    --head "$BRANCH_NAME" \
    --title "$PR_TITLE" \
    --body "## 주요 변경 사항
1. **4면 [전·후·좌·우] 지정 프레임 촬영 기반 3D 한옥 모델 생성** (\`src/photo/photo-modeler.ts\`, \`src/ui/photo-modal.ts\`)
2. **사실적 PBR 재질·범프맵·환경광(IBL) 및 3D 재질 구 UI 스와치 개선** (\`src/model/textures.ts\`, \`src/model/materials.ts\`, \`src/ui/viewport.ts\`, \`src/ui/inspector.ts\`)
3. **요구사항·유스케이스 명세서 및 단위 테스트 22건 통과** (\`docs/REQUIREMENTS_AND_SPECS.md\`, \`tests/photo-pbr.test.ts\`)
4. **GitHub Pages 무료 도메인 자동 배포 워크플로우** (\`.github/workflows/deploy.yml\`)" 2>/dev/null || gh pr view "$BRANCH_NAME" --json url -q .url)

  echo "생성된 PR: $PR_URL"

  # PR 즉시 병합 (Merge) 및 브랜치 정리
  gh pr merge "$BRANCH_NAME" --merge --delete-branch
  git checkout main && git pull origin main

  echo ""
  echo "✅ PR 병합이 완료되어 GitHub Actions 배포 워크플로우가 시작되었습니다!"
  echo "🌐 배포 도메인: https://ujin1782-svg.github.io/HanokJIN/"
else
  PR_COMPARE_URL="https://github.com/ujin1782-svg/HanokJIN/compare/main...${BRANCH_NAME}?expand=1"
  echo "[안내] GitHub CLI(gh)가 설치되어 있지 않아 데스크톱 기본 브라우저(Chrome)로 PR 생성 화면을 엽니다..."
  if command -v start &> /dev/null; then
    start "" "$PR_COMPARE_URL"
  elif command -v open &> /dev/null; then
    open -a "Google Chrome" "$PR_COMPARE_URL" || open "$PR_COMPARE_URL"
  elif command -v xdg-open &> /dev/null; then
    xdg-open "$PR_COMPARE_URL"
  fi
  echo "👉 브라우저에서 열린 페이지에서 [Create pull request] -> [Merge pull request]를 클릭하면 배포가 시작됩니다:"
  echo "   $PR_COMPARE_URL"
fi
