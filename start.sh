#!/bin/bash
# ============================================================
# AssetView — One-command startup (DB + Backend + Frontend)
# Usage: bash start.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   AssetView — Starting Services      ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# -------------------------------------------------------
# 1. Start PostgreSQL
# -------------------------------------------------------
echo "[1/4] Starting PostgreSQL..."

if pg_isready -q 2>/dev/null; then
  echo "  ✓ PostgreSQL already running"
else
  PG_STARTED=false

  # Try pg_ctlcluster (works in Codespaces where node user has pg access)
  for ver in 17 16 15 14; do
    if pg_ctlcluster $ver main start 2>/dev/null; then
      PG_STARTED=true
      echo "  ✓ Started PostgreSQL $ver"
      break
    fi
    # Fallback: try with sudo if available without password
    if sudo -n pg_ctlcluster $ver main start 2>/dev/null; then
      PG_STARTED=true
      echo "  ✓ Started PostgreSQL $ver (sudo)"
      break
    fi
  done

  if [ "$PG_STARTED" = false ]; then
    # Try pg_ctl directly with the data directory
    for ver in 17 16 15 14; do
      PGDATA="/var/lib/postgresql/$ver/main"
      PGBIN="/usr/lib/postgresql/$ver/bin"
      if [ -d "$PGDATA" ] && [ -x "$PGBIN/pg_ctl" ]; then
        "$PGBIN/pg_ctl" -D "$PGDATA" -l /tmp/pg.log start 2>/dev/null && PG_STARTED=true
        break
      fi
    done
  fi

  if [ "$PG_STARTED" = false ]; then
    # Last resort: service command
    service postgresql start 2>/dev/null && PG_STARTED=true
    if [ "$PG_STARTED" = false ]; then
      sudo -n service postgresql start 2>/dev/null && PG_STARTED=true
    fi
  fi

  if [ "$PG_STARTED" = false ]; then
    echo "  ✗ Could not start PostgreSQL. Try manually:"
    echo "    sudo pg_ctlcluster 17 main start"
    exit 1
  fi

  echo "  Waiting for PostgreSQL..."
  for i in $(seq 1 15); do
    if pg_isready -q 2>/dev/null; then
      echo "  ✓ PostgreSQL is ready"
      break
    fi
    sleep 1
  done

  if ! pg_isready -q 2>/dev/null; then
    echo "  ✗ PostgreSQL not responding after 15s"
    exit 1
  fi
fi

# -------------------------------------------------------
# 2. Ensure database exists and has data
# -------------------------------------------------------
echo "[2/4] Checking database..."

# Fix pg_hba.conf auth to trust (Codespaces may reset on restart)
PG_VERSION=$(pg_lsclusters -h 2>/dev/null | head -1 | awk '{print $1}')
if [ -n "$PG_VERSION" ]; then
  PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
  if [ -f "$PG_HBA" ] && [ -w "$PG_HBA" ]; then
    sed -i 's/scram-sha-256/trust/g; s/peer/trust/g; s/md5/trust/g' "$PG_HBA" 2>/dev/null
    psql -U postgres -c "SELECT pg_reload_conf();" >/dev/null 2>&1
  elif [ -f "$PG_HBA" ]; then
    sudo -n sed -i 's/scram-sha-256/trust/g; s/peer/trust/g; s/md5/trust/g' "$PG_HBA" 2>/dev/null
    sudo -n -u postgres psql -c "SELECT pg_reload_conf();" >/dev/null 2>&1
  fi
fi

# Create user/database — try without sudo first, then with sudo -n (non-interactive)
create_db() {
  local PSQL_CMD="$1"
  $PSQL_CMD -c "CREATE USER assetview WITH PASSWORD 'assetview' CREATEDB;" 2>/dev/null
  $PSQL_CMD -c "ALTER USER assetview WITH PASSWORD 'assetview';" 2>/dev/null
  $PSQL_CMD -c "CREATE DATABASE assetview OWNER assetview;" 2>/dev/null
}

if psql -U postgres -c "SELECT 1" >/dev/null 2>&1; then
  create_db "psql -U postgres"
elif sudo -n -u postgres psql -c "SELECT 1" >/dev/null 2>&1; then
  create_db "sudo -n -u postgres psql"
else
  echo "  Note: Cannot access postgres superuser. Assuming DB already exists."
fi

# Check if tables exist
TABLE_COUNT=$(psql -h localhost -U assetview -d assetview -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | xargs)

if [ "$TABLE_COUNT" = "" ] || [ "$TABLE_COUNT" -lt 5 ] 2>/dev/null; then
  echo "  Loading schema and seed data..."
  psql -h localhost -U assetview -d assetview -f database/schema.sql 2>/dev/null
  psql -h localhost -U assetview -d assetview -f database/seed.sql 2>/dev/null
  echo "  ✓ Database seeded"
else
  echo "  ✓ Database ready ($TABLE_COUNT tables)"
fi

# -------------------------------------------------------
# 3. Install dependencies if needed
# -------------------------------------------------------
echo "[3/4] Checking dependencies..."

if [ ! -d "backend/node_modules" ]; then
  echo "  Installing backend deps..."
  (cd backend && npm install --silent)
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "  Installing frontend deps..."
  (cd frontend && npm install --silent)
fi

if [ ! -d "node_modules" ]; then
  echo "  Installing root deps..."
  npm install --silent
fi

if [ -f "backend/prisma/schema.prisma" ] && [ ! -d "backend/node_modules/.prisma" ]; then
  echo "  Generating Prisma client..."
  (cd backend && npx prisma generate --no-hints 2>/dev/null)
fi

echo "  ✓ Dependencies ready"

# -------------------------------------------------------
# 4. Start Backend + Frontend
# -------------------------------------------------------
echo "[4/4] Starting servers..."
echo ""
echo "  ┌─────────────────────────────────────┐"
echo "  │  Backend:  http://localhost:3001     │"
echo "  │  Frontend: http://localhost:5174     │"
echo "  │                                     │"
echo "  │  Press Ctrl+C to stop all services  │"
echo "  └─────────────────────────────────────┘"
echo ""

npm run dev
