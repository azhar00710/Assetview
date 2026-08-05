# AssetView — one-command startup on Windows (DB + Backend + Frontend)
# Usage: .\start.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   AssetView — Starting Services      ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 1. PostgreSQL (auto-start Docker container + wait until ready)
Write-Host "[1/4] PostgreSQL..." -ForegroundColor Yellow
node "$Root\backend\scripts\ensureDatabase.mjs"
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "  ✓ PostgreSQL ready (localhost:5432)" -ForegroundColor Green

# 2. Backend .env
Write-Host "[2/4] Environment..." -ForegroundColor Yellow
if (-not (Test-Path "$Root\backend\.env")) {
    Copy-Item "$Root\backend\.env.example" "$Root\backend\.env"
    Write-Host "  ✓ Created backend/.env from .env.example" -ForegroundColor Green
} else {
    Write-Host "  ✓ backend/.env exists" -ForegroundColor Green
}

# 3. Dependencies
Write-Host "[3/4] Dependencies..." -ForegroundColor Yellow
@("node_modules", "backend\node_modules", "frontend\node_modules") | ForEach-Object {
    if (-not (Test-Path "$Root\$_")) {
        Write-Host "  Installing $_..."
        if ($_ -eq "node_modules") { npm install --silent }
        elseif ($_ -match "backend") { Push-Location backend; npm install --silent; Pop-Location }
        else { Push-Location frontend; npm install --silent; Pop-Location }
    }
}
Write-Host "  ✓ Dependencies ready" -ForegroundColor Green

# 4. Stop stale dev servers (common cause of port 3001 conflicts)
Write-Host "[4/5] Clearing stale dev servers..." -ForegroundColor Yellow
Push-Location "$Root\backend"
node scripts/stopDev.mjs 2>$null
Pop-Location
Write-Host "  ✓ Port 3001 cleared" -ForegroundColor Green

# 5. Start backend + frontend
Write-Host "[5/5] Starting servers..." -ForegroundColor Yellow

Write-Host ""
Write-Host "  ┌─────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "  │  Backend:  http://localhost:3001     │" -ForegroundColor Cyan
Write-Host "  │  Frontend: http://localhost:5174     │" -ForegroundColor Cyan
Write-Host "  │  Press Ctrl+C to stop all services   │" -ForegroundColor Cyan
Write-Host "  └─────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""

npm run dev
