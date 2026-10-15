import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { clearUrlDecision, saveUrlDecision, type UrlRole } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Accept or dismiss one proposed careers URL.
 *
 * Gated by the same key as posting removal. The board is readable by anyone
 * with the link, and this decides which URLs the collector polls - pointing an
 * employer at the wrong page makes it silently produce nothing, so it is not
 * something a passing visitor should be able to do.
 */

interface Body {
  company?: string;
  url?: string;
  role?: UrlRole;
  /** "accepted" adds it, "rejected" dismisses it, "clear" undoes either. */
  decision?: "accepted" | "rejected" | "clear";
}

export async function POST(req: Request) {
  if (!writeSecret()) {
    return NextResponse.json(
      { ok: false, error: "not configured: set REMOVAL_SECRET" },
      { status: 503 },
    );
  }
  if (!isAuthorised(req)) {
    return NextResponse.json({ ok: false, error: "not authorised" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const company = body.company?.trim();
  const url = body.url?.trim();
  if (!company || !url) {
    return NextResponse.json({ ok: false, error: "company and url are required" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: "url must be http(s)" }, { status: 400 });
  }

  const role: UrlRole = body.role === "primary" ? "primary" : "alternate";

  try {
    if (body.decision === "clear") {
      await clearUrlDecision(company, url);
      return NextResponse.json({ ok: true, decision: "clear" });
    }
    const decision = body.decision === "accepted" ? "accepted" : "rejected";
    await saveUrlDecision(company, url, role, decision);
    return NextResponse.json({ ok: true, decision, role });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
