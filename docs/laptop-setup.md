# Setting up the laptop as the 24/7 worker

One-time setup, about 30 minutes. After this the laptop runs everything by
itself: it starts at boot (no Windows sign-in needed), updates itself from
GitHub, and emails you if it ever needs you.

What it does every 2 hours: picks up searches you start from the website,
reads LinkedIn job listings and hiring posts, runs the free AI reviewers
(including a local one), watches co-op pages, adds new employers it finds,
and emails time-sensitive jobs. If GitHub's nightly company scan misses a
night, it runs that too.

## 1. Install the tools (free)

1. **Git** - https://git-scm.com/download/win (defaults are fine)
2. **Node.js 22 LTS** - https://nodejs.org (defaults are fine)
3. **Ollama** (the local AI reviewer) - https://ollama.com/download

## 2. Get the project

On your repository's GitHub page, click the green **Code** button and copy the
address (it ends in `.git`). Then open PowerShell and run, one line at a time,
pasting that address where it says `<repository address>`:

```
cd $HOME
git clone <repository address> "Saudi Job Alert"
cd "Saudi Job Alert"
npm ci
npx playwright install chromium
```

Clone it - do not copy the folder over from another computer. A copied folder
has no `.git`, so the worker can never update it and keeps running the code it
was copied with.

### The laptop folder is not a git copy

The launcher says so in red, and the worker's log says "NOT a git copy". Fix
it in place, once - your `.env.local`, LinkedIn sign-in, logs, the background
task and the desktop shortcut all stay as they are. In PowerShell, inside the
project folder, one line at a time:

```
git init
git remote add origin https://github.com/Rayan-Shareefi/Saudi-IT-Job-Alerts.git
git fetch origin
git checkout -f -B main origin/main
npm.cmd ci
```

`checkout -f` replaces the old code files with GitHub's; files git ignores
(`.env.local`, `.linkedin-profile`, `logs`) are not touched. Then open the
launcher and press **R**; it should say "Up to date".

## 3. The settings file

Copy `.env.local` from your PC into the laptop's `Saudi Job Alert` folder
(USB stick, or any way you like - not email or chat, it holds your keys).
Then open it in Notepad and add these lines at the end:

```
LINKEDIN_ENABLED=1
LINKEDIN_POSTS_ENABLED=1
LINKEDIN_EMAIL=the secondary account's email
LINKEDIN_PASSWORD=the secondary account's password
```

Also add `GROQ_API_KEY=...` if it is not there yet (free key, no card:
https://console.groq.com/keys).

## 4. The local AI model

```
ollama pull qwen2.5:7b-instruct
```

`npm run doctor` (step 7) measures how fast it runs on this laptop. If it says
"too slow", run `ollama pull qwen2.5:3b-instruct` and add
`OLLAMA_MODEL=qwen2.5:3b-instruct` to `.env.local`.

## 5. Sign LinkedIn in, once

```
npm run linkedin:login
```

A browser window opens. Sign in to the **secondary** account and finish any
check LinkedIn asks for. When your feed appears the window closes by itself;
the session is saved for months. If LinkedIn ever asks again, the worker
stops reading posts and emails you "LinkedIn needs you" - just run this
command again.

## 6. Power settings (so it never sleeps)

- Settings > System > Power & sleep > **When plugged in, PC goes to sleep after: Never**
- Control Panel > Power Options > Choose what closing the lid does >
  **When plugged in: Do nothing**
- Settings > Windows Update > Advanced options > **Active hours**: set them to
  cover the day, so restarts happen at night. The worker starts again by
  itself after a restart.
- **Battery:** a laptop kept at 100% charge around the clock wears its battery
  out and, in older models, can swell it. If your laptop's BIOS or its
  maker's app (Lenovo Vantage, Dell Power Manager, ASUS Armoury, HP...) has a
  "battery charge limit" or "conservation mode", turn it on (60-80%).
  Keep the vents clear; a cooling pad helps.

## 7. Install the worker and check everything

Open the project folder in File Explorer, then **File > Open Windows
PowerShell > Open Windows PowerShell as administrator** (it opens already in
the right folder), and run:

```
powershell -ExecutionPolicy Bypass -File scripts\laptop\install-worker.ps1
```

It ends with green **RUNNING** and the first log lines, or red **NOT
INSTALLED** with the reason. If Windows refuses to run the task without a
password, it opens a Windows box for your laptop sign-in password, which Task
Scheduler keeps (the project never sees it). Safe to run again at any time.

## Day to day

Nothing: the worker runs in the background and starts by itself after every
reboot. To watch it, double-click **Saudi Job Alert** on the desktop (the
first run of `Saudi Job Alert.cmd` in the project folder adds that shortcut).
It starts the worker if it is not running, offers the LinkedIn sign-in if it
is missing, and shows the log live in colour. Keys in that window:

| Key | Does |
|---|---|
| N | search now instead of waiting up to 2 hours (LinkedIn, the platforms, the jury) |
| F | full search: everything above plus every company site (~2 hours) |
| L | LinkedIn sign-in (secondary account) |
| U | download the latest version and restart into it |
| R | restart the worker |
| D | check everything (keys, Ollama, LinkedIn, database) |
| Q | close the window - the worker keeps running |

Every search first prints its plan with a time estimate for each step and the
time it should be done; long steps print the time left as they go. The
estimates learn from how long each step really takes on this laptop.

Opening the launcher also downloads the latest version and restarts the worker
into it, so updates reach the laptop even while the GitHub repository is
private (the background task cannot sign in to GitHub by itself).

Typing commands yourself: PowerShell refuses `npm` on a fresh Windows (script
policy). Type `npm.cmd` instead, e.g. `npm.cmd run doctor`.

- **Turn it off:** `Stop-ScheduledTask SaudiJobAlertWorker` (Administrator PowerShell)
- **Turn it back on:** `Start-ScheduledTask SaudiJobAlertWorker`
- **Remove it:** `Unregister-ScheduledTask -TaskName SaudiJobAlertWorker -Confirm:$false`
