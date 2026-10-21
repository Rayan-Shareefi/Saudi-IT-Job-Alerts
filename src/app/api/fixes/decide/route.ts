import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { decide, fixRowFrom, type FixDecision } from "@/lib/source-fix";

export const dynamic = "force-dynamic";

const DECISIONS: FixDecision[] = ["keep", "delete", "linkedin", "replace", "accept", "undo"];

/**
 * The user's choice on a fix the checker could not settle (or Undo on one it
 * applied). Recorded with the fix, so later checks learn from it.
 */
export async function POST(req: Request) {
  if (!writeSecret()) return NextResponse.json({ ok: false, error: "not configured: set REMOVAL_SECRET" }, { status: 503 });
  if (!isAuthorised(req)) return NextResponse.json({ ok: false, error: "not authorised" }, { status: 401 });
  let body: { id?: string; decision?: FixDecision; url?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.id || !body.decision || !DECISIONS.includes(body.decision)) {
    return NextResponse.json({ ok: false, error: "id and a decision are required" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin().from("source_fixes").select("*").eq("id", body.id).maybeSingle();
  if (error || !data) return NextResponse.json({ ok: false, error: error?.message ?? "no such fix" }, { status: 404 });
  try {
    const result = await decide(fixRowFrom(data), body.decision, { url: body.url });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
