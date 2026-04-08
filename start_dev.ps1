$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

function Get-EnvValue {
    param(
        [string]$FilePath,
        [string]$Key
    )

    if (-not (Test-Path $FilePath)) {
        return ""
    }

    $line = Get-Content $FilePath -ErrorAction SilentlyContinue |
        Where-Object { $_ -match "^$Key=" } |
        Select-Object -First 1

    if (-not $line) {
        return ""
    }

    return ($line -split '=', 2)[1].Trim()
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "[start] Created .env from .env.example. Update it if needed." -ForegroundColor Yellow
}

$localEnvPath = Join-Path $projectRoot ".env"
$rootEnvPath = Join-Path (Split-Path $projectRoot -Parent) ".env"
$localDyCookies = Get-EnvValue -FilePath $localEnvPath -Key "DY_COOKIES"
$rootDyCookies = Get-EnvValue -FilePath $rootEnvPath -Key "DY_COOKIES"

if (-not [string]::IsNullOrWhiteSpace($localDyCookies)) {
    Write-Host "[start] DY_COOKIES found in Douyin_Curation_Assistant\.env." -ForegroundColor Green
}
elseif (-not [string]::IsNullOrWhiteSpace($rootDyCookies)) {
    Write-Host "[start] DY_COOKIES not found in local .env, using fallback root .env." -ForegroundColor Yellow
}
else {
    Write-Host "[start] DY_COOKIES is empty in both local and root .env files. Fill one of them before using discovery search." -ForegroundColor Yellow
}

Write-Host "[start] SQLite will be created automatically under .\jsonData\ when the server starts." -ForegroundColor Green
Write-Host "[start] Starting client and server..." -ForegroundColor Green
npm run dev
