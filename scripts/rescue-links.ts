/**
 * Second pass over the employers the link check could not resolve.
 *
 * The first pass conflated two very different failures:
 *
 *   - "the URL is wrong"      -> 404, soft 404, DNS failure. Needs a new URL.
 *   - "the site blocks bots"  -> 403/429 from Cloudflare and friends. The URL is
 *                                probably fine; a human browser opens it. That
 *                                one should stay in the directory as a manual
 *                                link, not be thrown away.
 *
 * So this pass separates them, and tries harder on the first group:
 *   A. is the root domain alive at all?
 *   B. does the company run an ATS we can probe by slug? (jobs even with no
 *      working careers page)
 *   C. careers.* / jobs.* / hr.* subdomains
 *   D. a wider path list, Arabic included
 *   E. Chromium on the homepage with loose careers-link detection
 *
 * Writes data/link-rescue.json.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { COMPANIES, type CompanySeed } from "../src/lib/sources/companies";
import { mapLimit, request } from "../src/lib/http";
import { slugCandidates } from "./discover-ats";
import type { LinkResult } from "./check-links";

const has = (n: string) => process.argv.includes(`--${n}`);

export type RescueOutcome =
  | "url-fixed"
  | "ats-found"
  | "blocked-but-valid"
  | "dead";

export interface RescueResult {
  company: string;
  originalUrl: string;
  outcome: RescueOutcome;
  workingUrl?: string;
  atsAdapter?: string;
  atsHandle?: string;
  careersEmail?: string;
  note?: string;
}

/* -------------------------------------------------------------------------- */

const EXTRA_PATHS = [
  "/careers/jobs",
  "/careers/vacancies",
  "/en/careers/",
  "/ar/careers",
  "/careers/index.html",
  "/about/careers",
  "/about-us/careers",
  "/company/careers",
  "/en/company/careers",
  "/join",
  "/join-our-team",
  "/work-for-us",
  "/opportunities",
  "/en/opportunities",
  "/recruitment",
  "/hr",
  "/jobs/",
  "/en/join-us",
];

const SUBDOMAINS = ["careers", "jobs", "career", "hr", "recruitment", "talent", "apply"];

function isSoftNotFound(html: string): boolean {
  const head = html.slice(0, 4000).toLowerCase();
  const title = head.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/)?.[1] ?? "";
  if (/404|not found|page not found|صفحة غير موجودة/.test(title)) return true;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").trim();
  return text.length < 200;
}

function looksLikeCareers(html: string, url: string): boolean {
  if (/career|job|vacanc|recruit|join|employment|hiring/i.test(url)) return true;
  const text = html.slice(0, 60_000).toLowerCase();
  return (
    ["career", "vacanc", "job opening", "open position", "join our team", "apply now", "وظائف", "التوظيف"].filter(
      (t) => text.includes(t),
    ).length >= 2
  );
}

interface Probe {
  ok: boolean;
  status?: number;
  url?: string;
  html?: string;
  blocked?: boolean;
  error?: string;
}

async function probe(url: string, timeoutMs = 12_000): Promise<Probe> {
  try {
    const res = await request(url, { timeoutMs, retries: 0 });
    const html = await res.text();
    if (isSoftNotFound(html)) return { ok: false, status: res.status, url: res.url, error: "soft 404" };
    return { ok: true, status: res.status, url: res.url || url, html };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = Number(message.match(/HTTP (\d{3})/)?.[1]);
    // 401/403/429 mean the server answered and refused a bot - the host is alive.
    const blocked = [401, 403, 429].includes(status);
    return { ok: false, status: Number.isFinite(status) ? status : undefined, blocked, error: message };
  }
}

/* --- ATS slug probing, so we get jobs even with no reachable careers page --- */

const ATS_PROBES: Array<{
  adapter: string;
  url: (s: string) => string;
  count: (b: string) => number;
  name?: (b: string) => string | null;
}> = [
  {
    adapter: "greenhouse",
    url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    count: (b) => len(b, "jobs"),
  },
  {
    adapter: "lever",
    url: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
    count: (b) => {
      try {
        const j = JSON.parse(b);
        return Array.isArray(j) ? j.length : -1;
      } catch {
        return -1;
      }
    },
  },
  {
    adapter: "ashby",
    url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    count: (b) => len(b, "jobs"),
  },
  {
    adapter: "workable",
    url: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=false`,
    count: (b) => len(b, "jobs"),
    name: (b) => {
      try {
        return JSON.parse(b).name ?? null;
      } catch {
        return null;
      }
    },
  },
  {
    adapter: "smartrecruiters",
    url: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`,
    count: (b) => len(b, "content"),
  },
  {
    adapter: "recruitee",
    url: (s) => `https://${s}.recruitee.com/api/offers/`,
    count: (b) => len(b, "offers"),
  },
  {
    adapter: "bamboohr",
    url: (s) => `https://${s}.bamboohr.com/careers/list`,
    count: (b) => len(b, "result"),
  },
];

function len(body: string, key: string): number {
  try {
    const v = JSON.parse(body)[key];
    return Array.isArray(v) ? v.length : -1;
  } catch {
    return -1;
  }
}

function nameMatches(reported: string, company: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = norm(reported);
  const b = norm(company.replace(/\([^)]*\)/g, ""));
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

async function findAts(seed: CompanySeed): Promise<{ adapter: string; handle: string } | null> {
  for (const p of ATS_PROBES) {
    for (const slug of slugCandidates(seed.name)) {
      try {
        const res = await request(p.url(slug), { timeoutMs: 8000, retries: 0 });
        const body = await res.text();
        if (p.count(body) <= 0) continue;
        const reported = p.name?.(body);
        if (reported && !nameMatches(reported, seed.name)) continue;
        return { adapter: p.adapter, handle: slug };
      } catch {
        /* wrong slug */
      }
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */

async function rescue(seed: CompanySeed, browserInst: import("playwright").Browser | null): Promise<RescueResult> {
  const base: RescueResult = { company: seed.name, originalUrl: seed.careersUrl, outcome: "dead" };
  let origin: string;
  try {
    origin = new URL(seed.careersUrl).origin;
  } catch {
    return { ...base, note: "malformed url" };
  }

  /* A. is the host alive, and is it merely refusing bots? */
  const root = await probe(origin, 12_000);
  const hostAlive = root.ok || Boolean(root.blocked);

  /* B. an ATS board beats a careers page anyway */
  const ats = await findAts(seed).catch(() => null);
  if (ats) {
    return { ...base, outcome: "ats-found", atsAdapter: ats.adapter, atsHandle: ats.handle };
  }

  /* C. careers.* style subdomains */
  const bareHost = new URL(origin).hostname.replace(/^www\./, "");
  for (const sub of SUBDOMAINS) {
    const candidate = `https://${sub}.${bareHost}`;
    const r = await probe(candidate, 9000);
    if (r.ok && looksLikeCareers(r.html ?? "", r.url ?? candidate)) {
      return { ...base, outcome: "url-fixed", workingUrl: r.url ?? candidate };
    }
  }

  /* D. a wider path list on the original host */
  for (const path of EXTRA_PATHS) {
    const candidate = `${origin}${path}`;
    const r = await probe(candidate, 9000);
    if (r.ok && looksLikeCareers(r.html ?? "", r.url ?? candidate)) {
      return { ...base, outcome: "url-fixed", workingUrl: r.url ?? candidate };
    }
  }

  /* E. Chromium on the homepage, loose careers-link detection */
  if (browserInst) {
    const page = await browserInst.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    try {
      const res = await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2000);

      if (res && res.status() < 400) {
        const links: string[] = await page
          .$$eval("a[href]", (els) =>
            els
              .filter((e) => {
                const a = e as HTMLAnchorElement;
                const t = (a.textContent ?? "").toLowerCase();
                return /career|job|vacanc|join|توظيف|وظائف|التوظيف/i.test(a.href + " " + t);
              })
              .map((e) => (e as HTMLAnchorElement).href),
          )
          .catch(() => []);

        for (const link of [...new Set(links)].slice(0, 6)) {
          try {
            const r2 = await page.goto(link, { waitUntil: "domcontentloaded", timeout: 22_000 });
            await page.waitForTimeout(1200);
            const html = await page.content();
            if (r2 && r2.status() < 400 && !isSoftNotFound(html) && looksLikeCareers(html, page.url())) {
              return { ...base, outcome: "url-fixed", workingUrl: page.url() };
            }
          } catch {
            /* next */
          }
        }
      }
    } catch {
      /* browser could not reach it either */
    } finally {
      await page.close().catch(() => {});
    }
  }

  /* F. nothing found */
  if (hostAlive) {
    return {
      ...base,
      outcome: "blocked-but-valid",
      workingUrl: seed.careersUrl,
      note: root.blocked ? `host refuses bots (HTTP ${root.status})` : "host alive, no careers page located",
    };
  }
  return { ...base, outcome: "dead", note: root.error ?? "host unreachable" };
}

async function main(): Promise<void> {
  const report = JSON.parse(readFileSync("data/link-check.json", "utf8")) as { results: LinkResult[] };
  const stuck = report.results.filter((r) => r.status === "unreachable").map((r) => r.company);
  const targets = COMPANIES.filter((c) => stuck.includes(c.name));

  console.log(`Rescuing ${targets.length} unresolved employers...\n`);

  const { chromium } = await import("playwright");
  const b = has("no-browser") ? null : await chromium.launch({ headless: true });

  let done = 0;
  try {
    const results = await mapLimit(targets, 4, async (seed) => {
      const r = await rescue(seed, b).catch(
        () => ({ company: seed.name, originalUrl: seed.careersUrl, outcome: "dead", note: "threw" }) as RescueResult,
      );
      done++;
      const tag =
        r.outcome === "ats-found" ? "ATS " : r.outcome === "url-fixed" ? "FIX " : r.outcome === "blocked-but-valid" ? "BLOK" : "DEAD";
      console.log(
        `[${String(done).padStart(3)}/${targets.length}] ${tag} ${r.company.slice(0, 34).padEnd(34)} ` +
          `${r.atsHandle ? `${r.atsAdapter}:${r.atsHandle}` : (r.workingUrl ?? r.note ?? "").slice(0, 62)}`,
      );
      return r;
    });

    writeFileSync("data/link-rescue.json", JSON.stringify({ rescuedAt: new Date().toISOString(), results }, null, 2));

    const by = (o: RescueOutcome) => results.filter((r) => r.outcome === o);
    console.log(`\n--- rescue summary ---`);
    console.log(`ATS board found          : ${by("ats-found").length}`);
    console.log(`careers URL corrected    : ${by("url-fixed").length}`);
    console.log(`alive but blocks bots    : ${by("blocked-but-valid").length}  (kept as manual links)`);
    console.log(`genuinely dead           : ${by("dead").length}`);

    if (by("dead").length > 0) {
      console.log(`\nstill dead - these need you to paste the right URL:`);
      for (const r of by("dead")) console.log(`  ${r.company.slice(0, 40).padEnd(40)} ${r.originalUrl}`);
    }
    console.log(`\nwrote data/link-rescue.json`);
  } finally {
    await b?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
