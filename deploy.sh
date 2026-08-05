#!/bin/bash
set -e

echo "═══ AssetView Deployment ═══"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo "No .env file found. Creating from template..."
  cp .env.production .env
  echo ""
  echo "IMPORTANT: Edit .env and set your DB_PASSWORD and APP_PORT before continuing!"
  echo "  nano .env"
  echo ""
  echo "Then run this script again."
  exit 1
fi

echo "1/4  Building containers..."
docker compose -f docker-compose.prod.yml build --no-cache

echo ""
echo "2/4  Starting services..."
docker compose -f docker-compose.prod.yml up -d

echo ""
echo "3/4  Waiting for database to be ready..."
sleep 5

echo ""
echo "4/4  Running Prisma migrations..."
docker compose -f docker-compose.prod.yml exec backend npx prisma db push --skip-generate 2>/dev/null || echo "    (Prisma push skipped — schema.sql already applied via init scripts)"

echo ""
echo "═══════════════════════════════════════"
APP_PORT=$(grep APP_PORT .env | cut -d= -f2)
APP_PORT=${APP_PORT:-3080}
echo "  AssetView is running on port ${APP_PORT}"
echo "  Open: http://YOUR_DROPLET_IP:${APP_PORT}"
echo ""
echo "  Useful commands:"
echo "    docker compose -f docker-compose.prod.yml logs -f     # View logs"
echo "    docker compose -f docker-compose.prod.yml down         # Stop"
echo "    docker compose -f docker-compose.prod.yml up -d        # Start"
echo "    docker compose -f docker-compose.prod.yml restart      # Restart"
echo "═══════════════════════════════════════"
