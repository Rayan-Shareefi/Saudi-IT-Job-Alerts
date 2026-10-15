import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Save, unsave, or mark a job applied.
 *
 * Pressing Apply on a card saves the job with applied_at, so everything the
 * user applied to is in the Saved tab without a second click. Saved jobs are
 * stored server-side (not per browser) so the list is the same on the laptop,
 * the PC and the phone.
 */
export async function POST(req: Request) {
  if (!writeSecret()) {
    return NextResponse.json({ ok: false, error: "Not configured on the server: set REMOVAL_SECRET or CRON_SECRET." }, { status: 503 });
  }
  if (!isAuthorised(req)) return NextResponse.json({ ok: false, error: "That key was not accepted." }, { status: 401 });

  let body: { jobId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const { jobId, action } = body;
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ ok: false, error: "jobId required" }, { status: 400 });

  const db = supabaseAdmin();
  if (action === "unsave") {
    const { error } = await db.from("saved_jobs").delete().eq("job_id", jobId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, saved: false });
  }
  if (action === "save" || action === "applied") {
    const row: Record<string, unknown> = { job_id: jobId };
    if (action === "applied") row.applied_at = new Date().toISOString();
    // Upsert keeps the original saved_at when an already-saved job is applied to.
    const { error } = await db.from("saved_jobs").upsert(row, { onConflict: "job_id", ignoreDuplicates: false });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, saved: true, applied: action === "applied" });
  }
  return NextResponse.json({ ok: false, error: "action must be save, unsave or applied" }, { status: 400 });
}
