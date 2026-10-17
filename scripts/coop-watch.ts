/**
 * Co-op watch: notice when a company opens a co-op / internship intake, even
 * on a page that did not exist before.
 *
 *   npm run coop:watch            # check the next 15 companies in rotation
 *   npm run coop:watch -- --all   # every watched company (slow)
 *
 * The user's point: a company may publish a brand-new page or subdomain for
 * this year's co-op intake rather than update the overview page we know. So
 * each watched company (the priority-1 employers) is checked three ways:
 *
 *   1. its careers page: the co-op / internship wording on it changed;
 *   2. its sitemap.xml: a page appeared whose address says co-op / intern /
 *      graduate / تدريب;
 *   3. public certificate-transparency logs (crt.sh, free): a new subdomain
 *      such as coop., careers., talent. or jobs. was issued a certificate.
 *
 * The first visit to a company records what is there without alerting, so a
 * new watch does not flood the inbox. Anything new afterwards becomes a
 * coop_signals row, which the next alert email sends once.
 */
import "./load-env";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "../src/lib/db";
import { getText, sleep } from "../src/lib/http";
import { COMPANIES } from "../src/lib/sources/companies";

const ALL = process.argv.includes("--all");
const PER_RUN = 15;
const COOP_WORDS = /co-?op\b|cooperative training|internship|intern\b|graduate (program|development)|summer training|tamheer|تدريب تعاوني|التدريب التعاوني|تدريب صيفي|تمهير|حديثي التخرج/i;
const COOP_PATH = /co-?op|cooperative|intern|graduate|summer|tamheer|trainee|تدريب|تعاوني/i;
const NEW_HOST = /(^|\.)(coop|co-op|careers?|talent|jobs|intern|internship|graduates?|recruit|hiring|join|tamheer)\./i;

interface Watch {
  company: string;
  overview_url: string | null;
  domain: string | null;
  last_hash: string | null;
  known_urls: string[];
  known_hosts: string[];
  checked_at: string | null;
}

function domainOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    // Third-party boards are not the company's own domain.
    if (/myworkdayjobs|successfactors|oraclecloud|taleo|greenhouse|lever|workable|smartrecruiters|linkedin/i.test(h)) return null;
    return h.split(".").slice(-3).join(".").replace(/^(careers|jobs)\./, "");
  } catch {
    return null;
  }
}

/** The co-op related lines of a page, as one fingerprint. */
function coopFingerprint(html: string): { hash: string; lines: string[] } {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 6 && l.length < 300 && COOP_WORDS.test(l));
  return { hash: createHash("sha1").update(lines.join("|")).digest("hex").slice(0, 16), lines };
}

async function sitemapUrls(domain: string): Promise<string[]> {
  const out: string[] = [];
  for (const root of [`https://${domain}/sitemap.xml`, `https://www.${domain}/sitemap.xml`]) {
    try {
      const xml = await getText(root, { timeoutMs: 12000, retries: 0 });
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      // A sitemap index: follow the children that look like page lists, a few only.
      const children = locs.filter((l) => /sitemap.*\.xml/i.test(l)).slice(0, 6);
      out.push(...locs.filter((l) => !/\.xml(\?|$)/i.test(l)));
      for (const c of children) {
        try {
          const sub = await getText(c, { timeoutMs: 12000, retries: 0 });
          out.push(...[...sub.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]));
        } catch {
          /* one child failing is fine */
        }
      }
      if (out.length) break;
    } catch {
      /* no sitemap at this root */
    }
  }
  return out.filter((u) => COOP_PATH.test(decodeURIComponent(u))).slice(0, 500);
}

async function newHosts(domain: string): Promise<string[]> {
  try {
    const body = await getText(`https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`, { timeoutMs: 30000, retries: 0 });
    const rows = JSON.parse(body) as Array<{ name_value: string; not_before: string }>;
    const recent = Date.now() - 400 * 86_400_000;
    const hosts = new Set<string>();
    for (const r of rows) {
      if (new Date(r.not_before).getTime() < recent) continue;
      for (const n of r.name_value.split("\n")) {
        const h = n.trim().toLowerCase().replace(/^\*\./, "");
        if (h.endsWith(domain) && NEW_HOST.test(`${h}.`)) hosts.add(h);
      }
    }
    return [...hosts];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const db = supabaseAdmin();
  const watched = COMPANIES.filter((c) => c.priority === 1 && c.careersUrl);
  const { data } = await db.from("coop_watch").select("*");
  const state = new Map((data as Watch[] | null ?? []).map((w) => [w.company, w]));

  // Least recently checked first.
  const queue = [...watched].sort((a, b) => (state.get(a.name)?.checked_at ?? "").localeCompare(state.get(b.name)?.checked_at ?? "")).slice(0, ALL ? watched.length : PER_RUN);

  let signals = 0;
  for (const c of queue) {
    const prev = state.get(c.name);
    const first = !prev;
    const domain = prev?.domain ?? domainOf(c.careersUrl);
    const record = async (kind: string, url: string, detail: string) => {
      if (first) return; // baseline only
      const { error } = await db.from("coop_signals").insert({ company: c.name, kind, url, detail });
      if (!error) {
        signals++;
        console.log(`  ! ${c.name}: ${detail} - ${url}`);
      }
    };

    // 1. Co-op wording on the careers page.
    let hash = prev?.last_hash ?? null;
    try {
      const html = await getText(c.careersUrl, { timeoutMs: 15000, retries: 0 });
      const fp = coopFingerprint(html);
      if (fp.lines.length && prev?.last_hash && fp.hash !== prev.last_hash) {
        await record("page-changed", c.careersUrl, `co-op / internship wording changed: "${fp.lines[0].slice(0, 90)}"`);
      }
      hash = fp.hash;
    } catch {
      /* unreachable this time; try again next rotation */
    }

    // 2. New co-op pages in the sitemap.
    const known = new Set(prev?.known_urls ?? []);
    const urls = domain ? await sitemapUrls(domain) : [];
    for (const u of urls) if (!known.has(u)) await record("new-page", u, "a new co-op / internship page appeared on the site");

    // 3. New careers / co-op subdomains.
    const knownHosts = new Set(prev?.known_hosts ?? []);
    const hosts = domain ? await newHosts(domain) : [];
    for (const h of hosts) if (!knownHosts.has(h)) await record("new-subdomain", `https://${h}/`, `a new site was set up: ${h}`);

    await db.from("coop_watch").upsert(
      {
        company: c.name,
        overview_url: c.careersUrl,
        domain,
        last_hash: hash,
        known_urls: [...new Set([...known, ...urls])].slice(-2000),
        known_hosts: [...new Set([...knownHosts, ...hosts])],
        checked_at: new Date().toISOString(),
      },
      { onConflict: "company" },
    );
    console.log(`${first ? "baseline" : "checked "} ${c.name.padEnd(34)} ${urls.length} co-op page(s), ${hosts.length} careers host(s)`);
    await sleep(1500);
  }
  console.log(`\n${queue.length} company(ies) checked, ${signals} new co-op signal(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
