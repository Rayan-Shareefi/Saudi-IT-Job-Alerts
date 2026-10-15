import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { recomputeStates } from "@/lib/review";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The user's own Keep / Hide on a posting - the last word.
 *
 * Writes human_override, which beats every rule and every model (state.ts),
 * survives every future run, and is exported as a regression case and shown to
 * the senior reviewer as an example of where the line is. "clear" hands the
 * posting back to the rules and the jury.
 */
export async function POST(req: Request) {
  if (!writeSecret()) {
    return NextResponse.json({ ok: false, error: "Not configured on the server: set REMOVAL_SECRET or CRON_SECRET." }, { status: 503 });
  }
  if (!isAuthorised(req)) return NextResponse.json({ ok: false, error: "That key was not accepted." }, { status: 401 });

  let body: { jobId?: string; decision?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const { jobId, decision } = body;
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ ok: false, error: "jobId required" }, { status: 400 });
  if (decision !== "show" && decision !== "hide" && decision !== "clear") {
    return NextResponse.json({ ok: false, error: "decision must be show, hide or clear" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const override = decision === "clear" ? null : decision;
  const { error } = await db.from("jobs").update({ human_override: override }).eq("id", jobId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await db.from("audit_log").insert({
    actor: "user",
    action: `decide:${decision}`,
    job_id: jobId,
    detail: { note: body.note?.slice(0, 300) ?? null },
  });

  // Apply it now, so the card moves before the next scheduled run.
  try {
    const [r] = await recomputeStates({ ids: [jobId] });
    return NextResponse.json({ ok: true, state: r?.decision.state ?? null, reason: r?.decision.hiddenReason ?? null });
  } catch (err) {
    return NextResponse.json({ ok: true, state: null, warning: err instanceof Error ? err.message : String(err) });
  }
}
