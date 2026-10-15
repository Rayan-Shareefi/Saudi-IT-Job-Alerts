import { Resend } from "resend";
import { renderDigest } from "./email";
import { jobsForDigest, markNotified, supabaseAdmin } from "./db";
import { envStr } from "./env";
import { loadProfile } from "./board";
import { scoreJob } from "./resume";
import type { JobRecord } from "./types";

/**
 * One digest implementation for the scheduled script and the HTTP route.
 *
 * They used to be two copies that drifted: both read `DIGEST_FROM ?? default`,
 * so a blank GitHub secret reached Resend as `from: ""` and every scheduled
 * digest from 2026-09-04 onwards failed with "Invalid `from` field". The route
 * never recorded failures at all, so the only trace was GitHub's
 * "All jobs have failed" email.
 */

export const DEFAULT_SENDER = "Saudi Job Alert <onboarding@resend.dev>";

/** `a@b.c` or `Name <a@b.c>` - the two shapes Resend accepts. */
const SENDER_SHAPE = /^(?:[^<>@\s][^<>@]*\s)?<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/;

export function validSender(value: string): boolean {
  const v = value.trim();
  if (!SENDER_SHAPE.test(v)) return false;
  // Angle brackets come as a pair or not at all.
  return v.includes("<") === v.includes(">");
}

/** The configured sender, or the Resend sandbox address when none is set. */
export function resolveSender(): { from: string; problem: string | null } {
  const configured = envStr("DIGEST_FROM");
  if (!configured) return { from: DEFAULT_SENDER, problem: null };
  if (validSender(configured)) return { from: configured, problem: null };
  return {
    from: DEFAULT_SENDER,
    problem:
      `DIGEST_FROM is set but is not a valid sender ("Name <a@b.c>" or "a@b.c"); ` +
      `using ${DEFAULT_SENDER} instead`,
  };
}

export interface DigestOutcome {
  ok: boolean;
  sent: boolean;
  jobs: number;
  reason?: string;
  id?: string;
  warnings: string[];
}

async function recordRun(row: {
  recipient: string;
  job_count: number;
  window_start: string;
  window_end: string;
  ok: boolean;
  error?: string | null;
}): Promise<string | null> {
  const { error } = await supabaseAdmin().from("digest_runs").insert(row);
  return error ? `could not record digest run: ${error.message}` : null;
}

export async function sendDigest(opts: {
  days: number;
  appUrl?: string;
  /** Pre-fetched rows, for previews; normally read from the database. */
  jobs?: JobRecord[];
}): Promise<DigestOutcome> {
  const warnings: string[] = [];
  const windowEnd = new Date();
  const windowStart = new Date(Date.now() - opts.days * 86_400_000);

  const apiKey = envStr("RESEND_API_KEY");
  const to = envStr("DIGEST_TO");
  if (!apiKey || !to) {
    return {
      ok: false,
      sent: false,
      jobs: 0,
      reason: "RESEND_API_KEY and DIGEST_TO must both be set (blank counts as unset)",
      warnings,
    };
  }

  const { from, problem } = resolveSender();
  if (problem) warnings.push(problem);

  const jobs = opts.jobs ?? (await jobsForDigest(windowStart.toISOString()));
  const window = { window_start: windowStart.toISOString(), window_end: windowEnd.toISOString() };

  if (jobs.length === 0) {
    const w = await recordRun({ recipient: to, job_count: 0, ...window, ok: true });
    if (w) warnings.push(w);
    return { ok: true, sent: false, jobs: 0, reason: "no new postings in the window", warnings };
  }

  // The CV profile stored on the server (board.ts) decides "Recommended" here too.
  const recommended = new Set<string>();
  const profile = await loadProfile();
  if (profile) for (const j of jobs) if (scoreJob(j, profile).recommended) recommended.add(j.id);

  const { subject, html, text } = renderDigest({ jobs, windowStart, windowEnd, appUrl: opts.appUrl, recommended });
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: to.split(",").map((s) => s.trim()).filter(Boolean),
    subject,
    html,
    text,
  });

  if (error) {
    const w = await recordRun({ recipient: to, job_count: jobs.length, ...window, ok: false, error: error.message });
    if (w) warnings.push(w);
    return { ok: false, sent: false, jobs: jobs.length, reason: `Resend refused the email: ${error.message}`, warnings };
  }

  // The email is out. Record it before marking rows, so a marking failure
  // cannot make a successful send look like a failed one.
  const w = await recordRun({ recipient: to, job_count: jobs.length, ...window, ok: true });
  if (w) warnings.push(w);
  try {
    await markNotified(jobs.map((j) => j.id));
  } catch (err) {
    warnings.push(`sent, but could not mark rows notified: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ok: true, sent: true, jobs: jobs.length, id: data?.id, warnings };
}
