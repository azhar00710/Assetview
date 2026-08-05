# Create the assetview DB + user and load all schema/migrations/seeds.
# Idempotent: safe to re-run. Requires PostgreSQL 15 already installed and running.

# psql writes NOTICE messages to stderr ("relation already exists, skipping" etc.)
# even on success. PowerShell would otherwise treat that as a terminating error
# under "Stop" preference, so we keep "Continue" and rely on real exit codes.
$ErrorActionPreference = "Continue"
# Stop psql from polluting PowerShell's $error stream with its NOTICE/WARNING lines.
$PSNativeCommandUseErrorActionPreference = $false

# Use psql from the standard install location whether or not PATH is updated yet.
$psql = "C:\Program Files\PostgreSQL\15\bin\psql.exe"
if (-not (Test-Path $psql)) {
    $psql = "psql"  # fall back to PATH
}

# Project root (parent of this scripts folder)
$projectRoot = Split-Path -Parent $PSScriptRoot
$dbDir = Join-Path $projectRoot "database"
if (-not (Test-Path $dbDir)) {
    throw "database directory not found at $dbDir"
}

$superPass = "postgres"     # set in setup-postgres-windows.ps1
$appUser   = "assetview"
$appPass   = "assetview"
$appDb     = "assetview"

function Run-PsqlSuper([string]$sql) {
    $env:PGPASSWORD = $superPass
    # Merge stderr into stdout so PowerShell never sees a "remote exception".
    $output = & $psql -U postgres -h localhost -d postgres -v ON_ERROR_STOP=0 -c $sql 2>&1
    $output | Out-String | Write-Host
}

function Run-PsqlApp([string]$file) {
    $env:PGPASSWORD = $appPass
    Write-Host "  -> $file" -ForegroundColor DarkCyan
    $rawOutput = & $psql -U $appUser -h localhost -d $appDb -v ON_ERROR_STOP=0 -f $file 2>&1
    $exit = $LASTEXITCODE
    # Filter the chatter (statement keywords, NOTICE/WARNING for already-exists)
    # so the console stays readable, but always surface real errors.
    $rawOutput |
        Out-String |
        ForEach-Object { $_ -split "(\r?\n)" } |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and $_ -notmatch '^(SET|CREATE|ALTER|INSERT|UPDATE|DROP|DO|GRANT|REVOKE|COMMENT|COPY|BEGIN|COMMIT|ANALYZE)\b' } |
        Where-Object { $_ -notmatch 'already exists, skipping' } |
        Where-Object { $_ -notmatch '^psql:.*NOTICE:' } |
        ForEach-Object {
            if ($_ -match 'ERROR|FATAL|PANIC') {
                Write-Host "     $_" -ForegroundColor Red
            } else {
                Write-Host "     $_" -ForegroundColor DarkGray
            }
        }
    if ($exit -ne 0) {
        Write-Host "     (psql exit code $exit)" -ForegroundColor Yellow
    }
}

# ── Step 1 — make sure the cluster is reachable ──
Write-Host "==> Checking PostgreSQL is reachable" -ForegroundColor Cyan
$env:PGPASSWORD = $superPass
$probe = & $psql -U postgres -h localhost -d postgres -t -A -c "SELECT version()" 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Could not connect as postgres@localhost. Is the postgresql-x64-15 service running? Output: $probe"
}
Write-Host "    OK: $probe" -ForegroundColor Green

# ── Step 2 — create role and database (idempotent) ──
Write-Host "==> Creating role '$appUser' and database '$appDb'" -ForegroundColor Cyan
Run-PsqlSuper "DO `$`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$appUser') THEN CREATE ROLE $appUser LOGIN SUPERUSER PASSWORD '$appPass'; END IF; END `$`$;"
$dbExistsRaw = & $psql -U postgres -h localhost -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$appDb'" 2>&1
$dbExists = if ($null -eq $dbExistsRaw) { '' } else { ([string]$dbExistsRaw).Trim() }
if (-not $dbExists) {
    Run-PsqlSuper "CREATE DATABASE $appDb OWNER $appUser;"
} else {
    Write-Host "    Database already exists." -ForegroundColor Yellow
}

# ── Step 3 — apply schema, migrations, seed in the same order docker-compose did ──
Write-Host "==> Applying schema + migrations" -ForegroundColor Cyan

$ordered = @(
    "schema.sql",
    "migration_annotations.sql",
    "migration_v2.1_storage_versioning.sql",
    "migration_v3_hierarchy.sql",
    "migration_approval_status.sql",
    "migration_tag_document.sql",
    "migration_topology.sql",
    "migration_ocr.sql",
    "migration_pid_annotation_module.sql",
    "migration_ocr_v2.sql",
    "migration_line_engineering_data.sql",
    "migrations\003_topology_edges.sql",
    "migration_tag_dictionary.sql",
    "migration_ocr_ai_analysis.sql",
    "migration_tag_dictionary_extended_codes.sql",
    "migration_tag_analysis.sql",
    "migrations\009_ocr_zone_profile.sql",
    "migrations\010_ocr_feedback_learning.sql",
    "migrations\012_ai_batch_detection.sql",
    "migrations\013_pnid_line_dimensions.sql",
    "migrations\014_grounding_dino_config.sql",
    "seed.sql",
    "seed_topology_edges.sql"
)

foreach ($rel in $ordered) {
    $abs = Join-Path $dbDir $rel
    if (-not (Test-Path $abs)) {
        Write-Host "  -! Skipping (not found): $rel" -ForegroundColor Yellow
        continue
    }
    Run-PsqlApp $abs
}

# ── Step 4 — also apply any newer migrations not in the docker list ──
Write-Host "==> Applying remaining migrations under database\migrations" -ForegroundColor Cyan
$applied = $ordered | ForEach-Object { $_ -replace '\\', '/' }
Get-ChildItem (Join-Path $dbDir "migrations") -Filter "*.sql" | Sort-Object Name | ForEach-Object {
    $relPath = "migrations/" + $_.Name
    if ($applied -notcontains $relPath) {
        Run-PsqlApp $_.FullName
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " AssetView database is ready." -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host " DATABASE_URL=postgresql://$appUser`:$appPass@localhost:5432/$appDb"
Write-Host ""
Write-Host " Next steps:"
Write-Host "   1. Copy backend/.env.example to backend/.env"
Write-Host "      and add your ANTHROPIC_API_KEY."
Write-Host ""
Write-Host "   2. Install Node deps (one time):"
Write-Host "      npm run install:all"
Write-Host ""
Write-Host "   3. Start backend + frontend:"
Write-Host "      npm run dev"
Write-Host ""
Write-Host "   Open http://localhost:5173 in your browser."
