/**
 * Re-checks every employer's careers URL and looks for additional ones.
 *
 * Two jobs, because they are the same crawl:
 *
 *   1. **Has the URL moved?** Companies migrate ATS vendors and restructure
 *      sites constantly. A URL that worked last month can silently become a
 *      marketing page, and the failure mode is quiet: the page still returns
 *      200, it just no longer lists jobs.
 *
 *   2. **Is there a second one?** Plenty of employers run more than one board -
 *      a corporate site plus a graduate portal, an English and an Arabic
 *      listing, or a separate "students and interns" page. Finding only the
 *      first means missing everything on the others.
 *
 * Writes data/url-refresh.json. Apply with `npm run urls:apply`.
 *
 *   npx tsx scripts/refresh-urls.ts             # all employers
 *   npx tsx scripts/refresh-urls.ts --p 2       # priority 1-2
 *   npx tsx scripts/refresh-urls.ts --limit 60
 */
import { writeFileSync } from "node:fs";
import { COMPANIES, type CompanySeed } from "../src/lib/sources/companies";
import { mapLimit } from "../src/lib/http";
import { looksLikeSecondaryBoard } from "../src/lib/sources/secondary";
import { REPEATED_BLOCK_SCRIPT, type RepeatedCandidate, isPlausibleVacancy } from "../src/lib/adapters/repeated";

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface UrlFinding {
  company: string;
  currentUrl: string;
  /** Set when the current URL has moved or gone stale. */
  replacementUrl?: string;
  /** Extra boards worth polling alongside the primary. */
  secondaryUrls: string[];
  status: "unchanged" | "moved" | "extra-found" | "stale" | "unreachable";
  note?: string;
}

/**
 * Link text that indicates a *separate* board rather than a deeper page of the
 * same one - a graduate scheme, an Arabic listing, an internships portal.
 */
/**
 * Does this page actually list vacancies?
 *
 * Counting job-ish links was not enough, and Deloitte is why: their careers
 * homepage is full of links containing "career", so it scored as a board, while
 * the only thing the extractor could find on it was the cookie-consent table.
 * The real listing lives on a separate host behind a "Job search" button.
 *
 * So the test is now the one that matters: run the same repeated-block
 * extraction the ingest uses, and ask whether what comes out are plausible
 * vacancies. A recognised ATS host still short-circuits to true.
 */
async function countsAsBoard(page: import("playwright").Page, url: string): Promise<boolean> {
  if (/greenhouse|lever\.co|myworkdayjobs|oraclecloud|successfactors|taleo|icims|smartrecruiters|workable|ashbyhq|bamboohr|recruitee/i.test(url)) {
    return true;
  }
  const groups = (await page.evaluate(REPEATED_BLOCK_SCRIPT).catch(() => [])) as RepeatedCandidate[];
  for (const g of groups) {
    const real = g.items.filter((i) => isPlausibleVacancy(i.title, i.text));
    if (real.length >= 3 && real.length >= g.items.length * 0.5) return true;
  }
  return false;
}

/**
 * Link text that leads from a careers homepage to the actual listing.
 *
 * Employers routinely split the two: deloitte.com/middle-east/en/careers.html
 * is a brochure page whose "Job search" button points at
 * middleeastjobs.deloitte.com, where the vacancies actually are.
 */
const BOARD_LINK =
  /^(job search|search jobs?|search (deloitte |our )?jobs|view (all )?(jobs|openings|vacancies|positions)|see (all )?(jobs|openings|vacancies)|browse (jobs|openings)|current (openings|vacancies|opportunities)|open (positions|roles|vacancies)|all (jobs|vacancies|openings)|find a job|explore (jobs|opportunities)|apply now|بحث عن وظيفة|الوظائف الشاغرة|الوظائف المتاحة)$/i;

/** Hosts that are obviously a jobs board rather than a marketing site. */
const BOARD_HOST = /(^|\.)(jobs|careers|job|recruit|talent|hiring)[.-]|[.-](jobs|careers)\./i;

async function inspect(
  seed: CompanySeed,
  browser: import("playwright").Browser,
): Promise<UrlFinding> {
  const base: UrlFinding = {
    company: seed.name,
    currentUrl: seed.careersUrl,
    secondaryUrls: [],
    status: "unchanged",
  };

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  try {
    const res = await page.goto(seed.careersUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
    if (!res || res.status() >= 400) {
      return { ...base, status: "unreachable", note: `HTTP ${res?.status() ?? "no response"}` };
    }
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(1800);

    const landed = page.url();
    const moved = landed.replace(/\/$/, "") !== seed.careersUrl.replace(/\/$/, "");
    const isBoard = await countsAsBoard(page, landed);

    // Additional boards this page points at.
    const links = await page
      .$$eval("a[href]", (els) =>
        els.map((e) => ({
          href: (e as HTMLAnchorElement).href,
          text: (e.textContent ?? "").replace(/\s+/g, " ").trim(),
        })),
      )
      .catch(() => [] as Array<{ href: string; text: string }>);

    const origin = new URL(landed).origin;
    const secondary: string[] = [];
    for (const l of links) {
      if (!/^https?:/i.test(l.href)) continue;
      if (l.href.replace(/\/$/, "") === landed.replace(/\/$/, "")) continue;
      if (!looksLikeSecondaryBoard(l.href, l.text)) continue;
      // Same site, or a recognised ATS host - not a link out to LinkedIn.
      const sameSite = l.href.startsWith(origin);
      const atsHost =
        /greenhouse\.io|lever\.co|myworkdayjobs\.com|oraclecloud\.com|successfactors|taleo\.net|icims\.com|smartrecruiters\.com|workable\.com|ashbyhq\.com|bamboohr\.com|recruitee\.com/i.test(
          l.href,
        );
      if (!sameSite && !atsHost) continue;
      if (/linkedin|facebook|twitter|instagram|youtube/i.test(l.href)) continue;
      if (!secondary.includes(l.href)) secondary.push(l.href);
      if (secondary.length >= 3) break;
    }

    /*
     * The page is not a listing. Before writing it off, follow the button that
     * leads to one - this is the Deloitte case, where the careers page is a
     * brochure and "Job search" points at a jobs board on another host.
     */
    if (!isBoard) {
      const candidates = links
        .filter((l) => /^https?:/i.test(l.href))
        .filter((l) => BOARD_LINK.test(l.text) || BOARD_HOST.test(new URL(l.href).hostname))
        .filter((l) => !/linkedin|facebook|twitter|instagram|youtube|glassdoor|indeed/i.test(l.href))
        .filter((l) => l.href.replace(/\/$/, "") !== landed.replace(/\/$/, ""));

      const tried = new Set<string>();
      for (const c of candidates.slice(0, 4)) {
        const target = c.href.split("#")[0];
        if (tried.has(target)) continue;
        tried.add(target);
        try {
          const r = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25_000 });
          if (!r || r.status() >= 400) continue;
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(1500);
          if (await countsAsBoard(page, page.url())) {
            return {
              ...base,
              status: "moved",
              replacementUrl: page.url(),
              secondaryUrls: secondary,
              note: `careers page is a landing page; "${c.text.slice(0, 30)}" leads to the real listing`,
            };
          }
        } catch {
          /* try the next candidate */
        }
      }
    }

    if (moved && isBoard) {
      return { ...base, status: "moved", replacementUrl: landed, secondaryUrls: secondary, note: "redirects to a different page that does list jobs" };
    }
    if (!isBoard) {
      return {
        ...base,
        status: "stale",
        secondaryUrls: secondary,
        note: "page loads but no longer looks like a vacancy list",
      };
    }
    if (secondary.length > 0) {
      return { ...base, status: "extra-found", secondaryUrls: secondary, note: `${secondary.length} additional board(s) linked` };
    }
    return base;
  } catch (err) {
    return { ...base, status: "unreachable", note: err instanceof Error ? err.message.slice(0, 80) : String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const maxPriority = Number(arg("p") ?? 3);
  const limit = Number(arg("limit") ?? 1000);
  const targets = COMPANIES.filter((c) => c.priority <= maxPriority).slice(0, limit);

  console.log(`Re-checking ${targets.length} careers URLs and hunting for extras...\n`);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  let done = 0;

  try {
    const findings = await mapLimit(targets, 4, async (seed) => {
      const f: UrlFinding = await inspect(seed, browser).catch(() => ({
        company: seed.name,
        currentUrl: seed.careersUrl,
        secondaryUrls: [],
        status: "unreachable",
        note: "threw",
      }));
      done++;
      if (f.status !== "unchanged") {
        console.log(
          `[${String(done).padStart(3)}/${targets.length}] ${f.status.toUpperCase().padEnd(12)} ${f.company.slice(0, 30).padEnd(30)} ` +
            `${f.replacementUrl ?? f.secondaryUrls[0] ?? f.note ?? ""}`.slice(0, 90),
        );
      }
      return f;
    });

    writeFileSync(
      "data/url-refresh.json",
      JSON.stringify({ checkedAt: new Date().toISOString(), findings }, null, 2),
    );

    const by = (s: UrlFinding["status"]) => findings.filter((f) => f.status === s);
    console.log(`\n--- url refresh ---`);
    console.log(`unchanged and still a board : ${by("unchanged").length}`);
    console.log(`moved to a new URL          : ${by("moved").length}`);
    console.log(`extra board(s) found        : ${by("extra-found").length}`);
    console.log(`stale (no longer a listing) : ${by("stale").length}`);
    console.log(`unreachable                 : ${by("unreachable").length}`);
    console.log(
      `\nadditional boards discovered: ${findings.reduce((n, f) => n + f.secondaryUrls.length, 0)}`,
    );
    console.log(`\nwrote data/url-refresh.json - apply with npm run urls:apply`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
