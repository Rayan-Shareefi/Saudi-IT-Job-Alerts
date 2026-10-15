/**
 * Finds every application address an employer publishes, not just the first.
 *
 * Employers routinely run more than one inbox: SITE takes co-op and trainee
 * applications at a different address from permanent roles. The original
 * harvester collected all the candidates and then returned `preferred ?? undefined`
 * - so the second address was found, and thrown away. A co-op application sent
 * to the general careers inbox is a co-op application that gets ignored.
 *
 * Writes data/email-harvest.json. Apply with `npm run emails:apply`.
 *
 *   npx tsx scripts/harvest-emails.ts             # all employers
 *   npx tsx scripts/harvest-emails.ts --p 2       # priority 1-2 only
 *   npx tsx scripts/harvest-emails.ts --limit 40
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import {
  COMPANIES,
  allCareersEmails,
  isApplicationAddress,
  purposeOfMailbox,
} from "../src/lib/sources/companies";
import { mapLimit } from "../src/lib/http";

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Mailbox names that mean "send your application here". */
const APPLICATION_MAILBOX =
  /^(careers?|jobs?|recruit(ment|ing)?|hiring|hr|humanresources|human\.resources|talent|employment|cv|cvs|resume|apply|application|vacancy|vacancies|co-?op|coop|train(ee|ees|ing)|intern(ship|s)?|students?|graduates?|tamheer|wazayef|tawteef)$/i;

/** Addresses that look like an application inbox without matching exactly. */
const APPLICATION_HINT = /(career|job|recruit|hiring|talent|coop|co-op|intern|trainee|tamheer)/i;

const NOISE =
  /^(no-?reply|noreply|donotreply|info|support|sales|marketing|webmaster|postmaster|admin|contact|hello|enquiries|inquiries|media|press|privacy|legal|dpo|abuse|sentry|example|your|email|user|name|test|sample)@/i;

export interface EmailFinding {
  company: string;
  careersUrl: string;
  /** Everything already on file, so the diff is visible. */
  existing: string[];
  /** Addresses found on the page that are not on file yet. */
  discovered: Array<{ address: string; purpose?: string }>;
  status: "new-addresses" | "unchanged" | "unreachable";
  note?: string;
}

function extractAll(html: string): Array<{ address: string; purpose?: string }> {
  const found = new Map<string, { address: string; purpose?: string }>();
  for (const raw of html.match(EMAIL_RE) ?? []) {
    const email = raw.toLowerCase().replace(/[.,;:)\]]+$/, "");
    // Asset filenames and tracking ids routinely look like addresses.
    if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ttf)$/i.test(email)) continue;
    if (email.length > 80) continue;
    if (NOISE.test(email)) continue;
    // Excludes fraud-reporting and privacy inboxes, which read like application
    // addresses and are the opposite of one.
    if (!isApplicationAddress(email)) continue;

    const box = email.split("@")[0] ?? "";
    // Keep an address only if the mailbox reads like an application inbox -
    // otherwise a careers page's "contact our media team" line becomes an
    // apply-here address, which is worse than having none.
    if (!APPLICATION_MAILBOX.test(box) && !APPLICATION_HINT.test(box)) continue;

    if (!found.has(email)) found.set(email, { address: email, purpose: purposeOfMailbox(email) });
  }
  return [...found.values()];
}

async function inspect(
  seed: (typeof COMPANIES)[number],
  browser: import("playwright").Browser,
): Promise<EmailFinding> {
  const existing = allCareersEmails(seed).map((e) => e.address);
  const base: EmailFinding = {
    company: seed.name,
    careersUrl: seed.careersUrl,
    existing,
    discovered: [],
    status: "unchanged",
  };

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  try {
    const res = await page.goto(seed.careersUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!res || res.status() >= 400) {
      return { ...base, status: "unreachable", note: `HTTP ${res?.status() ?? "no response"}` };
    }
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    // mailto: links are the strongest signal; page text catches the rest.
    const mailtos = await page
      .$$eval('a[href^="mailto:"]', (els) =>
        els.map((e) => (e as HTMLAnchorElement).href.replace(/^mailto:/i, "").split("?")[0]),
      )
      .catch(() => [] as string[]);
    const html = await page.content();

    const all = extractAll([...mailtos, html].join(" "));
    const known = new Set(existing);
    const discovered = all.filter((e) => !known.has(e.address));

    return discovered.length > 0
      ? { ...base, discovered, status: "new-addresses", note: `${discovered.length} not on file` }
      : base;
  } catch (err) {
    return { ...base, status: "unreachable", note: err instanceof Error ? err.message.slice(0, 70) : String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const maxPriority = Number(arg("p") ?? 3);
  const limit = Number(arg("limit") ?? 1000);
  const targets = COMPANIES.filter((c) => c.priority <= maxPriority).slice(0, limit);

  console.log(`Harvesting application addresses from ${targets.length} careers pages...\n`);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  let done = 0;

  try {
    const findings = await mapLimit(targets, 4, async (seed) => {
      const f = await inspect(seed, browser).catch(
        (): EmailFinding => ({
          company: seed.name,
          careersUrl: seed.careersUrl,
          existing: [],
          discovered: [],
          status: "unreachable",
          note: "threw",
        }),
      );
      done++;
      if (f.status === "new-addresses") {
        console.log(
          `[${String(done).padStart(3)}/${targets.length}] ${f.company.slice(0, 32).padEnd(32)} ` +
            `+ ${f.discovered.map((d) => d.address).join(", ").slice(0, 60)}`,
        );
      }
      return f;
    });

    writeFileSync(
      "data/email-harvest.json",
      JSON.stringify({ checkedAt: new Date().toISOString(), findings }, null, 2),
    );

    const withNew = findings.filter((f) => f.status === "new-addresses");
    const extraCount = withNew.reduce((n, f) => n + f.discovered.length, 0);
    console.log(`\n--- email harvest ---`);
    console.log(`employers checked        : ${findings.length}`);
    console.log(`with addresses not on file: ${withNew.length}`);
    console.log(`new addresses found      : ${extraCount}`);
    console.log(`unreachable              : ${findings.filter((f) => f.status === "unreachable").length}`);

    const coop = withNew.flatMap((f) => f.discovered).filter((d) => /co-?op|train|intern|student|graduate/i.test(d.address));
    if (coop.length > 0) {
      console.log(`\nco-op / trainee inboxes found (${coop.length}):`);
      for (const c of coop.slice(0, 15)) console.log(`  ${c.address}`);
    }

    console.log(`\nwrote data/email-harvest.json - apply with npm run emails:apply`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
