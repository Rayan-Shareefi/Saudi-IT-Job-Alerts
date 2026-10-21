/**
 * Resolves the employer list into concrete, pollable sources.
 *
 * Three passes, cheapest first. Each company stops at the first pass that finds
 * a real applicant-tracking system:
 *
 *   A. markup sniff  - fetch the careers page, read the ATS slug out of the
 *                      HTML. Works whenever the page is server-rendered.
 *   B. slug probe    - guess slugs from the company name and *verify* each one
 *                      against the ATS's own API. A 200 with a valid payload is
 *                      proof, not a guess.
 *   C. browser sniff - load the page in Chromium and re-run pass A against the
 *                      hydrated DOM plus the final redirect URL. Catches the
 *                      many careers pages that inject their board client-side.
 *
 * Writes data/discovered.json.
 *
 *   npx tsx scripts/discover-ats.ts              # all passes
 *   npx tsx scripts/discover-ats.ts --no-browser # skip pass C
 *   npx tsx scripts/discover-ats.ts --p 1        # priority-1 employers only
 */
// Needed for the accepted-URL overrides below: without it isConfigured() is
// false when this runs from the CLI and your decisions are silently skipped.
import "./load-env";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { COMPANIES, isGlobalEmployer, type CompanySeed } from "../src/lib/sources/companies";
import { acceptedUrlOverrides, isConfigured } from "../src/lib/db";
import { getText, mapLimit, request } from "../src/lib/http";
import type { SourceDefinition } from "../src/lib/types";

/* -------------------------------------------------------------------------- */
/* pass A - markup signatures                                                  */
/* -------------------------------------------------------------------------- */

interface Signature {
  adapter: string;
  pattern: RegExp;
  build?: (m: RegExpMatchArray) => { handle: string } | null;
}

/** Path segments that are never a board slug. */
const BLOCKLIST = new Set([
  "www", "jobs", "careers", "search", "en", "us", "job", "static", "assets",
  "images", "img", "css", "js", "api", "embed", "widget", "index", "home",
  "about", "v1", "boards", "board", "company", "companies", "public", "app",
]);

const SIGNATURES: Signature[] = [
  // Most specific greenhouse forms first so the slug is never "v1"/"embed".
  {
    adapter: "greenhouse",
    pattern: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]{2,40})/i,
  },
  {
    adapter: "greenhouse",
    pattern: /greenhouse\.io\/embed\/job_board\?for=([a-z0-9_-]{2,40})/i,
  },
  {
    adapter: "greenhouse",
    pattern: /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]{2,40})/i,
  },
  { adapter: "lever", pattern: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]{2,40})/i },
  { adapter: "ashby", pattern: /jobs\.ashbyhq\.com\/([a-z0-9_.-]{2,40})/i },
  {
    adapter: "smartrecruiters",
    pattern: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]{2,40})/,
  },
  { adapter: "workable", pattern: /apply\.workable\.com\/([a-z0-9_-]{2,40})/i },
  { adapter: "recruitee", pattern: /([a-z0-9_-]{2,40})\.recruitee\.com/i },
  { adapter: "bamboohr", pattern: /([a-z0-9_-]{2,40})\.bamboohr\.com/i },
  { adapter: "personio", pattern: /([a-z0-9_-]{2,40})\.jobs\.personio\.(?:de|com)/i },
  {
    adapter: "workday",
    pattern: /([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/,
    build: (m) => (BLOCKLIST.has(m[2].toLowerCase()) ? null : { handle: `${m[1]}/${m[2]}` }),
  },
  {
    // The path segment after sites/ is the site id, and Oracle uses the same
    // value for the REST finder's siteNumber in the overwhelming majority of
    // deployments -- so it fills both slots rather than a hardcoded guess.
    adapter: "oraclecloud",
    pattern: /([a-z0-9-]+\.fa\.[a-z0-9]+\.(?:ocs\.)?oraclecloud\.com)[^"'\s]*?\/sites\/([A-Za-z0-9_]+)/i,
    build: (m) => ({ handle: `${m[1]}|${m[2]}|${m[2]}` }),
  },
  {
    adapter: "taleo",
    pattern: /([a-z0-9-]+\.taleo\.net)\/careersection\/([a-z0-9_.-]+)/i,
    build: (m) => ({ handle: `${m[1]}|${m[2]}` }),
  },
  {
    adapter: "successfactors",
    pattern: /(https?:\/\/[a-z0-9.-]*(?:successfactors|sapsf)\.[a-z]+\/[^"'\s]*(?:career|jobs)[^"'\s]*)/i,
    // Not the page's script assets: Wipro's and Fujitsu's sources were a
    // "messagebundle.properties" file whose path names "rmk-jobs-search", and
    // failed on every run for months (fixed 2026-10-21).
    build: (m) => (/messagebundle|\/verp\/|\.properties|\.js\b/i.test(m[1]) ? null : { handle: m[1].replace(/&amp;/g, "&") }),
  },
];

export function matchSignatures(html: string, seed: CompanySeed): SourceDefinition[] {
  const out: SourceDefinition[] = [];
  const seen = new Set<string>();

  for (const sig of SIGNATURES) {
    const m = html.match(sig.pattern);
    if (!m) continue;
    const built = sig.build ? sig.build(m) : { handle: m[1] };
    if (!built) continue;
    if (BLOCKLIST.has(built.handle.split(/[/|.]/)[0].toLowerCase())) continue;

    const key = `${sig.adapter}:${built.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // One source per adapter: the first (most specific) pattern wins.
    if (out.some((s) => s.adapter === sig.adapter)) continue;

    out.push({
      id: `${sig.adapter}-${slugId(seed.name)}`,
      label: seed.name,
      company: seed.name,
      kind: "ats",
      adapter: sig.adapter,
      handle: built.handle,
      region: regionOf(seed),
      enabled: true,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* pass B - verified slug probing                                              */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "group", "holding", "holdings", "company", "co", "inc", "ltd", "llc", "plc",
  "the", "and", "technologies", "technology", "saudi", "arabia", "arabian",
  "international", "corporation", "corp", "systems", "solutions", "global",
  "middle", "east", "software", "networks", "bank", "by",
]);

/**
 * Single generic words that are real boards belonging to somebody else.
 * "Saudi National Bank" reduces to `national` once stopwords are stripped, and
 * `national` is an active Greenhouse board for a company in Toronto.
 */
const GENERIC_SLUGS = new Set([
  "national", "international", "global", "digital", "capital", "central",
  "first", "general", "united", "arab", "gulf", "royal", "modern", "advanced",
  "smart", "future", "vision", "prime", "premier", "unified", "integrated",
  "eastern", "western", "northern", "southern", "middle", "new", "next",
]);

/** Slug candidates for a company name, most likely first. */
export function slugCandidates(name: string): string[] {
  const acronym = name.match(/\(([A-Za-z]{2,8})\)/)?.[1]?.toLowerCase();
  const base = name.replace(/\([^)]*\)/g, " ").replace(/['".,]/g, "");
  const words = base.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  const core = words.filter((w) => !STOPWORDS.has(w));

  const out: string[] = [];
  /**
   * `minLength` is the whole point here.
   *
   * A slug derived from the full company name can safely be short - "elm",
   * "hala" and "bupa" really are those companies. A slug derived from an
   * *acronym* cannot: three letters is a namespace shared by thousands of
   * organisations, and the probe cannot tell them apart because it only checks
   * that the board returns jobs. Measured collisions from allowing 3-letter
   * acronyms: `nca` is a Phoenix preschool, `sar` a New York learning center,
   * `sgh` a Texas hospice, `sta` a Norfolk clinic - none of them the Saudi
   * bodies whose initials they match.
   */
  const push = (v: string | undefined, minLength = 3) => {
    if (
      v &&
      v.length >= minLength &&
      v.length <= 40 &&
      !out.includes(v) &&
      !BLOCKLIST.has(v) &&
      !GENERIC_SLUGS.has(v)
    ) {
      out.push(v);
    }
  };

  // Deliberately no "first significant word" candidate. Stopword stripping
  // reduces both "Saudi National Bank" and "National Cybersecurity Authority"
  // to `national`, which is a real Greenhouse board belonging to a company in
  // Toronto. Single-word company names are already covered by core.join("").
  push(core.join(""));
  push(words.join(""));
  push(core.join("-"));
  // Acronyms and initials need four characters before they are trustworthy.
  push(acronym, 4);
  if (words.length > 1) push(words.map((w) => w[0]).join(""), 4);

  return out.slice(0, 4);
}

/**
 * A probe is only believed when the endpoint returns at least one real posting.
 *
 * Shape alone is worthless: SmartRecruiters answers 200 with an empty page for
 * any slug, and Workable has reserved-but-idle accounts under famous company
 * names (`lockheedmartin`, `vmware`) that return `{"jobs":[]}` -- Lockheed
 * Martin does not use Workable. Requiring a posting, plus a name match where
 * the API exposes one, is what separates a real board from a lookalike.
 *
 * The cost is that a genuine board with zero current openings is missed; it
 * gets picked up the next time discovery runs.
 */
interface Probe {
  adapter: string;
  url: (slug: string) => string;
  /** Number of postings in the payload; -1 when the body is not a board. */
  count: (body: string) => number;
  /** Account name the API reports, when it reports one. */
  name?: (body: string) => string | null;
}

function json<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function arrayLen(body: string, key: string): number {
  const j = json<Record<string, unknown>>(body);
  if (!j) return -1;
  const v = j[key];
  return Array.isArray(v) ? v.length : -1;
}

/** Loose company-name match: shared significant token, either direction. */
function nameMatches(reported: string, company: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = norm(reported);
  const b = norm(company.replace(/\([^)]*\)/g, ""));
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;

  const tokens = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 3 && !STOPWORDS.has(t));
  const ta = new Set(tokens(reported));
  return tokens(company).some((t) => ta.has(t));
}

const PROBES: Probe[] = [
  {
    adapter: "greenhouse",
    url: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    count: (b) => arrayLen(b, "jobs"),
  },
  {
    adapter: "lever",
    url: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
    count: (b) => {
      const j = json<unknown[]>(b);
      return Array.isArray(j) ? j.length : -1;
    },
  },
  {
    adapter: "ashby",
    url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    count: (b) => arrayLen(b, "jobs"),
  },
  {
    adapter: "smartrecruiters",
    url: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`,
    count: (b) => arrayLen(b, "content"),
  },
  {
    adapter: "workable",
    url: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=false`,
    count: (b) => arrayLen(b, "jobs"),
    name: (b) => json<{ name?: string }>(b)?.name ?? null,
  },
  {
    adapter: "recruitee",
    url: (s) => `https://${s}.recruitee.com/api/offers/`,
    count: (b) => arrayLen(b, "offers"),
  },
  {
    // Unknown subdomains 302 to a marketing page rather than 404ing.
    adapter: "bamboohr",
    url: (s) => `https://${s}.bamboohr.com/careers/list`,
    count: (b) => arrayLen(b, "result"),
  },
];

export async function probeSlugs(seed: CompanySeed): Promise<SourceDefinition[]> {
  const slugs = slugCandidates(seed.name);

  for (const probe of PROBES) {
    for (const slug of slugs) {
      try {
        const res = await request(probe.url(slug), { timeoutMs: 9000, retries: 0 });
        const body = await res.text();

        if (probe.count(body) <= 0) continue;
        const reported = probe.name?.(body);
        if (reported && !nameMatches(reported, seed.name)) continue;

        // A company runs one ATS, not seven -- first confirmed hit wins.
        return [
          {
            id: `${probe.adapter}-${slugId(seed.name)}`,
            label: seed.name,
            company: seed.name,
            kind: "ats",
            adapter: probe.adapter,
            handle: slug,
            region: regionOf(seed),
            enabled: true,
          },
        ];
      } catch {
        /* 404 = wrong slug, the expected outcome most of the time */
      }
    }
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* pass C - browser sniff                                                      */
/* -------------------------------------------------------------------------- */

async function browserSniff(
  seed: CompanySeed,
  browserInstance: import("playwright").Browser,
): Promise<{ sources: SourceDefinition[]; hasJsonLd: boolean; finalUrl: string }> {
  const page = await browserInstance.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  try {
    await page.goto(seed.careersUrl, { waitUntil: "domcontentloaded", timeout: 35_000 });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const finalUrl = page.url();
    const html = await page.content();
    // Anchor hrefs often hold the ATS link even when the visible markup does not.
    const hrefs = await page
      .$$eval("a[href]", (els) => els.map((e) => (e as HTMLAnchorElement).href))
      .catch(() => [] as string[]);

    const haystack = `${finalUrl}\n${hrefs.join("\n")}\n${html}`;
    return {
      sources: matchSignatures(haystack, seed),
      hasJsonLd: /"@type"\s*:\s*"JobPosting"/.test(html),
      finalUrl,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* orchestration                                                               */
/* -------------------------------------------------------------------------- */

/** Global employers must name a Saudi location; Saudi-HQ ones need not. */
function regionOf(seed: CompanySeed): "ksa" | "global" {
  return isGlobalEmployer(seed) ? "global" : "ksa";
}

function slugId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function variants(seed: CompanySeed): string[] {
  const out = [seed.careersUrl];
  try {
    const u = new URL(seed.careersUrl);
    for (const p of ["/careers", "/en/careers", "/jobs"]) {
      const c = `${u.origin}${p}`;
      if (!out.includes(c)) out.push(c);
    }
  } catch {
    /* malformed seed */
  }
  return out.slice(0, 3);
}

interface Discovery {
  company: string;
  sector: string;
  priority: number;
  resolvedBy: "markup" | "slug-probe" | "browser" | "jsonld" | "browser-fallback";
  found: SourceDefinition[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pIndex = args.indexOf("--p");
  const maxPriority = pIndex >= 0 ? Number(args[pIndex + 1]) : 3;
  const useBrowser = !args.includes("--no-browser");
  /*
   * Overrides you accepted in the Check URLs tab.
   *
   * The seed list in companies.ts stays the starting point and is never
   * rewritten - a button in a browser should not be editing source, and the
   * deployed app could not do it anyway. Instead the accepted URLs are layered
   * on here: an accepted "primary" replaces the employer's careers URL, and
   * accepted "alternate" entries join altUrls as extra boards to poll.
   *
   * A failure to read them is not fatal. Discovery still has to run when the
   * database is unreachable, and the seed list alone is a working answer.
   */
  const overrides = isConfigured()
    ? await acceptedUrlOverrides().catch((err) => {
        console.warn(`! could not read URL overrides: ${err instanceof Error ? err.message : err}`);
        return new Map<string, { primary?: string; alternates: string[] }>();
      })
    : new Map<string, { primary?: string; alternates: string[] }>();

  if (overrides.size > 0) {
    const primaries = [...overrides.values()].filter((o) => o.primary).length;
    const alts = [...overrides.values()].reduce((n, o) => n + o.alternates.length, 0);
    console.log(
      `Applying your accepted URLs: ${primaries} replacement(s), ${alts} additional board(s)\n`,
    );
  }

/**
 * The same page, however it was written.
 *
 * Used to stop two employers resolving to one board. "solutions by stc" and
 * "Saudi Telecom Solutions" shared a careers URL, so the collector polled that
 * site twice and every posting appeared under two employer names.
 */
function careersUrlKey(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return raw.toLowerCase();
  }
}

  const targets = COMPANIES.filter((c) => c.priority <= maxPriority).map((c) => {
    const o = overrides.get(c.name);
    if (!o) return c;
    return {
      ...c,
      careersUrl: o.primary ?? c.careersUrl,
      altUrls: [
        ...new Set([
          ...(c.altUrls ?? []),
          ...o.alternates,
          // A replaced primary is worth keeping as a secondary rather than
          // discarding: the old page sometimes still carries listings the new
          // one does not, and dropping it silently loses them.
          ...(o.primary && o.primary !== c.careersUrl ? [c.careersUrl] : []),
        ]),
      ],
    };
  });

  /*
   * One source per careers page.
   *
   * Thirty-eight groups of employers shared a URL - Fortinet and "Fortinet
   * Saudi", Cloudflare and "Cloudflare Saudi", the three Tadawul subsidiaries
   * on one group site. Each pair meant the same page polled twice and the same
   * postings listed under two employer names.
   *
   * The first name wins, and the rest are reported rather than silently
   * dropped: which of two names is the right one is a judgement call.
   */
  const claimed = new Map<string, string>();
  const skipped: Array<[string, string]> = [];
  const deduped = targets.filter((c) => {
    const key = careersUrlKey(c.careersUrl);
    const owner = claimed.get(key);
    if (owner) {
      skipped.push([c.name, owner]);
      return false;
    }
    claimed.set(key, c.name);
    return true;
  });

  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} employer(s) that share a careers page:`);
    for (const [dupe, owner] of skipped.slice(0, 12)) {
      console.log(`  ${dupe.slice(0, 34).padEnd(34)} -> already covered by ${owner}`);
    }
    console.log("");
  }

  const results = new Map<string, Discovery>();
  const pageCache = new Map<string, { html: string; url: string }>();

  /* ---- pass A ---- */
  console.log(`Pass A - markup sniff across ${deduped.length} employers\n`);
  await mapLimit(deduped, 8, async (seed) => {
    let html = "";
    let usedUrl = "";
    for (const url of variants(seed)) {
      try {
        html = await getText(url, { timeoutMs: 18_000, retries: 1 });
        usedUrl = url;
        if (html.length > 500) break;
      } catch {
        /* try the next variant */
      }
    }
    if (html) pageCache.set(seed.name, { html, url: usedUrl });

    const found = html ? matchSignatures(html, seed) : [];
    if (found.length > 0) {
      results.set(seed.name, {
        company: seed.name,
        sector: seed.sector,
        priority: seed.priority,
        resolvedBy: "markup",
        found,
      });
    }
  });
  console.log(`  resolved: ${results.size}\n`);

  /* ---- pass B ---- */
  const remainingB = deduped.filter((c) => !results.has(c.name));
  console.log(`Pass B - verified slug probe on ${remainingB.length} employers`);
  let bHits = 0;
  await mapLimit(remainingB, 10, async (seed) => {
    const found = await probeSlugs(seed).catch(() => []);
    if (found.length > 0) {
      bHits++;
      console.log(`  + ${seed.name} -> ${found[0].adapter}:${found[0].handle}`);
      results.set(seed.name, {
        company: seed.name,
        sector: seed.sector,
        priority: seed.priority,
        resolvedBy: "slug-probe",
        found,
      });
    }
  });
  console.log(`  resolved: ${bHits}\n`);

  /* ---- pass C ---- */
  const remainingC = deduped.filter((c) => !results.has(c.name));
  if (useBrowser && remainingC.length > 0) {
    console.log(`Pass C - browser sniff on ${remainingC.length} employers`);
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ headless: true });
    let cHits = 0;
    let done = 0;
    try {
      await mapLimit(remainingC, 4, async (seed) => {
        try {
          const { sources, hasJsonLd, finalUrl } = await browserSniff(seed, b);
          done++;
          if (sources.length > 0) {
            cHits++;
            console.log(`  + [${done}/${remainingC.length}] ${seed.name} -> ${sources[0].adapter}:${sources[0].handle}`);
            results.set(seed.name, {
              company: seed.name,
              sector: seed.sector,
              priority: seed.priority,
              resolvedBy: "browser",
              found: sources,
            });
          } else if (hasJsonLd) {
            results.set(seed.name, {
              company: seed.name,
              sector: seed.sector,
              priority: seed.priority,
              resolvedBy: "jsonld",
              found: [
                {
                  id: `jsonld-${slugId(seed.name)}`,
                  label: seed.name,
                  company: seed.name,
                  kind: "career-page",
                  adapter: "jsonld",
                  handle: finalUrl,
                  region: regionOf(seed),
                  enabled: true,
                },
              ],
            });
          }
        } catch {
          done++;
        }
      });
    } finally {
      await b.close();
    }
    console.log(`  resolved: ${cHits} via ATS\n`);
  }

  /* ---- fallback for everything still unresolved ---- */
  for (const seed of deduped) {
    if (results.has(seed.name)) continue;
    const cached = pageCache.get(seed.name);
    const hasJsonLd = cached ? /"@type"\s*:\s*"JobPosting"/.test(cached.html) : false;
    results.set(seed.name, {
      company: seed.name,
      sector: seed.sector,
      priority: seed.priority,
      resolvedBy: hasJsonLd ? "jsonld" : "browser-fallback",
      found: [
        {
          id: `${hasJsonLd ? "jsonld" : "browser"}-${slugId(seed.name)}`,
          label: seed.name,
          company: seed.name,
          kind: "career-page",
          adapter: hasJsonLd ? "jsonld" : "browser",
          handle: cached?.url ?? seed.careersUrl,
          region: regionOf(seed),
          needsBrowser: !hasJsonLd,
          // Browser-only sources are expensive; keep them on for the employers
          // most likely to be hiring in Riyadh.
          enabled: hasJsonLd || seed.priority <= 2,
        },
      ],
    });
  }

  /* ---- secondary boards ---- */
  /*
   * An employer can run more than one board - a graduate scheme beside the
   * corporate site, or a separate internships portal. Each altUrl becomes its
   * own browser source so those vacancies are polled too, rather than the first
   * board found standing in for all of them.
   */
  let altCount = 0;
  for (const seed of deduped) {
    for (const [i, url] of (seed.altUrls ?? []).entries()) {
      const entry = results.get(seed.name);
      if (!entry) continue;
      if (entry.found.some((f) => f.handle === url)) continue;
      entry.found.push({
        id: `alt${i + 1}-${slugId(seed.name)}`,
        label: `${seed.name} (board ${i + 2})`,
        company: seed.name,
        kind: "career-page",
        adapter: "browser",
        handle: url,
        region: regionOf(seed),
        needsBrowser: true,
        enabled: true,
      });
      altCount++;
    }
  }
  if (altCount > 0) console.log(`added ${altCount} secondary board(s) from altUrls
`);

  /* ---- write ---- */
  if (!existsSync("data")) mkdirSync("data", { recursive: true });
  const all = [...results.values()];
  const sources = all.flatMap((r) => r.found);

  writeFileSync(
    "data/discovered.json",
    JSON.stringify(
      { generatedAt: new Date().toISOString(), companies: all.length, sources },
      null,
      2,
    ),
  );

  const byAdapter: Record<string, number> = {};
  const byPass: Record<string, number> = {};
  for (const s of sources) byAdapter[s.adapter] = (byAdapter[s.adapter] ?? 0) + 1;
  for (const r of all) byPass[r.resolvedBy] = (byPass[r.resolvedBy] ?? 0) + 1;

  console.log("--- discovery summary ---");
  console.log(`employers probed : ${all.length}`);
  console.log(`sources written  : ${sources.length}  (${sources.filter((s) => s.kind === "ats").length} on a real ATS)`);
  console.log("\nby resolution pass:");
  for (const [k, v] of Object.entries(byPass).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${v}`);
  }
  console.log("\nby adapter:");
  for (const [k, v] of Object.entries(byAdapter).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${v}`);
  }
  console.log("\nwrote data/discovered.json");
}

// Guarded so other scripts can import slugCandidates without triggering a run.
const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith("discover-ats.ts");
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
