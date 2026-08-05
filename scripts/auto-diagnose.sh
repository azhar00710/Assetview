#!/bin/bash
# ============================================================
# auto-diagnose.sh — Intelligent error classification & fix suggestions
# Usage: bash scripts/auto-diagnose.sh
#
# Goes beyond "what's broken" to tell you WHY and HOW to fix it.
# Groups errors by root cause, suggests fix order, and estimates
# how many fixes are actually needed (many errors cascade from one root).
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   AssetView — Intelligent Error Diagnostics   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── Run build and capture output ──
echo -e "${BOLD}Running frontend build...${NC}"
cd "$REPO_ROOT/frontend"
npm install --silent 2>/dev/null
BUILD_OUTPUT=$(npm run build 2>&1) || true

if echo "$BUILD_OUTPUT" | grep -q "built in"; then
  echo -e "\n${GREEN}Frontend build PASSED — no errors!${NC}"
  echo ""
  echo -e "${BOLD}Running additional checks...${NC}"

  # Even if build passes, check for warnings
  WARNINGS=$(echo "$BUILD_OUTPUT" | grep -i "warning" | wc -l)
  if [ "$WARNINGS" -gt 0 ]; then
    echo -e "  ${YELLOW}$WARNINGS warning(s) found${NC}"
    echo "$BUILD_OUTPUT" | grep -i "warning" | head -5
  fi
  exit 0
fi

echo ""
echo -e "${RED}Build FAILED — analyzing errors...${NC}"
echo ""

# Save for reference
echo "$BUILD_OUTPUT" > /tmp/assetview-build-output.log

# ── Classify errors ──

# Category 1: Missing imports/modules
MISSING_IMPORTS=$(echo "$BUILD_OUTPUT" | grep -oP "Could not resolve ['\"]([^'\"]+)['\"]" | sort -u || true)
MISSING_IMPORT_COUNT=$(echo "$MISSING_IMPORTS" | grep -c "." 2>/dev/null || echo "0")

# Category 2: Undefined exports
UNDEFINED_EXPORTS=$(echo "$BUILD_OUTPUT" | grep -oP "does not provide an export named ['\"]([^'\"]+)['\"]" | sort -u || true)
UNDEFINED_EXPORT_COUNT=$(echo "$UNDEFINED_EXPORTS" | grep -c "." 2>/dev/null || echo "0")

# Category 3: Syntax errors
SYNTAX_ERRORS=$(echo "$BUILD_OUTPUT" | grep -B2 "SyntaxError\|Unexpected token\|Parse error" | sort -u || true)
SYNTAX_ERROR_COUNT=$(echo "$SYNTAX_ERRORS" | grep -c "." 2>/dev/null || echo "0")

# Category 4: Type errors (JSX, props)
TYPE_ERRORS=$(echo "$BUILD_OUTPUT" | grep -oP "is not defined\|is not a function\|Cannot read properties" | sort -u || true)
TYPE_ERROR_COUNT=$(echo "$TYPE_ERRORS" | grep -c "." 2>/dev/null || echo "0")

# Category 5: CSS/Tailwind errors
CSS_ERRORS=$(echo "$BUILD_OUTPUT" | grep -i "css\|postcss\|tailwind" | sort -u || true)
CSS_ERROR_COUNT=$(echo "$CSS_ERRORS" | grep -c "." 2>/dev/null || echo "0")

# ── Extract affected files ──
AFFECTED_FILES=$(echo "$BUILD_OUTPUT" | grep -oP "src/[^\s:]+\.(js|jsx|ts|tsx)" | sort -u || true)

# ── Report ──
echo -e "${BOLD}Error Classification:${NC}"
echo "═══════════════════════════════════════"

if [ "$MISSING_IMPORT_COUNT" -gt 0 ]; then
  echo -e "\n${MAGENTA}[Missing Imports/Modules] — $MISSING_IMPORT_COUNT${NC}"
  echo -e "${DIM}  Root cause: Agent branch had a file that wasn't merged, or dependency not installed${NC}"
  echo -e "${DIM}  Fix: Check if module exists, install missing npm packages, or fix import path${NC}"
  echo "$MISSING_IMPORTS" | head -10 | while read -r line; do
    echo -e "  ${RED}${NC} $line"
  done
fi

if [ "$UNDEFINED_EXPORT_COUNT" -gt 0 ]; then
  echo -e "\n${MAGENTA}[Undefined Exports] — $UNDEFINED_EXPORT_COUNT${NC}"
  echo -e "${DIM}  Root cause: Import expects named export that file doesn't have${NC}"
  echo -e "${DIM}  Fix: Add missing export to source file, or fix import name${NC}"
  echo "$UNDEFINED_EXPORTS" | head -10 | while read -r line; do
    echo -e "  ${RED}${NC} $line"
  done
fi

if [ "$SYNTAX_ERROR_COUNT" -gt 0 ]; then
  echo -e "\n${MAGENTA}[Syntax Errors] — $SYNTAX_ERROR_COUNT${NC}"
  echo -e "${DIM}  Root cause: Merge conflict left invalid syntax, or incomplete code from agent${NC}"
  echo -e "${DIM}  Fix: Open file, find the error line, fix JSX/JS syntax${NC}"
  echo "$SYNTAX_ERRORS" | head -10 | while read -r line; do
    echo -e "  ${RED}${NC} $line"
  done
fi

if [ "$CSS_ERROR_COUNT" -gt 0 ]; then
  echo -e "\n${MAGENTA}[CSS/Tailwind Errors] — $CSS_ERROR_COUNT${NC}"
  echo -e "${DIM}  Root cause: Invalid Tailwind class or PostCSS config issue${NC}"
  echo -e "${DIM}  Fix: Check tailwind.config.js, verify class names are valid${NC}"
  echo "$CSS_ERRORS" | head -5 | while read -r line; do
    echo -e "  ${RED}${NC} $line"
  done
fi

# ── Affected files with dependency analysis ──
echo ""
echo -e "${BOLD}Affected Files (fix in this order):${NC}"
echo "═══════════════════════════════════════"

# Categorize by depth (fix deepest dependencies first)
echo "$AFFECTED_FILES" | while read -r file; do
  [ -z "$file" ] && continue
  if echo "$file" | grep -q "hooks/"; then
    echo -e "  ${RED}1-FIX FIRST${NC}  $file"
  elif echo "$file" | grep -q "lib/"; then
    echo -e "  ${YELLOW}2-THEN${NC}       $file"
  elif echo "$file" | grep -q "data/"; then
    echo -e "  ${YELLOW}2-THEN${NC}       $file"
  elif echo "$file" | grep -q "components/"; then
    echo -e "  ${CYAN}3-THEN${NC}       $file"
  elif echo "$file" | grep -q "App.jsx"; then
    echo -e "  ${GREEN}4-LAST${NC}       $file"
  else
    echo -e "  ${DIM}?${NC}            $file"
  fi
done | sort

# ── Cascade analysis ──
echo ""
echo -e "${BOLD}Cascade Analysis:${NC}"
echo "═══════════════════════════════════════"

TOTAL_ERRORS=$(echo "$BUILD_OUTPUT" | grep -c "error" 2>/dev/null || echo "?")
ROOT_CAUSES=$((MISSING_IMPORT_COUNT + UNDEFINED_EXPORT_COUNT + SYNTAX_ERROR_COUNT))

echo -e "  Total errors reported: ${RED}$TOTAL_ERRORS${NC}"
echo -e "  Estimated root causes: ${YELLOW}$ROOT_CAUSES${NC}"
echo -e "  Cascade ratio: ~$(( TOTAL_ERRORS / (ROOT_CAUSES > 0 ? ROOT_CAUSES : 1) ))x"
echo ""
echo -e "  ${DIM}Many errors cascade from a single root cause.${NC}"
echo -e "  ${DIM}Fixing $ROOT_CAUSES root issues may resolve all $TOTAL_ERRORS errors.${NC}"

# ── Actionable steps ──
echo ""
echo -e "${BOLD}Recommended Actions:${NC}"
echo "═══════════════════════════════════════"

STEP=1
if [ "$MISSING_IMPORT_COUNT" -gt 0 ]; then
  echo -e "  ${STEP}. Fix missing imports/modules (likely from unmerged agent files)"
  ((STEP++))
fi
if [ "$UNDEFINED_EXPORT_COUNT" -gt 0 ]; then
  echo -e "  ${STEP}. Add missing exports to source files"
  ((STEP++))
fi
if [ "$SYNTAX_ERROR_COUNT" -gt 0 ]; then
  echo -e "  ${STEP}. Fix syntax errors (check for merge conflict remnants)"
  ((STEP++))
fi
echo -e "  ${STEP}. Re-run build after each fix to check cascade resolution"
((STEP++))
echo -e "  ${STEP}. When build passes, run: bash scripts/wave-orchestrator.sh health"

echo ""
echo -e "${DIM}Full build output saved to: /tmp/assetview-build-output.log${NC}"
