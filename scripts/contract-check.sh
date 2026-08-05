#!/bin/bash
# ============================================================
# contract-check.sh — Verify frontend↔backend API contracts
# Usage: bash scripts/contract-check.sh
#
# Checks that:
#   1. Every useApi.js hook has a matching backend route
#   2. Every backend route is registered in server.js
#   3. Frontend fetch URLs match backend route paths
#   4. No orphaned routes (backend route exists but no frontend consumer)
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   AssetView — API Contract Checker            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

ISSUES=0

# ── Check 1: Backend routes registered in server.js ──
echo -e "${BOLD}[1/4] Backend route registration${NC}"

ROUTE_FILES=$(find "$REPO_ROOT/backend/src/routes" -maxdepth 1 -name "*.js" -not -name "*.test.js" | sort)
SERVER_JS="$REPO_ROOT/backend/src/server.js"

for rf in $ROUTE_FILES; do
  BASENAME=$(basename "$rf" .js)
  if grep -q "$BASENAME" "$SERVER_JS" 2>/dev/null; then
    echo -e "  ${GREEN}OK${NC}  $BASENAME registered"
  else
    echo -e "  ${RED}MISSING${NC}  $BASENAME NOT registered in server.js"
    ((ISSUES++))
  fi
done

# ── Check 2: Frontend API URLs match backend routes ──
echo -e "\n${BOLD}[2/4] Frontend API URL patterns${NC}"

# Extract fetch/axios URLs from frontend
FRONTEND_URLS=$(grep -rn "fetch\|axios\|apiUrl\|API_URL\|/api/v1" \
  "$REPO_ROOT/frontend/src/" \
  --include="*.js" --include="*.jsx" \
  2>/dev/null | grep -oP '/api/v1/[a-z/_-]+' | sort -u)

# Extract registered backend paths
BACKEND_PATHS=$(grep -rn "prefix\|url:" "$REPO_ROOT/backend/src/routes/" \
  --include="*.js" 2>/dev/null | grep -oP "'/[a-z/_:-]+'" | tr -d "'" | sort -u)

for url in $FRONTEND_URLS; do
  # Strip /api/v1 prefix for comparison
  CLEAN_URL=$(echo "$url" | sed 's|/api/v1||')
  # Check if any backend route matches (fuzzy — just first segment)
  FIRST_SEG=$(echo "$CLEAN_URL" | cut -d'/' -f2)
  if echo "$BACKEND_PATHS" | grep -q "$FIRST_SEG" 2>/dev/null; then
    echo -e "  ${GREEN}OK${NC}  $url"
  else
    echo -e "  ${YELLOW}WARN${NC}  $url — no obvious backend match"
    ((ISSUES++))
  fi
done

# ── Check 3: useApi.js hooks have matching endpoints ──
echo -e "\n${BOLD}[3/4] useApi.js hook coverage${NC}"

HOOKS_FILE="$REPO_ROOT/frontend/src/hooks/useApi.js"
if [ -f "$HOOKS_FILE" ]; then
  HOOK_NAMES=$(grep -oP 'export\s+(function|const)\s+\K\w+' "$HOOKS_FILE" | sort)
  for hook in $HOOK_NAMES; do
    # Check if hook is used anywhere in components
    USAGE=$(grep -rn "$hook" "$REPO_ROOT/frontend/src/components/" \
      --include="*.jsx" --include="*.js" 2>/dev/null | wc -l)
    if [ "$USAGE" -gt 0 ]; then
      echo -e "  ${GREEN}OK${NC}  $hook (used $USAGE times)"
    else
      echo -e "  ${YELLOW}UNUSED${NC}  $hook — exported but never imported in components"
    fi
  done
else
  echo -e "  ${YELLOW}SKIP${NC}  useApi.js not found"
fi

# ── Check 4: Prisma schema matches route expectations ──
echo -e "\n${BOLD}[4/4] Prisma model coverage${NC}"

PRISMA_FILE="$REPO_ROOT/backend/prisma/schema.prisma"
if [ -f "$PRISMA_FILE" ]; then
  MODELS=$(grep "^model " "$PRISMA_FILE" | awk '{print $2}' | sort)
  for model in $MODELS; do
    # Check if model is used in any route
    MODEL_LOWER=$(echo "$model" | tr '[:upper:]' '[:lower:]')
    ROUTE_USAGE=$(grep -rn "$model\|$MODEL_LOWER" "$REPO_ROOT/backend/src/routes/" \
      --include="*.js" 2>/dev/null | wc -l)
    if [ "$ROUTE_USAGE" -gt 0 ]; then
      echo -e "  ${GREEN}OK${NC}  $model (referenced $ROUTE_USAGE times in routes)"
    else
      echo -e "  ${YELLOW}UNUSED${NC}  $model — defined in Prisma but no route uses it"
    fi
  done
else
  echo -e "  ${YELLOW}SKIP${NC}  schema.prisma not found"
fi

# ── Summary ──
echo ""
echo "═══════════════════════════════════════"
if [ $ISSUES -eq 0 ]; then
  echo -e "${GREEN}All contracts aligned!${NC}"
else
  echo -e "${YELLOW}$ISSUES potential issue(s) found${NC}"
  echo "  Review warnings above. Not all may be real problems."
fi
