# Shared helpers for setup / start / stop / package. Dot-source it:
#   . (Join-Path $PSScriptRoot "common.ps1")
#
# ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI.

$ErrorActionPreference = "Stop"
$script:Root = Split-Path -Parent $PSScriptRoot
$script:Backend = Join-Path $script:Root "backend"
$script:Frontend = Join-Path $script:Root "frontend"
$script:Logs = Join-Path $script:Root "logs"
$script:VenvPy = Join-Path $script:Backend ".venv\Scripts\python.exe"
New-Item -ItemType Directory -Force $script:Logs | Out-Null

# Python must not crash printing Arabic to a cp1252 console or log file.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
# Next.js asks to send telemetry on first build; an office PC has no one to answer.
$env:NEXT_TELEMETRY_DISABLED = "1"

function Step([string]$msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok([string]$msg) { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn([string]$msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Fail([string]$msg, [string]$hint = "") {
    Write-Host ""
    Write-Host "ERROR: $msg" -ForegroundColor Red
    if ($hint) { Write-Host $hint -ForegroundColor Yellow }
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}

# Runs a native probe whose failure is an answer, not an error. In Windows
# PowerShell 5.1 redirected stderr under "Stop" would abort the whole script.
function Invoke-Quiet([scriptblock]$block) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { & $block 2>$null } finally { $ErrorActionPreference = $eap }
}

function Ask-YesNo([string]$question) {
    $answer = Read-Host "$question [Y/n]"
    return ($answer -eq "" -or $answer -match '^(y|yes)$')
}

# A program installed a moment ago is not on this session's PATH yet.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Find-PgTool([string]$name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $found = Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\$name.exe" -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

# Returns @(exe, args...) for a Python 3.11-3.13, or $null. The Microsoft
# Store "python" alias is a stub that opens the Store; it fails the version
# probe and is skipped.
function Find-Python {
    $candidates = @(@("py", "-3.12"), @("py", "-3.13"), @("py", "-3.11"), @("python"), @("python3"))
    foreach ($cand in $candidates) {
        if (-not (Get-Command $cand[0] -ErrorAction SilentlyContinue)) { continue }
        $rest = @($cand | Select-Object -Skip 1)
        $v = Invoke-Quiet { & $cand[0] @rest -c "import sys; print('%d.%d' % sys.version_info[:2])" }
        if ($LASTEXITCODE -eq 0 -and "$v".Trim() -match '^3\.(11|12|13)$') { return $cand }
    }
    return $null
}

function Get-NodeVersion {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $null }
    $v = Invoke-Quiet { & node --version }
    if ("$v" -match '^v(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2])" }
    return $null
}

function Read-DotEnv([string]$path) {
    $map = @{}
    if (-not (Test-Path $path)) { return $map }
    foreach ($line in Get-Content $path) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $map[$Matches[1]] = $Matches[2].Trim() }
    }
    return $map
}

function Write-Utf8File([string]$path, [string[]]$lines) {
    # No BOM: python-dotenv would read it as part of the first key's name.
    [IO.File]::WriteAllText($path, ($lines -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding $false))
}

function Test-Http([string]$url, [int]$timeoutSec = 3) {
    try {
        $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec $timeoutSec
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch { return $false }
}

function Get-PortOwner([int]$port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { return $null }
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    return [pscustomobject]@{ Pid = $conn.OwningProcess; Name = $(if ($proc) { $proc.ProcessName } else { "?" }) }
}

# PostgreSQL runs as a Windows service. A stopped one is the commonest
# "it worked yesterday" failure, so find it and try to start it.
function Confirm-PostgresService {
    $services = @(Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue)
    if (-not $services.Count) { return }
    foreach ($svc in $services) {
        if ($svc.Status -eq "Running") { return }
    }
    $svc = $services[0]
    Warn "PostgreSQL service '$($svc.Name)' is $($svc.Status) - starting it."
    try {
        Start-Service $svc.Name -ErrorAction Stop
        Ok "PostgreSQL service started."
    } catch {
        Fail "Could not start the PostgreSQL service '$($svc.Name)'." `
            "Open Services (services.msc), start '$($svc.Name)' and set it to Automatic, or run this as administrator."
    }
}

# Asks the backend's own code to open a database connection, so the error the
# user sees is the real one (wrong password, database missing, server down).
function Test-Database {
    $probe = "from sqlalchemy import text`nfrom app.database import engine`nwith engine.connect() as c:`n    print(c.execute(text('select count(*) from accounts')).scalar())"
    Push-Location $script:Backend
    $eap = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try {
        $lines = @($probe | & $script:VenvPy - 2>&1 | ForEach-Object { "$_" } | Where-Object { $_.Trim() })
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $eap; Pop-Location }
    # On failure the last line of the traceback names the cause - except that
    # SQLAlchemy appends a "(Background on this error at: <url>)" line after it.
    $meaningful = @($lines | Where-Object { $_ -notmatch '^\s*\(Background on this error' })
    $last = if ($meaningful.Count) { $meaningful[-1].Trim() -replace '^\S+Error:\s*', '' } else { "" }
    return [pscustomobject]@{ Ok = ($code -eq 0); Output = $last }
}
