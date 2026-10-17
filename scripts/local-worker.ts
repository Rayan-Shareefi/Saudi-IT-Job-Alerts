/**
 * The laptop worker: runs forever, started by Windows Task Scheduler at boot.
 *
 *   npm run worker            # the loop (what the scheduled task runs)
 *   npm run worker -- --once  # one cycle, then exit (for testing)
 *
 * Every 2 minutes: start any run someone queued with a button on the site.
 * Every cycle (2 hours by default, WORKER_CYCLE_MIN):
 *
 *   1. update itself from GitHub (git pull + npm ci when dependencies change),
 *      so a fix pushed once reaches the laptop without anyone touching it;
 *   2. LinkedIn job listings and company hiring posts (home IP, this machine
 *      holds the signed-in profile);
 *   3. the AI jury over what the rules could not settle, with the local
 *      Ollama model as an extra, unlimited juror;
 *   4. co-op watch and employer discovery;
 *   5. instant alerts for time-sensitive jobs;
 *   6. the company-board pass, if GitHub's nightly run has not succeeded in
 *      26 hours.
 *
 * Each step is a separate child process: a crash in one step never stops the
 * worker, and every step runs the code currently on disk (a long-lived process
 * holds the code it started with - HANDOVER §8).
 */
import "./load-env";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { envFlag, envInt, envStr } from "../src/lib/env";
import { finishRun, latestRun, markStalled, queuedRuns, startRun } from "../src/lib/runs";
import { sendSystemAlert, sendTimeSensitiveAlerts } from "../src/lib/alerts";
import { sleep } from "../src/lib/http";

const ONCE = process.argv.includes("--once");
const CYCLE_MS = envInt("WORKER_CYCLE_MIN", 120) * 60_000;
const POLL_MS = 2 * 60_000;
const TSX = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function log(s: string): void {
  console.log(`[${new Date().toISOString().slice(0, 19).replace("T", " ")}] ${s}`);
}

/** Run a script as its own process; returns its exit code. */
function step(name: string, script: string, args: string[] = [], timeoutMin = 90): number {
  log(`> ${name}`);
  const r = spawnSync(process.execPath, [TSX, script, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    timeout: timeoutMin * 60_000,
    windowsHide: true,
    env: { ...process.env, WORKER_NAME: "laptop" },
  });
  const code = r.status ?? (r.error ? 1 : 0);
  log(`< ${name} exited ${code}${r.error ? ` (${r.error.message})` : ""}`);
  return code;
}

/** Exit code that tells Task Scheduler "restart me" (the task restarts on failure). */
const RESTART_FOR_UPDATE = 75;

function head(): string {
  return spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).stdout?.trim() ?? "";
}

/*
 * The scheduled task has no desktop, so a credential prompt (a private repo,
 * an expired sign-in) would wait forever for a click nobody can make. Fail
 * fast instead; the worker carries on with the code on disk.
 */
const GIT_NO_PROMPT = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

function selfUpdate(): void {
  if (!existsSync(".git")) return;
  const before = head();
  const lockBefore = existsSync("package-lock.json") ? readFileSync("package-lock.json", "utf8") : "";
  const pull = spawnSync("git", ["pull", "--ff-only"], { stdio: "inherit", windowsHide: true, env: GIT_NO_PROMPT, timeout: 5 * 60_000 });
  if (pull.status !== 0) {
    log("git pull failed (local changes?) - carrying on with the code on disk");
    return;
  }
  const lockAfter = existsSync("package-lock.json") ? readFileSync("package-lock.json", "utf8") : "";
  if (lockAfter !== lockBefore) {
    log("dependencies changed - npm ci");
    spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci"], { stdio: "inherit", windowsHide: true, shell: process.platform === "win32" });
  }
  // The steps are child processes and already run the new code; the loop
  // itself does not, so it hands over to a fresh copy of itself.
  if (head() !== before && !ONCE) {
    log("updated to new code - restarting the worker");
    process.exit(RESTART_FOR_UPDATE);
  }
}

/** Runs queued by the buttons on the site, oldest first. */
async function pickUpQueued(): Promise<void> {
  await markStalled();
  for (const run of await queuedRuns()) {
    if (run.scope !== "company" && run.scope !== "api") continue;
    step(`queued ${run.scope} run`, "scripts/ingest.ts", ["--run-id", run.id, "--scope", run.scope, ...(run.trigger?.includes("jsearch") ? ["--with-jsearch"] : [])], 180);
  }
}

async function companyPassIfGithubMissed(): Promise<void> {
  const last = await latestRun("company");
  const lastGood = last && last.status === "done" ? new Date(last.finished_at ?? last.requested_at).getTime() : 0;
  if (Date.now() - lastGood < 26 * 3_600_000) return;
  log("no successful company-board pass in 26h - running it here");
  step("company boards (fallback)", "scripts/ingest.ts", ["--scope", "company", "--no-metered", "--order", "stale-first", "--deadline-min", "100", "--trigger", "laptop-fallback"], 150);
}

async function cycle(): Promise<void> {
  const tracker = await startRun("worker", "schedule", "laptop");
  try {
    selfUpdate();
    if (envFlag("LINKEDIN_ENABLED")) step("LinkedIn jobs", "scripts/ingest.ts", ["--source", "linkedin-riyadh"], 60);
    if (envFlag("LINKEDIN_POSTS_ENABLED")) {
      const code = step("LinkedIn hiring posts", "scripts/ingest.ts", ["--source", "linkedin-posts"], 40);
      if (code !== 0) {
        await sendSystemAlert(
          "linkedin",
          "LinkedIn needs you",
          "The laptop could not read LinkedIn hiring posts - usually the session expired or LinkedIn asked for a verification step. On the laptop, run: npm run linkedin:login",
        );
      }
    }
    step("AI jury", "scripts/judge.ts", ["--max", String(envInt("WORKER_JUDGE_MAX", 80)), "--deadline-min", "60"], 75);
    step("co-op watch", "scripts/coop-watch.ts", [], 30);
    step("employer discovery", "scripts/discover-employers.ts", [], 30);
    const sent = await sendTimeSensitiveAlerts().catch((err) => {
      log(`alerts failed: ${err instanceof Error ? err.message : err}`);
      return 0;
    });
    if (sent) log(`alerted ${sent} time-sensitive item(s)`);
    await companyPassIfGithubMissed();
    if (tracker) await finishRun(tracker.id, "done");
  } catch (err) {
    log(`cycle failed: ${err instanceof Error ? err.message : err}`);
    if (tracker) await finishRun(tracker.id, "failed", { error: String(err).slice(0, 400) });
  }
}

async function main(): Promise<void> {
  log(`worker starting (cycle every ${CYCLE_MS / 60_000} min)`);
  // Without these every database call fails, and a failure cannot be written
  // to the database - so say it here, where the log is the only witness.
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !envStr(k));
  if (missing.length) {
    log(`MISSING ${missing.join(", ")} - put .env.local in ${process.cwd()} (run: npm run doctor). Retrying in 10 minutes.`);
    await sleep(10 * 60_000);
    process.exit(1); // the task restarts it, re-reading .env.local
  }
  let nextCycle = 0;
  for (;;) {
    try {
      await pickUpQueued();
      if (Date.now() >= nextCycle) {
        await cycle();
        nextCycle = Date.now() + CYCLE_MS;
      }
    } catch (err) {
      log(`loop error: ${err instanceof Error ? err.message : err}`);
    }
    if (ONCE) return;
    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
