# FALK Health Check
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=== FALK Health Check v2.0 ===" -ForegroundColor Cyan

# 1. Build
Write-Host ""
Write-Host "[1/8] Build..." -ForegroundColor Yellow
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "  OK" -ForegroundColor Green } else { Write-Host "  FAILED" -ForegroundColor Red; exit 1 }

# 2. Tests
Write-Host ""
Write-Host "[2/8] Tests..." -ForegroundColor Yellow
$testOutput = npm test 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
    $line = ($testOutput -split "`n" | Select-String "Tests.*passed" | Select-Object -First 1)
    if ($line) { Write-Host "  OK - $($line.ToString().Trim())" -ForegroundColor Green }
    else { Write-Host "  OK" -ForegroundColor Green }
} else { Write-Host "  FAILED" -ForegroundColor Red; exit 1 }

# 3. Raw storage
Write-Host ""
Write-Host "[3/8] Raw storage..." -ForegroundColor Yellow
if (Test-Path ".backup\raw") {
    $count = (Get-ChildItem .backup\raw -Recurse -Filter *.json -ErrorAction SilentlyContinue).Count
    $h3Count = (Get-ChildItem .backup\raw\h3-aggregated -Recurse -Filter *.json -ErrorAction SilentlyContinue).Count
    Write-Host "  $count files total ($h3Count H3-aggregated)" -ForegroundColor Green
}

# 4. Checkpoints
Write-Host ""
Write-Host "[4/8] Checkpoints..." -ForegroundColor Yellow
if (Test-Path ".backup\checkpoints") {
    $cpCount = (Get-ChildItem .backup\checkpoints -Filter *.json -ErrorAction SilentlyContinue).Count
    Write-Host "  $cpCount checkpoints" -ForegroundColor Green
}

# 5. Errors + Requests
Write-Host ""
Write-Host "[5/8] Errors + Requests..." -ForegroundColor Yellow
$errCount = if (Test-Path ".backup\errors\queue.jsonl") { (Get-Content .backup\errors\queue.jsonl -ErrorAction SilentlyContinue).Count } else { 0 }
$reqCount = if (Test-Path ".backup\requests\log.jsonl") { (Get-Content .backup\requests\log.jsonl -ErrorAction SilentlyContinue).Count } else { 0 }
Write-Host "  Requests: $reqCount | Unresolved errors: $errCount" -ForegroundColor $(if ($errCount -eq 0) { "Green" } else { "Yellow" })

# 6. Run contexts + Engine results
Write-Host ""
Write-Host "[6/8] Runs + Engines..." -ForegroundColor Yellow
$runCount = if (Test-Path ".backup\runs") { (Get-ChildItem .backup\runs -Filter *.json).Count } else { 0 }
$engineCount = if (Test-Path ".backup\engine-runs") { (Get-ChildItem .backup\engine-runs -Filter *.jsonl).Count } else { 0 }
Write-Host "  $runCount analysis runs, $engineCount engine-result logs" -ForegroundColor Green

# 7. Conflicts
Write-Host ""
Write-Host "[7/8] Conflicts..." -ForegroundColor Yellow
$confCount = if (Test-Path ".backup\conflicts\conflicts.jsonl") { (Get-Content .backup\conflicts\conflicts.jsonl -ErrorAction SilentlyContinue).Count } else { 0 }
Write-Host "  $confCount logged conflicts" -ForegroundColor Green

# 8. Files inventory
Write-Host ""
Write-Host "[8/8] Files inventory..." -ForegroundColor Yellow
$tsCount = (Get-ChildItem src -Recurse -Filter *.ts -ErrorAction SilentlyContinue).Count
$testCount = (Get-ChildItem src\tests -Filter *.test.ts -ErrorAction SilentlyContinue).Count
Write-Host "  $tsCount .ts files, $testCount test files" -ForegroundColor Green

Write-Host ""
Write-Host "=== Health check complete ===" -ForegroundColor Cyan
Write-Host ""