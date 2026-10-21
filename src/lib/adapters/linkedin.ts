import * as cheerio from "cheerio";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { reserve } from "../budget";
import { fetchAllRows, supabaseAdmin } from "../db";
import { envFlag, envInt } from "../env";
import { seniorityOf } from "../experience";
import { htmlToText, sleep, toIso } from "../http";
import type { RawJob, SourceDefinition } from "../types";
import { MissingCredential } from "./aggregators";

/**
 * LinkedIn job listings, through the public pages LinkedIn serves to visitors
 * who are not signed in. No account, no login, no cookies.
 *
 * Added 2026-10-13 at the user's request, with the risk stated: LinkedIn's
 * terms discourage automated access. So this is deliberately gentle and never
 * tries to get around a refusal:
 *
 *   - a few searches per run, a short pause with jitter between requests, a
 *     daily request cap shared across machines (budget.ts);
 *   - the full posting is fetched only for listings not already read;
 *   - any sign of refusal - HTTP 429 or 999, a redirect to a login or
 *     "authwall" page, or pages missing their usual markers - stops the whole
 *     source for this run. It is reported, not retried.
 *
 * Runs on the laptop (LINKEDIN_ENABLED=1): LinkedIn answers datacenter
 * addresses such as GitHub's with refusals far more often than a home line.
 */

// Cybersecurity, cloud and cloud security only (DevOps dropped by the owner on
// 2026-10-21). A pass reads a few of these in turn, so the longer list costs
// nothing per pass; each term just comes round less often.
const SEARCHES = [
  "cybersecurity",
  "information security",
  "SOC analyst",
  "GRC cybersecurity",
  "penetration testing",
  "security engineer",
  "cloud engineer",
  "cloud security",
  "cybersecurity internship",
  "cooperative training",
  "أمن سيبراني",
  "cloud security engineer",
  "security analyst",
  "identity and access management",
  "incident response",
  "vulnerability management",
  "threat intelligence",
  "application security",
  "cloud architect",
  "AWS",
  "Azure",
  "cybersecurity graduate",
  "security trainee",
];

const LOCATION = "Riyadh, Riyadh, Saudi Arabia";
const BASE = "https://www.linkedin.com/jobs-guest/jobs/api";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  accept: "text/html,application/xhtml+xml",
};

/**
 * LinkedIn said stop. Not a fault: the run stops as asked, ingest records it
 * as a skip (the stored listings stay), and the laptop worker waits longer
 * before each next try (local-worker.ts).
 */
export class LinkedInRefused extends Error {
  /**
   * `ours`: our own daily allowance ran out (budget.ts), not a refusal from
   * LinkedIn - so no pause follows; the next pass after midnight UTC reads on.
   */
  constructor(why: string, ours = false) {
    super(ours ? `${why} - nothing more is asked of LinkedIn today (not a refusal)` : `LinkedIn asked us to slow down (${why}) - stopped as asked; the laptop tries again later`);
    this.name = "LinkedInRefused";
  }
}

/* ------------------------------- parsing ---------------------------------- */

export interface LinkedInCard {
  id: string;
  title: string;
  company: string;
  location: string;
  postedAt: string | null;
  companySlug?: string | null;
}

/** The cards on one search-results page. Exported for scripts/test-linkedin.ts. */
export function parseSearch(html: string): LinkedInCard[] {
  const $ = cheerio.load(html);
  const out: LinkedInCard[] = [];
  $("li").each((_, li) => {
    const el = $(li);
    const urn = el.find("[data-entity-urn]").attr("data-entity-urn") ?? "";
    const id = urn.match(/jobPosting:(\d+)/)?.[1];
    const title = el.find(".base-search-card__title").text().replace(/\s+/g, " ").trim();
    if (!id || !title) return;
    out.push({
      id,
      title,
      company: el.find(".base-search-card__subtitle").text().replace(/\s+/g, " ").trim() || "Unknown",
      location: el.find(".job-search-card__location").text().replace(/\s+/g, " ").trim(),
      postedAt: toIso(el.find("time").attr("datetime") ?? null),
      // The company's page, so its posts and jobs can be read too (linkedin-companies.ts).
      companySlug: (el.find(".base-search-card__subtitle a").attr("href") ?? "").match(/\/company\/([^/?#]+)/)?.[1] ?? null,
    });
  });
  return out;
}

export interface LinkedInDetail {
  description: string;
  criteria: Record<string, string>;
  applyUrl: string | null;
  closed: boolean;
}

/** One posting's page. Exported for scripts/test-linkedin.ts. */
export function parseDetail(html: string): LinkedInDetail | null {
  const $ = cheerio.load(html);
  const markup = $(".show-more-less-html__markup").first();
  if (markup.length === 0) return null;
  const criteria: Record<string, string> = {};
  $(".description__job-criteria-item").each((_, item) => {
    const k = $(item).find(".description__job-criteria-subheader").text().trim();
    const v = $(item).find(".description__job-criteria-text").text().replace(/\s+/g, " ").trim();
    if (k && v) criteria[k] = v;
  });
  // An "Apply on company website" posting carries its target in a comment.
  const code = $("code#applyUrl").html() ?? "";
  const apply = code.match(/<!--\s*"?([^"]+?)"?\s*-->/)?.[1] ?? null;
  return {
    description: htmlToText(markup.html() ?? ""),
    criteria,
    applyUrl: apply ? decodeURIComponent(apply.replace(/&amp;/g, "&")) : null,
    closed: /no longer accepting applications/i.test(html),
  };
}

/**
 * A batch cut short, with why: ingest.ts saves the postings and reports the
 * run as partial (the note becomes the source's status line).
 */
export function withNote(jobs: RawJob[], note: string): RawJob[] {
  return Object.assign(jobs, { note });
}

/* ------------------------------- fetching --------------------------------- */

let lastRequest = 0;
export async function gentleGet(url: string): Promise<string> {
  // ~10 s between requests, as a person paging through listings would.
  const gap = envInt("LINKEDIN_DELAY_MS", 8000) + Math.floor(Math.random() * 4000);
  const wait = lastRequest + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  if (!(await reserve("linkedin"))) throw new LinkedInRefused("this app's daily LinkedIn allowance is used up", true);
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (res.status === 429 || res.status === 999) throw new LinkedInRefused(`HTTP ${res.status}`);
  if (/authwall|\/login|checkpoint|uas\/login/i.test(res.url)) throw new LinkedInRefused("redirected to a login page");
  if (!res.ok) throw new Error(`LinkedIn HTTP ${res.status}`);
  return res.text();
}

const PAGE_SIZE = 10;

/**
 * Which listings to open first, since a pass opens at most 25. Co-op,
 * internship and junior titles first, senior titles last: a senior title goes
 * to the 5+ tab on its title alone (state.ts), so its text changes nothing.
 * Newest first within each group.
 */
export function byUsefulness(cards: LinkedInCard[]): LinkedInCard[] {
  const rank = (c: LinkedInCard) => (PROGRAMME_TITLE.test(c.title) ? 0 : seniorityOf(c.title) === "senior" ? 2 : 1);
  return [...cards].sort((a, b) => rank(a) - rank(b) || String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? "")));
}
const PROGRAMME_TITLE = /\b(intern\w*|co-?op|cooperative|trainee\w*|graduate|apprentice\w*|tamheer)\b|تدريب|تمهير|خريج/i;

/**
 * Where the search rotation stands, kept on the laptop between passes so each
 * pass reads the next searches whatever the time between them.
 */
const CURSOR_FILE = join(process.cwd(), "logs", "linkedin-cursor.json");
function readCursor(): number {
  try {
    const n = Number(JSON.parse(readFileSync(CURSOR_FILE, "utf8")).next);
    if (Number.isInteger(n) && n >= 0) return n % SEARCHES.length;
  } catch {
    /* first pass, or not the laptop */
  }
  return Math.floor(Date.now() / 7_200_000) % SEARCHES.length;
}
function writeCursor(next: number): void {
  try {
    mkdirSync(dirname(CURSOR_FILE), { recursive: true });
    writeFileSync(CURSOR_FILE, JSON.stringify({ next, at: new Date().toISOString() }));
  } catch {
    /* read-only checkout: the time-based start still rotates */
  }
}

interface Stored {
  /** Full or partial texts already read, so they are not fetched again. */
  texts: Map<string, string>;
  /** Listings found before whose posting was never opened, newest first. */
  unread: LinkedInCard[];
  /** Listings already matched to the same vacancy on another source: opening them adds nothing. */
  settled: Set<string>;
}

async function stored(sourceId: string): Promise<Stored> {
  const none: Stored = { texts: new Map(), unread: [], settled: new Set() };
  try {
    const rows = await fetchAllRows<Record<string, unknown>>(
      (from, to) =>
        supabaseAdmin()
          .from("jobs")
          .select("external_id,title,company,location_text,posted_at,description_text,text_quality,duplicate_of,is_active")
          .eq("source_id", sourceId)
          .range(from, to),
      "stored LinkedIn listings",
    );
    const out: Stored = { texts: new Map(), unread: [], settled: new Set() };
    for (const r of rows) {
      const ext = String(r.external_id);
      const quality = String(r.text_quality ?? "none");
      if (quality === "full" || quality === "partial") out.texts.set(ext, String(r.description_text ?? ""));
      else if (r.duplicate_of) out.settled.add(ext);
      else if (r.is_active && ext.startsWith("li:")) {
        out.unread.push({
          id: ext.slice(3),
          title: String(r.title),
          company: String(r.company),
          location: String(r.location_text ?? ""),
          postedAt: (r.posted_at as string) ?? null,
        });
      }
    }
    out.unread.sort((a, b) => String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? "")));
    return out;
  } catch {
    return none;
  }
}

export const linkedin = async (source: SourceDefinition): Promise<RawJob[]> => {
  if (!envFlag("LINKEDIN_ENABLED")) {
    throw new MissingCredential("LINKEDIN_ENABLED=1 (LinkedIn is read from the laptop only)");
  }
  const maxDetail = envInt("LINKEDIN_MAX_DETAIL", 25);
  const pages = envInt("LINKEDIN_PAGES", 3);
  const perRun = Math.min(SEARCHES.length, envInt("LINKEDIN_SEARCHES_PER_RUN", 5));
  const { texts: known, unread, settled } = await stored(source.id);

  /*
   * A refusal stops the asking, never the keeping. The first version threw
   * on the first 429 and lost everything already read: the laptop made ~150
   * LinkedIn requests a day for four days (2026-10-17..20) and stored none.
   * Now what was read is returned, the rest is read on a later pass, and the
   * refusal is reported on the result so the worker waits before asking again.
   */
  let refusal: LinkedInRefused | null = null;
  const ask = async (url: string): Promise<string | null> => {
    if (refusal) return null;
    try {
      return await gentleGet(url);
    } catch (err) {
      if (err instanceof LinkedInRefused) {
        refusal = err;
        return null;
      }
      throw err;
    }
  };

  // A few searches per pass, carrying on where the last pass stopped: fewer
  // requests at a time is what keeps LinkedIn answering.
  const from = readCursor();
  const queries = Array.from({ length: perRun }, (_, i) => SEARCHES[(from + i) % SEARCHES.length]);
  writeCursor((from + perRun) % SEARCHES.length);

  const cards = new Map<string, LinkedInCard>();
  let emptyPages = 0;
  const search = async (q: string, page: number): Promise<number> => {
    // A results page holds 10 cards (scripts/fixtures/linkedin-search.html).
    // Stepping by 25 skipped 15 listings on every page after the first.
    const url =
      `${BASE}/seeMoreJobPostings/search?keywords=${encodeURIComponent(q)}` +
      `&location=${encodeURIComponent(LOCATION)}&f_TPR=r2592000&start=${page * PAGE_SIZE}`;
    const html = await ask(url);
    if (html === null) return 0;
    const found = parseSearch(html);
    if (found.length === 0) {
      // Empty pages on searches that normally return results is what a soft
      // block looks like; stop rather than keep asking.
      if (++emptyPages >= 4) refusal = new LinkedInRefused("several result pages came back empty");
      return 0;
    }
    emptyPages = 0;
    for (const c of found) cards.set(c.id, c);
    return found.length;
  };

  const out = new Map<string, RawJob>();
  let opened = 0;
  /** Open a listing's posting (within the pass's allowance) and keep it. */
  const keep = async (c: LinkedInCard): Promise<void> => {
    const externalId = `li:${c.id}`;
    if (out.has(externalId)) return;
    let text = known.get(externalId) ?? "";
    let applyUrl: string | null = null;
    let employmentType: string | null = null;
    if (!text && !settled.has(externalId) && opened < maxDetail && !refusal) {
      opened++;
      const html = await ask(`${BASE}/jobPosting/${c.id}`);
      const detail = html === null ? null : parseDetail(html);
      if (detail?.closed) return;
      if (detail) {
        // LinkedIn's own fields are appended as labelled lines, so the
        // experience reader can see "Employment type: Internship".
        const meta = Object.entries(detail.criteria).map(([k, v]) => `${k}: ${v}.`).join(" ");
        text = `${detail.description}\n\n${meta}`.trim();
        applyUrl = detail.applyUrl;
        employmentType = detail.criteria["Employment type"] ?? null;
      }
    }
    out.set(externalId, {
      sourceId: source.id,
      externalId,
      title: c.title,
      company: c.company.replace(/\s*\|.*$/, "").trim() || "Unknown",
      locationText: c.location,
      descriptionText: text,
      url: `https://www.linkedin.com/jobs/view/${c.id}/`,
      applyUrl,
      postedAt: c.postedAt,
      employmentType,
      publisher: "LinkedIn",
    });
  };

  /*
   * The order of a pass, because LinkedIn may stop it after a handful of
   * requests: one fresh search page; then the postings found before but never
   * opened (a listing without its text cannot be judged and waits in
   * Unclassified); then the remaining searches; then the new listings' postings.
   */
  if (queries.length) await search(queries[0], 0);
  for (const c of byUsefulness(unread)) {
    if (refusal || opened >= maxDetail) break;
    await keep(c);
  }
  for (const [i, q] of queries.entries()) {
    for (let page = i === 0 ? 1 : 0; page < pages && !refusal; page++) {
      if ((await search(q, page)) < PAGE_SIZE) break;
    }
  }

  // Two known companies' own jobs a pass, by the id their page gave
  // (linkedin-companies.ts), across Saudi Arabia - the employers' whole
  // LinkedIn boards, not only what the keywords happened to match.
  try {
    const { data: companies } = await supabaseAdmin()
      .from("linkedin_companies")
      .select("slug,org_id")
      .not("org_id", "is", null)
      .neq("status", "dead")
      .order("last_jobs_at", { ascending: true, nullsFirst: true })
      .limit(envInt("LINKEDIN_COMPANY_SEARCHES", 2));
    for (const c of companies ?? []) {
      if (refusal) break;
      const html = await ask(`${BASE}/seeMoreJobPostings/search?f_C=${encodeURIComponent(String(c.org_id))}&location=${encodeURIComponent("Saudi Arabia")}&f_TPR=r2592000&start=0`);
      if (html === null) break;
      for (const card of parseSearch(html)) cards.set(card.id, card);
      await supabaseAdmin().from("linkedin_companies").update({ last_jobs_at: new Date().toISOString() }).eq("slug", c.slug);
    }
  } catch {
    /* no company list yet */
  }

  // Every company named on a card joins the list of pages to read.
  const slugs = new Map<string, string>();
  for (const c of cards.values()) if (c.companySlug) slugs.set(c.companySlug, c.company);
  for (const [slug, name] of slugs) {
    await supabaseAdmin()
      .rpc("linkedin_company_seen", { p_slug: slug, p_name: name, p_via: "LinkedIn job card" })
      .then(() => {}, () => {});
  }

  for (const c of byUsefulness([...cards.values()])) await keep(c);

  const jobs = [...out.values()];
  const stopped = refusal as LinkedInRefused | null;
  if (stopped) {
    // Nothing read at all: a plain refusal (a skip, see ingest.ts).
    if (jobs.length === 0) throw stopped;
    return withNote(jobs, `partial: ${stopped.message} - kept the ${jobs.length} listing(s) read before that`);
  }
  return jobs;
};
