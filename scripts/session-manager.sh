#!/bin/bash
# ============================================================
# session-manager.sh — Manage session lifecycle & memory
# Usage: bash scripts/session-manager.sh <command>
#
# Commands:
#   start     Run before starting a Claude session (health check + briefing)
#   end       Run after ending a session (record what happened)
#   compact   Generate COMPACT.md for context recovery
#   briefing  Generate briefing without recording anything
#   history   Show session history
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STATE_FILE="$REPO_ROOT/SESSION_STATE.md"
COMPACT_FILE="$REPO_ROOT/COMPACT.md"
SESSION_LOG="$REPO_ROOT/.claude/.session-log"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

cmd_start() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║   AssetView — Session Start                   ║${NC}"
  echo -e "${CYAN}║   $(date '+%Y-%m-%d %H:%M')                              ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
  echo ""

  # Git state
  echo -e "${BOLD}Git State:${NC}"
  echo "  Branch: $(git branch --show-current)"
  echo "  Last commit: $(git log --oneline -1)"
  DIRTY=$(git status --porcelain | wc -l)
  if [ "$DIRTY" -gt 0 ]; then
    echo -e "  Working tree: ${YELLOW}DIRTY ($DIRTY files)${NC}"
  else
    echo -e "  Working tree: ${GREEN}CLEAN${NC}"
  fi
  echo ""

  # Health check
  echo -e "${BOLD}Health Check:${NC}"

  # Frontend build
  echo -ne "  Frontend build... "
  cd "$REPO_ROOT/frontend"
  npm install --silent 2>/dev/null
  BUILD_OUT=$(npm run build 2>&1)
  if echo "$BUILD_OUT" | grep -q "built in"; then
    echo -e "${GREEN}PASS${NC}"
    FRONTEND_OK=true
  else
    ERROR_COUNT=$(echo "$BUILD_OUT" | grep -c "error" 2>/dev/null || echo "?")
    echo -e "${RED}FAIL ($ERROR_COUNT errors)${NC}"
    FRONTEND_OK=false
  fi

  # Backend syntax
  cd "$REPO_ROOT/backend"
  echo -ne "  Backend syntax... "
  if node -c src/server.js 2>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
  else
    echo -e "${RED}FAIL${NC}"
  fi

  echo ""

  # Blocking issues from SESSION_STATE
  if [ -f "$STATE_FILE" ]; then
    echo -e "${BOLD}From SESSION_STATE.md:${NC}"
    # Extract "What Is Broken" section
    BROKEN=$(sed -n '/## What Is Broken/,/## /p' "$STATE_FILE" | head -20 | grep "^-" || echo "  (none recorded)")
    echo "$BROKEN" | head -5
    echo ""
  fi

  # Decisions
  if [ -f "$STATE_FILE" ]; then
    echo -e "${BOLD}Decisions (DO NOT re-debate):${NC}"
    sed -n '/## Decisions Already Made/,/## /p' "$STATE_FILE" | grep "^[0-9]" | head -5
    echo ""
  fi

  # Suggested next action
  echo -e "${BOLD}Suggested First Action:${NC}"
  if [ "$FRONTEND_OK" = false ]; then
    echo -e "  ${YELLOW}Fix frontend build errors first.${NC}"
    echo "  Run: bash scripts/wave-orchestrator.sh fix-report"
  else
    echo -e "  ${GREEN}Build is passing. Check SESSION_STATE.md for next task.${NC}"
  fi

  echo ""
  echo -e "${CYAN}Paste this as your first message to Claude:${NC}"
  echo '  "Read SESSION_STATE.md and CLAUDE.md first. Then [your task]."'
  echo ""
}

cmd_end() {
  echo ""
  echo -e "${BOLD}Session End — Recording State${NC}"
  echo ""

  # Get session summary
  read -p "What did you accomplish? (1-2 sentences): " SUMMARY
  read -p "Any new issues discovered? (or 'none'): " ISSUES
  read -p "What should the next session do? (1 sentence): " NEXT

  SESSION_NUM=$(grep -c "### Session" "$STATE_FILE" 2>/dev/null || echo "0")
  SESSION_NUM=$((SESSION_NUM + 1))

  # Append to SESSION_STATE.md
  cat >> "$STATE_FILE" <<EOF

### Session $SESSION_NUM — $(date '+%Y-%m-%d %H:%M')
- **Goal**: $SUMMARY
- **Issues**: $ISSUES
- **Next session should**: $NEXT
EOF

  # Run compact generation
  cmd_compact

  # Commit state
  git add "$STATE_FILE" "$COMPACT_FILE" 2>/dev/null
  git commit -m "session: update state after session $SESSION_NUM" 2>/dev/null || echo "  (nothing to commit)"

  echo ""
  echo -e "${GREEN}Session state recorded.${NC}"
}

cmd_compact() {
  echo -e "${BOLD}Generating COMPACT.md...${NC}"

  # Build status
  cd "$REPO_ROOT/frontend"
  npm install --silent 2>/dev/null
  BUILD_OUT=$(npm run build 2>&1)
  if echo "$BUILD_OUT" | grep -q "built in"; then
    BUILD_STATUS="PASSING"
    BUILD_ERRORS=""
  else
    BUILD_STATUS="FAILING"
    BUILD_ERRORS=$(echo "$BUILD_OUT" | grep -E "error|Error" | head -10)
  fi

  cd "$REPO_ROOT"

  cat > "$COMPACT_FILE" <<EOF
# COMPACT.md — Context Recovery for AssetView
> Auto-generated: $(date -Iseconds)
> Paste this into Claude when it starts forgetting instructions.

## Project
AssetView — Oil & gas P&ID visualization platform (React 18 + Fastify + PostgreSQL)

## Current State
- **Branch**: $(git branch --show-current)
- **Last commit**: $(git log --oneline -1)
- **Frontend build**: $BUILD_STATUS
$BUILD_ERRORS

## Critical Rules (non-negotiable)
1. All colors from constants.js/theme.js — ZERO hardcoded hex
2. API calls through useApi.js hooks — no direct fetch()
3. Lines BELONG to systems, APPEAR on P&IDs (junction tables)
4. Cross-refs at 65% opacity with system color border
5. Dark mode default. P&ID canvas = light (#F5F7F7 via CANVAS_BG)
6. React Flow (@xyflow/react), Three.js, ELK.js — decisions FINAL

## Key Files
- frontend/src/data/constants.js — SC, CC, COL, M3, EC, CANVAS_BG
- frontend/src/lib/theme.js — md(), systemColor(), critColor(), alpha()
- frontend/src/hooks/useApi.js — React Query hooks
- frontend/src/App.jsx — main app, view switching
- SESSION_STATE.md — session history & state

## Available Automation
- \`bash scripts/wave-orchestrator.sh health\` — quick health check
- \`bash scripts/wave-orchestrator.sh fix-report\` — build errors grouped
- \`bash scripts/deploy-test.sh --dev\` — full build+test cycle
- \`bash scripts/deploy-test.sh --local\` — Docker deploy + smoke test

## What Was Merged (V1-V9)
V1(topology DB), V2(digital index), V4(React Flow canvas), V5(ELK layout),
V6(semantic zoom), V7(Three.js 3D), V8(selection bus 2D↔3D), V9(tag documents), C3(API wiring)

## Decisions (DO NOT re-debate)
React Flow, Three.js, ELK.js, Fastify, Prisma, Tailwind, pg_trgm, wave-based agents
EOF

  echo -e "  ${GREEN}COMPACT.md generated${NC}"
}

cmd_briefing() {
  cmd_start
}

cmd_history() {
  echo -e "${BOLD}Session History:${NC}"
  echo ""

  if [ -f "$STATE_FILE" ]; then
    grep -A3 "### Session" "$STATE_FILE" || echo "  No sessions recorded yet"
  fi

  echo ""

  if [ -f "$SESSION_LOG" ]; then
    echo -e "${BOLD}Quick Log:${NC}"
    tail -20 "$SESSION_LOG"
  fi
}

# ── Main ──
COMMAND="${1:-start}"

case "$COMMAND" in
  start)    cmd_start ;;
  end)      cmd_end ;;
  compact)  cmd_compact ;;
  briefing) cmd_briefing ;;
  history)  cmd_history ;;
  *)
    echo "Usage: bash scripts/session-manager.sh <command>"
    echo "  start     Health check + briefing (run before session)"
    echo "  end       Record what happened (run after session)"
    echo "  compact   Generate COMPACT.md for context recovery"
    echo "  briefing  Same as start"
    echo "  history   Show session history"
    ;;
esac
