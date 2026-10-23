# FALK Health Check
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=== FALK Health Check ===" -ForegroundColor Cyan

# 1. Build
Write-Host ""
Write-Host "[1/7] Build..." -ForegroundColor Yellow
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "  OK" -ForegroundColor Green } else { Write-Host "  FAILED" -ForegroundColor Red; exit 1 }

# 2. Tests
Write-Host ""
Write-Host "[2/7] Tests..." -ForegroundColor Yellow
$testOutput = npm test 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
    $line = ($testOutput -split "`n" | Select-String "Tests.*passed" | Select-Object -First 1)
    if ($line) { Write-Host "  OK - $($line.ToString().Trim())" -ForegroundColor Green }
    else { Write-Host "  OK" -ForegroundColor Green }
} else { Write-Host "  FAILED" -ForegroundColor Red; Write-Host $testOutput; exit 1 }

# 3. Raw storage
Write-Host ""
Write-Host "[3/7] Raw storage..." -ForegroundColor Yellow
if (Test-Path ".backup\raw") {
    $count = (Get-ChildItem .backup\raw -Recurse -Filter *.json -ErrorAction SilentlyContinue).Count
    Write-Host "  $count files" -ForegroundColor Green
} else { Write-Host "  (empty)" -ForegroundColor Gray }

# 4. Checkpoints
Write-Host ""
Write-Host "[4/7] Checkpoints..." -ForegroundColor Yellow
if (Test-Path ".backup\checkpoints") {
    $cpCount = (Get-ChildItem .backup\checkpoints -Filter *.json -ErrorAction SilentlyContinue).Count
    Write-Host "  $cpCount checkpoints" -ForegroundColor Green
} else { Write-Host "  (none)" -ForegroundColor Gray }

# 5. Errors queue
Write-Host ""
Write-Host "[5/7] Error queue..." -ForegroundColor Yellow
if (Test-Path ".backup\errors\queue.jsonl") {
    $errCount = (Get-Content .backup\errors\queue.jsonl -ErrorAction SilentlyContinue).Count
    Write-Host "  $errCount unresolved failures" -ForegroundColor Yellow
} else { Write-Host "  0 (clean)" -ForegroundColor Green }

# 6. Run contexts
Write-Host ""
Write-Host "[6/7] Run contexts..." -ForegroundColor Yellow
if (Test-Path ".backup\runs") {
    $runCount = (Get-ChildItem .backup\runs -Filter *.json -ErrorAction SilentlyContinue).Count
    Write-Host "  $runCount analysis runs recorded" -ForegroundColor Green
} else { Write-Host "  (none)" -ForegroundColor Gray }

# 7. Files inventory
Write-Host ""
Write-Host "[7/7] Files inventory..." -ForegroundColor Yellow
$tsCount = (Get-ChildItem src -Recurse -Filter *.ts -ErrorAction SilentlyContinue).Count
$testCount = (Get-ChildItem src\tests -Filter *.test.ts -ErrorAction SilentlyContinue).Count
Write-Host "  $tsCount .ts files, $testCount test files" -ForegroundColor Green

Write-Host ""
Write-Host "=== Health check complete ===" -ForegroundColor Cyan
Write-Host ""