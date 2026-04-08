$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$ports = @(3001, 5173, 5174)

function Should-StopProcess {
    param(
        [int]$Port,
        $ProcessInfo
    )

    if (-not $ProcessInfo) {
        return $false
    }

    $commandLine = [string]$ProcessInfo.CommandLine
    $name = [string]$ProcessInfo.Name

    if ($Port -eq 3001) {
        return (
            $commandLine -like "*Douyin_Curation_Assistant*" -or
            $commandLine -like "*src/server.js*" -or
            $commandLine -like "*douyin-curation-assistant-server*"
        )
    }

    if ($Port -in 5173, 5174) {
        return (
            $commandLine -like "*Douyin_Curation_Assistant*" -or
            $commandLine -like "*vite*" -or
            $commandLine -like "*douyin-curation-assistant-client*"
        )
    }

    return $commandLine -like "*Douyin_Curation_Assistant*"
}

foreach ($port in $ports) {
    for ($round = 0; $round -lt 5; $round++) {
        $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique

        if (-not $connections) {
            break
        }

        foreach ($processId in $connections) {
            $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
            if (-not (Should-StopProcess -Port $port -ProcessInfo $processInfo)) {
                Write-Host "[stop] Skip port $port process $processId because it does not look like this project's process." -ForegroundColor Yellow
                continue
            }

            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Write-Host "[stop] Stopped process $processId on port $port." -ForegroundColor Green
            }
            catch {
                Write-Host ("[stop] Failed to stop process {0} on port {1}: {2}" -f $processId, $port, $_.Exception.Message) -ForegroundColor Red
            }
        }

        Start-Sleep -Milliseconds 300
    }
}

Write-Host "[stop] Done." -ForegroundColor Green
