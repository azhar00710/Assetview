# Initialize PostgreSQL 15 cluster + service for AssetView local development.
# RUN AS ADMINISTRATOR. One-time setup.

$ErrorActionPreference = "Stop"
$pgRoot   = "C:\Program Files\PostgreSQL\15"
$pgBin    = "$pgRoot\bin"
$pgData   = "$pgRoot\data"
$service  = "postgresql-x64-15"
$pgUser   = "postgres"
$pgPass   = "postgres"   # local dev only — change later if you care

if (-not (Test-Path "$pgBin\initdb.exe")) {
    throw "PostgreSQL not found at $pgBin. Re-run the EnterpriseDB installer first."
}

Write-Host "==> Step 1/5: Stopping any existing service" -ForegroundColor Cyan
$svc = Get-Service $service -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne "Stopped") {
    Stop-Service $service -Force
    Start-Sleep -Seconds 3
}

Write-Host "==> Step 2/5: Initializing data cluster at $pgData" -ForegroundColor Cyan
if ((Get-ChildItem $pgData -ErrorAction SilentlyContinue).Count -gt 0) {
    Write-Host "    Data dir not empty. Wiping and re-initializing." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "$pgData\*" -ErrorAction SilentlyContinue
}

# initdb cannot write under Program Files as a non-Admin user. We pass the
# superuser password via a file because --pwfile is the only non-interactive way.
$pwFile = "$env:TEMP\pg_super_pw.txt"
[System.IO.File]::WriteAllText($pwFile, $pgPass, (New-Object System.Text.UTF8Encoding $false))

# Grant NetworkService (the service account) write access on the data dir
icacls $pgData /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /T | Out-Null

# Run initdb as the service account so the resulting files are readable by it
& "$pgBin\initdb.exe" `
    --pgdata="$pgData" `
    --username=$pgUser `
    --pwfile=$pwFile `
    --auth-host=md5 `
    --auth-local=md5 `
    --encoding=UTF8 `
    --locale=C
if ($LASTEXITCODE -ne 0) { throw "initdb failed with exit code $LASTEXITCODE" }
Remove-Item $pwFile -Force -ErrorAction SilentlyContinue

Write-Host "==> Step 3/5: Re-applying NTFS permissions on data dir" -ForegroundColor Cyan
icacls $pgData /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /T | Out-Null

Write-Host "==> Step 4/5: Registering Windows service" -ForegroundColor Cyan
# Service may already exist from the installer; remove and recreate cleanly.
$existing = Get-Service $service -ErrorAction SilentlyContinue
if ($existing) {
    & "$pgBin\pg_ctl.exe" unregister -N $service 2>$null | Out-Null
    Start-Sleep -Seconds 2
}
& "$pgBin\pg_ctl.exe" register `
    -N $service `
    -D "$pgData" `
    -S auto `
    -w
if ($LASTEXITCODE -ne 0) { throw "pg_ctl register failed with exit code $LASTEXITCODE" }

Write-Host "==> Step 5/5: Starting the service" -ForegroundColor Cyan
Start-Service $service
Start-Sleep -Seconds 5
$svc = Get-Service $service
if ($svc.Status -ne "Running") {
    throw "Service did not start. Status: $($svc.Status). Check Event Viewer or $pgData\log\"
}

Write-Host ""
Write-Host "==> Adding $pgBin to system PATH" -ForegroundColor Cyan
$currentPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($currentPath -notlike "*$pgBin*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$pgBin", "Machine")
    Write-Host "    Added. Open a NEW PowerShell window for psql to be on PATH." -ForegroundColor Yellow
} else {
    Write-Host "    Already on PATH." -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " PostgreSQL 15 setup complete." -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host " Service:    $service (Running, auto-start)"
Write-Host " Host:       localhost:5432"
Write-Host " Superuser:  $pgUser"
Write-Host " Password:   $pgPass"
Write-Host " Data dir:   $pgData"
Write-Host ""
Write-Host " Next: open a NEW PowerShell window and run:"
Write-Host "   cd C:\Users\Admin\PID_assetview"
Write-Host "   .\scripts\setup-assetview-db.ps1"
