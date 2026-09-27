# Starts the system and opens it in the browser. Run start.bat (or the
# desktop shortcut). The two servers run in minimized windows titled
# "ERP backend" and "ERP frontend"; stop.bat (or closing them) stops them.

param([switch]$NoBrowser)

. (Join-Path $PSScriptRoot "common.ps1")

$config = Read-DotEnv (Join-Path $Backend ".env")
$backendPort = if ($config["BACKEND_PORT"]) { [int]$config["BACKEND_PORT"] } else { 8000 }
$frontendPort = if ($config["FRONTEND_PORT"]) { [int]$config["FRONTEND_PORT"] } else { 3000 }
$pidFile = Join-Path $Logs "pids.txt"

if (-not (Test-Path $VenvPy) -or -not (Test-Path (Join-Path $Frontend "node_modules\next"))) {
    Fail "The system is not installed on this PC yet." "Run setup.bat first."
}
if (-not (Test-Path (Join-Path $Frontend ".next\BUILD_ID"))) {
    Fail "The frontend has not been built." "Run setup.bat again - it builds it."
}

# Already running? Then there is nothing to start - just open it. The
# frontend is recognised by its own page (a Next.js build), not by the port
# answering: after a fallback to 3100, something else may hold 3000.
function Find-RunningFrontend {
    foreach ($port in @($frontendPort, 3100) | Select-Object -Unique) {
        try {
            $page = Invoke-WebRequest "http://127.0.0.1:$port/login" -UseBasicParsing -TimeoutSec 3
            if ($page.Content -match '/_next/') { return $port }
        } catch { }
    }
    return $null
}
$runningPort = Find-RunningFrontend
if ($runningPort -and (Test-Http "http://127.0.0.1:$backendPort/health")) {
    Ok "The system is already running (http://localhost:$runningPort)."
    if (-not $NoBrowser) { Start-Process "http://localhost:$runningPort" }
    exit 0
}

Step "Checking the database"
Confirm-PostgresService
$db = Test-Database
if (-not $db.Ok) {
    Fail "The backend cannot reach the database: $($db.Output)" `
        "Is PostgreSQL running? If its password or port changed, run setup.bat again."
}
Ok "Database answers ($($db.Output) accounts)."

# A port held by something else would make the server die on start with an
# error nobody sees. Say so now; for the frontend, fall back to 3100, which
# setup.ps1 allowed in the backend's CORS list for exactly this.
$owner = Get-PortOwner $backendPort
if ($owner) {
    Fail "Port $backendPort is already used by '$($owner.Name)' (PID $($owner.Pid))." `
        "Close that program (or run stop.bat), then start again."
}
$owner = Get-PortOwner $frontendPort
if ($owner) {
    if ($frontendPort -ne 3100 -and -not (Get-PortOwner 3100)) {
        Warn "Port $frontendPort is used by '$($owner.Name)' - using port 3100 instead."
        $frontendPort = 3100
    } else {
        Fail "Port $frontendPort is already used by '$($owner.Name)' (PID $($owner.Pid))." `
            "Close that program (or run stop.bat), then start again."
    }
}

Step "Starting the system"
# Two ordinary console windows, minimized: visible in the taskbar, so anyone
# can see the system is up; closing them (or stop.bat) stops it. cmd /k keeps
# a window open after a crash, so the error stays on screen to be read.
$backendProc = Start-Process cmd.exe -WorkingDirectory $Backend -WindowStyle Minimized -PassThru -ArgumentList @(
    "/k", "title ERP backend - do not close && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port $backendPort")
$frontendProc = Start-Process cmd.exe -WorkingDirectory $Frontend -WindowStyle Minimized -PassThru -ArgumentList @(
    "/k", "title ERP frontend - do not close && node node_modules\next\dist\bin\next start -p $frontendPort -H 127.0.0.1")
Set-Content -Path $pidFile -Value @($backendProc.Id, $frontendProc.Id) -Encoding ascii

Write-Host "    Waiting for the servers (up to 90 seconds)..."
$deadline = (Get-Date).AddSeconds(90)
$backendUp = $false; $frontendUp = $false
while ((Get-Date) -lt $deadline -and -not ($backendUp -and $frontendUp)) {
    Start-Sleep -Milliseconds 700
    if (-not $backendUp) { $backendUp = Test-Http "http://127.0.0.1:$backendPort/health" }
    if (-not $frontendUp) { $frontendUp = Test-Http "http://127.0.0.1:$frontendPort" }
}

if (-not $backendUp) {
    Fail "The backend did not start." "Open the 'ERP backend' window in the taskbar - the error is shown there."
}
if (-not $frontendUp) {
    Fail "The frontend did not start." "Open the 'ERP frontend' window in the taskbar - the error is shown there."
}

Ok "Backend  http://localhost:$backendPort"
Ok "Frontend http://localhost:$frontendPort"
if ($config["FRONTEND_PORT"] -and $frontendPort -ne [int]$config["FRONTEND_PORT"]) {
    Warn "Running on port $frontendPort because $($config["FRONTEND_PORT"]) was busy."
}
Write-Host ""
Write-Host "The system is running. To close it: stop.bat, or close the two ERP windows." -ForegroundColor Green
if (-not $NoBrowser) { Start-Process "http://localhost:$frontendPort" }
