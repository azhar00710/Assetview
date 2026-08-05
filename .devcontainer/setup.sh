#!/bin/bash
# NOTE: No "set -e" — we want the container to start even if some steps fail

echo "=== AssetView Codespace Setup ==="

# -------------------------------------------------------
# 1. Install npm dependencies first (most important)
# -------------------------------------------------------
echo "[1/4] Installing npm dependencies..."

cd /workspaces/PID_assetview

echo "  Backend..."
cd backend && npm install && cd ..

echo "  Frontend..."
cd frontend && npm install && cd ..

echo "  Root (concurrently)..."
npm install

# -------------------------------------------------------
# 2. Create backend .env
# -------------------------------------------------------
echo "[2/4] Creating backend .env..."
cat > backend/.env << 'ENVFILE'
DATABASE_URL=postgresql://assetview:assetview@localhost:5432/assetview
PORT=3001
CORS_ORIGIN=*
ENVFILE

# -------------------------------------------------------
# 3. Generate Prisma client
# -------------------------------------------------------
echo "[3/4] Generating Prisma client..."
cd backend && npx prisma generate && cd ..

# -------------------------------------------------------
# 4. Install and start PostgreSQL (optional — app runs without it)
# -------------------------------------------------------
echo "[4/4] Setting up PostgreSQL..."

if command -v psql > /dev/null 2>&1; then
  echo "  PostgreSQL client already available."
else
  echo "  Installing PostgreSQL..."
  sudo apt-get update -qq 2>/dev/null
  sudo apt-get install -y -qq postgresql-15 2>/dev/null

  if [ $? -ne 0 ]; then
    echo "  WARNING: PostgreSQL install failed. You can install it manually later:"
    echo "    sudo apt-get update && sudo apt-get install -y postgresql-15"
    echo "  Continuing without database..."
  fi
fi

# Try to start PostgreSQL
if command -v pg_ctlcluster > /dev/null 2>&1; then
  echo "  Starting PostgreSQL..."
  sudo pg_ctlcluster 15 main start 2>/dev/null || \
  sudo pg_ctlcluster 16 main start 2>/dev/null || \
  sudo pg_ctlcluster 17 main start 2>/dev/null || \
  echo "  WARNING: Could not start PostgreSQL cluster."

  # Wait for PostgreSQL to be ready
  for i in $(seq 1 10); do
    if pg_isready -q 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if pg_isready -q 2>/dev/null; then
    # Set trust auth for local connections (dev environment - no password needed)
    PG_VERSION=$(pg_lsclusters -h 2>/dev/null | head -1 | awk '{print $1}')
    if [ -n "$PG_VERSION" ]; then
      PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
      if [ -f "$PG_HBA" ]; then
        echo "  Configuring trust auth for local dev..."
        sudo sed -i 's/scram-sha-256/trust/g' "$PG_HBA" 2>/dev/null
        sudo sed -i 's/peer/trust/g' "$PG_HBA" 2>/dev/null
        sudo sed -i 's/md5/trust/g' "$PG_HBA" 2>/dev/null
        sudo -u postgres psql -c "SELECT pg_reload_conf();" 2>/dev/null
      fi
    fi

    echo "  Creating database..."
    sudo -u postgres psql -c "CREATE USER assetview WITH PASSWORD 'assetview' CREATEDB;" 2>/dev/null || true
    sudo -u postgres psql -c "ALTER USER assetview WITH PASSWORD 'assetview';" 2>/dev/null || true
    sudo -u postgres psql -c "CREATE DATABASE assetview OWNER assetview;" 2>/dev/null || true

    echo "  Loading schema..."
    psql -h localhost -U assetview -d assetview -f database/schema.sql 2>/dev/null || \
      echo "  WARNING: Schema load failed (may already exist)."

    echo "  Loading seed data..."
    psql -h localhost -U assetview -d assetview -f database/seed.sql 2>/dev/null || \
      echo "  WARNING: Seed load failed (may already exist)."

    echo "  PostgreSQL is ready!"
  else
    echo "  WARNING: PostgreSQL is not responding. Database not configured."
  fi
else
  echo "  WARNING: pg_ctlcluster not found. Skipping database setup."
fi

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "  Start both servers:"
echo "    npm run dev"
echo ""
echo "  Port 5173 will auto-open in your browser."
echo "========================================="
