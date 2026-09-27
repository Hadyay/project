# Stops the servers start.ps1 launched (by the PIDs it recorded, whole process
# tree), and anything still answering on the configured ports from this
# folder's own Python or Node.

param([switch]$Quiet)

. (Join-Path $PSScriptRoot "common.ps1")

$config = Read-DotEnv (Join-Path $Backend ".env")
$ports = @(
    $(if ($config["BACKEND_PORT"]) { [int]$config["BACKEND_PORT"] } else { 8000 }),
    $(if ($config["FRONTEND_PORT"]) { [int]$config["FRONTEND_PORT"] } else { 3000 }),
    3100
)
$pidFile = Join-Path $Logs "pids.txt"
$stopped = 0

function Stop-Tree([int]$id) {
    if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { return $false }
    Invoke-Quiet { & taskkill.exe /PID $id /T /F } | Out-Null
    return $true
}

if (Test-Path $pidFile) {
    foreach ($id in Get-Content $pidFile) {
        if ($id -match '^\d+$' -and (Stop-Tree ([int]$id))) { $stopped++ }
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}

# A server started some other way (an old start.bat window, a crash that lost
# the PID file) - but only ours, recognised by what it runs: uvicorn serving
# app.main:app, or Next.js. (A venv's python.exe is a launcher whose child is
# the real interpreter, so the folder path is not in the listener's details.)
foreach ($port in $ports) {
    $owner = Get-PortOwner $port
    if (-not $owner -or $owner.Name -notin @("python", "node")) { continue }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($owner.Pid)" -ErrorAction SilentlyContinue
    $cmd = if ($proc) { "$($proc.CommandLine)" } else { "" }
    if ($cmd -match 'uvicorn.+app\.main:app' -or $cmd -match 'next[\\/]dist[\\/]bin[\\/]next|next(\.cmd)?"?\s+(start|dev)') {
        if (Stop-Tree $owner.Pid) { $stopped++ }
    }
}

if (-not $Quiet) {
    if ($stopped) { Ok "The system is stopped." } else { Ok "The system was not running." }
}
