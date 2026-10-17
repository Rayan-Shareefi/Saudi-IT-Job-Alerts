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
 *
 * The schedule survives restarts (logs/worker-state.json), LinkedIn is asked at
 * most once an hour, and the launcher (Saudi Job Alert.cmd) shows this log live
 * and can ask for a cycle now (logs/run-now).
 */
import "./load-env";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envFlag, envInt, envStr } from "../src/lib/env";
import { finishRun, latestRun, markStalled, queuedRuns, startRun } from "../src/lib/runs";
import { sendSystemAlert, sendTimeSensitiveAlerts } from "../src/lib/alerts";
import { PROFILE_DIR } from "../src/lib/adapters/linkedin-posts";
import { supabaseAdmin } from "../src/lib/db";
import { sleep } from "../src/lib/http";

const ONCE = process.argv.includes("--once");
const CYCLE_MS = envInt("WORKER_CYCLE_MIN", 120) * 60_000;
const POLL_MS = 2 * 60_000;
const TSX = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

/*
 * Kept on disk so a restart (a self-update, a reboot, the launcher's Restart)
 * resumes the schedule instead of starting a cycle at once - otherwise every
 * restart would ask LinkedIn again. The launcher's "run now" key drops the
 * RUN_NOW file, picked up within one poll.
 */
const STATE_FILE = join("logs", "worker-state.json");
const RUN_NOW = join("logs", "run-now");
/** LinkedIn is asked at most this often, whatever triggers a cycle. */
const LINKEDIN_GAP_MS = 60 * 60_000;

interface WorkerState {
  lastCycleAt?: string;
  linkedinJobsAt?: string;
  linkedinPostsAt?: string;
  /** LinkedIn job listings asked us to slow down this many times in a row. */
  linkedinRefusals?: number;
  /** No LinkedIn job listings before this time (after a refusal). */
  linkedinJobsPauseUntil?: string;
  /** The weekly AI model check (scripts/llm-upgrade.ts). */
  llmUpgradeAt?: string;
}

function readState(): WorkerState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as WorkerState;
  } catch {
    return {};
  }
}

function writeState(change: Partial<WorkerState>): void {
  try {
    mkdirSync("logs", { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...change }, null, 2));
  } catch {
    /* the schedule is a courtesy; never stop the worker over it */
  }
}

/** Minutes since a stored time, or Infinity if never. */
function minutesSince(iso: string | undefined): number {
  return iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : Infinity;
}

/** True if LinkedIn may be asked now; otherwise logs why not. */
function linkedinTurn(key: "linkedinJobsAt" | "linkedinPostsAt", label: string): boolean {
  const state = readState();
  const pause = key === "linkedinJobsAt" && state.linkedinJobsPauseUntil ? new Date(state.linkedinJobsPauseUntil).getTime() : 0;
  if (pause > Date.now()) {
    log(`${label}: LinkedIn asked us to slow down - pausing until ${clock(pause)}`);
    return false;
  }
  const ago = minutesSince(state[key]);
  if (ago * 60_000 < LINKEDIN_GAP_MS) {
    log(`${label}: asked ${Math.round(ago)} min ago - LinkedIn is asked at most once an hour, skipping`);
    return false;
  }
  return true;
}

/*
 * After LinkedIn asks us to slow down, wait longer before each next try - 3,
 * 6, 12, then 24 hours - and back to normal after the first success. On
 * 2026-10-17 the laptop was refused on its first request of every cycle
 * while the PC on the same day was answered: asking every two hours only
 * keeps a limit like that in place.
 */
async function afterLinkedinJobs(): Promise<void> {
  const { data } = await supabaseAdmin().from("source_health").select("error").eq("source_id", "linkedin-riyadh").maybeSingle();
  const refused = /asked us to slow down/i.test(String(data?.error ?? ""));
  const state = readState();
  if (!refused) {
    if (state.linkedinRefusals) writeState({ linkedinRefusals: 0, linkedinJobsPauseUntil: undefined });
    return;
  }
  const n = (state.linkedinRefusals ?? 0) + 1;
  const hours = Math.min(24, 3 * 2 ** (n - 1));
  const until = Date.now() + hours * 3_600_000;
  writeState({ linkedinRefusals: n, linkedinJobsPauseUntil: new Date(until).toISOString() });
  log(`LinkedIn asked us to slow down (${n} time(s) in a row) - next LinkedIn jobs try in ${hours} h, at ${clock(until)}. Not a fault; LinkedIn jobs also arrive through JSearch.`);
}

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
  // Before the run is tracked: an update restarts the worker right here, and
  // the fresh copy runs this cycle (lastCycleAt is not written yet).
  selfUpdate();
  writeState({ lastCycleAt: new Date().toISOString() });
  const tracker = await startRun("worker", "schedule", "laptop");
  try {
    if (envFlag("LINKEDIN_ENABLED") && linkedinTurn("linkedinJobsAt", "LinkedIn jobs")) {
      writeState({ linkedinJobsAt: new Date().toISOString() });
      step("LinkedIn jobs", "scripts/ingest.ts", ["--source", "linkedin-riyadh"], 60);
      await afterLinkedinJobs().catch(() => {});
    }
    if (envFlag("LINKEDIN_POSTS_ENABLED") && linkedinTurn("linkedinPostsAt", "LinkedIn hiring posts")) {
      // Without a saved session nothing is sent to LinkedIn, so it is not a turn.
      if (existsSync(PROFILE_DIR)) writeState({ linkedinPostsAt: new Date().toISOString() });
      const code = step("LinkedIn hiring posts", "scripts/ingest.ts", ["--source", "linkedin-posts"], 40);
      if (code !== 0) {
        await sendSystemAlert(
          "linkedin",
          "LinkedIn needs you",
          "The laptop could not read LinkedIn hiring posts - usually it has not been signed in yet, the session expired, or LinkedIn asked for a verification step. On the laptop, double-click \"Saudi Job Alert\" on the desktop and press L to sign in.",
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
    // Weekly: move to newer free AI models, only ones that pass every test
    // posting (docs/ai-models.md). Recorded first, so a crash cannot repeat it.
    if (minutesSince(readState().llmUpgradeAt) > 7 * 24 * 60) {
      writeState({ llmUpgradeAt: new Date().toISOString() });
      step("AI model check (weekly)", "scripts/llm-upgrade.ts", [], 30);
    }
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
  const last = readState().lastCycleAt;
  let nextCycle = last ? new Date(last).getTime() + CYCLE_MS : 0;
  if (nextCycle > Date.now()) log(`resuming the schedule: next cycle at ${clock(nextCycle)} (press N in the launcher to run now)`);
  for (;;) {
    try {
      await pickUpQueued();
      if (existsSync(RUN_NOW)) {
        unlinkSync(RUN_NOW);
        log("run-now requested");
        nextCycle = 0;
      }
      if (Date.now() >= nextCycle) {
        await cycle();
        nextCycle = Date.now() + CYCLE_MS;
        log(`cycle finished - next at ${clock(nextCycle)}; checking for button runs every 2 min`);
      }
    } catch (err) {
      log(`loop error: ${err instanceof Error ? err.message : err}`);
    }
    if (ONCE) return;
    // Sleep in short steps so a run-now request is noticed within seconds.
    for (let waited = 0; waited < POLL_MS && !existsSync(RUN_NOW); waited += 5000) await sleep(5000);
  }
}

/** Local wall-clock time, for log lines a person reads. */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
