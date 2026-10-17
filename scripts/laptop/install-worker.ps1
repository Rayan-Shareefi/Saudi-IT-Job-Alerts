# Installs the Saudi Job Alert worker as a Windows scheduled task on the laptop.
#
# Run in PowerShell opened "as Administrator" (easiest: open the project
# folder in File Explorer > File > Open Windows PowerShell > as administrator):
#
#   powershell -ExecutionPolicy Bypass -File scripts\laptop\install-worker.ps1
#
# Safe to run again at any time: it replaces the task and restarts it.
#
# What it sets up:
#   - starts at boot, whether or not anyone signs in to Windows;
#   - restarts within a minute if it stops (including after it updates itself
#     from GitHub);
#   - keeps running on battery and never times out;
#   - writes its log to logs\worker.log in the project folder.
#
# Then it checks that the worker really started, and says so plainly.
#
# To remove it:  Unregister-ScheduledTask -TaskName SaudiJobAlertWorker -Confirm:$false
#
# -FromLauncher: started by the launcher (Saudi Job Alert.cmd) in its own
# administrator window, which closes at the end - so pause on a failure.

param([switch]$FromLauncher)

$ErrorActionPreference = "Stop"
$name = "SaudiJobAlertWorker"

function Fail($msg) {
  Write-Host ""
  Write-Host "NOT INSTALLED: $msg" -ForegroundColor Red
  if ($FromLauncher) { Read-Host "Press Enter to close" | Out-Null }
  exit 1
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail "this PowerShell is not 'as administrator'. Close it, open one with Run as administrator, and run this again." }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Write-Host "Project folder: $repo"
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail "Node is not found. Install Node LTS from nodejs.org, then open a NEW PowerShell window and run this again." }
$tsx = Join-Path $repo "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $tsx)) { Fail "run 'npm ci' in $repo first." }
if (-not ((Test-Path (Join-Path $repo ".env.local")) -or (Test-Path (Join-Path $repo ".env")))) {
  Fail "no .env.local or .env in $repo. Copy .env.local from the PC into this folder."
}
New-Item -ItemType Directory -Force (Join-Path $repo "logs") | Out-Null
$log = Join-Path $repo "logs\worker.log"

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
$user = "$env:USERDOMAIN\$env:USERNAME"

# Waits for the worker's first log line; true if the task really started.
function Started() {
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if ((Test-Path $log) -and (Get-Item $log).LastWriteTime -gt $script:startedAt) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

function StartFresh() {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*local-worker.ts*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # The log only grows; start afresh past 20 MB, keeping the previous one.
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 20MB) { Move-Item $log (Join-Path $repo "logs\worker.old.log") -Force }
  $script:startedAt = Get-Date
  Start-ScheduledTask -TaskName $name
}

# The launcher's Restart, with the task already installed: restarting is
# enough, and re-registering could ask for the Windows password again.
$running = $false
if ($FromLauncher -and (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)) {
  StartFresh
  $running = Started
}

if (-not $running) {
  # First choice: no password stored at all (S4U).
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  StartFresh
  $running = Started
}

if (-not $running) {
  $code = "0x{0:X8}" -f (Get-ScheduledTask -TaskName $name | Get-ScheduledTaskInfo).LastTaskResult
  Write-Host ""
  Write-Host "Windows would not start it without your password (result $code)." -ForegroundColor Yellow
  Write-Host "A Windows box will open: type the password you use to sign in to THIS laptop"
  Write-Host "(for a Microsoft account, its password - not the PIN). Windows Task Scheduler"
  Write-Host "keeps it; this project never sees or stores it. Close the box to cancel."
  $cred = Get-Credential -UserName $user -Message "Windows password for this laptop (kept by Task Scheduler)"
  if (-not $cred) { Fail "cancelled." }
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null
  StartFresh
  if (-not (Started)) {
    $code = "0x{0:X8}" -f (Get-ScheduledTask -TaskName $name | Get-ScheduledTaskInfo).LastTaskResult
    Fail "the task still did not start (result $code). Send this result code."
  }
}

Write-Host ""
Write-Host "RUNNING. It starts by itself after every reboot; no window is normal." -ForegroundColor Green
if ($FromLauncher) { Start-Sleep -Seconds 3; exit 0 }
Write-Host "To watch it live, double-click 'Saudi Job Alert' on the desktop (or Saudi Job Alert.cmd in $repo)."
Start-Sleep -Seconds 15
Write-Host "Last log lines ($log):"
Get-Content $log -Tail 8
