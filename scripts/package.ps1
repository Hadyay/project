# Makes the one file to carry to another PC: dist\RealEstateERP-<date>.zip,
# holding a fresh database backup and the project without anything tied to
# this machine (virtualenv, node_modules, build output, local .env files).
#
# On the other PC: unzip, double-click setup.bat, then start.bat.

. (Join-Path $PSScriptRoot "common.ps1")

Step "Backing up the database"
& (Join-Path $PSScriptRoot "backup-db.ps1")
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) { Fail "The database backup failed." }

Step "Collecting the files"
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$name = "RealEstateERP-$stamp"
$staging = Join-Path $env:ProgramData "RealEstateERP\$name"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null

# Tied to this PC, rebuilt by setup.bat, or raw legacy material the running
# system does not need.
$excludeDirs = @(".venv", "venv", "node_modules", ".next", "__pycache__", ".pytest_cache",
    "legacy_data", "logs", "dist", ".git", ".claude")
$excludeFiles = @(".env", ".env.local", ".env.bak", "*.pyc", "*.log", "*.zip", "pids.txt", "*.tsbuildinfo", "acc.json")
& robocopy $Root $staging /E /XD @excludeDirs /XF @excludeFiles /NFL /NDL /NJH /NJS /NP | Out-Null
# robocopy: 0-7 are success codes, 8+ are failures.
if ($LASTEXITCODE -ge 8) { Fail "Copying the project failed (robocopy code $LASTEXITCODE)." }
$global:LASTEXITCODE = 0

foreach ($required in @("setup.bat", "start.bat", "stop.bat", "scripts\setup.ps1", "backend\requirements.txt",
        "frontend\package-lock.json", "db_backup\realestate_erp_full.sql")) {
    if (-not (Test-Path (Join-Path $staging $required))) { Fail "Missing from the package: $required" }
}
Ok "Files collected."

Step "Creating the zip"
$dist = Join-Path $Root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist "$name.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
# tar.exe ships with Windows 10+ and writes a standard zip; Compress-Archive in
# PowerShell 5.1 is slow and trips over long paths.
Push-Location (Split-Path $staging)
try {
    & tar.exe -a -c -f $zip $name
    if ($LASTEXITCODE -ne 0) { Fail "Creating the zip failed." }
} finally { Pop-Location }
Remove-Item -Recurse -Force $staging

$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ""
Write-Host "Package ready: $zip ($size MB)" -ForegroundColor Green
Write-Host "It contains the client's ledger and user accounts - hand it over privately."
Write-Host "On the other PC: unzip it, double-click setup.bat, then start.bat."
