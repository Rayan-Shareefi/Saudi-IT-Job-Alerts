import { NextResponse } from "next/server";
import { COMPANIES } from "@/lib/sources/companies";
import { saveUrlFindings, urlFindingsCheckedBefore } from "@/lib/db";
import { checkCareersUrl } from "@/lib/url-check";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Re-checks employer careers URLs, a batch at a time.
 *
 * In batches because the check opens a real browser on every employer: 500+ of
 * them takes about an hour, and no HTTP request survives that. Each call takes
 * the companies checked longest ago, so repeated presses walk the whole list
 * without repeating work, and one press is always useful on its own.
 *
 * Nothing is applied. A careers URL is the single point of failure for an
 * employer - point it at the wrong page and that company silently produces
 * nothing - so findings are stored for review with both URLs shown, and the
 * change is made deliberately.
 */
const BATCH = 25;
const COOLDOWN_MS = 30_000;
let lastRunAt = 0;
let running = false;

export async function POST(req: Request) {
  if (running) {
    return NextResponse.json({ ok: false, error: "a check is already running" }, { status: 409 });
  }
  const since = Date.now() - lastRunAt;
  if (since < COOLDOWN_MS) {
    return NextResponse.json(
      { ok: false, retryInSeconds: Math.ceil((COOLDOWN_MS - since) / 1000) },
      { status: 429 },
    );
  }

  let size = BATCH;
  try {
    const body = (await req.json()) as { batch?: number };
    if (typeof body.batch === "number") size = Math.min(Math.max(body.batch, 1), 60);
  } catch {
    /* no body is fine - use the default batch */
  }

  running = true;
  lastRunAt = Date.now();

  try {
    // Longest-unchecked first, so pressing the button repeatedly sweeps the
    // whole list rather than re-checking the same 25 employers.
    const order = await urlFindingsCheckedBefore();
    const targets = [...COMPANIES]
      .sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0))
      .slice(0, size);

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const findings = [];

    try {
      for (const seed of targets) {
        findings.push(await checkCareersUrl(seed, browser));
      }
    } finally {
      await browser.close().catch(() => {});
    }

    await saveUrlFindings(findings);

    const changed = findings.filter((f) => f.status !== "unchanged");
    return NextResponse.json({
      ok: true,
      checked: findings.length,
      remaining: Math.max(0, COMPANIES.length - order.size - findings.length),
      moved: findings.filter((f) => f.status === "moved").length,
      extraFound: findings.filter((f) => f.status === "extra-found").length,
      stale: findings.filter((f) => f.status === "stale").length,
      unreachable: findings.filter((f) => f.status === "unreachable").length,
      changed: changed.length,
    });
  } catch (err) {
    lastRunAt = 0;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    running = false;
  }
}
