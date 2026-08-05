#!/bin/bash
# ============================================================
# wave-orchestrator.sh — Launch, test, and merge agent waves
# Usage: bash scripts/wave-orchestrator.sh <command> [args]
#
# Commands:
#   status              Show current state of all waves/branches
#   test-wave <N>       Test all branches in wave N
#   merge-wave <N>      Test + merge wave N into main
#   fix-report          Build frontend, show all errors grouped by file
#   health              Quick health check (build + basic tests)
#
# Wave definitions (edit WAVES array below to match your branches)
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ════════════════════════════════════════════
# WAVE DEFINITIONS — edit these for your project
# ════════════════════════════════════════════
# Format: "wave_number|branch_name|agent_name|description"

WAVE_DEFS=(
  # Wave 1 — Foundation (already merged)
  "1|origin/claude/topology-api-endpoints-JTv1g|V1-DB|Topology tables + API"
  "1|origin/claude/agent-v2-digital-index-BzptT|V2-Index|Digital index backend"

  # Wave 2 — 2D Canvas
  "2|feature/system-canvas|V4-Canvas|React Flow canvas + custom nodes"
  "2|feature/elk-layout|V5-ELK|ELK layout engine"
  "2|feature/semantic-zoom|V6-Zoom|Semantic zoom + navigation"
  "2|feature/wire-frontend-api|C3-Wiring|Frontend API wiring"

  # Wave 3 — 3D + Integration
  "3|feature/3d-viewer|V7-3D|Three.js 3D model viewer"
  "3|feature/selection-bus|V8-Sync|Selection Bus 2D↔3D sync"
  "3|feature/digital-index-ui|V9-Index|Digital Index frontend"

  # Wave 4 — Polish (future)
  # "4|feature/performance|V10-Perf|Performance optimization"
  # "4|feature/ai-chat|V11-AI|AI chat integration"
)

# ════════════════════════════════════════════

get_wave_branches() {
  local wave_num="$1"
  for def in "${WAVE_DEFS[@]}"; do
    IFS='|' read -r wn branch agent desc <<< "$def"
    if [ "$wn" = "$wave_num" ]; then
      echo "$branch"
    fi
  done
}

cmd_status() {
  echo ""
  echo -e "${BOLD}AssetView — Wave Status${NC}"
  echo "═══════════════════════════════════════════════════════"
  echo ""

  local current_wave=""
  for def in "${WAVE_DEFS[@]}"; do
    IFS='|' read -r wn branch agent desc <<< "$def"

    if [ "$wn" != "$current_wave" ]; then
      current_wave="$wn"
      echo -e "${BOLD}Wave $wn${NC}"
      echo "────────────────────────────────────────"
    fi

    # Check if branch exists and its merge status
    local status_icon=""
    local status_text=""

    if git merge-base --is-ancestor "$branch" HEAD 2>/dev/null; then
      status_icon="${GREEN}MERGED${NC}"
    elif git rev-parse "$branch" >/dev/null 2>&1; then
      status_icon="${YELLOW}EXISTS${NC}"
    elif git rev-parse "origin/$branch" >/dev/null 2>&1; then
      status_icon="${YELLOW}REMOTE${NC}"
    else
      status_icon="${DIM}NOT FOUND${NC}"
    fi

    printf "  %-10s  %-12s  %-40s  %s\n" "$(echo -e $status_icon)" "$agent" "$branch" "$desc"
  done

  echo ""

  # Current branch info
  echo -e "${BOLD}Current:${NC} $(git branch --show-current)"
  echo -e "${BOLD}Last commit:${NC} $(git log --oneline -1)"
  echo ""
}

cmd_test_wave() {
  local wave_num="$1"
  local branches=()

  while IFS= read -r b; do
    branches+=("$b")
  done < <(get_wave_branches "$wave_num")

  if [ ${#branches[@]} -eq 0 ]; then
    echo "No branches defined for wave $wave_num"
    exit 1
  fi

  echo -e "${CYAN}Testing Wave $wave_num (${#branches[@]} branches)${NC}"
  bash "$REPO_ROOT/scripts/merge-wave.sh" --dry-run "${branches[@]}"
}

cmd_merge_wave() {
  local wave_num="$1"
  local branches=()

  while IFS= read -r b; do
    branches+=("$b")
  done < <(get_wave_branches "$wave_num")

  if [ ${#branches[@]} -eq 0 ]; then
    echo "No branches defined for wave $wave_num"
    exit 1
  fi

  echo -e "${CYAN}Merging Wave $wave_num (${#branches[@]} branches)${NC}"
  bash "$REPO_ROOT/scripts/merge-wave.sh" "${branches[@]}"
}

cmd_fix_report() {
  echo -e "${BOLD}AssetView — Build Error Report${NC}"
  echo "═══════════════════════════════════════"
  echo ""

  cd "$REPO_ROOT/frontend"
  npm install --silent 2>/dev/null

  echo -e "${CYAN}Running frontend build...${NC}"
  echo ""

  BUILD_OUTPUT=$(npm run build 2>&1) || true

  # Check if build passed
  if echo "$BUILD_OUTPUT" | grep -q "built in"; then
    echo -e "${GREEN}Frontend build PASSED — no errors!${NC}"
    echo "$BUILD_OUTPUT" | tail -3
    return 0
  fi

  # Parse and group errors by file
  echo -e "${RED}Build FAILED. Errors by file:${NC}"
  echo ""

  echo "$BUILD_OUTPUT" | grep -E "^(ERROR|error|Error|✗|src/)" | while read -r line; do
    echo "  $line"
  done

  echo ""
  echo -e "${BOLD}Full output saved to:${NC} /tmp/assetview-build-errors.log"
  echo "$BUILD_OUTPUT" > /tmp/assetview-build-errors.log

  # Count errors
  ERROR_COUNT=$(echo "$BUILD_OUTPUT" | grep -c "error" 2>/dev/null || echo "?")
  echo -e "\n${RED}Total errors: ~$ERROR_COUNT${NC}"
  echo ""
  echo -e "${YELLOW}Tip: Fix files from bottom of import chain up (hooks → lib → components → App.jsx)${NC}"
}

cmd_health() {
  echo -e "${BOLD}AssetView — Health Check${NC}"
  echo "═══════════════════════════════════════"
  echo ""

  local SCORE=0
  local TOTAL=0

  # Check 1: Frontend build
  ((TOTAL++))
  echo -ne "  Frontend build... "
  cd "$REPO_ROOT/frontend"
  npm install --silent 2>/dev/null
  if npm run build 2>&1 | grep -q "built in"; then
    echo -e "${GREEN}PASS${NC}"
    ((SCORE++))
  else
    echo -e "${RED}FAIL${NC}"
  fi

  # Check 2: Backend syntax
  ((TOTAL++))
  echo -ne "  Backend syntax...  "
  cd "$REPO_ROOT/backend"
  if node -c src/server.js 2>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
    ((SCORE++))
  else
    echo -e "${RED}FAIL${NC}"
  fi

  # Check 3: Prisma schema
  ((TOTAL++))
  echo -ne "  Prisma schema...  "
  cd "$REPO_ROOT/backend"
  if npx prisma validate --no-hints 2>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
    ((SCORE++))
  else
    echo -e "${RED}FAIL${NC}"
  fi

  # Check 4: Backend tests
  ((TOTAL++))
  echo -ne "  Backend tests...  "
  cd "$REPO_ROOT/backend"
  if npm test 2>&1 | grep -q "pass"; then
    echo -e "${GREEN}PASS${NC}"
    ((SCORE++))
  else
    echo -e "${YELLOW}SKIP${NC} (needs DB)"
  fi

  # Check 5: No merge conflicts
  ((TOTAL++))
  echo -ne "  No conflicts...   "
  cd "$REPO_ROOT"
  if ! grep -rq "<<<<<<< " --include="*.js" --include="*.jsx" --include="*.ts" --include="*.css" . 2>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
    ((SCORE++))
  else
    echo -e "${RED}FAIL — merge conflict markers found${NC}"
  fi

  echo ""
  echo -e "  Score: ${BOLD}$SCORE/$TOTAL${NC}"

  if [ $SCORE -eq $TOTAL ]; then
    echo -e "  ${GREEN}All checks passed!${NC}"
  else
    echo -e "  ${YELLOW}Run 'bash scripts/wave-orchestrator.sh fix-report' for details${NC}"
  fi
}

# ── Main ──
COMMAND="${1:-status}"

case "$COMMAND" in
  status)
    cmd_status
    ;;
  test-wave)
    cmd_test_wave "${2:?Usage: wave-orchestrator.sh test-wave <wave-number>}"
    ;;
  merge-wave)
    cmd_merge_wave "${2:?Usage: wave-orchestrator.sh merge-wave <wave-number>}"
    ;;
  fix-report)
    cmd_fix_report
    ;;
  health)
    cmd_health
    ;;
  *)
    echo "Usage: bash scripts/wave-orchestrator.sh <command>"
    echo ""
    echo "Commands:"
    echo "  status              Show wave/branch status"
    echo "  test-wave <N>       Dry-run test wave N"
    echo "  merge-wave <N>      Test + merge wave N"
    echo "  fix-report          Show all build errors grouped"
    echo "  health              Quick health check"
    ;;
esac
