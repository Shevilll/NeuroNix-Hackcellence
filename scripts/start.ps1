# Start the backend (http://localhost:8000) and the frontend (http://localhost:5173).
# Ctrl+C stops both. Override the ports with BACKEND_PORT and FRONTEND_PORT if they are taken.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$BackendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8000" }
$FrontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "5173" }

$Uvicorn = "$Root\backend\.venv\Scripts\uvicorn.exe"
if (-not (Test-Path $Uvicorn)) {
    Write-Error "backend is not set up. Run .\scripts\setup.ps1 first."
    exit 1
}

$procs = @()
try {
    Write-Host "==> Backend:  http://localhost:$BackendPort"
    $procs += Start-Process -FilePath $Uvicorn `
        -ArgumentList "app.main:app", "--port", $BackendPort `
        -WorkingDirectory "$Root\backend" -NoNewWindow -PassThru

    if (Test-Path "$Root\frontend\package.json") {
        Write-Host "==> Frontend: http://localhost:$FrontendPort"
        $env:BACKEND_URL = "http://localhost:$BackendPort"
        $procs += Start-Process -FilePath "cmd.exe" `
            -ArgumentList "/c", "npm run dev -- --port $FrontendPort --strictPort" `
            -WorkingDirectory "$Root\frontend" -NoNewWindow -PassThru
    }

    # Run until either process exits or Ctrl+C is pressed.
    while (-not ($procs | Where-Object { $_.HasExited })) { Start-Sleep -Seconds 1 }
} finally {
    foreach ($p in $procs) {
        if (-not $p.HasExited) {
            # /T also stops child processes (node under npm).
            & taskkill /PID $p.Id /T /F 2>$null | Out-Null
        }
    }
}
