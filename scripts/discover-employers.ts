/**
 * Find employers the board does not track yet, and add them.
 *
 *   npm run employers:discover            # find candidates, try up to 25 (20 min)
 *   npm run employers:discover -- --dry   # report only
 *
 * The user's example: STC posts a security job on LinkedIn, but STC's own
 * careers site is not being checked. So, for every company behind a verified
 * or unclassified cyber/cloud vacancy from LinkedIn, JSearch, Careerjet,
 * Jooble or Workable's Riyadh search that is not in the registry:
 *
 *   1. record it as a candidate (employer_candidates);
 *   2. find its site: the domain of the employer's own apply link, or the
 *      obvious domains for its name, checked to really be that company;
 *   3. find its job board: an ATS linked from the careers page (the same
 *      markup sniff and verified slug probe as sources:discover);
 *   4. add it (dynamic_sources) ONLY if the board returns at least one real
 *      posting in Saudi Arabia. A guess that returns nothing is recorded, not
 *      added, and looked at again after 30 days.
 *
 * Every run - the search button, the schedule, the laptop - reads the added
 * boards (registry.dynamicSources), and every posting from them goes through
 * the same rules, jury and evidence check as any other before it is shown.
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
const PER_RUN = Number(process.argv[process.argv.indexOf("--max") + 1]) || 25;
/** Stop starting new companies after this long; the rest wait for the next run. */
const DEADLINE_MS = 20 * 60_000;
/** A company with no board found is looked at again after this long. */
const RECHECK_MS = 30 * 86_400_000;
const SEARCH_KINDS = ["linkedin", "linkedin-post", "jsearch", "careerjet", "jooble", "aggregator", "telegram"];
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

interface Board {
  adapter: string;
  handle: string;
  careersUrl: string;
  /** Read off the careers page, or confirmed on an ATS API under the company's name. */
  via: "page" | "probe";
}

/**
 * How many real postings in Saudi Arabia the board returns. A board is added
 * only above zero: same name is not same company - "Master Works" (a Riyadh
 * IT firm) matched masterworks.com, a US art-investment company.
 */
async function saudiPostings(name: string, key: string, board: Board): Promise<number> {
  const source = {
    id: `auto-${board.adapter}-${key}`.slice(0, 80),
    label: name,
    company: name,
    kind: board.adapter === "browser" ? "career-page" : "ats",
    adapter: board.adapter,
    handle: board.handle,
    region: "ksa",
    needsBrowser: board.adapter === "browser",
    enabled: true,
  } as const;
  try {
    const adapter = ADAPTERS[board.adapter];
    const postings = adapter ? await adapter(source as never) : [];
    return postings
      .filter((p) => isPlausiblePosting(p.title, p.descriptionText, p.url))
      .filter((p) => SAUDI.test(`${p.locationText ?? ""} ${p.title}`)).length;
  } catch (err) {
    console.log(`  ${name.padEnd(36)} ${board.adapter} board did not load (${err instanceof Error ? err.message.slice(0, 60) : err})`);
    return 0;
  }
}

async function findBoard(seed: CompanySeed, home: string): Promise<Board | null> {
  // An ATS linked or embedded from the careers page.
  for (const path of CAREERS_PATHS) {
    const url = `${home}${path}`;
    try {
      const res = await request(url, { timeoutMs: 12000, retries: 0 });
      if (!res.ok) continue;
      const html = await res.text();
      const found = matchSignatures(html, { ...seed, careersUrl: url });
      if (found.length) return { adapter: found[0].adapter, handle: found[0].handle, careersUrl: url, via: "page" };
      // A careers page with no ATS: read by the browser adapter.
      if (/vacanc|open (positions|roles)|job openings|current openings|وظائف|الوظائف الشاغرة/i.test(html)) {
        return { adapter: "browser", handle: url, careersUrl: url, via: "page" };
      }
    } catch {
      /* next path */
    }
  }
  // A verified slug on a public ATS API (requires real postings and a name match).
  const probed = await probeSlugs(seed).catch(() => []);
  if (probed.length) return { adapter: probed[0].adapter, handle: probed[0].handle, careersUrl: home, via: "probe" };
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
    if (!key || key.length < 3 || tracked.has(key) || /^(unknown|hiringpost|confidential|clientof|telegram)/.test(key)) continue;
    const entry = byCompany.get(key) ?? { name: r.company, rows: [] };
    entry.rows.push(r);
    byCompany.set(key, entry);
  }
  console.log(`${byCompany.size} employer(s) behind cyber/cloud postings are not tracked yet`);

  // Record or refresh every candidate.
  const { data: existing } = await db.from("employer_candidates").select("company_key,status,checked_at");
  const status = new Map((existing ?? []).map((e) => [String(e.company_key), String(e.status)]));
  const checkedAt = new Map((existing ?? []).map((e) => [String(e.company_key), e.checked_at ? new Date(String(e.checked_at)).getTime() : 0]));
  const due = (key: string) => {
    const s = status.get(key) ?? "new";
    return s === "new" || (s === "no-careers-site" && Date.now() - (checkedAt.get(key) ?? 0) > RECHECK_MS);
  };
  if (!DRY) {
    for (const [key, c] of byCompany) {
      await db.from("employer_candidates").upsert(
        { company_key: key, company: c.name, seen_count: c.rows.length, example_title: c.rows[0].title, example_url: c.rows[0].url, updated_at: new Date().toISOString(), ...(status.has(key) ? {} : { status: "new" }) },
        { onConflict: "company_key" },
      );
    }
  }

  const waiting = [...byCompany.keys()].filter(due).length;
  const todo = [...byCompany.entries()]
    .filter(([key]) => due(key))
    .sort((a, b) => b[1].rows.length - a[1].rows.length)
    .slice(0, PER_RUN);
  console.log(`${waiting} waiting to be checked; checking ${todo.length} now (most cyber/cloud postings first)`);

  const started = Date.now();
  let added = 0;
  let checked = 0;
  for (const [key, c] of todo) {
    if (Date.now() - started > DEADLINE_MS) {
      console.log(`  time limit reached - the other ${todo.length - checked} wait for the next run`);
      break;
    }
    checked++;
    const now = new Date().toISOString();
    const seed: CompanySeed = { name: c.name, careersUrl: "", sector: "technology" as CompanySeed["sector"], priority: 2 };
    const byName = (): Promise<Board | null> =>
      probeSlugs(seed)
        .then((p) => (p.length ? { adapter: p[0].adapter, handle: p[0].handle, careersUrl: `its ${p[0].adapter} board "${p[0].handle}"`, via: "probe" as const } : null))
        .catch(() => null);
    // Found through Workable's search, so it hires on an ATS: ask for its
    // board by name first. Guessing the website first went to the wrong
    // page for JODAYN and Master-Works (2026-10-17).
    const viaAts = c.rows.some((r) => r.source_kind === "aggregator");
    let home: string | null = null;
    let board = viaAts ? await byName() : null;
    if (!board) {
      home = await homepageOf(c.name, c.rows);
      // No website found is not the end: many employers answer on a public
      // ATS API under their own name.
      board = home ? await findBoard(seed, home) : viaAts ? null : await byName();
    }
    let real = board ? await saudiPostings(c.name, key, board) : 0;
    // A careers page with nothing Saudi on it may be another company's or one
    // the browser cannot read; the ATS under the company's name is the second
    // chance.
    if (board && real === 0 && board.via === "page" && !viaAts) {
      const second = await byName();
      const n = second ? await saudiPostings(c.name, key, second) : 0;
      if (second && n > 0) {
        board = second;
        real = n;
      }
    }
    if (!board) {
      console.log(`  ${c.name.padEnd(36)} ${home ? `${home} - no job board found` : "no website or job board found"}`);
      if (!DRY) {
        await db
          .from("employer_candidates")
          .update({ status: "no-careers-site", ...(home ? { website: home } : {}), note: home ? "site found, no job board on it" : "no website found from its postings or name, no ATS under its name", checked_at: now })
          .eq("company_key", key);
      }
      continue;
    }

    const id = `auto-${board.adapter}-${key}`.slice(0, 80);
    const kind = board.adapter === "browser" ? "career-page" : "ats";
    if (real === 0) {
      console.log(`  ${c.name.padEnd(36)} ${board.adapter} board has no real postings in Saudi Arabia - not added`);
      if (!DRY) {
        await db
          .from("employer_candidates")
          .update({ status: "no-careers-site", ...(home ? { website: home } : {}), note: `board at ${board.careersUrl} returned no real postings`, checked_at: now })
          .eq("company_key", key);
      }
      continue;
    }
    console.log(`  ${c.name.padEnd(36)} ADD ${board.adapter} ${board.handle} (${real} real postings)`);
    added++;
    if (!DRY) {
      await db.from("dynamic_sources").upsert(
        { id, company: c.name, label: c.name, kind, adapter: board.adapter, handle: board.handle, region: "ksa", needs_browser: board.adapter === "browser", found_via: c.rows[0].source_kind, evidence: `${real} postings on ${board.careersUrl}` },
        { onConflict: "id" },
      );
      await db
        .from("employer_candidates")
        .update({ status: "added", ...(home ? { website: home } : {}), note: `added ${board.adapter} ${board.handle}`, checked_at: now })
        .eq("company_key", key);
    }
  }

  const total = DRY ? null : (await dynamicSources()).length;
  console.log(
    `\nchecked ${checked}, added ${added}${total !== null ? ` - ${total} employer board(s) found automatically so far, searched on every run` : ""}` +
      (waiting - checked > 0 ? `; ${waiting - checked} still waiting` : ""),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
