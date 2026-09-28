# One-time installation on a Windows PC. Run setup.bat (double-click).
#
#   1. checks Python 3.11-3.13, Node.js 18.18+, PostgreSQL 14+ - and offers to
#      install whatever is missing with winget
#   2. creates the login role 'erp' and the database 'realestate_erp_full', and
#      restores db_backup\realestate_erp_full.sql into it (made by package.bat
#      or backup-db.bat on the old PC); without the backup it stops (-Empty overrides)
#   3. writes backend\.env and frontend\.env.local for this machine
#   4. installs backend and frontend dependencies and builds the frontend
#   5. runs the migrations, checks the database answers, and puts a shortcut
#      on the desktop
#
# Everything is logged to logs\setup-<date>.log - send that file if it fails.
# Safe to re-run: an existing database is kept unless -Force is given, which
# DROPS it and restores the backup over it.

param(
    [string]$PgHost = "localhost",
    [int]$PgPort = 5432,
    [string]$PgSuperUser = "postgres",
    [string]$DbName = "realestate_erp_full",
    [string]$DbUser = "erp",
    [string]$DbPassword = "erp_dev_password",
    [string]$Backup = "",
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 3000,
    [switch]$SkipInstall,
    [switch]$NoShortcut,
    [switch]$Force,
    # Only for a brand-new office with no history: install without the data backup.
    [switch]$Empty
)

. (Join-Path $PSScriptRoot "common.ps1")
if (-not $Backup) { $Backup = Join-Path $Root "db_backup\$DbName.sql" }
Start-Transcript -Path (Join-Path $Logs ("setup-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))) | Out-Null

function Sql-Literal([string]$s) { return "'" + ($s -replace "'", "''") + "'" }

# Runs one SQL command as the superuser and returns its single-value output.
function Invoke-SuperSql([string]$sql, [string]$db = "postgres") {
    $out = & $script:psql -h $PgHost -p $PgPort -U $PgSuperUser -d $db -v ON_ERROR_STOP=1 -tAq -c $sql
    if ($LASTEXITCODE -ne 0) { Fail "psql failed running: $sql" }
    return ($out | Out-String).Trim()
}

function Install-WithWinget([string]$id, [string]$label, [string[]]$extra = @()) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
    if (-not (Ask-YesNo "    $label is missing. Install it now with winget?")) { return $false }
    & winget install -e --id $id --accept-package-agreements --accept-source-agreements @extra
    Update-SessionPath
    return $true
}

Write-Host "Real Estate ERP - setup" -ForegroundColor White
Write-Host "Folder: $Root"

# ---------------------------------------------------------------- prerequisites
Step "Checking prerequisites"

$py = Find-Python
if (-not $py -and -not $SkipInstall) {
    if (Install-WithWinget "Python.Python.3.12" "Python 3.12") { $py = Find-Python }
}
if (-not $py) {
    Fail "Python 3.11, 3.12 or 3.13 is required." `
        "Install Python 3.12 from https://www.python.org/downloads/ - tick 'Add python.exe to PATH' - then run setup.bat again."
}
Ok ("Python: " + ($py -join " "))

$node = Get-NodeVersion
if ((-not $node -or $node -lt [version]"18.18") -and -not $SkipInstall) {
    if (Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS") { $node = Get-NodeVersion }
}
if (-not $node -or $node -lt [version]"18.18") {
    Fail "Node.js 18.18 or newer is required." `
        "Install the LTS version from https://nodejs.org/ then run setup.bat again."
}
Ok "Node.js: $node"

$script:psql = Find-PgTool "psql"
if (-not $psql) {
    Write-Host ""
    Warn "PostgreSQL is not installed."
    if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Ask-YesNo "    Install PostgreSQL 16 now with winget?")) {
        $sec = Read-Host "    Choose a password for the PostgreSQL superuser 'postgres' (write it down)" -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
        if (-not $plain) { Fail "An empty password is not allowed." }
        & winget install -e --id PostgreSQL.PostgreSQL.16 --accept-package-agreements --accept-source-agreements `
            --override "--mode unattended --unattendedmodeui minimal --superpassword `"$plain`" --serverport $PgPort"
        Update-SessionPath
        $script:psql = Find-PgTool "psql"
        if ($psql) { $env:PGPASSWORD = $plain }
    }
}
if (-not $psql) {
    Fail "PostgreSQL 14 or newer is required." `
        "Install it from https://www.postgresql.org/download/windows/ (remember the 'postgres' password), then run setup.bat again."
}
Ok "psql: $psql"
Confirm-PostgresService

# ---------------------------------------------------------------- database
Step "Connecting to PostgreSQL on ${PgHost}:$PgPort"
if (-not $env:PGPASSWORD) {
    $sec = Read-Host "    Password of the PostgreSQL superuser '$PgSuperUser'" -AsSecureString
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$probe = Invoke-Quiet { & $psql -h $PgHost -p $PgPort -U $PgSuperUser -d postgres -tAc "SHOW server_version_num" }
if ($LASTEXITCODE -ne 0) {
    Fail "Cannot log in to PostgreSQL as '$PgSuperUser' on ${PgHost}:$PgPort." `
        "Check the password (it is the one chosen when PostgreSQL was installed) and that the server runs on port $PgPort (use -PgPort otherwise)."
}
if ([int]"$probe".Trim() -lt 140000) { Fail "PostgreSQL $probe is too old - version 14 or newer is required." }
Ok "Connected (PostgreSQL $(Invoke-SuperSql 'SHOW server_version'))"

Step "Creating role '$DbUser' and database '$DbName'"
if ((Invoke-SuperSql "SELECT 1 FROM pg_roles WHERE rolname = $(Sql-Literal $DbUser)") -eq "1") {
    Invoke-SuperSql "ALTER ROLE `"$DbUser`" WITH LOGIN PASSWORD $(Sql-Literal $DbPassword)" | Out-Null
    Ok "Role exists - password set."
} else {
    Invoke-SuperSql "CREATE ROLE `"$DbUser`" WITH LOGIN PASSWORD $(Sql-Literal $DbPassword)" | Out-Null
    Ok "Role created."
}

$dbExists = ((Invoke-SuperSql "SELECT 1 FROM pg_database WHERE datname = $(Sql-Literal $DbName)") -eq "1")
# Decide before touching anything: -Force without a backup must not drop the
# data that is there and then discover it has nothing to restore.
if ((-not $dbExists -or $Force) -and -not (Test-Path $Backup) -and -not $Empty) {
    Fail "The data backup is missing: $Backup" `
        "Make the package with package.bat on the old PC (it includes the data), unzip it here and run setup.bat again. Nothing was changed."
}

if ($dbExists -and $Force) {
    # -Force replaces the data that is there. Save it first, as a dated backup
    # the app lists (Settings > Backups), so restoring the wrong file can be
    # undone. If it cannot be saved, stop before anything is dropped.
    Step "Saving the current data before replacing it"
    $pgDump = Join-Path (Split-Path $psql) "pg_dump.exe"
    $keepName = "erp_backup_{0:yyyy-MM-dd_HHmmss}_manual.sql" -f (Get-Date)
    # Dumped under ProgramData first, like the restore file: the project path
    # may carry an Arabic user name that pg_dump cannot open.
    $keepTmp = Join-Path $env:ProgramData "RealEstateERP\$keepName"
    New-Item -ItemType Directory -Force (Split-Path $keepTmp) | Out-Null
    $superPassword = $env:PGPASSWORD
    $env:PGPASSWORD = $DbPassword
    & $pgDump -h $PgHost -p $PgPort -U $DbUser -d $DbName --no-owner --no-privileges --encoding=UTF8 --quote-all-identifiers -f $keepTmp
    $code = $LASTEXITCODE
    $env:PGPASSWORD = $superPassword
    $complete = (Test-Path $keepTmp) -and (Select-String -Path $keepTmp -Pattern "PostgreSQL database dump complete" -SimpleMatch -Quiet)
    if ($code -ne 0 -or -not $complete) {
        Remove-Item $keepTmp -ErrorAction SilentlyContinue
        Fail "Could not save the current data before replacing it - nothing was changed." `
            "Check the pg_dump message above (pg_dump must be as new as the PostgreSQL server)."
    }
    $keepDir = Join-Path $Root "db_backup"
    New-Item -ItemType Directory -Force $keepDir | Out-Null
    Move-Item $keepTmp (Join-Path $keepDir $keepName) -Force
    Ok "Current data saved: db_backup\$keepName"
}

$restore = $true
if ($dbExists) {
    if ($Force) {
        Warn "Dropping the existing database (-Force)."
        Invoke-SuperSql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $(Sql-Literal $DbName) AND pid <> pg_backend_pid()" | Out-Null
        Invoke-SuperSql "DROP DATABASE `"$DbName`"" | Out-Null
    } else {
        Ok "Database already exists - kept as it is (setup.bat -Force replaces it from the backup)."
        $restore = $false
    }
}
if ($restore) {
    # template0 + UTF8 whatever the Windows locale is: the data is Arabic.
    Invoke-SuperSql "CREATE DATABASE `"$DbName`" OWNER `"$DbUser`" ENCODING 'UTF8' TEMPLATE template0" | Out-Null
    Ok "Database created."
}

$legacyChart = $true
if ($restore) {
    if (Test-Path $Backup) {
        Step "Restoring the backup ($([math]::Round((Get-Item $Backup).Length / 1MB, 2)) MB)"
        # pg_dump from the Aug 2025 patch releases on (16.10, 17.6, ...) wraps
        # the dump in \restrict / \unrestrict, which older psql rejects. They
        # only guard against dumps from untrusted servers; this one is ours.
        # Written under ProgramData: psql cannot open a path with Arabic in it,
        # and the user's TEMP folder carries their (possibly Arabic) name.
        $sqlDir = Join-Path $env:ProgramData "RealEstateERP"
        New-Item -ItemType Directory -Force $sqlDir | Out-Null
        $sqlFile = Join-Path $sqlDir "restore.sql"
        $writer = New-Object IO.StreamWriter($sqlFile, $false, (New-Object Text.UTF8Encoding $false))
        try {
            foreach ($line in [IO.File]::ReadLines((Resolve-Path $Backup).Path)) {
                if ($line -notmatch '^\\(un)?restrict\s') { $writer.WriteLine($line) }
            }
        } finally { $writer.Close() }

        # Restored as the app role so it owns every table, type and view.
        $superPassword = $env:PGPASSWORD
        $env:PGPASSWORD = $DbPassword
        & $psql -h $PgHost -p $PgPort -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -q --single-transaction -o NUL -f $sqlFile
        $code = $LASTEXITCODE
        $env:PGPASSWORD = $superPassword
        Remove-Item $sqlFile -ErrorAction SilentlyContinue
        if ($code -ne 0) {
            # Drop the empty database, or a plain re-run would keep it.
            Invoke-SuperSql "DROP DATABASE `"$DbName`"" | Out-Null
            Fail "Restoring the backup failed - see the psql error above. Nothing was kept."
        }
        Ok "Restored."
    } else {
        # Only reachable with -Empty: the check above stops a missing backup
        # before anything is created or dropped.
        Warn "No backup - building an EMPTY database (starter chart + admin user), as -Empty asked."
        $legacyChart = $false
    }
} else {
    $legacyChart = ((Invoke-SuperSql "SELECT 1 FROM accounts WHERE code = '411'" $DbName) -eq "1")
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

# ---------------------------------------------------------------- config
Step "Writing configuration"
$envFile = Join-Path $Backend ".env"
$jwtSecret = (Read-DotEnv $envFile)["JWT_SECRET"]
if (Test-Path $envFile) { Copy-Item $envFile "$envFile.bak" -Force }
if (-not $jwtSecret -or $jwtSecret -eq "change_me_dev_secret") {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwtSecret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
}
# 3100 is allowed too, so start.bat can fall back to it when 3000 is taken.
$origins = @($FrontendPort, 3100) | Select-Object -Unique | ForEach-Object { "http://localhost:$_,http://127.0.0.1:$_" }
$lines = @(
    "# Written by scripts\setup.ps1 for this machine.",
    "DATABASE_URL=postgresql+psycopg://${DbUser}:${DbPassword}@${PgHost}:${PgPort}/${DbName}",
    "JWT_SECRET=$jwtSecret",
    "BACKEND_CORS_ORIGINS=$($origins -join ',')",
    "BACKEND_PORT=$BackendPort",
    "FRONTEND_PORT=$FrontendPort"
)
if ($legacyChart) {
    $lines += @(
        "",
        "# The database carries the imported legacy chart (Lebanese general plan).",
        "RECEIVABLE_PARENT_CODE=411",
        "SALES_REVENUE_CODE=7010002",
        "DEFAULT_CASH_CODE=5300002",
        "RENT_REVENUE_CODE=5120"
    )
}
# The daily backup (Settings > Backups) runs pg_dump from the API; point it at
# the one beside this psql. The API also searches for one if this is missing.
$pgDumpExe = Join-Path (Split-Path $psql) "pg_dump.exe"
if (Test-Path $pgDumpExe) {
    $lines += @("", "# Daily database backups into db_backup\ (Settings > Backups).", "BACKUP_PG_DUMP=$pgDumpExe")
}
Write-Utf8File $envFile $lines
Write-Utf8File (Join-Path $Frontend ".env.local") @("NEXT_PUBLIC_API_URL=http://localhost:$BackendPort")
Ok "backend\.env and frontend\.env.local written."

# ---------------------------------------------------------------- backend
if (-not $SkipInstall) {
    Step "Installing the backend (Python packages)"
    $venvOk = $false
    if (Test-Path $VenvPy) {
        Invoke-Quiet { & $VenvPy -c "import fastapi, sqlalchemy, psycopg" } | Out-Null
        $venvOk = ($LASTEXITCODE -eq 0)
    }
    if (-not $venvOk) {
        # A venv copied from another PC points at that PC's Python - rebuild it.
        $rest = @($py | Select-Object -Skip 1)
        & $py[0] @rest -m venv --clear (Join-Path $Backend ".venv")
        if ($LASTEXITCODE -ne 0) { Fail "Could not create the Python virtual environment." }
    }
    & $VenvPy -m pip install --disable-pip-version-check -q -r (Join-Path $Backend "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        Fail "Installing the Python packages failed." "Check the internet connection, then run setup.bat again."
    }
    Ok "Backend installed."
}
if (-not (Test-Path $VenvPy)) { Fail "backend\.venv is missing - run setup.bat without -SkipInstall." }

Step "Database migrations"
Push-Location $Backend
try {
    & $VenvPy -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { Fail "Database migration failed." }
    if (-not $legacyChart) {
        & $VenvPy -m app.seed.run
        if ($LASTEXITCODE -ne 0) { Fail "Seeding the empty database failed." }
    }
} finally { Pop-Location }
$db = Test-Database
if (-not $db.Ok) { Fail "The backend cannot read the database: $($db.Output)" }
Ok "Database answers: $($db.Output) accounts."

# ---------------------------------------------------------------- frontend
if (-not $SkipInstall) {
    Step "Installing the frontend (npm packages)"
    Push-Location $Frontend
    try {
        & npm ci --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE -ne 0) {
            Warn "npm ci failed - retrying with npm install."
            & npm install --no-audit --no-fund --loglevel=error
            if ($LASTEXITCODE -ne 0) {
                Fail "Installing the npm packages failed." "Check the internet connection, then run setup.bat again."
            }
        }
    } finally { Pop-Location }
    Ok "Frontend installed."
}

Step "Building the frontend (1-3 minutes)"
$owner = Get-PortOwner $FrontendPort
if ($owner -and $owner.Name -eq "node") {
    # A running Next server serves from .next; rebuilding under it breaks it.
    Fail "The app is running (port $FrontendPort). Run stop.bat first, then setup.bat again."
}
Push-Location $Frontend
try {
    $nextDir = Join-Path $Frontend ".next"
    if (Test-Path $nextDir) { Remove-Item -Recurse -Force $nextDir }
    & npm run build --silent
    if ($LASTEXITCODE -ne 0) { Fail "The frontend build failed - see the messages above." }
} finally { Pop-Location }
Ok "Frontend built."

# ---------------------------------------------------------------- shortcut
if (-not $NoShortcut) {
    try {
        $desktop = [Environment]::GetFolderPath("Desktop")
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut((Join-Path $desktop "Real Estate ERP.lnk"))
        $link.TargetPath = Join-Path $Root "start.bat"
        $link.WorkingDirectory = $Root
        $link.WindowStyle = 7
        $link.Description = "Start the Real Estate ERP"
        $link.Save()
        Ok "Desktop shortcut 'Real Estate ERP' created."
    } catch {
        Warn "Could not create the desktop shortcut ($($_.Exception.Message)) - use start.bat."
    }
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Start the system with start.bat (or the desktop shortcut)."
if ($legacyChart) {
    Write-Host "Sign in with the same users as on the old PC." -ForegroundColor Yellow
} else {
    Write-Host "Sign in as admin / admin123 and change the password under Settings." -ForegroundColor Yellow
}
try { Stop-Transcript | Out-Null } catch { }
