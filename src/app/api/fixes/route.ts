import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { latestFixes, queueFix, type FixPage } from "@/lib/source-fix";

export const dynamic = "force-dynamic";

const PAGES: FixPage[] = ["human", "sites", "failing", "urls"];

/**
 * Repairs to the sites the collector reads (src/lib/source-fix.ts).
 *
 * GET  - the latest fix per card, for the pages to show progress.
 * POST - queue one: a URL the user pasted on a card, or "Find fixes" for a
 *        whole page ({ page, all: true }). The laptop checks the queue every
 *        two minutes (scripts/fix-sources.ts) - checking needs a browser and
 *        minutes per site, which a Vercel function has neither of.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = url.searchParams.get("page");
  const company = url.searchParams.get("company");
  const all = await latestFixes();
  const rows = Object.values(all).filter((f) => (!page || f.page === page) && (!company || f.company === company));
  return NextResponse.json({ ok: true, fixes: rows });
}

interface Body {
  page?: FixPage;
  all?: boolean;
  company?: string;
  sourceId?: string;
  oldUrl?: string;
  newUrl?: string;
}

export async function POST(req: Request) {
  if (!writeSecret()) return NextResponse.json({ ok: false, error: "not configured: set REMOVAL_SECRET" }, { status: 503 });
  if (!isAuthorised(req)) return NextResponse.json({ ok: false, error: "not authorised" }, { status: 401 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.page || !PAGES.includes(body.page)) return NextResponse.json({ ok: false, error: "page must be one of " + PAGES.join(", ") }, { status: 400 });
  const newUrl = body.newUrl?.trim() || null;
  if (newUrl && !/^https?:\/\//i.test(newUrl)) return NextResponse.json({ ok: false, error: "paste a full URL starting with https://" }, { status: 400 });
  if (!body.all && !body.company?.trim()) return NextResponse.json({ ok: false, error: "company is required" }, { status: 400 });
  // Bounded: the laptop works through whatever is queued here.
  if ((newUrl?.length ?? 0) > 1000 || (body.oldUrl?.length ?? 0) > 1000 || (body.company?.length ?? 0) > 200 || (body.sourceId?.length ?? 0) > 120) {
    return NextResponse.json({ ok: false, error: "too long" }, { status: 400 });
  }

  try {
    const fix = await queueFix({
      company: body.all ? "*" : (body.company as string).trim(),
      page: body.page,
      sourceId: body.sourceId ?? null,
      oldUrl: body.oldUrl ?? null,
      newUrl,
      requestedBy: "user",
    });
    return NextResponse.json({
      ok: true,
      fix,
      message: body.all
        ? "Queued: the laptop checks every card on this page, a few at a time, and fixes what it can by itself."
        : "Queued: the laptop checks it within a few minutes and replaces the URL if it works.",
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
