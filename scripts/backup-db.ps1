# Dumps the ERP database to db_backup\<db>.sql so it can be restored on
# another machine by scripts\setup.ps1.
#
# The data does not live in the project folder: it lives in Postgres (on the
# development PC, inside the Docker volume). Copying the folder alone moves no
# ledger, no users, no letterhead. Run this first, then copy the folder.
#
# Works against either Postgres:
#   - the Docker container project-db-1, if it is running
#   - otherwise the server named by DATABASE_URL in backend\.env (needs pg_dump)
#
# The dump is plain SQL without owners or grants, so it restores into any
# Postgres 14+ under whatever role setup.ps1 creates.

param(
    [string]$DbName = "",
    [string]$Container = "project-db-1",
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root "db_backup" }
New-Item -ItemType Directory -Force $OutDir | Out-Null

function Read-DatabaseUrl {
    $envFile = Join-Path $root "backend\.env"
    if (-not (Test-Path $envFile)) { return $null }
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -Last 1
    if (-not $line) { return $null }
    $url = ($line -split '=', 2)[1].Trim()
    if ($url -notmatch '^postgresql(\+\w+)?://([^:]+):([^@]*)@([^:/]+):(\d+)/(.+)$') {
        throw "Cannot parse DATABASE_URL in backend\.env: $url"
    }
    return @{ User = $Matches[2]; Password = $Matches[3]; Host = $Matches[4]; Port = $Matches[5]; Db = $Matches[6] }
}

function Find-PgTool([string]$name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$name.exe" -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
    throw "$name not found. Add PostgreSQL's bin folder to PATH."
}

$url = Read-DatabaseUrl
if (-not $DbName) { $DbName = if ($url) { $url.Db } else { "realestate_erp_full" } }
$outFile = Join-Path $OutDir "$DbName.sql"
$dumpArgs = @("--no-owner", "--no-privileges", "--encoding=UTF8", "--quote-all-identifiers")

$useDocker = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $state = & docker inspect -f "{{.State.Running}}" $Container 2>$null
    $ErrorActionPreference = $eap
    if ($LASTEXITCODE -eq 0 -and $state -eq "true") { $useDocker = $true }
}

if ($useDocker) {
    Write-Host "Dumping '$DbName' from Docker container $Container ..."
    # pg_dump writes inside the container and docker cp copies the bytes out:
    # piping through PowerShell would re-encode the Arabic text as UTF-16.
    & docker exec $Container pg_dump -U erp -d $DbName @dumpArgs -f /tmp/erp_backup.sql
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed inside the container." }
    & docker cp "${Container}:/tmp/erp_backup.sql" $outFile
    if ($LASTEXITCODE -ne 0) { throw "docker cp failed." }
    & docker exec $Container rm -f /tmp/erp_backup.sql
} else {
    if (-not $url) { throw "Docker container $Container is not running and backend\.env has no DATABASE_URL." }
    $pgDump = Find-PgTool "pg_dump"
    Write-Host "Dumping '$DbName' from $($url.Host):$($url.Port) ..."
    $env:PGPASSWORD = $url.Password
    & $pgDump -h $url.Host -p $url.Port -U $url.User -d $DbName @dumpArgs -f $outFile
    Remove-Item Env:PGPASSWORD
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed." }
}

$size = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host ""
Write-Host "Backup written: $outFile ($size MB)" -ForegroundColor Green
Write-Host "It contains the client's real ledger and user accounts - keep it private."
