/**
 * Re-examines sources that ran cleanly but returned nothing.
 *
 * Zero results has two very different causes and they need opposite responses:
 *
 *   - the employer genuinely has no Riyadh openings right now  -> leave it
 *   - the URL points at a careers *landing* page rather than the vacancy list
 *     -> the URL is wrong and needs replacing
 *
 * The second is the common one, and it is invisible from the health table: the
 * page loads, returns 200, contains the word "careers", and has no jobs on it
 * because the jobs live one click deeper behind "View all openings".
 *
 * So this loads each zero-yield page and asks: does it list vacancies, or does
 * it advertise a link to where the vacancies are? When it is the latter, the
 * deeper URL is followed and proposed as a replacement.
 *
 *   npx tsx scripts/audit-zero.ts            # all zero-yield sources
 *   npx tsx scripts/audit-zero.ts --limit 40
 */
import "./load-env";
import { writeFileSync } from "node:fs";
import { sourceHealth, isConfigured } from "../src/lib/db";
import { sourceById } from "../src/lib/sources/registry";
import { COMPANIES } from "../src/lib/sources/companies";
import { mapLimit } from "../src/lib/http";

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Link text that means "the actual vacancies are through here". */
const DEEPER_LINK =
  /(view|see|browse|search|explore|all)\s+(all\s+)?(current\s+)?(job|jobs|opening|openings|vacanc|position|opportunit|role)|current openings|open positions|job search|search jobs|available jobs|الوظائف الشاغرة|الوظائف المتاحة|تصفح الوظائف/i;

export interface ZeroFinding {
  sourceId: string;
  company: string;
  adapter: string;
  url: string;
  verdict: "listing-page" | "landing-page" | "unreachable" | "no-openings";
  jobLinksFound: number;
  suggestedUrl?: string;
  suggestedJobLinks?: number;
  note?: string;
}

/** How many links on this page look like individual job postings? */
function countJobLinks(hrefs: string[]): number {
  const seen = new Set<string>();
  for (const href of hrefs) {
    if (!/job|career|vacan|position|opening|requisition/i.test(href)) continue;
    // A posting link carries an id or a long slug; a nav link does not.
    if (!/[-/](\d{4,})(?:[/?#]|$)/.test(href) && !/\/(jobs?|careers?)\/[a-z0-9][a-z0-9-]{10,}/i.test(href)) {
      continue;
    }
    seen.add(href);
  }
  return seen.size;
}

async function main(): Promise<void> {
  if (!isConfigured()) {
    console.error("Supabase is not configured - this reads the source_health table.");
    process.exit(1);
  }

  const limit = Number(arg("limit") ?? 500);
  const health = await sourceHealth();

  // Ran fine, produced nothing. Failures belong in the Failing sources tab.
  const zero = health
    .filter((h) => h.ok && h.kept === 0)
    .map((h) => {
      const src = sourceById(h.sourceId);
      const company = COMPANIES.find((c) => c.name === h.label);
      const url = src?.handle?.startsWith("http") ? src.handle : company?.careersUrl;
      return { ...h, url, adapter: src?.adapter ?? h.adapter };
    })
    .filter((h): h is typeof h & { url: string } => Boolean(h.url))
    .slice(0, limit);

  console.log(`Re-checking ${zero.length} sources that returned nothing...\n`);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  let done = 0;

  try {
    const findings = await mapLimit(zero, 4, async (row): Promise<ZeroFinding> => {
      const base: ZeroFinding = {
        sourceId: row.sourceId,
        company: row.label,
        adapter: row.adapter,
        url: row.url,
        verdict: "unreachable",
        jobLinksFound: 0,
      };

      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale: "en-US",
      });

      try {
        const res = await page.goto(row.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(2000);
        if (!res || res.status() >= 400) {
          done++;
          return { ...base, note: `HTTP ${res?.status() ?? "no response"}` };
        }

        const links = await page
          .$$eval("a[href]", (els) => els.map((e) => (e as HTMLAnchorElement).href))
          .catch(() => [] as string[]);
        const jobLinks = countJobLinks(links);

        if (jobLinks >= 3) {
          done++;
          return { ...base, verdict: "listing-page", jobLinksFound: jobLinks };
        }

        // Few or no postings: is there a link deeper in to where they live?
        const candidates = await page
          .$$eval("a[href]", (els) =>
            els.map((e) => ({
              href: (e as HTMLAnchorElement).href,
              text: (e.textContent ?? "").replace(/\s+/g, " ").trim(),
            })),
          )
          .catch(() => [] as Array<{ href: string; text: string }>);

        const deeper = candidates.filter(
          (c) => DEEPER_LINK.test(c.text) && !/^(mailto:|tel:|javascript:)/i.test(c.href),
        );

        for (const cand of deeper.slice(0, 3)) {
          try {
            const r2 = await page.goto(cand.href, { waitUntil: "domcontentloaded", timeout: 25_000 });
            await page.waitForTimeout(1800);
            if (!r2 || r2.status() >= 400) continue;
            const links2 = await page
              .$$eval("a[href]", (els) => els.map((e) => (e as HTMLAnchorElement).href))
              .catch(() => [] as string[]);
            const jobs2 = countJobLinks(links2);
            if (jobs2 >= 3) {
              done++;
              return {
                ...base,
                verdict: "landing-page",
                jobLinksFound: jobLinks,
                suggestedUrl: page.url(),
                suggestedJobLinks: jobs2,
                note: `"${cand.text.slice(0, 40)}" leads to the real list`,
              };
            }
          } catch {
            /* next candidate */
          }
        }

        done++;
        return {
          ...base,
          verdict: "no-openings",
          jobLinksFound: jobLinks,
          note: "page loads and lists nothing - probably genuinely empty",
        };
      } catch (err) {
        done++;
        return { ...base, note: err instanceof Error ? err.message.slice(0, 80) : String(err) };
      } finally {
        await page.close().catch(() => {});
        if (done % 10 === 0) console.log(`  ...${done}/${zero.length}`);
      }
    });

    writeFileSync(
      "data/zero-audit.json",
      JSON.stringify({ auditedAt: new Date().toISOString(), findings }, null, 2),
    );

    const by = (v: ZeroFinding["verdict"]) => findings.filter((f) => f.verdict === v);
    console.log(`\n--- zero-yield audit ---`);
    console.log(`wrong URL (landing page, real list found) : ${by("landing-page").length}`);
    console.log(`correct URL, genuinely no openings        : ${by("no-openings").length}`);
    console.log(`correct URL, lists jobs but none matched  : ${by("listing-page").length}`);
    console.log(`unreachable                               : ${by("unreachable").length}`);

    const fixes = by("landing-page");
    if (fixes.length > 0) {
      console.log(`\nURLs to replace:`);
      for (const f of fixes) {
        console.log(`  ${f.company.slice(0, 32).padEnd(32)}`);
        console.log(`    from ${f.url}`);
        console.log(`    to   ${f.suggestedUrl}  (${f.suggestedJobLinks} postings)`);
      }
    }
    console.log(`\nwrote data/zero-audit.json - apply with scripts/apply-zero-fixes.ts`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
