import { supabaseAdmin, supabaseRead } from "./db";

/**
 * Collection runs, tracked in the database.
 *
 * The old buttons kept progress in the web server's memory, which broke in
 * every way it could: lost on reload and on hot-reload, invisible on Vercel
 * (where the run could not execute anyway), and frozen at "0 of 520" when a
 * regex parsing log lines was mangled. A row per run, written by whichever
 * machine does the work - GitHub Actions, the laptop, or local dev - fixes
 * all of it: the page reads the row, wherever the run happens.
 */

export type RunScope = "company" | "api" | "linkedin" | "judge" | "worker";
export type RunStatus = "queued" | "running" | "done" | "failed" | "stalled";

export interface Run {
  id: string;
  scope: RunScope;
  status: RunStatus;
  trigger: string;
  runner: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  total: number;
  done: number;
  current: string | null;
  fetched: number;
  kept: number;
  inserted: number;
  failed: number;
  skipped: string[];
  error: string | null;
  github_run_id: string | null;
}

/** A run with no heartbeat for this long is reported as stalled. */
export const STALL_MS = 10 * 60_000;

/** Queue a run. If one is already queued or running for the scope, return that one instead. */
export async function queueRun(scope: RunScope, trigger: string): Promise<{ run: Run; existing: boolean }> {
  const db = supabaseAdmin();
  await markStalled();
  const { data, error } = await db.from("ingest_runs").insert({ scope, trigger }).select("*").single();
  if (!error && data) return { run: data as Run, existing: false };
  // The partial unique index refuses a second live run for the same scope.
  const live = await liveRun(scope);
  if (live) return { run: live, existing: true };
  throw new Error(`could not queue run: ${error?.message ?? "unknown"}`);
}

export async function liveRun(scope: RunScope): Promise<Run | null> {
  const { data } = await supabaseAdmin()
    .from("ingest_runs")
    .select("*")
    .eq("scope", scope)
    .in("status", ["queued", "running"])
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Run) ?? null;
}

export async function latestRun(scope: RunScope): Promise<Run | null> {
  // Readable with the public key too (ingest_runs has a public read policy).
  const { data } = await supabaseRead()
    .from("ingest_runs")
    .select("*")
    .eq("scope", scope)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Run) ?? null;
}

/** Take a queued run for this machine; false if another runner got it first. */
export async function claimRun(id: string, runner: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin()
    .from("ingest_runs")
    .update({ status: "running", runner, started_at: now, heartbeat_at: now, github_run_id: process.env.GITHUB_RUN_ID ?? null })
    .eq("id", id)
    .eq("status", "queued")
    .select("id");
  return (data?.length ?? 0) > 0;
}

/** Start a run that was not queued by a button (a schedule, the CLI). */
export async function startRun(scope: RunScope, trigger: string, runner: string): Promise<Run | null> {
  try {
    const { run, existing } = await queueRun(scope, trigger);
    if (existing && run.status === "running") return null;
    return (await claimRun(run.id, runner)) ? run : null;
  } catch {
    return null;
  }
}

let lastBeat = 0;
/** Progress, written at most every 5 seconds so a fast run does not flood the table. */
export async function heartbeat(id: string, progress: Partial<Pick<Run, "total" | "done" | "current" | "fetched" | "kept" | "inserted" | "failed" | "skipped">>, force = false): Promise<void> {
  if (!force && Date.now() - lastBeat < 5000) return;
  lastBeat = Date.now();
  await supabaseAdmin()
    .from("ingest_runs")
    .update({ ...progress, heartbeat_at: new Date().toISOString() })
    .eq("id", id)
    .then(() => {});
}

export async function finishRun(id: string, status: "done" | "failed", summary: Partial<Run> = {}): Promise<void> {
  await supabaseAdmin()
    .from("ingest_runs")
    .update({ ...summary, status, finished_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() })
    .eq("id", id)
    .then(() => {});
}

/** Runs whose machine went quiet: shown as stalled, and the scope freed. */
export async function markStalled(): Promise<void> {
  const cutoff = new Date(Date.now() - STALL_MS).toISOString();
  await supabaseAdmin()
    .from("ingest_runs")
    .update({ status: "stalled", finished_at: new Date().toISOString() })
    .eq("status", "running")
    .lt("heartbeat_at", cutoff)
    .then(() => {});
  // A queued run nobody picked up within an hour (no GitHub token, laptop off).
  await supabaseAdmin()
    .from("ingest_runs")
    .update({ status: "stalled", finished_at: new Date().toISOString(), error: "no runner picked this up within an hour - is the laptop on, and is GH_DISPATCH_TOKEN set on Vercel?" })
    .eq("status", "queued")
    .lt("requested_at", new Date(Date.now() - 60 * 60_000).toISOString())
    .then(() => {});
}

/** Queued runs waiting for a machine, oldest first (the laptop worker polls this). */
export async function queuedRuns(): Promise<Run[]> {
  const { data } = await supabaseAdmin().from("ingest_runs").select("*").eq("status", "queued").order("requested_at", { ascending: true }).limit(5);
  return (data as Run[]) ?? [];
}

/**
 * Ask GitHub Actions to run the collection now.
 *
 * Needs a fine-grained token (this repo only, Actions: read and write) as
 * GH_DISPATCH_TOKEN and the repo as GH_REPO ("owner/name") on Vercel. Without
 * them the run stays queued and the laptop worker picks it up.
 */
export async function dispatchWorkflow(run: Run): Promise<{ ok: boolean; why?: string }> {
  const token = process.env.GH_DISPATCH_TOKEN?.trim();
  const repo = process.env.GH_REPO?.trim();
  if (!token || !repo) return { ok: false, why: "GH_DISPATCH_TOKEN / GH_REPO not set" };
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/ingest.yml/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: process.env.GH_REF?.trim() || "main", inputs: { run_id: run.id, scope: run.scope } }),
  });
  if (res.status === 204) return { ok: true };
  return { ok: false, why: `GitHub answered ${res.status}` };
}
