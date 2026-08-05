#!/bin/bash
echo "Resetting database..."
docker compose down -v
docker compose up -d postgres
sleep 3
echo "Database reset complete."
