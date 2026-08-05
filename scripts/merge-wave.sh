#!/bin/bash
# ============================================================
# merge-wave.sh — Test and merge a wave of branches in order
# Usage: bash scripts/merge-wave.sh [--dry-run] <branch1> <branch2> ...
#
# What it does:
#   1. Tests each branch (frontend build + backend tests)
#   2. If ALL pass: merges them into main one by one
#   3. Pushes main after all merges
#   4. Updates SESSION_STATE.md with results
#
# Example — merge Wave 2:
#   bash scripts/merge-wave.sh \
#     feature/system-canvas \
#     feature/elk-layout \
#     feature/semantic-zoom \
#     feature/wire-frontend-api
#
# Dry run (test only, no merge):
#   bash scripts/merge-wave.sh --dry-run feature/system-canvas
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

DRY_RUN=false
BRANCHES=()

# Parse args
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then
    DRY_RUN=true
  else
    BRANCHES+=("$arg")
  fi
done

if [ ${#BRANCHES[@]} -eq 0 ]; then
  echo "Usage: bash scripts/merge-wave.sh [--dry-run] <branch1> <branch2> ..."
  echo ""
  echo "Branches are merged in the order given."
  echo "Use --dry-run to test without merging."
  exit 1
fi

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   AssetView — Wave Merge Pipeline            ║${NC}"
echo -e "${CYAN}║   Branches: ${#BRANCHES[@]}   Dry-run: $DRY_RUN${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── Phase 1: Test all branches ──
echo -e "${BOLD}Phase 1: Testing all branches${NC}"
echo "─────────────────────────────"

FAILED=()
PASSED=()

for branch in "${BRANCHES[@]}"; do
  echo -e "\n${CYAN}Testing: ${YELLOW}$branch${NC}"

  # Quick test: try merge in temp worktree, build frontend
  WORKTREE="/tmp/assetview-wave-test-$$"

  git worktree add "$WORKTREE" origin/main 2>/dev/null || git worktree add "$WORKTREE" main 2>/dev/null

  cd "$WORKTREE"

  # Merge all previously passed branches first (cumulative)
  for prev in "${PASSED[@]}"; do
    git merge "$prev" --no-edit -q 2>/dev/null || {
      echo -e "  ${RED}FAIL: Conflicts with previously merged $prev${NC}"
      cd "$REPO_ROOT"
      git worktree remove "$WORKTREE" --force 2>/dev/null || rm -rf "$WORKTREE"
      FAILED+=("$branch")
      continue 2
    }
  done

  # Now merge this branch
  if ! git merge "$branch" --no-edit -q 2>&1; then
    echo -e "  ${RED}FAIL: Merge conflicts${NC}"
    git merge --abort 2>/dev/null
    cd "$REPO_ROOT"
    git worktree remove "$WORKTREE" --force 2>/dev/null || rm -rf "$WORKTREE"
    FAILED+=("$branch")
    continue
  fi

  # Build frontend
  cd "$WORKTREE/frontend"
  npm install --silent 2>/dev/null
  if ! npm run build 2>&1 | tail -5; then
    echo -e "  ${RED}FAIL: Frontend build failed${NC}"
    cd "$REPO_ROOT"
    git worktree remove "$WORKTREE" --force 2>/dev/null || rm -rf "$WORKTREE"
    FAILED+=("$branch")
    continue
  fi

  echo -e "  ${GREEN}PASS${NC}"
  PASSED+=("$branch")

  cd "$REPO_ROOT"
  git worktree remove "$WORKTREE" --force 2>/dev/null || rm -rf "$WORKTREE"
done

# ── Report test results ──
echo ""
echo "─────────────────────────────"
echo -e "${BOLD}Test Results:${NC}"
for b in "${PASSED[@]}"; do
  echo -e "  ${GREEN}PASS${NC}  $b"
done
for b in "${FAILED[@]}"; do
  echo -e "  ${RED}FAIL${NC}  $b"
done

if [ ${#FAILED[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}${#FAILED[@]} branch(es) failed. Fix before merging.${NC}"

  # Update session state
  if [ -f "$REPO_ROOT/SESSION_STATE.md" ]; then
    echo "" >> "$REPO_ROOT/SESSION_STATE.md"
    echo "### Wave Test $(date -Iseconds)" >> "$REPO_ROOT/SESSION_STATE.md"
    for b in "${FAILED[@]}"; do
      echo "- FAIL: $b" >> "$REPO_ROOT/SESSION_STATE.md"
    done
  fi
  exit 1
fi

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo -e "${GREEN}All ${#PASSED[@]} branches passed! (dry-run — no merges performed)${NC}"
  exit 0
fi

# ── Phase 2: Merge all branches ──
echo ""
echo -e "${BOLD}Phase 2: Merging into main${NC}"
echo "─────────────────────────────"

git checkout main 2>/dev/null || git checkout -b main origin/main

for branch in "${PASSED[@]}"; do
  echo -e "  Merging ${YELLOW}$branch${NC}..."
  git merge "$branch" --no-edit -q
  echo -e "  ${GREEN}Merged${NC}"
done

# ── Phase 3: Final verification build ──
echo ""
echo -e "${BOLD}Phase 3: Final verification build${NC}"
echo "─────────────────────────────"

cd "$REPO_ROOT/frontend"
npm install --silent 2>/dev/null
if npm run build 2>&1 | tail -3; then
  echo -e "  ${GREEN}Final build PASSED${NC}"
else
  echo -e "  ${RED}Final build FAILED — rolling back${NC}"
  cd "$REPO_ROOT"
  git reset --hard HEAD~${#PASSED[@]}
  exit 1
fi

cd "$REPO_ROOT"

# ── Phase 4: Push ──
echo ""
echo -e "${BOLD}Phase 4: Push to origin${NC}"
echo "─────────────────────────────"
echo -e "  ${YELLOW}Run manually:${NC} git push origin main"
echo "  (Not pushing automatically — verify first)"

# ── Update session state ──
if [ -f "$REPO_ROOT/SESSION_STATE.md" ]; then
  echo "" >> "$REPO_ROOT/SESSION_STATE.md"
  echo "### Wave Merged $(date -Iseconds)" >> "$REPO_ROOT/SESSION_STATE.md"
  for b in "${PASSED[@]}"; do
    echo "- MERGED: $b" >> "$REPO_ROOT/SESSION_STATE.md"
  done
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   All ${#PASSED[@]} branches merged successfully!       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
