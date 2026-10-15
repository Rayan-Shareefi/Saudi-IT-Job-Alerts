/**
 * Verifies every careers URL in the employer database and repairs the broken ones.
 *
 * The seed URLs were written from knowledge, not from checking, so a good share
 * of them 404 or redirect somewhere useless. For each employer this script:
 *
 *   1. Fetches the seed URL and follows redirects.
 *   2. Rejects soft-404s - pages that answer 200 with "page not found" body.
 *   3. On failure, tries common careers paths on the same origin.
 *   4. Still failing, loads the homepage and follows whatever it labels
 *      "Careers" / "Jobs" / "وظائف" / "التوظيف".
 *   5. Still failing, retries the whole thing in headless Chromium, which gets
 *      past the sites that refuse plain fetch.
 *   6. Harvests careers@ / jobs@ / hr@ style addresses from whatever page it
 *      reached, so employers who only accept CVs by email are still reachable.
 *
 * Writes data/link-check.json. Apply the repairs with scripts/apply-link-fixes.ts.
 *
 *   npx tsx scripts/check-links.ts                # everything
 *   npx tsx scripts/check-links.ts --no-browser   # skip the Chromium pass
 *   npx tsx scripts/check-links.ts --p 2          # priority 1-2 only
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { COMPANIES, type CompanySeed } from "../src/lib/sources/companies";
import { mapLimit, request } from "../src/lib/http";

const has = (n: string) => process.argv.includes(`--${n}`);
function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export type LinkStatus = "ok" | "fixed" | "email-only" | "unreachable";

export interface LinkResult {
  company: string;
  sector: string;
  priority: number;
  originalUrl: string;
  status: LinkStatus;
  /** The URL that actually works, when one was found. */
  workingUrl?: string;
  httpStatus?: number;
  careersEmail?: string;
  method: "direct" | "redirect" | "variant" | "homepage-link" | "browser" | "none";
  note?: string;
}

/* -------------------------------------------------------------------------- */
/* page checks                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Plenty of sites answer 200 for a missing page. Treat a page as absent when
 * the title or an early heading says so, or when there is almost no content.
 */
function isSoftNotFound(html: string): boolean {
  const head = html.slice(0, 4000).toLowerCase();
  const title = head.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/)?.[1] ?? "";
  if (/404|not found|page not found|page doesn.t exist|صفحة غير موجودة|غير موجود/.test(title)) {
    return true;
  }
  if (/>\s*(404|page not found|error 404)\s*</i.test(head)) return true;
  // A page with essentially no text is not a careers page.
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").trim();
  return text.length < 200;
}

/** Hostnames that are a careers destination in their own right. */
const CAREERS_HOST =
  /^(careers?|jobs?|talent|hr|recruit(ing|ment)?|apply|hiring)\./i;

const ATS_HOST =
  /(myworkdayjobs|oraclecloud|successfactors|sapsf|taleo\.net|icims|smartrecruiters|greenhouse\.io|lever\.co|workable\.com|ashbyhq|bamboohr|elevatus\.io|zohorecruit|applytojob|recruitee)/i;

/**
 * A landing page is only a real repair when it is not simply the company
 * homepage. `zamil.com/` is not a careers page, but `careers.stc.com.sa/` and
 * `hmg.elevatus.io/` are - the host carries the meaning there, not the path.
 */
function isUsableCareersUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const bare = u.pathname === "/" || u.pathname === "";
    if (!bare) return true;
    return CAREERS_HOST.test(u.hostname) || ATS_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** Does this page actually look like it lists or describes jobs? */
function looksLikeCareers(html: string, url: string): boolean {
  if (!isUsableCareersUrl(url)) return false;
  if (/career|job|vacanc|recruit|join-us|joinus|employment|hiring|wazifa|tawzeef/i.test(url)) {
    return true;
  }
  const text = html.slice(0, 60_000).toLowerCase();
  const hits = [
    "career", "vacanc", "job opening", "open position", "join our team",
    "we are hiring", "apply now", "وظائف", "التوظيف", "الوظائف الشاغرة",
  ].filter((t) => text.includes(t)).length;
  return hits >= 2;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const CAREERS_MAILBOX =
  /^(careers?|jobs?|hr|recruit(ment)?|talent|employment|hiring|cv|resume|people|tawzeef|wazaif|joinus|join)([.\-_].*)?$/i;

/** Pull a careers-ish address out of a page, preferring the obvious ones. */
function extractCareersEmail(html: string): string | undefined {
  const found = new Set<string>();
  for (const raw of html.match(EMAIL_RE) ?? []) {
    const email = raw.toLowerCase();
    // Skip tracking/asset noise that happens to look like an address.
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(email)) continue;
    if (/^(no-?reply|info|support|sentry|example|your|email|user)@/.test(email)) continue;
    found.add(email);
  }
  const list = [...found];
  const preferred = list.find((e) => CAREERS_MAILBOX.test(e.split("@")[0]));
  return preferred ?? undefined;
}

/* -------------------------------------------------------------------------- */
/* candidate URLs                                                              */
/* -------------------------------------------------------------------------- */

const CAREER_PATHS = [
  "/careers",
  "/careers/",
  "/en/careers",
  "/jobs",
  "/en/jobs",
  "/career",
  "/join-us",
  "/about-us/careers",
  "/en/about-us/careers",
  "/about/careers",
  "/vacancies",
  "/work-with-us",
  "/ar/careers",
];

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Careers links advertised by a homepage, best candidates first. */
function careersLinksFrom(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const anchorRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const hrefLower = href.toLowerCase();

    const labelHit =
      /^(careers?|jobs?|vacancies|join us|work with us|employment|وظائف|التوظيف|الوظائف)/.test(label);
    const hrefHit = /(career|job|vacanc|recruit|join-us|employment|توظيف|وظائف)/.test(hrefLower);
    if (!labelHit && !hrefHit) continue;
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    // Skip links out to the aggregators - we want the employer's own page.
    if (/linkedin\.com|bayt\.com|indeed\.com|glassdoor/i.test(hrefLower)) continue;

    try {
      const abs = new URL(href, baseUrl).toString();
      if (!out.includes(abs)) out.push(abs);
    } catch {
      /* malformed href */
    }
  }
  // Prefer same-origin links, then shorter paths (usually the index page).
  const base = originOf(baseUrl);
  return out
    .sort((a, b) => {
      const aSame = originOf(a) === base ? 0 : 1;
      const bSame = originOf(b) === base ? 0 : 1;
      return aSame - bSame || a.length - b.length;
    })
    .slice(0, 5);
}

/* -------------------------------------------------------------------------- */
/* probing                                                                     */
/* -------------------------------------------------------------------------- */

interface Probe {
  ok: boolean;
  httpStatus?: number;
  finalUrl?: string;
  html?: string;
  error?: string;
}

async function probe(url: string, timeoutMs = 15_000): Promise<Probe> {
  try {
    const res = await request(url, { timeoutMs, retries: 0 });
    const html = await res.text();
    if (isSoftNotFound(html)) {
      return { ok: false, httpStatus: res.status, finalUrl: res.url, html, error: "soft 404" };
    }
    return { ok: true, httpStatus: res.status, finalUrl: res.url || url, html };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = Number(message.match(/HTTP (\d{3})/)?.[1]);
    return { ok: false, httpStatus: Number.isFinite(status) ? status : undefined, error: message };
  }
}

async function checkCompany(seed: CompanySeed): Promise<LinkResult> {
  const base: LinkResult = {
    company: seed.name,
    sector: seed.sector,
    priority: seed.priority,
    originalUrl: seed.careersUrl,
    status: "unreachable",
    method: "none",
  };

  let bestHtml = "";

  /* 1. the seed url itself */
  const first = await probe(seed.careersUrl);
  if (first.html) bestHtml = first.html;
  if (first.ok && looksLikeCareers(first.html ?? "", first.finalUrl ?? seed.careersUrl)) {
    const redirected = (first.finalUrl ?? "").replace(/\/$/, "") !== seed.careersUrl.replace(/\/$/, "");
    return {
      ...base,
      status: redirected ? "fixed" : "ok",
      workingUrl: first.finalUrl,
      httpStatus: first.httpStatus,
      method: redirected ? "redirect" : "direct",
      careersEmail: extractCareersEmail(first.html ?? ""),
    };
  }

  const origin = originOf(seed.careersUrl);
  if (!origin) return { ...base, note: "malformed url" };

  /* 2. common careers paths on the same origin */
  const seedPath = new URL(seed.careersUrl).pathname.replace(/\/$/, "");
  for (const path of CAREER_PATHS) {
    if (path.replace(/\/$/, "") === seedPath) continue;
    const candidate = `${origin}${path}`;
    const r = await probe(candidate, 12_000);
    if (r.html && r.html.length > bestHtml.length) bestHtml = r.html;
    if (r.ok && looksLikeCareers(r.html ?? "", r.finalUrl ?? candidate)) {
      return {
        ...base,
        status: "fixed",
        workingUrl: r.finalUrl ?? candidate,
        httpStatus: r.httpStatus,
        method: "variant",
        careersEmail: extractCareersEmail(r.html ?? ""),
      };
    }
  }

  /* 3. follow the careers link the homepage advertises */
  const home = await probe(origin, 15_000);
  if (home.html) {
    if (home.html.length > bestHtml.length) bestHtml = home.html;
    for (const link of careersLinksFrom(home.html, home.finalUrl ?? origin)) {
      const r = await probe(link, 12_000);
      if (r.html && r.html.length > bestHtml.length) bestHtml = r.html;
      if (r.ok && looksLikeCareers(r.html ?? "", link)) {
        return {
          ...base,
          status: "fixed",
          workingUrl: r.finalUrl ?? link,
          httpStatus: r.httpStatus,
          method: "homepage-link",
          careersEmail: extractCareersEmail(r.html ?? ""),
        };
      }
    }
  }

  /* 4. nothing worked over plain fetch */
  const email = extractCareersEmail(bestHtml);
  return {
    ...base,
    status: email ? "email-only" : "unreachable",
    careersEmail: email,
    httpStatus: first.httpStatus,
    note: first.error ?? "no careers page found",
  };
}

/* -------------------------------------------------------------------------- */
/* browser pass                                                                */
/* -------------------------------------------------------------------------- */

async function browserCheck(
  seed: CompanySeed,
  b: import("playwright").Browser,
): Promise<LinkResult | null> {
  const page = await b.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  try {
    const origin = originOf(seed.careersUrl);
    for (const target of [seed.careersUrl, origin].filter(Boolean) as string[]) {
      try {
        const res = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(1500);
        const html = await page.content();
        const url = page.url();

        if (res && res.status() < 400 && !isSoftNotFound(html) && looksLikeCareers(html, url)) {
          return {
            company: seed.name,
            sector: seed.sector,
            priority: seed.priority,
            originalUrl: seed.careersUrl,
            status: url.replace(/\/$/, "") === seed.careersUrl.replace(/\/$/, "") ? "ok" : "fixed",
            workingUrl: url,
            httpStatus: res.status(),
            method: "browser",
            careersEmail: extractCareersEmail(html),
          };
        }

        // On the homepage, follow its careers link.
        if (target === origin) {
          for (const link of careersLinksFrom(html, url)) {
            try {
              const r2 = await page.goto(link, { waitUntil: "domcontentloaded", timeout: 25_000 });
              await page.waitForTimeout(1200);
              const h2 = await page.content();
              if (r2 && r2.status() < 400 && !isSoftNotFound(h2) && looksLikeCareers(h2, page.url())) {
                return {
                  company: seed.name,
                  sector: seed.sector,
                  priority: seed.priority,
                  originalUrl: seed.careersUrl,
                  status: "fixed",
                  workingUrl: page.url(),
                  httpStatus: r2.status(),
                  method: "browser",
                  careersEmail: extractCareersEmail(h2),
                };
              }
            } catch {
              /* next link */
            }
          }
        }
      } catch {
        /* next target */
      }
    }
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* main                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const maxPriority = Number(arg("p") ?? 3);
  const useBrowser = !has("no-browser");
  const targets = COMPANIES.filter((c) => c.priority <= maxPriority);

  console.log(`Checking ${targets.length} careers URLs...\n`);

  let done = 0;
  const results = await mapLimit(targets, 10, async (seed) => {
    const r = await checkCompany(seed).catch(
      () =>
        ({
          company: seed.name,
          sector: seed.sector,
          priority: seed.priority,
          originalUrl: seed.careersUrl,
          status: "unreachable",
          method: "none",
          note: "check threw",
        }) as LinkResult,
    );
    done++;
    const mark = r.status === "ok" ? "OK  " : r.status === "fixed" ? "FIX " : r.status === "email-only" ? "MAIL" : "DEAD";
    console.log(
      `[${String(done).padStart(3)}/${targets.length}] ${mark} ${r.company.slice(0, 36).padEnd(36)} ` +
        `${r.status === "fixed" ? `-> ${r.workingUrl?.slice(0, 60)}` : r.careersEmail ? r.careersEmail : (r.note ?? "").slice(0, 50)}`,
    );
    return r;
  });

  /* browser retry for whatever plain fetch could not reach */
  const stillBroken = results.filter((r) => r.status === "unreachable" || r.status === "email-only");
  if (useBrowser && stillBroken.length > 0) {
    console.log(`\nBrowser pass on ${stillBroken.length} unresolved employers...\n`);
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ headless: true });
    let n = 0;
    try {
      await mapLimit(stillBroken, 4, async (broken) => {
        const seed = targets.find((c) => c.name === broken.company);
        if (!seed) return;
        const fixed = await browserCheck(seed, b).catch(() => null);
        n++;
        if (fixed) {
          // Keep an email harvested by the fetch pass if the browser found none.
          fixed.careersEmail = fixed.careersEmail ?? broken.careersEmail;
          Object.assign(broken, fixed);
          console.log(`  + [${n}/${stillBroken.length}] ${broken.company.slice(0, 34).padEnd(34)} -> ${broken.workingUrl?.slice(0, 60)}`);
        }
      });
    } finally {
      await b.close();
    }
  }

  if (!existsSync("data")) mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/link-check.json",
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
  );

  const by = (s: LinkStatus) => results.filter((r) => r.status === s);
  console.log(`\n--- link check summary ---`);
  console.log(`already correct : ${by("ok").length}`);
  console.log(`repaired        : ${by("fixed").length}`);
  console.log(`email only      : ${by("email-only").length}`);
  console.log(`unreachable     : ${by("unreachable").length}`);
  console.log(`emails found    : ${results.filter((r) => r.careersEmail).length}`);

  const dead = by("unreachable");
  if (dead.length > 0) {
    console.log(`\nno careers page found (these need a human eye):`);
    for (const r of dead.slice(0, 60)) {
      console.log(`  ${r.company.slice(0, 40).padEnd(40)} ${r.originalUrl.slice(0, 58)}  ${(r.note ?? "").slice(0, 30)}`);
    }
  }

  console.log(`\nwrote data/link-check.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
