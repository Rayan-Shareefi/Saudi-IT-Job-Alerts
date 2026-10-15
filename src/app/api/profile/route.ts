import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Store the parsed CV profile (skills, certifications, years) server-side.
 *
 * Never the CV itself: the file is parsed in the browser and discarded. The
 * profile lives on the server so the Recommended badge works on every device
 * and in the emails, not only in the browser that read the CV.
 */
export async function POST(req: Request) {
  if (!writeSecret()) {
    return NextResponse.json({ ok: false, error: "Not configured on the server: set REMOVAL_SECRET or CRON_SECRET." }, { status: 503 });
  }
  if (!isAuthorised(req)) return NextResponse.json({ ok: false, error: "That key was not accepted." }, { status: 401 });
  let body: { profile?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const p = body.profile as { skills?: unknown } | null;
  if (!p || !Array.isArray(p.skills)) return NextResponse.json({ ok: false, error: "profile with skills required" }, { status: 400 });
  // Bounded: a profile is a short list of skills and a band, never a document.
  if (JSON.stringify(p).length > 20_000) return NextResponse.json({ ok: false, error: "profile too large" }, { status: 413 });
  const { error } = await supabaseAdmin().from("user_profile").upsert({ id: "me", profile: p, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!isAuthorised(req)) return NextResponse.json({ ok: false, error: "That key was not accepted." }, { status: 401 });
  const { error } = await supabaseAdmin().from("user_profile").delete().eq("id", "me");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
