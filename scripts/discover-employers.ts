/**
 * Find employers the board does not track yet, and add them.
 *
 *   npm run employers:discover            # find candidates, try up to 6
 *   npm run employers:discover -- --dry   # report only
 *
 * The user's example: STC posts a security job on LinkedIn, but STC's own
 * careers site is not being checked. So, for every company behind a verified
 * or unclassified cyber/cloud vacancy from LinkedIn, JSearch, Careerjet or
 * Jooble that is not in the registry:
 *
 *   1. record it as a candidate (employer_candidates);
 *   2. find its site: the domain of the employer's own apply link, or the
 *      obvious domains for its name, checked to really be that company;
 *   3. find its job board: an ATS linked from the careers page (the same
 *      markup sniff and verified slug probe as sources:discover);
 *   4. add it (dynamic_sources) ONLY if the board returns at least one real
 *      posting. A guess that returns nothing is recorded, not added.
 *
 * No search engine is scraped and no bot protection is bypassed: a site that
 * refuses is recorded as "blocked" and stays covered by LinkedIn and JSearch.
 */
import "./load-env";
import { companyKey } from "../src/lib/company-key";
import { fetchAllRows, supabaseAdmin } from "../src/lib/db";
import { getText, request } from "../src/lib/http";
import { ADAPTERS } from "../src/lib/adapters";
import { COMPANIES, type CompanySeed } from "../src/lib/sources/companies";
import { dynamicSources } from "../src/lib/sources/registry";
import { isPlausiblePosting } from "../src/lib/plausible";
import { matchSignatures, probeSlugs } from "./discover-ats";

const DRY = process.argv.includes("--dry");
const PER_RUN = Number(process.argv[process.argv.indexOf("--max") + 1]) || 6;
const SEARCH_KINDS = ["linkedin", "linkedin-post", "jsearch", "careerjet", "jooble"];
const NOT_EMPLOYER_HOST = /linkedin\.|indeed\.|bayt\.|glassdoor\.|careerjet|jooble|jobviewtrack|google\.|naukrigulf|gulftalent|tanqeeb|wuzzuf|forms\.|greenhouse\.io|lever\.co|workable\.com|myworkdayjobs|smartrecruiters|ashbyhq|bamboohr|recruitee|successfactors|oraclecloud|taleo/i;
const SAUDI = /saudi|riyadh|\bksa\b|jeddah|dammam|khobar|الرياض|السعودية|المملكة/i;
const CAREERS_PATHS = ["/careers", "/en/careers", "/careers/", "/jobs", "/join-us", "/en/join-us", "/about/careers", "/ar/careers"];

interface Row {
  company: string;
  title: string;
  url: string;
  apply_url: string | null;
  source_kind: string;
}

async function homepageOf(name: string, rows: Row[]): Promise<string | null> {
  /*
   * An apply link on the employer's own domain. Not just "any host that is not
   * a known board": there are hundreds of aggregators (bebee.com was taken for
   * Datamatics' site in testing), so the domain must carry the company's name.
   */
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !["technologies", "technology", "solutions", "company", "group", "saudi", "arabia", "services", "systems", "international"].includes(w));
  for (const r of rows) {
    for (const link of [r.apply_url, r.url]) {
      if (!link) continue;
      try {
        const u = new URL(link);
        const host = u.hostname.toLowerCase();
        if (NOT_EMPLOYER_HOST.test(host)) continue;
        if (tokens.some((t) => host.includes(t))) return `${u.protocol}//${u.hostname}`;
      } catch {
        /* not a URL */
      }
    }
  }
  // Otherwise the obvious domains, accepted only if the page names the company.
  const slug = companyKey(name).replace(/[^a-z0-9]/g, "");
  if (slug.length < 3) return null;
  for (const host of [`${slug}.com.sa`, `${slug}.sa`, `${slug}.com`]) {
    try {
      const html = await getText(`https://${host}/`, { timeoutMs: 9000, retries: 0 });
      const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      if (words.length && words.every((w) => html.toLowerCase().includes(w))) return `https://${host}`;
    } catch {
      /* not this one */
    }
  }
  return null;
}

async function findBoard(seed: CompanySeed, home: string): Promise<{ adapter: string; handle: string; careersUrl: string } | null> {
  // An ATS linked or embedded from the careers page.
  for (const path of CAREERS_PATHS) {
    const url = `${home}${path}`;
    try {
      const res = await request(url, { timeoutMs: 12000, retries: 0 });
      if (!res.ok) continue;
      const html = await res.text();
      const found = matchSignatures(html, { ...seed, careersUrl: url });
      if (found.length) return { adapter: found[0].adapter, handle: found[0].handle, careersUrl: url };
      // A careers page with no ATS: read by the browser adapter.
      if (/vacanc|open (positions|roles)|job openings|current openings|وظائف|الوظائف الشاغرة/i.test(html)) {
        return { adapter: "browser", handle: url, careersUrl: url };
      }
    } catch {
      /* next path */
    }
  }
  // A verified slug on a public ATS API (requires real postings and a name match).
  const probed = await probeSlugs(seed).catch(() => []);
  if (probed.length) return { adapter: probed[0].adapter, handle: probed[0].handle, careersUrl: home };
  return null;
}

async function main(): Promise<void> {
  const db = supabaseAdmin();
  const tracked = new Set([...COMPANIES.map((c) => companyKey(c.name)), ...(await dynamicSources()).map((d) => companyKey(d.company ?? d.label))]);

  const rows = await fetchAllRows<Row>(
    (from, to) =>
      db
        .from("jobs")
        .select("company,title,url,apply_url,source_kind")
        .eq("is_active", true)
        .in("source_kind", SEARCH_KINDS)
        .in("review_state", ["show", "unclassified", "needs_review"])
        .range(from, to),
    "search-result rows",
  );

  const byCompany = new Map<string, { name: string; rows: Row[] }>();
  for (const r of rows) {
    const key = companyKey(r.company);
    if (!key || key.length < 3 || tracked.has(key) || /^(unknown|hiringpost|confidential|clientof)/.test(key)) continue;
    const entry = byCompany.get(key) ?? { name: r.company, rows: [] };
    entry.rows.push(r);
    byCompany.set(key, entry);
  }
  console.log(`${byCompany.size} employer(s) behind cyber/cloud postings are not tracked yet`);

  // Record or refresh every candidate.
  const { data: existing } = await db.from("employer_candidates").select("company_key,status");
  const status = new Map((existing ?? []).map((e) => [String(e.company_key), String(e.status)]));
  if (!DRY) {
    for (const [key, c] of byCompany) {
      await db.from("employer_candidates").upsert(
        { company_key: key, company: c.name, seen_count: c.rows.length, example_title: c.rows[0].title, example_url: c.rows[0].url, updated_at: new Date().toISOString(), ...(status.has(key) ? {} : { status: "new" }) },
        { onConflict: "company_key" },
      );
    }
  }

  const todo = [...byCompany.entries()]
    .filter(([key]) => (status.get(key) ?? "new") === "new")
    .sort((a, b) => b[1].rows.length - a[1].rows.length)
    .slice(0, PER_RUN);

  for (const [key, c] of todo) {
    const seed: CompanySeed = { name: c.name, careersUrl: "", sector: "technology" as CompanySeed["sector"], priority: 2 };
    const home = await homepageOf(c.name, c.rows);
    if (!home) {
      console.log(`  ${c.name.padEnd(36)} no website found`);
      if (!DRY) await db.from("employer_candidates").update({ status: "no-careers-site", note: "no website found from its postings or name" }).eq("company_key", key);
      continue;
    }
    const board = await findBoard(seed, home);
    if (!board) {
      console.log(`  ${c.name.padEnd(36)} ${home} - no job board found`);
      if (!DRY) await db.from("employer_candidates").update({ status: "no-careers-site", website: home, note: "site found, no job board on it" }).eq("company_key", key);
      continue;
    }

    // Validate: the board must return at least one real posting before it is added.
    const id = `auto-${board.adapter}-${key}`.slice(0, 80);
    const source = { id, label: c.name, company: c.name, kind: board.adapter === "browser" ? "career-page" : "ats", adapter: board.adapter, handle: board.handle, region: "ksa", needsBrowser: board.adapter === "browser", enabled: true } as const;
    let real = 0;
    try {
      const adapter = ADAPTERS[board.adapter];
      const postings = adapter ? await adapter(source as never) : [];
      const plausible = postings.filter((p) => isPlausiblePosting(p.title, p.descriptionText, p.url));
      /*
       * Same name is not same company: "Master Works" (a Riyadh IT firm)
       * matched masterworks.com, a US art-investment company. A board is only
       * this employer's if it actually hires in Saudi Arabia.
       */
      const saudi = plausible.filter((p) => SAUDI.test(`${p.locationText ?? ""} ${p.title}`));
      real = saudi.length;
    } catch (err) {
      console.log(`  ${c.name.padEnd(36)} ${board.adapter} board did not load (${err instanceof Error ? err.message.slice(0, 60) : err})`);
    }
    if (real === 0) {
      if (!DRY) await db.from("employer_candidates").update({ status: "no-careers-site", website: home, note: `board at ${board.careersUrl} returned no real postings` }).eq("company_key", key);
      continue;
    }
    console.log(`  ${c.name.padEnd(36)} ADD ${board.adapter} ${board.handle} (${real} real postings)`);
    if (!DRY) {
      await db.from("dynamic_sources").upsert(
        { id, company: c.name, label: c.name, kind: source.kind, adapter: board.adapter, handle: board.handle, region: "ksa", needs_browser: source.needsBrowser, found_via: c.rows[0].source_kind, evidence: `${real} postings on ${board.careersUrl}` },
        { onConflict: "id" },
      );
      await db.from("employer_candidates").update({ status: "added", website: home, note: `added ${board.adapter} ${board.handle}` }).eq("company_key", key);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
