# One-time setup (Windows PowerShell): backend virtualenv + dependencies, frontend dependencies.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot

# Pick the first Python that is 3.12 or newer.
$PythonCmd = $null
$candidates = @(
    @("py", "-3.14"), @("py", "-3.13"), @("py", "-3.12"),
    @("python3"), @("python")
)
foreach ($c in $candidates) {
    if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { continue }
    $extra = @()
    if ($c.Count -gt 1) { $extra = $c[1..($c.Count - 1)] }
    & $c[0] @extra -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)" 2>$null
    if ($LASTEXITCODE -eq 0) { $PythonCmd = $c; break }
}
if (-not $PythonCmd) {
    Write-Error "Python 3.12 or newer is required"
    exit 1
}
$PyExe = $PythonCmd[0]
$PyArgs = @()
if ($PythonCmd.Count -gt 1) { $PyArgs = $PythonCmd[1..($PythonCmd.Count - 1)] }

Write-Host "==> Backend: creating virtualenv with $($PythonCmd -join ' ')"
& $PyExe @PyArgs -m venv "$Root\backend\.venv"
if ($LASTEXITCODE -ne 0) { exit 1 }
$VenvPython = "$Root\backend\.venv\Scripts\python.exe"
& $VenvPython -m pip install --quiet --upgrade pip
if ($LASTEXITCODE -ne 0) { exit 1 }
& $VenvPython -m pip install --quiet -e "$Root\backend[dev]"
if ($LASTEXITCODE -ne 0) { exit 1 }

if (Test-Path "$Root\frontend\package.json") {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Error "Node.js 20+ and npm are required for the frontend"
        exit 1
    }
    Write-Host "==> Frontend: installing dependencies"
    Push-Location "$Root\frontend"
    try {
        if (Test-Path "package-lock.json") { npm ci } else { npm install }
        if ($LASTEXITCODE -ne 0) { exit 1 }
    } finally {
        Pop-Location
    }
}

Write-Host "==> Setup complete. Start the app with: .\scripts\start.ps1"
