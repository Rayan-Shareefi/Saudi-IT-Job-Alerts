import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { saveUrlDecision, saveUrlFindings } from "@/lib/db";
import { checkCareersUrl } from "@/lib/url-check";
import { COMPANIES } from "@/lib/sources/companies";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Add a careers URL you found yourself.
 *
 * The checker only proposes what it stumbles across; plenty of boards are
 * simply not linked from anywhere it looks. This takes a URL, opens it, and
 * fills in the rest - whether it actually lists vacancies, which employer it
 * belongs to, and any secondary boards it links to - so the only thing to type
 * is the address.
 *
 * The URL is opened before it is stored. Accepting one unverified would put a
 * page into the collector that might list nothing at all, which is the failure
 * this whole tab exists to prevent.
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

  const seed = COMPANIES.find((c) => c.name === company);
  if (!seed) {
    return NextResponse.json(
      { ok: false, error: `"${company}" is not an employer on file.` },
      { status: 422 },
    );
  }

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    let finding;
    try {
      // Check the URL AS IF it were this employer's careers page, which tells
      // us whether it lists vacancies and what else it links to.
      finding = await checkCareersUrl({ ...seed, careersUrl: url }, browser);
    } finally {
      await browser.close().catch(() => {});
    }

    const listsJobs = finding.status === "unchanged" || finding.status === "extra-found";
    const movedTo = finding.status === "moved" ? finding.suggestedUrl : undefined;

    if (!listsJobs && !movedTo) {
      // Recorded so it shows in the tab with its reason, but not accepted:
      // adding a page that lists nothing is the mistake this tab prevents.
      await saveUrlFindings([
        {
          company,
          currentUrl: url,
          extraUrls: finding.extraUrls,
          status: finding.status,
          note: `added by hand: ${finding.note ?? "does not look like a vacancy list"}`,
        },
      ]);
      return NextResponse.json({
        ok: false,
        added: false,
        company,
        status: finding.status,
        error:
          finding.status === "unreachable"
            ? "That page did not respond."
            : "That page opened but nothing on it reads as a job listing, so it was not added. It is listed in the tab so you can look.",
      });
    }

    // A redirect to a real board means the destination is the useful URL.
    const finalUrl = movedTo ?? url;
    const role = body.role === "primary" ? "primary" : "alternate";

    await saveUrlFindings([
      {
        company,
        currentUrl: seed.careersUrl,
        suggestedUrl: finalUrl,
        extraUrls: finding.extraUrls,
        status: "moved",
        note: `added by hand${movedTo ? " (redirected to the live board)" : ""}`,
      },
    ]);
    await saveUrlDecision(company, finalUrl, role, "accepted");

    return NextResponse.json({
      ok: true,
      added: true,
      company,
      url: finalUrl,
      role,
      extraFound: finding.extraUrls.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
