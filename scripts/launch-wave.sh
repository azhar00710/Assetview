#!/bin/bash
# ============================================================
# launch-wave.sh — Launch parallel Claude Code agents for a wave
# Usage: bash scripts/launch-wave.sh <wave-config-file>
#
# This is the KEY automation piece: instead of manually starting
# each session, this script launches N parallel Claude Code
# headless sessions, each in its own worktree, with specific prompts.
#
# Prerequisites:
#   - Claude Code CLI installed (claude command available)
#   - tmux installed (for parallel pane view)
#   - Git worktree support
#
# Config file format (YAML-like, one agent per block):
#   See examples in scripts/waves/ directory
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

CONFIG_FILE="${1:-}"
MODE="${2:---tmux}"  # --tmux (visual) or --headless (CI)

if [ -z "$CONFIG_FILE" ]; then
  echo "Usage: bash scripts/launch-wave.sh <wave-config> [--tmux|--headless]"
  echo ""
  echo "Wave configs available:"
  ls scripts/waves/*.sh 2>/dev/null || echo "  No wave configs found. Create one in scripts/waves/"
  echo ""
  echo "Example: bash scripts/launch-wave.sh scripts/waves/wave-fix.sh"
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Config file not found: $CONFIG_FILE"
  exit 1
fi

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   AssetView — Wave Launcher                   ║${NC}"
echo -e "${CYAN}║   Config: $(basename $CONFIG_FILE)${NC}"
echo -e "${CYAN}║   Mode: $MODE${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Source the wave config (defines AGENTS array)
source "$CONFIG_FILE"

# Verify AGENTS array exists
if [ ${#AGENTS[@]} -eq 0 ]; then
  echo "No agents defined in config file"
  exit 1
fi

echo -e "${BOLD}Agents to launch: ${#AGENTS[@]}${NC}"
echo ""

if [ "$MODE" = "--tmux" ]; then
  # ── TMUX MODE: Visual parallel panes ──
  SESSION_NAME="assetview-wave-$(date +%s)"

  # Create tmux session with first agent
  FIRST=true
  PANE_IDX=0

  for agent_def in "${AGENTS[@]}"; do
    # Parse agent definition: "name|branch|prompt"
    IFS='|' read -r AGENT_NAME AGENT_BRANCH AGENT_PROMPT <<< "$agent_def"

    echo -e "  Launching ${YELLOW}$AGENT_NAME${NC} on ${CYAN}$AGENT_BRANCH${NC}"

    # Build the claude command
    CLAUDE_CMD="claude --worktree $AGENT_BRANCH -p \"$AGENT_PROMPT\" --allowedTools 'Read,Edit,Write,Bash,Grep,Glob' --max-turns 50"

    if [ "$FIRST" = true ]; then
      tmux new-session -d -s "$SESSION_NAME" -n "$AGENT_NAME" "$CLAUDE_CMD; read -p 'Agent done. Press enter.'"
      FIRST=false
    else
      tmux split-window -t "$SESSION_NAME" "$CLAUDE_CMD; read -p 'Agent done. Press enter.'"
      tmux select-layout -t "$SESSION_NAME" tiled
    fi

    ((PANE_IDX++))
  done

  echo ""
  echo -e "${GREEN}All agents launched in tmux session: $SESSION_NAME${NC}"
  echo -e "  Attach: ${BOLD}tmux attach -t $SESSION_NAME${NC}"
  echo -e "  Kill:   ${BOLD}tmux kill-session -t $SESSION_NAME${NC}"
  echo ""

  # Auto-attach
  tmux attach -t "$SESSION_NAME"

elif [ "$MODE" = "--headless" ]; then
  # ── HEADLESS MODE: Background parallel execution ──
  PIDS=()
  LOG_DIR="$REPO_ROOT/scripts/.wave-logs"
  mkdir -p "$LOG_DIR"

  for agent_def in "${AGENTS[@]}"; do
    IFS='|' read -r AGENT_NAME AGENT_BRANCH AGENT_PROMPT <<< "$agent_def"

    LOG_FILE="$LOG_DIR/${AGENT_NAME}-$(date +%Y%m%d-%H%M%S).log"
    echo -e "  Launching ${YELLOW}$AGENT_NAME${NC} → $LOG_FILE"

    # Run claude headless in background
    claude --worktree "$AGENT_BRANCH" \
      -p "$AGENT_PROMPT" \
      --allowedTools "Read,Edit,Write,Bash,Grep,Glob" \
      --max-turns 50 \
      --output-format json \
      > "$LOG_FILE" 2>&1 &

    PIDS+=($!)
  done

  echo ""
  echo -e "${BOLD}Waiting for all agents to complete...${NC}"
  echo -e "  Monitor: ${CYAN}tail -f $LOG_DIR/*.log${NC}"
  echo ""

  # Wait for all and report
  FAILED=0
  for i in "${!PIDS[@]}"; do
    if wait "${PIDS[$i]}"; then
      IFS='|' read -r AGENT_NAME _ _ <<< "${AGENTS[$i]}"
      echo -e "  ${GREEN}DONE${NC}  $AGENT_NAME"
    else
      IFS='|' read -r AGENT_NAME _ _ <<< "${AGENTS[$i]}"
      echo -e "  ${RED}FAIL${NC}  $AGENT_NAME"
      ((FAILED++))
    fi
  done

  echo ""
  if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All agents completed successfully!${NC}"
    echo "  Next: bash scripts/merge-wave.sh <branches...>"
  else
    echo -e "${RED}$FAILED agent(s) failed. Check logs in $LOG_DIR${NC}"
  fi

elif [ "$MODE" = "--dry-run" ]; then
  # ── DRY RUN: Show what would be launched ──
  echo -e "${BOLD}Dry run — agents that would launch:${NC}"
  echo ""
  for agent_def in "${AGENTS[@]}"; do
    IFS='|' read -r AGENT_NAME AGENT_BRANCH AGENT_PROMPT <<< "$agent_def"
    echo -e "  ${YELLOW}$AGENT_NAME${NC}"
    echo -e "    Branch: $AGENT_BRANCH"
    echo -e "    Prompt: ${AGENT_PROMPT:0:100}..."
    echo ""
  done
fi
