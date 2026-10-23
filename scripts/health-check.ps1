# FALK Health Check
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=== FALK Health Check ===" -ForegroundColor Cyan

# 1. Build
Write-Host ""
Write-Host "[1/5] Build..." -ForegroundColor Yellow
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK" -ForegroundColor Green
} else {
    Write-Host "  FAILED" -ForegroundColor Red
    exit 1
}

# 2. Tests
Write-Host ""
Write-Host "[2/5] Tests..." -ForegroundColor Yellow
$testOutput = npm test 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
    $line = ($testOutput -split "`n" | Select-String "Tests.*passed" | Select-Object -First 1)
    if ($line) {
        Write-Host "  OK - $($line.ToString().Trim())" -ForegroundColor Green
    } else {
        Write-Host "  OK" -ForegroundColor Green
    }
} else {
    Write-Host "  FAILED" -ForegroundColor Red
    Write-Host $testOutput
    exit 1
}

# 3. Raw storage
Write-Host ""
Write-Host "[3/5] Raw storage..." -ForegroundColor Yellow
if (Test-Path ".backup\raw") {
    $count = (Get-ChildItem .backup\raw -Recurse -Filter *.json -ErrorAction SilentlyContinue).Count
    Write-Host "  $count files" -ForegroundColor Green
} else {
    Write-Host "  (empty - run npm start to populate)" -ForegroundColor Gray
}

# 4. Checkpoints
Write-Host ""
Write-Host "[4/5] Checkpoints..." -ForegroundColor Yellow
if (Test-Path ".backup\checkpoints") {
    $cpCount = (Get-ChildItem .backup\checkpoints -Filter *.json -ErrorAction SilentlyContinue).Count
    Write-Host "  $cpCount checkpoints" -ForegroundColor Green
} else {
    Write-Host "  (none yet)" -ForegroundColor Gray
}

# 5. Files inventory
Write-Host ""
Write-Host "[5/5] Source files..." -ForegroundColor Yellow
$tsCount = (Get-ChildItem src -Recurse -Filter *.ts -ErrorAction SilentlyContinue).Count
$testCount = (Get-ChildItem src\tests -Filter *.test.ts -ErrorAction SilentlyContinue).Count
Write-Host "  $tsCount .ts files, $testCount test files" -ForegroundColor Green

Write-Host ""
Write-Host "=== Health check complete ===" -ForegroundColor Cyan
Write-Host ""