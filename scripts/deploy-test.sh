#!/bin/bash
# ============================================================
# deploy-test.sh — Build, deploy to Docker, and smoke test
# Usage: bash scripts/deploy-test.sh [--local | --remote <host>]
#
# --local:  Build and test locally with docker compose
# --remote: SSH to droplet, pull, rebuild, test
#
# This replaces the manual: stop frontend, stop backend,
# pull, build, start, check, start, check cycle.
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

MODE="${1:---local}"
REMOTE_HOST="${2:-}"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   AssetView — Deploy & Smoke Test        ║${NC}"
echo -e "${CYAN}║   Mode: $MODE${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Helper: smoke test endpoints ──
smoke_test() {
  local BASE_URL="$1"
  local PASS=0
  local FAIL=0

  echo -e "\n${CYAN}Running smoke tests against $BASE_URL${NC}"

  endpoints=(
    "/api/v1/platforms"
    "/api/v1/platforms/1/systems"
    "/api/v1/search?q=pump"
    "/api/v1/registers/equipment"
  )

  for ep in "${endpoints[@]}"; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$ep" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      echo -e "  ${GREEN}$HTTP_CODE${NC}  $ep"
      ((PASS++))
    elif [ "$HTTP_CODE" = "000" ]; then
      echo -e "  ${RED}ERR${NC}  $ep (connection refused)"
      ((FAIL++))
    else
      echo -e "  ${YELLOW}$HTTP_CODE${NC}  $ep"
      ((FAIL++))
    fi
  done

  # Test frontend serves
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}$HTTP_CODE${NC}  / (frontend)"
    ((PASS++))
  else
    echo -e "  ${RED}$HTTP_CODE${NC}  / (frontend)"
    ((FAIL++))
  fi

  echo ""
  echo -e "  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"

  if [ $FAIL -gt 0 ]; then
    return 1
  fi
  return 0
}

if [ "$MODE" = "--local" ]; then
  # ── Local Docker deploy ──
  echo -e "${CYAN}[1/4] Building frontend...${NC}"
  cd "$REPO_ROOT/frontend"
  npm install --silent 2>/dev/null
  VITE_API_URL=/api/v1 npm run build 2>&1 | tail -3

  echo -e "\n${CYAN}[2/4] Copying build to backend/public...${NC}"
  rm -rf "$REPO_ROOT/backend/public/assets"
  cp -r "$REPO_ROOT/frontend/dist/"* "$REPO_ROOT/backend/public/"
  echo -e "  ${GREEN}Done${NC}"

  echo -e "\n${CYAN}[3/4] Starting services with Docker Compose...${NC}"
  cd "$REPO_ROOT"
  docker compose -f docker-compose.prod.yml down 2>/dev/null || true
  docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -5

  echo -e "\n${CYAN}[4/4] Waiting for services (10s)...${NC}"
  sleep 10

  APP_PORT=$(grep APP_PORT .env 2>/dev/null | cut -d= -f2 || echo "3080")
  APP_PORT=${APP_PORT:-3080}

  if smoke_test "http://localhost:$APP_PORT"; then
    echo -e "\n${GREEN}Deploy SUCCESS${NC}"
  else
    echo -e "\n${RED}Deploy has issues — check logs:${NC}"
    echo "  docker compose -f docker-compose.prod.yml logs --tail=50"
  fi

elif [ "$MODE" = "--remote" ]; then
  # ── Remote droplet deploy ──
  if [ -z "$REMOTE_HOST" ]; then
    echo "Usage: bash scripts/deploy-test.sh --remote <user@host>"
    exit 1
  fi

  echo -e "${CYAN}Deploying to $REMOTE_HOST...${NC}"
  ssh "$REMOTE_HOST" bash -s <<'REMOTE_SCRIPT'
    set -e
    cd ~/PID_assetview || cd ~/assetview || { echo "Project dir not found"; exit 1; }

    echo "Pulling latest..."
    git pull origin main

    echo "Rebuilding..."
    docker compose -f docker-compose.prod.yml down
    docker compose -f docker-compose.prod.yml up -d --build

    echo "Waiting for services..."
    sleep 15

    echo "Services started."
REMOTE_SCRIPT

  echo -e "\n${CYAN}Running remote smoke tests...${NC}"
  # Extract just the host part for curl
  REMOTE_IP=$(echo "$REMOTE_HOST" | sed 's/.*@//')
  APP_PORT="${3:-3080}"

  if smoke_test "http://$REMOTE_IP:$APP_PORT"; then
    echo -e "\n${GREEN}Remote deploy SUCCESS${NC}"
  else
    echo -e "\n${YELLOW}Some endpoints failed — SSH in to check:${NC}"
    echo "  ssh $REMOTE_HOST"
    echo "  docker compose -f docker-compose.prod.yml logs --tail=50"
  fi

elif [ "$MODE" = "--dev" ]; then
  # ── Local dev mode (no Docker) ──
  echo -e "${CYAN}[1/3] Building frontend...${NC}"
  cd "$REPO_ROOT/frontend"
  npm install --silent 2>/dev/null
  if npm run build 2>&1 | tail -3; then
    echo -e "  ${GREEN}Frontend build PASSED${NC}"
  else
    echo -e "  ${RED}Frontend build FAILED${NC}"
    exit 1
  fi

  echo -e "\n${CYAN}[2/3] Running backend tests...${NC}"
  cd "$REPO_ROOT/backend"
  npm install --silent 2>/dev/null
  npx prisma generate --no-hints 2>/dev/null || true
  npm test 2>&1 | tail -10 || echo -e "  ${YELLOW}(Some tests may need running DB)${NC}"

  echo -e "\n${CYAN}[3/3] Quick sanity check...${NC}"
  echo -e "  ${GREEN}Build artifacts exist:${NC}"
  ls -la "$REPO_ROOT/frontend/dist/index.html" 2>/dev/null && echo "  index.html OK" || echo "  index.html MISSING"
  ls "$REPO_ROOT/frontend/dist/assets/"*.js 2>/dev/null | head -3 && echo "  JS bundles OK" || echo "  JS bundles MISSING"

  echo -e "\n${GREEN}Dev build complete${NC}"
fi
