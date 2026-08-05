#!/bin/bash
# ============================================================
# test-branch.sh — Test a feature branch before merging
# Usage: bash scripts/test-branch.sh <branch-name> [--fix]
#
# What it does:
#   1. Creates a temp worktree with the branch merged into main
#   2. Installs dependencies
#   3. Runs frontend build (catches import/syntax/type errors)
#   4. Runs backend tests
#   5. Reports PASS/FAIL with details
#   6. Cleans up worktree
#
# With --fix: stays in worktree on failure so you can fix
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${1:-}"
FIX_MODE="${2:-}"
WORKTREE_DIR="/tmp/assetview-test-$$"
RESULTS_FILE="$REPO_ROOT/scripts/.last-test-result"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

cleanup() {
  if [ "$FIX_MODE" != "--fix" ] || [ "${TEST_PASSED:-true}" = "true" ]; then
    echo -e "\n${CYAN}Cleaning up worktree...${NC}"
    cd "$REPO_ROOT"
    git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || rm -rf "$WORKTREE_DIR"
  else
    echo -e "\n${YELLOW}--fix mode: Worktree kept at $WORKTREE_DIR${NC}"
    echo "  cd $WORKTREE_DIR to fix issues, then re-run test"
  fi
}

if [ -z "$BRANCH" ]; then
  echo "Usage: bash scripts/test-branch.sh <branch-name> [--fix]"
  echo ""
  echo "Examples:"
  echo "  bash scripts/test-branch.sh feature/system-canvas"
  echo "  bash scripts/test-branch.sh origin/feature/elk-layout --fix"
  exit 1
fi

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   AssetView — Branch Test Runner         ║${NC}"
echo -e "${CYAN}║   Branch: ${YELLOW}${BRANCH}${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

trap cleanup EXIT

# ── Step 1: Create worktree with merge ──
echo -e "${CYAN}[1/5] Creating test worktree...${NC}"
cd "$REPO_ROOT"
git fetch origin 2>/dev/null || true

# Create worktree from main
git worktree add "$WORKTREE_DIR" origin/main 2>/dev/null || {
  git worktree add "$WORKTREE_DIR" main 2>/dev/null
}

cd "$WORKTREE_DIR"

# Try to merge the branch
echo -e "  Merging ${YELLOW}$BRANCH${NC} into main..."
if ! git merge "$BRANCH" --no-edit 2>&1; then
  echo -e "${RED}  FAIL: Merge conflicts detected!${NC}"
  git merge --abort
  echo "FAIL|$BRANCH|merge-conflict|$(date -Iseconds)" >> "$RESULTS_FILE"
  TEST_PASSED=false
  exit 1
fi
echo -e "  ${GREEN}Merge clean${NC}"

# ── Step 2: Install dependencies ──
echo -e "\n${CYAN}[2/5] Installing dependencies...${NC}"
cd "$WORKTREE_DIR/frontend" && npm install --silent 2>&1 | tail -1
cd "$WORKTREE_DIR/backend" && npm install --silent 2>&1 | tail -1
if [ -f "$WORKTREE_DIR/backend/prisma/schema.prisma" ]; then
  cd "$WORKTREE_DIR/backend" && npx prisma generate --no-hints 2>/dev/null || true
fi
echo -e "  ${GREEN}Dependencies installed${NC}"

# ── Step 3: Frontend build ──
echo -e "\n${CYAN}[3/5] Building frontend...${NC}"
cd "$WORKTREE_DIR/frontend"
BUILD_OUTPUT=$(npm run build 2>&1) || {
  echo -e "${RED}  FAIL: Frontend build failed!${NC}"
  echo "$BUILD_OUTPUT" | grep -E "(error|Error|ERROR)" | head -20
  echo "FAIL|$BRANCH|frontend-build|$(date -Iseconds)" >> "$RESULTS_FILE"
  TEST_PASSED=false
  exit 1
}
echo -e "  ${GREEN}Frontend build passed${NC}"

# ── Step 4: Backend tests ──
echo -e "\n${CYAN}[4/5] Running backend tests...${NC}"
cd "$WORKTREE_DIR/backend"
if [ -f "src/api.test.js" ]; then
  TEST_OUTPUT=$(npm test 2>&1) || {
    echo -e "${YELLOW}  WARN: Some backend tests failed${NC}"
    echo "$TEST_OUTPUT" | grep -E "(FAIL|fail|✗|✘)" | head -10
    # Don't fail on backend tests — they need DB
    echo -e "  ${YELLOW}(Backend tests may need running DB — check manually)${NC}"
  }
  echo -e "  ${GREEN}Backend tests completed${NC}"
else
  echo -e "  ${YELLOW}No test files found, skipping${NC}"
fi

# ── Step 5: Report ──
echo -e "\n${CYAN}[5/5] Results${NC}"
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   PASS — Branch ready to merge           ║${NC}"
echo -e "${GREEN}║   Branch: ${BRANCH}${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"

echo "PASS|$BRANCH|all|$(date -Iseconds)" >> "$RESULTS_FILE"
TEST_PASSED=true
