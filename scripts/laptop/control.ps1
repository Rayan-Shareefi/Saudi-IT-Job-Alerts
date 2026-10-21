# The laptop launcher: double-click "Saudi Job Alert.cmd" (or its desktop
# shortcut). It makes sure the background worker is running, offers the
# LinkedIn sign-in when it is missing, then shows the worker's log live.
#
# Closing this window does NOT stop the worker: it runs in the background as a
# scheduled task and starts by itself after every reboot. This window is only
# for watching.
#
# Plain ASCII on purpose: Windows PowerShell 5.1 misreads a UTF-8 script
# without a byte-order mark.
#
# -FunctionsOnly: define the functions and stop (for testing the log viewer).

param([switch]$FunctionsOnly)

$ErrorActionPreference = "Continue"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$host.UI.RawUI.WindowTitle = "Saudi Job Alert - laptop worker"
$task = "SaudiJobAlertWorker"
$log = Join-Path $repo "logs\worker.log"
$tsx = Join-Path $repo "node_modules\tsx\dist\cli.mjs"

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }
function Line() { Say ("-" * 72) DarkGray }

function Node-Script($script) {
  # node + tsx directly: no npm, so PowerShell's script policy never gets in the way.
  # Out-Host shows the output as it comes instead of returning it.
  & node $tsx $script | Out-Host
  return $LASTEXITCODE
}

function Env-Flag($name) {
  $pattern = '^\s*' + $name + '\s*=\s*["'']?(1|true|yes)["'']?\s*$'
  foreach ($f in ".env.local", ".env") {
    $p = Join-Path $repo $f
    if ((Test-Path $p) -and (Select-String -Path $p -Pattern $pattern -Quiet)) { return $true }
  }
  return $false
}

function Worker-Running() {
  $info = schtasks /query /tn $task /fo csv /nh 2>$null
  if ($LASTEXITCODE -eq 0 -and "$info" -match '"Running"') { return $true }
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
  return [bool]($procs | Where-Object { $_.CommandLine -like "*local-worker.ts*" })
}

function Install-Or-Restart() {
  Say "Starting the worker. Windows will ask for permission - click Yes." Yellow
  $script = Join-Path $repo "scripts\laptop\install-worker.ps1"
  try {
    Start-Process powershell -Verb RunAs -Wait -ErrorAction Stop -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -FromLauncher"
  } catch {
    Say "Permission was not given, so the worker was not started." Red
    return
  }
  if (Worker-Running) { Say "Worker is running." Green } else { Say "The worker did not start - see the window that just closed, or run this again." Red }
}

function LinkedIn-Login() {
  Line
  Say "LinkedIn sign-in" Cyan
  Say "A browser window opens. Sign in with the SECONDARY LinkedIn account and finish"
  Say "any check LinkedIn asks for. The window closes by itself when the feed loads."
  Line
  $code = Node-Script "scripts\linkedin-login.ts"
  if ($code -eq 0) {
    New-Item -ItemType File -Force (Join-Path $repo "logs\run-now") | Out-Null
    Say "Signed in. The worker reads LinkedIn within a minute." Green
  } else {
    Say "Not signed in this time (exit $code). Press L to try again." Red
  }
  Line
}

function Show-Keys() {
  Say "Keys:  N = search now (LinkedIn, platforms, jury)   F = full search (also every company site, ~2 h)" DarkCyan
  Say "       U = update now   R = restart worker   D = check everything   L = LinkedIn sign-in   Q = close" DarkCyan
  Say "JSearch (the metered API) is not in N or F: GitHub runs it twice a week to stay inside its free quota." DarkGray
  Say "Closing this window does not stop the worker." DarkGray
  Line
}

$loopMarker = Join-Path $repo "logs\loop-installed"

# The version on this laptop: short id, date, and what changed in it.
function Version-Line() {
  $sha = (& git -C $repo rev-parse --short HEAD 2>$null)
  $when = (& git -C $repo log -1 --format=%cd --date=format:"%Y-%m-%d %H:%M" 2>$null)
  $what = (& git -C $repo log -1 --format=%s 2>$null)
  if ($what.Length -gt 70) { $what = $what.Substring(0, 67) + "..." }
  return "$sha from $when - $what"
}

# The newest version on GitHub (the repository is public: no sign-in needed).
function Remote-Head() {
  $env:GIT_TERMINAL_PROMPT = "0"
  $out = (& git -C $repo ls-remote origin HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  return ("$out" -split "\s+")[0]
}

# Downloads the latest version and says plainly what this laptop now runs.
function Update-Code([switch]$Ask) {
  if (-not (Test-Path (Join-Path $repo ".git"))) {
    Say "This folder is NOT a git copy, so it can never update itself - it keeps running the code it was copied with." Red
    Say "One-time fix (docs/laptop-setup.md, 'The laptop folder is not a git copy'): in this folder run" Red
    Say "  git init ; git remote add origin https://github.com/Rayan-Shareefi/Saudi-IT-Job-Alerts.git ; git fetch origin ; git checkout -f -B main origin/main ; npm.cmd ci" Yellow
    return $false
  }
  Say "Checking GitHub for a newer version..." White
  $before = (& git -C $repo rev-parse HEAD 2>$null)
  $remote = Remote-Head
  if (-not $remote) {
    Say "Could not reach GitHub (no internet?). Still running: $(Version-Line)" Yellow
    return $false
  }
  if ($remote -eq $before) {
    Say "Up to date - this laptop runs the latest version: $(Version-Line)" Green
    return $false
  }
  $out = (& git -C $repo pull --ff-only 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    # GitHub's history was rewritten when the repo went public: a copy cloned
    # before then can never fast-forward. Keep it on a branch and move over.
    & git -C $repo merge-base --is-ancestor HEAD origin/main 2>$null; $behind = ($LASTEXITCODE -eq 0)
    & git -C $repo merge-base --is-ancestor origin/main HEAD 2>$null; $ahead = ($LASTEXITCODE -eq 0)
    if (-not $behind -and -not $ahead) {
      Say "This copy's history differs from GitHub's (the history was rewritten when the repo went public), so it cannot update by pulling." Yellow
      $go = (-not $Ask) -or ((Read-Host "Keep this copy on a backup branch and move to GitHub's version? (Y = yes, Enter = no)") -match "^[yY]")
      if ($go) {
        $keep = "laptop-before-" + (Get-Date -Format "yyyy-MM-dd-HHmm")
        & git -C $repo branch $keep | Out-Null
        & git -C $repo stash push -m "set aside before moving to GitHub's history ($keep)" | Out-Null
        $out = (& git -C $repo reset --hard origin/main 2>&1 | Out-String)
        if ($LASTEXITCODE -eq 0) { Say "Moved to GitHub's version; the old copy is on branch $keep." Green }
      }
    }
  }
  if ($LASTEXITCODE -ne 0) {
    # Usually files changed on this laptop (often only line endings) block it.
    $changed = @(& git -C $repo status --porcelain --untracked-files=no 2>$null)
    if ($changed.Count -gt 0) {
      Say "A newer version is on GitHub, but these files were changed on this laptop:" Yellow
      $changed | Select-Object -First 8 | ForEach-Object { Say "    $_" Yellow }
      $go = $Ask -and ((Read-Host "Set them aside (kept in git stash, nothing is lost) and update? (Y = yes, Enter = no)") -match "^[yY]")
      if ($go) {
        & git -C $repo stash push -m ("set aside by the launcher " + (Get-Date -Format "yyyy-MM-dd HH:mm")) | Out-Null
        $out = (& git -C $repo pull --ff-only 2>&1 | Out-String)
      }
    }
    if ($LASTEXITCODE -ne 0 -or (& git -C $repo rev-parse HEAD 2>$null) -eq $before) {
      $last = ($out.Trim() -split "`r?`n")[-1]
      Say "NOT updated ($last). Still running the old version: $(Version-Line). Press U to try again." Red
      return $false
    }
  }
  $after = (& git -C $repo rev-parse HEAD 2>$null)
  Say "Updated. This laptop now runs: $(Version-Line)" Green
  & git -C $repo log --format="    - %s" -n 5 "$before..$after" 2>$null | ForEach-Object { Say $_ DarkGreen }
  if (& git -C $repo diff --name-only $before $after -- package-lock.json) {
    Say "Installing updated packages (a few minutes)..." Yellow
    & npm.cmd ci | Out-Host
  }
  return $true
}

# The worker restarts itself into new code when asked (logs\restart), since
# the background task runs it in a restart loop.
function Restart-Into-New-Code() {
  if (Test-Path $loopMarker) {
    New-Item -ItemType File -Force (Join-Path $repo "logs\restart") | Out-Null
    Say "Restarting the worker into the new version (within a minute)." Green
  } else {
    Install-Or-Restart
  }
}

function Show-Schedule() {
  try {
    $state = Get-Content (Join-Path $repo "logs\worker-state.json") -Raw -ErrorAction Stop | ConvertFrom-Json
    if ($state.lastCycleAt) {
      $last = [DateTime]::Parse($state.lastCycleAt).ToLocalTime()
      $next = $last.AddMinutes(120)
      Say ("Last search started {0:HH:mm}; next one around {1:HH:mm}. Press N to search now." -f $last, $next) Gray
    }
  } catch {
    # no schedule yet: the first search starts as soon as the worker does
  }
}

function Paint($l) {
  # Counters that are zero ("failed : 0", "errors (0)") are good news, not red.
  if ($l -match "^\s*\w[\w ]*:\s*0\b" -or $l -match "\(0\)") { Say $l Gray }
  # A site that answered but has nothing in scope today: normal, so quiet.
  elseif ($l -match "^\[\s*\d+/\d+\] none ") { Say $l DarkGray }
  elseif ($l -match "^\[\s*\d+/\d+\] ok ") { Say $l Green }
  # Waiting is not breaking: skips, a spent free quota, LinkedIn saying "slow down".
  # ...and so are the AI models' passing hiccups, which the jury works around.
  elseif ($l -match "\bskip\b|skipped|slow down|pausing until|resting for the rest|quota|model errors|^\s+\d+x ") { Say $l Yellow }
  elseif ($l -match "needs you") { Say $l Magenta }
  elseif ($l -match "\bFAIL\b|failed|[Ee]rror|MISSING|NOT INSTALLED") { Say $l Red }
  elseif ($l -match " ADD ") { Say $l Green }
  # The time estimates: the plan, its finish time, and time left in long steps.
  elseif ($l -match "search plan:|this search takes about|min left - done around") { Say $l Cyan }
  elseif ($l -match "^\[[^\]]+\] > ") { Say $l Cyan }
  elseif ($l -match "exited 0") { Say $l Green }
  elseif ($l -match "exited \d") { Say $l Yellow }
  elseif ($l -match "^\[[^\]]+\] ") { Say $l White }
  else { Say $l Gray }
}

function Key-Waiting() {
  try { return [Console]::KeyAvailable } catch { return $false }  # no keyboard (redirected input)
}

function Handle-Key() {
  if (-not (Key-Waiting)) { return $true }
  $k = [Console]::ReadKey($true).Key
  switch ($k) {
    "L" { LinkedIn-Login }
    "N" {
      New-Item -ItemType File -Force (Join-Path $repo "logs\run-now") | Out-Null
      Say ">> Asked for a search now - it starts within a few seconds (or after the current step) and prints its time estimate." Yellow
    }
    "F" {
      New-Item -ItemType File -Force (Join-Path $repo "logs\run-full") | Out-Null
      Say ">> Asked for a full search - every platform and every company site. It prints its time estimate when it starts." Yellow
    }
    "U" {
      Line
      if (Update-Code -Ask) { Restart-Into-New-Code } else { Say "The worker keeps running the version above." DarkGray }
      Line
    }
    "R" { Install-Or-Restart }
    "D" { Line; Node-Script "scripts\doctor.ts" | Out-Null; Line }
    "Q" { return $false }
    default { Show-Keys }
  }
  return $true
}

function Follow() {
  while (-not (Test-Path $log)) {
    Say "Waiting for the worker to write its first log line..." DarkGray
    Start-Sleep -Seconds 3
    if (-not (Handle-Key)) { return }
  }
  $fs = Open-Log
  if ($fs.Length -gt 20000) { [void]$fs.Seek(-20000, [IO.SeekOrigin]::End) }
  $reader = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
  if ($fs.Position -gt 0) { [void]$reader.ReadLine() }  # drop the cut-off first line
  # What happened recently: the last 40 lines, then everything new as it comes.
  $parts = $reader.ReadToEnd() -split "`r?`n"
  $recent = @($parts[0..($parts.Count - 2)] | Where-Object { $_ }) | Select-Object -Last 40
  foreach ($l in $recent) { Paint $l }
  $pending = $parts[$parts.Count - 1]
  $idle = 0
  for (;;) {
    $chunk = $reader.ReadToEnd()
    if ($chunk) {
      $parts = ($pending + $chunk) -split "`r?`n"
      for ($i = 0; $i -lt $parts.Count - 1; $i++) { if ($parts[$i]) { Paint $parts[$i] } }
      $pending = $parts[$parts.Count - 1]
      $idle = 0
      continue
    }
    if (-not (Handle-Key)) { break }
    if ((++$idle % 10) -eq 0) {
      # The installer moves a big log aside and starts a new one: follow the
      # new file. Its size comes from a handle - Get-Item's lags behind a file
      # another program is writing, which looked like a fresh log.
      try { $probe = Open-Log; $len = $probe.Length; $probe.Close() } catch { $len = $fs.Position }
      if ($len -lt $fs.Position) {
        $reader.Close(); $fs = Open-Log
        $reader = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8); $pending = ""
      }
    }
    Start-Sleep -Milliseconds 400
  }
  $reader.Close()
}

function Open-Log() {
  return [IO.File]::Open($log, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
}

# ---------------------------------------------------------------- start ----

if ($FunctionsOnly) { return }
Clear-Host
Say "Saudi Job Alert - laptop worker" Cyan
Say "Folder: $repo" DarkGray
Line

# A desktop shortcut, once, so this is one double-click away.
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = Join-Path $desktop "Saudi Job Alert.lnk"
if (-not (Test-Path $shortcut)) {
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  $s.TargetPath = Join-Path $repo "Saudi Job Alert.cmd"
  $s.WorkingDirectory = $repo
  $s.Save()
  Say "Added a 'Saudi Job Alert' shortcut to your desktop." Green
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Say "Node is not installed. Install Node LTS from nodejs.org, then open this again." Red; Read-Host "Press Enter to close"; exit 1 }
if (-not ((Test-Path (Join-Path $repo ".env.local")) -or (Test-Path (Join-Path $repo ".env")))) { Say "No .env.local in this folder. Copy it from the PC, then open this again." Red; Read-Host "Press Enter to close"; exit 1 }
if (-not (Test-Path $tsx)) {
  Say "Installing the project's packages (first time only, a few minutes)..." Yellow
  & npm.cmd ci
}

$updated = Update-Code -Ask
if (-not (Test-Path $loopMarker)) {
  Say "One-time upgrade of the background task, so updates restart the worker by themselves." Yellow
  Install-Or-Restart
} elseif (-not (Worker-Running)) {
  Install-Or-Restart
} else {
  Say "Worker: running in the background." Green
  if ($updated) { Restart-Into-New-Code }
}
Show-Schedule

if ((Env-Flag "LINKEDIN_POSTS_ENABLED") -and -not (Test-Path (Join-Path $repo ".linkedin-profile"))) {
  Say "LinkedIn hiring posts need a one-time sign-in on this laptop." Magenta
  $answer = Read-Host "Sign in now? (Y = yes, Enter = later)"
  if ($answer -match "^[yY]") { LinkedIn-Login }
}

Line
Show-Keys
Follow
