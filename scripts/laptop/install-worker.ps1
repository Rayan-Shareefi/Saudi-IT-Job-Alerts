# Installs the Saudi Job Alert worker as a Windows scheduled task on the laptop.
#
# Run ONCE, in PowerShell opened "as Administrator", from anywhere:
#
#   powershell -ExecutionPolicy Bypass -File "C:\path\to\Saudi Job Alert\scripts\laptop\install-worker.ps1"
#
# What it sets up:
#   - starts at boot, whether or not anyone signs in to Windows (no password
#     is stored: it runs as your account with the S4U logon type);
#   - restarts within a minute if it stops (including after it updates itself
#     from GitHub);
#   - keeps running on battery and never times out;
#   - writes its log to logs\worker.log in the project folder.
#
# To remove it:  Unregister-ScheduledTask -TaskName SaudiJobAlertWorker -Confirm:$false

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node -ErrorAction Stop).Source
$tsx = Join-Path $repo "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $tsx)) { throw "Run 'npm ci' in $repo first." }
New-Item -ItemType Directory -Force (Join-Path $repo "logs") | Out-Null

$command = "/c `"`"$node`" `"$tsx`" scripts\local-worker.ts >> logs\worker.log 2>&1`""
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $command -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName "SaudiJobAlertWorker" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "SaudiJobAlertWorker"

Write-Host ""
Write-Host "Installed and started. It will start by itself after every reboot."
Write-Host "Log: $repo\logs\worker.log"
Write-Host "Check everything with: npm run doctor"
