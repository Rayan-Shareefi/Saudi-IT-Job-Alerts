import { reserve } from "../budget";
import { fetchAllRows, supabaseAdmin } from "../db";
import { envInt, envStr } from "../env";
import { htmlToText } from "../http";
import { platformName } from "../platform";
import { relativeToIso } from "../relative-date";
import { safeLink } from "../safe-link";
import { COMPANIES } from "../sources/companies";
import type { RawJob, SourceDefinition } from "../types";
import { jsearchIdFor, MissingCredential, QuotaExceeded } from "./aggregators";

/**
 * Google Jobs through SerpApi (free plan: 250 searches a month, no card),
 * pointed at the employers whose own careers site cannot be read - blocked,
 * moved, or a list the browser reader cannot see. "Tahakom jobs" on Google
 * Jobs often finds their postings with the real apply link, where their site
 * shows nothing to a program (2026-11-04).
 *
 * Metered like JSearch (kind "jsearch"): it runs with JSearch twice a week
 * and from the "include JSearch" button, never in the frequent passes, and
 * every search goes through budget.ts first (BUDGET_SERPAPI_MONTH, 230).
 * Each run searches the SERPAPI_PER_RUN employers searched longest ago, so
 * the allowance goes round all of them.
 *
 * The key travels in the address, as SerpApi requires, so no error message
 * here ever includes the address.
 */

interface GoogleJob {
  title?: string;
  company_name?: string;
  location?: string;
  via?: string;
  description?: string;
  share_link?: string;
  job_id?: string;
  detected_extensions?: { posted_at?: string; schedule_type?: string };
  apply_options?: Array<{ title?: string; link?: string }>;
}

/** Sites that carry other employers' jobs: an apply link on one is not the employer's own. */
const BOARD_HOST = /linkedin\.|indeed\.|bayt\.|glassdoor\.|jooble|careerjet|naukrigulf|gulftalent|tanqeeb|wuzzuf|ziprecruiter|monster\.|talent\.com|jobrapido|jobleads|bebee|whatjobs|jora\.|google\./i;

/** The employer's own apply link if Google lists one, else the first, else Google's page. */
export function bestApplyLink(job: GoogleJob): string | null {
  const options = (job.apply_options ?? []).map((o) => safeLink(o.link)).filter((l): l is string => Boolean(l));
  const own = options.find((l) => {
    try {
      return !BOARD_HOST.test(new URL(l).hostname);
    } catch {
      return false;
    }
  });
  return own ?? options[0] ?? safeLink(job.share_link) ?? null;
}

/** One Google Jobs result as a posting. Exported for scripts/test-serpapi.ts. */
export function toRawJob(job: GoogleJob, source: SourceDefinition): RawJob | null {
  const title = htmlToText(job.title ?? "").trim();
  const company = (job.company_name ?? "").trim() || "Unknown";
  if (!title) return null;
  const apply = bestApplyLink(job);
  const url = apply ?? safeLink(job.share_link);
  if (!url) return null;
  const location = (job.location ?? "").trim();
  return {
    sourceId: source.id,
    externalId: jsearchIdFor(apply ?? "", company, title, location),
    title,
    company,
    locationText: location,
    descriptionText: (job.description ?? "").slice(0, 16000),
    url,
    applyUrl: apply,
    postedAt: relativeToIso(job.detected_extensions?.posted_at ?? null),
    employmentType: job.detected_extensions?.schedule_type ?? null,
    // The site Google found it on ("via LinkedIn"), as the board's platform badge.
    publisher: job.via ? platformName(job.via.replace(/^via\s+/i, "")) : "Google Jobs",
    listedOn: [...new Set((job.apply_options ?? []).map((o) => (o.title ? platformName(o.title) : "")).filter(Boolean))],
  };
}

/**
 * Who to search this run: employers with no readable site of their own,
 * searched longest ago first. Falls back to the big-name employers when the
 * site reports are empty.
 */
async function targets(count: number): Promise<string[]> {
  const db = supabaseAdmin();
  const unreadable = new Set<string>();
  try {
    const reports = await fetchAllRows<{ company: string; verdict: string }>(
      (from, to) => db.from("source_reports").select("company,verdict").range(from, to),
      "site report",
    );
    for (const r of reports) if (r.verdict !== "email-only" && r.verdict !== "login-required") unreadable.add(r.company);
  } catch {
    /* no report yet */
  }
  if (unreadable.size === 0) for (const c of COMPANIES.filter((c) => c.priority === 1)) unreadable.add(c.name);
  const { data } = await db.from("serpapi_targets").select("company,last_searched_at");
  const last = new Map((data ?? []).map((r) => [String(r.company), r.last_searched_at ? Date.parse(String(r.last_searched_at)) : 0]));
  return [...unreadable].sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0)).slice(0, count);
}

/** One Google Jobs search. Exported for scripts/test-serpapi.ts (against a local mock). */
export async function searchGoogleJobs(key: string, query: string): Promise<GoogleJob[]> {
  const base = envStr("SERPAPI_BASE_URL") ?? "https://serpapi.com";
  const params = new URLSearchParams({ engine: "google_jobs", q: query, location: "Riyadh, Riyadh Province, Saudi Arabia", hl: "en", gl: "sa", api_key: key });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${base}/search.json?${params}`, { signal: ctrl.signal });
    const body = (await res.json().catch(() => ({}))) as { jobs_results?: GoogleJob[]; error?: string };
    // "Google hasn't returned any results for this query." is an answer, not a fault.
    if (body.error && /hasn't returned any results|no results/i.test(body.error)) return [];
    if (res.status === 401 || /invalid api key/i.test(body.error ?? "")) throw new MissingCredential("a valid SERPAPI_KEY");
    if (res.status === 429 || /run out of searches|plan.*limit/i.test(body.error ?? "")) throw new QuotaExceeded("SerpApi");
    if (!res.ok || body.error) throw new Error(`SerpApi refused the search (HTTP ${res.status}${body.error ? `: ${body.error.slice(0, 80)}` : ""})`);
    return body.jobs_results ?? [];
  } finally {
    clearTimeout(timer);
  }
}

export const serpapi = async (source: SourceDefinition): Promise<RawJob[]> => {
  const key = envStr("SERPAPI_KEY");
  if (!key) throw new MissingCredential("SERPAPI_KEY");
  const mock = Boolean(envStr("SERPAPI_BASE_URL"));
  const companies = await targets(envInt("SERPAPI_PER_RUN", 25));
  const db = supabaseAdmin();
  const out = new Map<string, RawJob>();
  let searched = 0;
  for (const company of companies) {
    // The local mock costs nothing; everything else goes through the budget.
    if (!mock && !(await reserve("serpapi"))) break;
    let found: GoogleJob[] = [];
    try {
      found = await searchGoogleJobs(key, `${company} jobs`);
      searched++;
    } catch (err) {
      if (err instanceof QuotaExceeded || err instanceof MissingCredential) {
        if (out.size > 0) break;
        throw err;
      }
      continue; // one bad search does not end the run
    }
    for (const g of found) {
      const job = toRawJob(g, source);
      if (job && !out.has(job.externalId)) out.set(job.externalId, job);
    }
    await db
      .from("serpapi_targets")
      .upsert({ company, last_searched_at: new Date().toISOString(), last_found: found.length }, { onConflict: "company" })
      .then(() => {}, () => {});
  }
  if (searched === 0 && companies.length > 0) throw new QuotaExceeded("SerpApi (this app's monthly budget, BUDGET_SERPAPI_MONTH)");
  return [...out.values()];
};
