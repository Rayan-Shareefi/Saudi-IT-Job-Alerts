import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { COMPANIES } from "@/lib/sources/companies";
import { queueFix } from "@/lib/source-fix";

export const dynamic = "force-dynamic";

/**
 * Add a careers URL you found yourself.
 *
 * The checker only proposes what it stumbles across; plenty of boards are
 * simply not linked from anywhere it looks. This takes a URL, works out the
 * employer, and queues it for the laptop, which opens it and adds it only if
 * real postings come off it (scripts/fix-sources.ts).
 *
 * It used to open the page right here, in a browser - which a Vercel function
 * does not have ("browserType.launch: Executable doesn't exist", 2026-10-21).
 */
interface Body {
  url?: string;
  /** Optional: which employer it belongs to. Guessed from the URL when absent. */
  company?: string;
  /** "primary" replaces the employer's careers URL; "alternate" adds a board. */
  role?: "primary" | "alternate";
}

/**
 * Which employer a URL most likely belongs to.
 *
 * Matched on the hostname, because a careers URL almost always sits on the
 * employer's own domain or names them in an ATS path
 * (`apply.workable.com/qiddiya-investment-company-1`).
 */
function guessCompany(url: string): string | null {
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "").toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }

  const registryHost = (raw: string): string => {
    try {
      return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  };

  // An employer already on file with the same host.
  const sameHost = COMPANIES.find((c) => registryHost(c.careersUrl) === host);
  if (sameHost) return sameHost.name;

  // Otherwise the employer whose name appears in the host or the path.
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const haystack = slug(`${host}${path}`);
  let best: { name: string; len: number } | null = null;
  for (const c of COMPANIES) {
    const key = slug(c.name);
    if (key.length < 5) continue;
    if (haystack.includes(key) && (!best || key.length > best.len)) {
      best = { name: c.name, len: key.length };
    }
  }
  return best?.name ?? null;
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

  const url = body.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { ok: false, error: "a full http(s) URL is required" },
      { status: 400 },
    );
  }

  const company = body.company?.trim() || guessCompany(url);
  if (!company) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not work out which employer this belongs to. Add the company name and try again.",
      },
      { status: 422 },
    );
  }

  try {
    const role = body.role === "primary" ? "primary" : "alternate";
    const seed = COMPANIES.find((c) => c.name === company);
    const fix = await queueFix({ company, page: "urls", oldUrl: seed?.careersUrl ?? null, newUrl: url, requestedBy: "user", detail: { role } });
    return NextResponse.json({ ok: true, queued: true, company, fix });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
