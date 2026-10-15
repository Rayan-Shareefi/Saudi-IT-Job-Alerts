/**
 * Decides whether an employer's careers URL still points at their job list.
 *
 * Shared by the CLI sweep (`npm run urls:refresh`) and the in-app button, so
 * the two cannot drift into disagreeing about what "moved" means.
 *
 * The test is deliberately the real one: run the same repeated-block extraction
 * the collector uses and ask whether what comes out are plausible vacancies.
 * Counting job-ish links was not enough - a careers homepage is full of them,
 * which is how Deloitte's brochure page passed while the only thing extractable
 * on it was the cookie-consent table.
 */
import type { Browser } from "playwright";
import type { CompanySeed } from "./sources/companies";
import { looksLikeSecondaryBoard } from "./sources/secondary";
import { REPEATED_BLOCK_SCRIPT, isPlausibleVacancy, type RepeatedCandidate } from "./adapters/repeated";

export interface UrlFinding {
  company: string;
  currentUrl: string;
  /** Set when a better URL was found. */
  suggestedUrl?: string;
  /** Additional boards for the same employer. */
  extraUrls: string[];
  status: "unchanged" | "moved" | "extra-found" | "stale" | "unreachable";
  note?: string;
}

/** Recognised applicant-tracking hosts are boards by definition. */
const ATS_HOST =
  /greenhouse\.io|lever\.co|myworkdayjobs\.com|oraclecloud\.com|successfactors|taleo\.net|icims\.com|smartrecruiters\.com|workable\.com|ashbyhq\.com|bamboohr\.com|recruitee\.com/i;

/**
 * Link text that leads from a careers homepage to the actual listing.
 *
 * Employers routinely split the two: deloitte.com/middle-east/en/careers.html
 * is a brochure page whose "Job search" button points at
 * middleeastjobs.deloitte.com, where the vacancies actually are.
 */
const BOARD_LINK =
  /^(job search|search jobs?|search (our )?jobs|view (all )?(jobs|openings|vacancies|positions)|see (all )?(jobs|openings|vacancies)|browse (jobs|openings)|current (openings|vacancies|opportunities)|open (positions|roles|vacancies)|all (jobs|vacancies|openings)|find a job|explore (jobs|opportunities))$/i;

const BOARD_HOST = /(^|\.)(jobs|careers|job|recruit|talent|hiring)[.-]|[.-](jobs|careers)\./i;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function listsVacancies(page: import("playwright").Page, url: string): Promise<boolean> {
  if (ATS_HOST.test(url)) return true;
  const groups = (await page.evaluate(REPEATED_BLOCK_SCRIPT).catch(() => [])) as RepeatedCandidate[];
  for (const g of groups) {
    const real = g.items.filter((i) => isPlausibleVacancy(i.title, i.text));
    if (real.length >= 3 && real.length >= g.items.length * 0.5) return true;
  }
  return false;
}

export async function checkCareersUrl(seed: CompanySeed, browser: Browser): Promise<UrlFinding> {
  const base: UrlFinding = {
    company: seed.name,
    currentUrl: seed.careersUrl,
    extraUrls: [],
    status: "unchanged",
  };

  const page = await browser.newPage({ userAgent: USER_AGENT, locale: "en-US" });

  try {
    const res = await page.goto(seed.careersUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!res || res.status() >= 400) {
      return { ...base, status: "unreachable", note: `HTTP ${res?.status() ?? "no response"}` };
    }
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const landed = page.url();
    const moved = landed.replace(/\/$/, "") !== seed.careersUrl.replace(/\/$/, "");
    const isBoard = await listsVacancies(page, landed);

    const links = await page
      .$$eval("a[href]", (els) =>
        els.map((e) => ({
          href: (e as HTMLAnchorElement).href,
          text: (e.textContent ?? "").replace(/\s+/g, " ").trim(),
        })),
      )
      .catch(() => [] as Array<{ href: string; text: string }>);

    const known = new Set([seed.careersUrl, ...(seed.altUrls ?? [])].map((u) => u.replace(/\/$/, "")));
    const extras: string[] = [];
    for (const l of links) {
      if (!looksLikeSecondaryBoard(l.href, l.text)) continue;
      const clean = l.href.split("#")[0];
      if (known.has(clean.replace(/\/$/, ""))) continue;
      if (!extras.includes(clean)) extras.push(clean);
      if (extras.length >= 3) break;
    }

    // Not a listing. Before writing it off, follow the button that leads to one.
    if (!isBoard) {
      const candidates = links
        .filter((l) => /^https?:/i.test(l.href))
        .filter((l) => {
          try {
            return BOARD_LINK.test(l.text) || BOARD_HOST.test(new URL(l.href).hostname);
          } catch {
            return false;
          }
        })
        .filter((l) => !/linkedin|facebook|twitter|instagram|youtube|glassdoor|indeed/i.test(l.href))
        .filter((l) => l.href.replace(/\/$/, "") !== landed.replace(/\/$/, ""));

      const tried = new Set<string>();
      for (const c of candidates.slice(0, 3)) {
        const target = c.href.split("#")[0];
        if (tried.has(target)) continue;
        tried.add(target);
        try {
          const r = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20_000 });
          if (!r || r.status() >= 400) continue;
          await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
          await page.waitForTimeout(1200);
          if (await listsVacancies(page, page.url())) {
            return {
              ...base,
              status: "moved",
              suggestedUrl: page.url(),
              extraUrls: extras,
              note: `the careers page is a landing page; "${c.text.slice(0, 30)}" leads to the listing`,
            };
          }
        } catch {
          /* try the next candidate */
        }
      }
    }

    if (moved && isBoard) {
      return {
        ...base,
        status: "moved",
        suggestedUrl: landed,
        extraUrls: extras,
        note: "redirects to a different page that does list jobs",
      };
    }
    if (!isBoard) {
      return {
        ...base,
        status: "stale",
        extraUrls: extras,
        note: "the page loads but no longer looks like a vacancy list",
      };
    }
    if (extras.length > 0) {
      return {
        ...base,
        status: "extra-found",
        extraUrls: extras,
        note: `${extras.length} additional board(s) linked from this page`,
      };
    }
    return base;
  } catch (err) {
    return {
      ...base,
      status: "unreachable",
      note: err instanceof Error ? err.message.slice(0, 90) : String(err),
    };
  } finally {
    await page.close().catch(() => {});
  }
}
