import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { dispatchWorkflow, latestRun, markStalled, queueRun, type RunScope } from "@/lib/runs";
import { usage } from "@/lib/budget";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * "Search for new jobs" and "Search by API".
 *
 * A run takes minutes to hours and opens hundreds of sites with a real browser,
 * which no web request can host - least of all on Vercel. So the button only
 * queues a run (a row in ingest_runs) and hands it to a machine that can do it:
 *
 *   1. GitHub Actions, dispatched here when GH_DISPATCH_TOKEN is set (Vercel);
 *   2. the laptop worker, which picks up queued runs every few minutes;
 *   3. in local dev, a detached child process started right here.
 *
 * Whichever machine runs it writes progress to the row, and GET reads the row,
 * so the progress survives reloads and works from any device.
 */

export async function GET() {
  try {
    // Housekeeping needs the service key; reading progress does not.
    await markStalled().catch(() => {});
    const [company, api, jsearch] = await Promise.all([latestRun("company"), latestRun("api"), usage("jsearch")]);
    return NextResponse.json({ ok: true, runs: { company, api }, jsearch: { used: jsearch.requests, cap: jsearch.cap.requests } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!writeSecret()) {
    return NextResponse.json({ ok: false, error: "Not configured on the server: set REMOVAL_SECRET or CRON_SECRET." }, { status: 503 });
  }
  if (!isAuthorised(req)) return NextResponse.json({ ok: false, error: "That key was not accepted." }, { status: 401 });

  let scope: RunScope = "company";
  let withJsearch = false;
  try {
    const body = (await req.json()) as { scope?: string; jsearch?: boolean };
    if (body.scope === "api") scope = "api";
    withJsearch = body.jsearch === true;
  } catch {
    /* no body: company boards, the safe default */
  }

  const { run, existing } = await queueRun(scope, withJsearch ? "button+jsearch" : "button");
  if (existing) return NextResponse.json({ ok: true, run, existing: true, message: "Already running - following it." });

  // 1. GitHub Actions.
  const dispatched = await dispatchWorkflow(run);
  if (dispatched.ok) return NextResponse.json({ ok: true, run, where: "github" });

  // 3. Local dev: start it here, detached, so it outlives this request.
  if (!process.env.VERCEL) {
    const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    if (existsSync(cli)) {
      const args = [cli, "scripts/ingest.ts", "--run-id", run.id, "--scope", scope];
      if (withJsearch) args.push("--with-jsearch");
      const child = spawn(process.execPath, args, { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      return NextResponse.json({ ok: true, run, where: "this computer" });
    }
  }

  // 2. Otherwise the laptop worker will pick it up.
  return NextResponse.json({
    ok: true,
    run,
    where: "queue",
    message: `Queued. The laptop will start it within a few minutes (${dispatched.why}).`,
  });
}
