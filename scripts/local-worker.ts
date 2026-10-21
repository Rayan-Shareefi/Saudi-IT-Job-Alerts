/**
 * The laptop worker: runs forever, started by Windows Task Scheduler at boot.
 *
 *   npm run worker            # the loop (what the scheduled task runs)
 *   npm run worker -- --once  # one cycle, then exit (for testing)
 *
 * Every 2 minutes: start any run someone queued with a button on the site.
 * Every cycle (2 hours by default, WORKER_CYCLE_MIN) - printed first as a
 * plan with a time estimate per step and a "done around" time:
 *
 *   1. update itself from GitHub (git pull + npm ci when dependencies change),
 *      so a fix pushed once reaches the laptop without anyone touching it;
 *   2. LinkedIn job listings and company hiring posts, pictures read too
 *      (home IP, this machine holds the signed-in profile);
 *   3. the other job platforms (Workable, Sabbar, Jooble, Careerjet) that no
 *      machine has read in three hours;
 *   4. every company site, when asked (launcher F) or when GitHub's pass has
 *      not succeeded in 26 hours;
 *   5. the AI jury over what the rules could not settle, with the local
 *      Ollama model as an extra, unlimited juror; then instant alerts;
 *   6. co-op watch, employer discovery, and the weekly AI model check.
 *
 * Each step is a separate child process: a crash in one step never stops the
 * worker, and every step runs the code currently on disk (a long-lived process
 * holds the code it started with - HANDOVER §8).
 *
 * The schedule survives restarts (logs/worker-state.json), LinkedIn is asked at
 * most once an hour, and the launcher (Saudi Job Alert.cmd) shows this log live
 * and can ask for a search now (logs/run-now), a full one (logs/run-full) or a
 * restart into new code (logs/restart).
 */
import "./load-env";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envFlag, envInt, envStr } from "../src/lib/env";
import { finishRun, latestRun, markStalled, queuedRuns, recordVersion, startRun } from "../src/lib/runs";
import { codeVersion } from "./code-version";
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
/** The launcher's F key: a cycle now that also reads every company site. */
const RUN_FULL = join("logs", "run-full");
/** The launcher, after updating the code: restart into it (the supervisor loop starts the new copy). */
const RESTART = join("logs", "restart");
/** LinkedIn is asked at most this often, whatever triggers a cycle. */
const LINKEDIN_GAP_MS = 60 * 60_000;

interface WorkerState {
  lastCycleAt?: string;
  linkedinJobsAt?: string;
  linkedinPostsAt?: string;
  linkedinCompaniesAt?: string;
  /** LinkedIn job listings asked us to slow down this many times in a row. */
  linkedinRefusals?: number;
  /** No LinkedIn job listings before this time (after a refusal). */
  linkedinJobsPauseUntil?: string;
  /** The weekly AI model check (scripts/llm-upgrade.ts). */
  llmUpgradeAt?: string;
  /** The last source-repair pass (scripts/fix-sources.ts). */
  fixRunAt?: string;
  /** How long each step takes on this machine, in minutes (for the time estimates). */
  stepMinutes?: Record<string, number>;
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
function linkedinTurn(key: "linkedinJobsAt" | "linkedinPostsAt" | "linkedinCompaniesAt", label: string): boolean {
  const state = readState();
  // A refusal pauses every request to LinkedIn without a login: job listings and company pages share the limit.
  const pause = key !== "linkedinPostsAt" && state.linkedinJobsPauseUntil ? new Date(state.linkedinJobsPauseUntil).getTime() : 0;
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
async function afterLinkedinJobs(sourceId = "linkedin-riyadh"): Promise<void> {
  const { data } = await supabaseAdmin().from("source_health").select("error,kept").eq("source_id", sourceId).maybeSingle();
  const status = String(data?.error ?? "");
  const refused = /asked us to slow down/i.test(status);
  const state = readState();
  if (!refused) {
    if (state.linkedinRefusals) writeState({ linkedinRefusals: 0, linkedinJobsPauseUntil: undefined });
    return;
  }
  // Stopped part-way, but with listings read and kept: progress, so no
  // growing pause - just the usual rest before asking again.
  if (status.startsWith("partial:")) {
    const until = Date.now() + 3 * 3_600_000;
    writeState({ linkedinRefusals: 0, linkedinJobsPauseUntil: new Date(until).toISOString() });
    log(`LinkedIn stopped us part-way; the listings read before that are kept. Next LinkedIn jobs pass at ${clock(until)}.`);
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
function step(name: string, script: string, args: string[] = [], timeoutMin = 90, note = "", extraEnv: Record<string, string> = {}): number {
  log(`> ${name}${note ? ` (${note})` : ""}`);
  const r = spawnSync(process.execPath, [TSX, script, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    timeout: timeoutMin * 60_000,
    windowsHide: true,
    env: { ...process.env, WORKER_NAME: "laptop", ...extraEnv },
  });
  const code = r.status ?? (r.error ? 1 : 0);
  log(`< ${name} exited ${code}${r.error ? ` (${r.error.message})` : ""}`);
  return code;
}

/*
 * Exit code for "start me again": the scheduled task runs the worker inside a
 * loop (install-worker.ps1) that starts a fresh copy after it exits. Task
 * Scheduler's own "restart on failure" never fires for a program that exits
 * by itself, so the first version would have stopped for good after its
 * first self-update.
 */
const RESTART_FOR_UPDATE = 75;

function head(): string {
  return spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).stdout?.trim() ?? "";
}

/** "abc1234 from 2026-10-21 14:05 - what changed", for the log. */
function version(): string {
  const r = spawnSync("git", ["log", "-1", "--format=%h from %cd - %s", "--date=format:%Y-%m-%d %H:%M"], { encoding: "utf8", windowsHide: true });
  return r.stdout?.trim().slice(0, 110) || "unknown (not a git copy)";
}

/*
 * Files changed on the laptop block every later `git pull`, and the worker
 * then runs old code for good. When the only changes are line endings (an
 * editor or a .gitattributes change can cause that), set them aside in git
 * stash - recoverable, nothing lost - and pull again. Real edits are left
 * alone and reported; the launcher's U key offers to set them aside.
 */
/** This copy and GitHub's share no line of history to fast-forward along. */
function historyRewritten(): boolean {
  const fetched = spawnSync("git", ["fetch", "origin"], { windowsHide: true, env: GIT_NO_PROMPT, timeout: 5 * 60_000 }).status === 0;
  if (!fetched) return false;
  const behind = spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], { windowsHide: true }).status === 0;
  const ahead = spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], { windowsHide: true }).status === 0;
  return !behind && !ahead;
}

function onlyLineEndingsChanged(): boolean {
  const any = spawnSync("git", ["diff", "--quiet"], { windowsHide: true }).status === 1;
  const real = spawnSync("git", ["diff", "--quiet", "--ignore-cr-at-eol"], { windowsHide: true }).status === 1;
  return any && !real;
}

/*
 * The scheduled task has no desktop, so a credential prompt (a private repo,
 * an expired sign-in) would wait forever for a click nobody can make. Fail
 * fast instead; the worker carries on with the code on disk.
 */
const GIT_NO_PROMPT = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

function selfUpdate(): void {
  // A folder copied rather than cloned has no .git and can never update: the
  // laptop ran its first copy's code for days without a word (2026-10-21).
  if (!existsSync(".git")) {
    log(`NOT a git copy: this folder cannot update itself and runs old code. One-time fix: see "The laptop folder is not a git copy" in docs/laptop-setup.md. Running: ${process.cwd()}`);
    return;
  }
  const before = head();
  const lockBefore = existsSync("package-lock.json") ? readFileSync("package-lock.json", "utf8") : "";
  const pullOnce = () => spawnSync("git", ["pull", "--ff-only"], { stdio: "inherit", windowsHide: true, env: GIT_NO_PROMPT, timeout: 5 * 60_000 });
  let pull = pullOnce();
  if (pull.status !== 0 && onlyLineEndingsChanged()) {
    log("update blocked by line-ending changes only - setting them aside (git stash) and updating");
    spawnSync("git", ["stash", "push", "-m", `line endings set aside by the worker ${new Date().toISOString().slice(0, 16)}`], { stdio: "inherit", windowsHide: true });
    pull = pullOnce();
  }
  /*
   * GitHub's history was rewritten when the repo went public (2026-10-21), so
   * a copy cloned before then can never fast-forward: the laptop kept running
   * old code for a day and overwrote the board with the old checker policy.
   * The old copy is kept on a branch and any local edits in git stash -
   * nothing is lost - and the laptop moves to GitHub's version.
   */
  if (pull.status !== 0 && historyRewritten()) {
    const keep = `laptop-before-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
    log(`GitHub's history was rewritten, so this copy cannot update by pulling - keeping it on branch ${keep} and moving to GitHub's version`);
    spawnSync("git", ["branch", keep], { stdio: "inherit", windowsHide: true });
    spawnSync("git", ["stash", "push", "-m", `set aside before moving to GitHub's history (${keep})`], { stdio: "inherit", windowsHide: true });
    pull = spawnSync("git", ["reset", "--hard", "origin/main"], { stdio: "inherit", windowsHide: true });
  }
  if (pull.status !== 0) {
    const changed = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", windowsHide: true }).stdout?.trim();
    log(
      changed
        ? `NOT updated: files changed on this laptop block the update (${changed.split(/\r?\n/).slice(0, 4).join("; ")}) - press U in the launcher to set them aside. Running: ${version()}`
        : `NOT updated: git pull failed (no internet?) - running: ${version()}`,
    );
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
    log(`updated to ${version()} - restarting the worker into it`);
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
  /*
   * URLs pasted on the fix pages, and their "Find fixes" buttons. A URL the
   * user pasted is checked at once; the many automatic checks one "Find
   * fixes" press creates go 25 at a time, at most every 45 minutes, so the
   * searches themselves still run on time.
   */
  const db = supabaseAdmin();
  const { count: mine } = await db.from("source_fixes").select("id", { count: "exact", head: true }).eq("status", "queued").eq("requested_by", "user");
  const { count: auto } = await db.from("source_fixes").select("id", { count: "exact", head: true }).eq("status", "queued").eq("requested_by", "auto");
  if (mine || (auto && minutesSince(readState().fixRunAt) >= 45)) {
    writeState({ fixRunAt: new Date().toISOString() });
    step("source repair", "scripts/fix-sources.ts", ["--max", "25", "--deadline-min", "40"], 50, `${mine ?? 0} from you, ${auto ?? 0} automatic waiting`);
  }
}

/** True when GitHub's company-board pass has not succeeded in 26 hours. */
async function githubMissedCompanies(): Promise<boolean> {
  const last = await latestRun("company");
  const lastGood = last && last.status === "done" ? new Date(last.finished_at ?? last.requested_at).getTime() : 0;
  return Date.now() - lastGood >= 26 * 3_600_000;
}

/*
 * The job platforms besides LinkedIn. GitHub's fast pass also reads them
 * every four hours, so the laptop reads only the ones nobody has read in the
 * last three - it fills gaps instead of asking every site twice.
 */
const PLATFORMS = ["workable-riyadh", "sabbar-riyadh", "telegram-channels", "jooble-riyadh", "careerjet-riyadh"];

async function stalePlatforms(): Promise<string[]> {
  const { data } = await supabaseAdmin().from("source_health").select("source_id,last_run_at").in("source_id", PLATFORMS);
  const last = new Map((data ?? []).map((r) => [String(r.source_id), new Date(String(r.last_run_at)).getTime()]));
  return PLATFORMS.filter((id) => Date.now() - (last.get(id) ?? 0) >= 3 * 3_600_000);
}

interface Planned {
  key: string;
  name: string;
  script: string;
  args: string[];
  timeoutMin: number;
  /** Checked again just before the step runs: false skips it. */
  when?: () => boolean;
  after?: (code: number) => Promise<void>;
  /** Settings for this step only (a full search reads further back). */
  env?: Record<string, string>;
}

/** First guesses, in minutes; replaced by how long each step really took on this laptop. */
const FIRST_GUESS: Record<string, number> = {
  "linkedin-jobs": 4,
  "linkedin-posts": 5,
  "linkedin-companies": 4,
  platforms: 6,
  companies: 100,
  jury: 20,
  coop: 3,
  discovery: 15,
  models: 10,
};

function estimate(key: string): number {
  return readState().stepMinutes?.[key] ?? FIRST_GUESS[key] ?? 5;
}

/** Keep a running average of how long a step takes here, for the next estimate. */
function learn(key: string, minutes: number): void {
  const known = readState().stepMinutes ?? {};
  const before = known[key];
  writeState({ stepMinutes: { ...known, [key]: before === undefined ? minutes : before * 0.5 + minutes * 0.5 } });
}

async function plan(full: boolean): Promise<Planned[]> {
  const steps: Planned[] = [];
  if (envFlag("LINKEDIN_ENABLED") && linkedinTurn("linkedinJobsAt", "LinkedIn jobs")) {
    steps.push({
      key: "linkedin-jobs",
      name: "LinkedIn jobs",
      script: "scripts/ingest.ts",
      args: ["--source", "linkedin-riyadh"],
      timeoutMin: 60,
      after: async () => {
        writeState({ linkedinJobsAt: new Date().toISOString() });
        await afterLinkedinJobs().catch(() => {});
      },
    });
  }
  /*
   * Company pages, without signing in: their hiring, co-op and internship
   * posts. Replaced the signed-in post search as the way to read posts
   * (2026-10-21): that search mixed in adverts and AI-written posts, and its
   * page showed the reader nothing at all.
   */
  if (envFlag("LINKEDIN_ENABLED") && linkedinTurn("linkedinCompaniesAt", "LinkedIn company pages")) {
    steps.push({
      key: "linkedin-companies",
      name: "LinkedIn company pages",
      // If the job listings were refused moments ago, this waits too.
      when: () => !(readState().linkedinJobsPauseUntil && Date.parse(readState().linkedinJobsPauseUntil as string) > Date.now()),
      script: "scripts/ingest.ts",
      args: ["--source", "linkedin-companies"],
      timeoutMin: 40,
      after: async () => {
        writeState({ linkedinCompaniesAt: new Date().toISOString() });
        await afterLinkedinJobs("linkedin-companies").catch(() => {});
      },
    });
  }
  // The old signed-in post search, only if asked for (LINKEDIN_SEARCH_POSTS=1).
  if (envFlag("LINKEDIN_POSTS_ENABLED") && envFlag("LINKEDIN_SEARCH_POSTS") && linkedinTurn("linkedinPostsAt", "LinkedIn hiring posts")) {
    steps.push({
      key: "linkedin-posts",
      name: "LinkedIn hiring posts",
      script: "scripts/ingest.ts",
      args: ["--source", "linkedin-posts"],
      timeoutMin: 40,
      after: async (code) => {
        // Without a saved session nothing is sent to LinkedIn, so it is not a turn.
        if (existsSync(PROFILE_DIR)) writeState({ linkedinPostsAt: new Date().toISOString() });
        if (code !== 0) {
          await sendSystemAlert(
            "linkedin",
            "LinkedIn needs you",
            "The laptop could not read LinkedIn hiring posts - usually it has not been signed in yet, the session expired, or LinkedIn asked for a verification step. On the laptop, double-click \"Saudi Job Alert\" on the desktop and press L to sign in.",
          );
        }
      },
    });
  }
  // A full search (F) reads every platform; otherwise only those due.
  const platforms = full ? PLATFORMS : await stalePlatforms().catch(() => PLATFORMS);
  if (platforms.length) {
    steps.push({ key: "platforms", name: `Job platforms (${platforms.map((p) => p.replace(/-(riyadh|channels)$/, "")).join(", ")})`, script: "scripts/ingest.ts", args: ["--source", platforms.join(",")], timeoutMin: 45, env: full ? { TELEGRAM_PAGES: "15" } : {} });
  }
  if (full || (await githubMissedCompanies().catch(() => false))) {
    if (!full) log("no successful company-board pass in 26h - running it here");
    steps.push({ key: "companies", name: "Company sites (every employer board)", script: "scripts/ingest.ts", args: ["--scope", "company", "--no-metered", "--order", "stale-first", "--deadline-min", "120", "--trigger", full ? "laptop-full" : "laptop-fallback"], timeoutMin: 150 });
  }
  steps.push({ key: "jury", name: "AI jury", script: "scripts/judge.ts", args: ["--max", String(envInt("WORKER_JUDGE_MAX", 80)), "--deadline-min", "60"], timeoutMin: 75 });
  steps.push({ key: "coop", name: "co-op watch", script: "scripts/coop-watch.ts", args: [], timeoutMin: 30 });
  steps.push({ key: "discovery", name: "employer discovery", script: "scripts/discover-employers.ts", args: [], timeoutMin: 30 });
  // Weekly: move to newer free AI models, only ones that pass every test
  // posting (docs/ai-models.md). Recorded first, so a crash cannot repeat it.
  if (minutesSince(readState().llmUpgradeAt) > 7 * 24 * 60) {
    writeState({ llmUpgradeAt: new Date().toISOString() });
    steps.push({ key: "models", name: "AI model check (weekly)", script: "scripts/llm-upgrade.ts", args: [], timeoutMin: 30 });
  }
  return steps;
}

async function cycle(full = false): Promise<void> {
  // Before the run is tracked: an update restarts the worker right here, and
  // the fresh copy runs this cycle (lastCycleAt is not written yet).
  selfUpdate();
  writeState({ lastCycleAt: new Date().toISOString() });
  const tracker = await startRun("worker", full ? "full" : "schedule", "laptop");
  if (tracker) await recordVersion(tracker.id, codeVersion());
  try {
    const steps = await plan(full);
    const total = steps.reduce((sum, s) => sum + estimate(s.key), 0);
    log(`search plan: ${steps.map((s) => `${s.name} ~${Math.max(1, Math.round(estimate(s.key)))} min`).join(" | ")}`);
    log(`this search takes about ${Math.max(1, Math.round(total))} min - done around ${clock(Date.now() + total * 60_000)}`);
    let left = total;
    for (const s of steps) {
      left -= estimate(s.key);
      if (s.when && !s.when()) {
        log(`${s.name}: skipped - LinkedIn asked us to slow down a moment ago`);
        continue;
      }
      const started = Date.now();
      const code = step(s.name, s.script, s.args, s.timeoutMin, `about ${Math.max(1, Math.round(estimate(s.key)))} min; everything done around ${clock(Date.now() + (estimate(s.key) + left) * 60_000)}`, s.env);
      learn(s.key, (Date.now() - started) / 60_000);
      await s.after?.(code);
      // Instant alerts as soon as the jury has spoken, not at the very end.
      if (s.key === "jury") {
        const sent = await sendTimeSensitiveAlerts().catch((err) => {
          log(`alerts failed: ${err instanceof Error ? err.message : err}`);
          return 0;
        });
        if (sent) log(`alerted ${sent} time-sensitive item(s)`);
      }
    }
    if (tracker) await finishRun(tracker.id, "done");
  } catch (err) {
    log(`cycle failed: ${err instanceof Error ? err.message : err}`);
    if (tracker) await finishRun(tracker.id, "failed", { error: String(err).slice(0, 400) });
  }
}

async function main(): Promise<void> {
  log(`worker starting (cycle every ${CYCLE_MS / 60_000} min) - version ${version()}`);
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
      if (existsSync(RESTART)) {
        unlinkSync(RESTART);
        log("restart requested (new code) - starting a fresh copy");
        process.exit(RESTART_FOR_UPDATE);
      }
      let full = false;
      if (existsSync(RUN_FULL)) {
        unlinkSync(RUN_FULL);
        log("full search requested - every company site this time too");
        full = true;
        nextCycle = 0;
      }
      if (existsSync(RUN_NOW)) {
        unlinkSync(RUN_NOW);
        log("search-now requested");
        nextCycle = 0;
      }
      if (Date.now() >= nextCycle) {
        await cycle(full);
        nextCycle = Date.now() + CYCLE_MS;
        log(`cycle finished - next at ${clock(nextCycle)}; checking for button runs every 2 min`);
      }
    } catch (err) {
      log(`loop error: ${err instanceof Error ? err.message : err}`);
    }
    if (ONCE) return;
    // Sleep in short steps so a run-now request is noticed within seconds.
    const asked = () => existsSync(RUN_NOW) || existsSync(RUN_FULL) || existsSync(RESTART);
    for (let waited = 0; waited < POLL_MS && !asked(); waited += 5000) await sleep(5000);
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
