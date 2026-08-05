#!/bin/bash
echo "Setting up AssetView database..."
docker compose up -d postgres
sleep 3
echo "Database ready. Schema and seed data loaded via docker-entrypoint."
echo "Connect: docker compose exec postgres psql -U assetview assetview"
