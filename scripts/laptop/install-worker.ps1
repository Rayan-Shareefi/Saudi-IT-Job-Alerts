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
$npm = Join-Path (Split-Path $node) "npm.cmd"
if (-not ((Test-Path (Join-Path $repo ".env.local")) -or (Test-Path (Join-Path $repo ".env")))) {
  Fail "no .env.local or .env in $repo. Copy .env.local from the PC into this folder."
}
New-Item -ItemType Directory -Force (Join-Path $repo "logs") | Out-Null
$log = Join-Path $repo "logs\worker.log"
$heartbeat = Join-Path $repo "logs\heartbeat.json"
$needsInstall = Join-Path $repo "logs\needs-install"

# The task runs a small loop that starts the worker again whenever it exits -
# after updating itself, after the launcher asks for a restart, after a crash.
# Task Scheduler's own "restart on failure" does not do this: it never fires
# for a program that exits by itself. The loop is passed encoded, so it is
# held in memory and a later "git pull" cannot change it while it runs.
#
# Loop version 2 (2026-10-22): before each start, the packages are reinstalled
# when the worker asked for it (logs\needs-install, after an update changed
# them) or when they are missing. The worker used to run "npm ci" inside
# itself, holding files in node_modules open, and hung there with the laptop
# on. Between runs nothing holds them.
$q = [char]34
$inner = "/c $q$q$node$q $q$tsx$q scripts\local-worker.ts >> logs\worker.log 2>&1$q"
$install = "/c $q$q$npm$q ci >> logs\worker.log 2>&1$q"
$loop = @"
# saudi-job-alert worker loop v2
Set-Location -LiteralPath '$($repo.Replace("'", "''"))'
while (`$true) {
  if ((Test-Path 'logs\needs-install') -or -not (Test-Path 'node_modules\tsx\dist\cli.mjs')) {
    Add-Content -Path 'logs\worker.log' -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] installing the packages (npm ci) before starting the worker')
    `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '$($install.Replace("'", "''"))' -NoNewWindow -Wait -PassThru
    if (`$p.ExitCode -eq 0) { Remove-Item 'logs\needs-install' -ErrorAction SilentlyContinue }
  }
  Start-Process -FilePath 'cmd.exe' -ArgumentList '$($inner.Replace("'", "''"))' -NoNewWindow -Wait
  Start-Sleep -Seconds 15
}
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($loop))
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand $encoded" -WorkingDirectory $repo
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

# True once the worker writes its heartbeat after this start. Its log changing
# was not proof: a worker crashing every 15 seconds writes to its log too.
function Started() {
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    if ((Test-Path $heartbeat) -and (Get-Item $heartbeat).LastWriteTime -gt $script:startedAt) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

# A background loop of this project, any version: its command is encoded, so
# decode it and look for the worker's script.
function IsWorkerLoop($cmd) {
  if (-not $cmd -or $cmd -notmatch '-EncodedCommand\s+(\S+)') { return $false }
  try { $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1])) } catch { return $false }
  return $text -like "*local-worker.ts*"
}

function KillTree($id, $all) {
  foreach ($child in @($all | Where-Object { $_.ParentProcessId -eq $id })) { KillTree $child.ProcessId $all }
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}

# Everything of the worker: every background loop (old versions too), every
# worker and what it started (steps, browsers, a stuck "npm ci"). Restart used
# to stop only processes named after the worker, so a hung reinstall or an
# older loop survived it.
function StopWorker() {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $roots = @($all | Where-Object {
    ($_.Name -eq "powershell.exe" -and (IsWorkerLoop $_.CommandLine)) -or
    ($_.Name -eq "node.exe" -and ($_.CommandLine -like "*local-worker.ts*" -or $_.CommandLine -like "*npm-cli.js*ci*"))
  })
  foreach ($p in $roots) { KillTree $p.ProcessId $all }
  if ($roots.Count -gt 0) { Write-Host "Stopped $($roots.Count) old worker process(es)."; Start-Sleep -Seconds 2 }
}

# The packages, reinstalled when the worker asked for it, when they are
# missing, or when the package list is newer than the installed set.
function InstallIfNeeded() {
  $installed = Join-Path $repo "node_modules\.package-lock.json"
  $lock = Join-Path $repo "package-lock.json"
  $stale = (Test-Path $installed) -and (Test-Path $lock) -and ((Get-Item $lock).LastWriteTime -gt (Get-Item $installed).LastWriteTime)
  if (-not ((Test-Path $needsInstall) -or -not (Test-Path $tsx) -or $stale)) { return }
  Write-Host "Installing the project's packages (npm ci, a few minutes)..." -ForegroundColor Yellow
  Push-Location $repo
  & $npm ci
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Fail "npm ci failed (see above). Close every window using this folder, then press R again." }
  Remove-Item $needsInstall -ErrorAction SilentlyContinue
}

function StartFresh() {
  StopWorker
  InstallIfNeeded
  # The log only grows; start afresh past 20 MB, keeping the previous one.
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 20MB) { Move-Item $log (Join-Path $repo "logs\worker.old.log") -Force }
  $script:startedAt = Get-Date
  Start-ScheduledTask -TaskName $name
}

function ShowLogTail() {
  if (Test-Path $log) {
    Write-Host "Last lines of $log :" -ForegroundColor Yellow
    Get-Content $log -Tail 12 | ForEach-Object { Write-Host "  $_" }
  }
}

# The launcher's Restart, with the task already installed the current way
# (the restart loop): restarting is enough, and re-registering could ask for
# the Windows password again. A task from before the loop is replaced.
$running = $false
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
$current = $existing -and ($existing.Actions | Where-Object { $_.Execute -eq "powershell.exe" -and $_.Arguments -like "*$encoded*" })
if ($FromLauncher -and $current) {
  StartFresh
  $running = Started
}
if ($existing -and -not $current) { Write-Host "Updating the scheduled task to the restart loop (one time)." }

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
    ShowLogTail
    Fail "the worker did not answer within 90 seconds (task result $code). Send a photo of this window."
  }
}

Write-Host ""
Write-Host "RUNNING - the worker answered. It starts by itself after every reboot; no window is normal." -ForegroundColor Green
# Tells the launcher the task runs the restart loop (version 2), so an update
# can restart the worker without asking Windows for permission again.
Set-Content -Path (Join-Path $repo "logs\loop-installed") -Value ("loop v2 " + (Get-Date -Format o)) -Encoding ascii
if ($FromLauncher) { Start-Sleep -Seconds 3; exit 0 }
Write-Host "To watch it live, double-click 'Saudi Job Alert' on the desktop (or Saudi Job Alert.cmd in $repo)."
Start-Sleep -Seconds 15
Write-Host "Last log lines ($log):"
Get-Content $log -Tail 8
