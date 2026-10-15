/**
 * Multi-employer APIs. These are how postings from LinkedIn, Indeed, Bayt,
 * GulfTalent and Naukrigulf reach the app: those sites forbid scraping in their
 * terms, but they syndicate into aggregators that publish documented APIs.
 *
 * Deliberately excluded: Adzuna (no Saudi Arabia coverage), Arbeitnow and
 * Remotive (EU / remote-only), all of which would be dead weight here.
 *
 * All three below are free-tier and all are optional -- a missing key skips the
 * source rather than failing the run.
 */
import { reserve } from "../budget";
import { companyKey, shortHash, titleKey } from "../company-key";
import { envStr } from "../env";
import { normalize } from "../text";
import { getJson, htmlToText, toIso } from "../http";
import type { RawJob, SourceDefinition } from "../types";
import type { Adapter } from "./ats";

/**
 * Search terms fanned out across the aggregators: cybersecurity and cloud only.
 *
 * The board was narrowed on 2026-10-13 from "all IT" to security + cloud (and
 * DevOps/SRE/network roles only where the duties are cloud or security). The
 * old list asked for data analysts, help desk and software engineers, which
 * the relevance stage then had to throw away - quota and noise for nothing.
 * Terms name the work, not the word "cybersecurity": SOC and GRC postings
 * often never say it.
 */
export const QUERY_TERMS = [
  "cybersecurity",
  "cyber security",
  "information security",
  "SOC analyst",
  "security operations center",
  "GRC cybersecurity",
  "penetration tester",
  "security engineer",
  "identity and access management",
  "application security",
  "threat intelligence",
  "incident response",
  "vulnerability management",
  "network security",
  "OT security",
  "أمن سيبراني",
  "الأمن السيبراني",
  "أمن المعلومات",
  "cloud engineer",
  "cloud architect",
  "cloud security",
  "AWS",
  "Azure",
  "Google Cloud",
  "DevOps engineer",
  "DevSecOps",
  "site reliability engineer",
  "platform engineer",
  "Kubernetes",
  "الحوسبة السحابية",
] as const;

/**
 * Student-intake searches. Saudi employers advertise these under distinct
 * names - the cooperative training semester (التدريب التعاوني) is a separate
 * intake from a summer internship - so searching for "internship" alone misses
 * most of them.
 */
export const STUDENT_TERMS = [
  "cooperative training",
  "co-op training",
  "تدريب تعاوني",
  "internship",
  "summer internship",
  "تدريب صيفي",
  "trainee program",
  "graduate program",
  "fresh graduate",
  "cybersecurity internship",
  "cloud internship",
  "security co-op",
  "تدريب أمن سيبراني",
] as const;

/**
 * Throw when every request a source made failed.
 *
 * Jooble and Careerjet swallow per-term errors so one bad keyword cannot sink
 * the run - but when *every* term fails (key revoked, endpoint retired,
 * Referer refused) they returned [] as a success, and deactivateMissing then
 * retired every stored row for the source. Careerjet alone held 848 rows.
 */
function failIfNothingWorked(source: string, attempts: number, errors: string[]): void {
  if (attempts > 0 && errors.length === attempts) {
    throw new Error(`${source}: all ${attempts} requests failed - first error: ${errors[0]}`);
  }
}

export class MissingCredential extends Error {
  constructor(name: string) {
    super(`missing ${name}`);
    this.name = "MissingCredential";
  }
}

/* ----------------------------------- Jooble ------------------------------ */

interface JoobleJob {
  id?: number | string;
  title: string;
  location?: string;
  snippet?: string;
  link: string;
  company?: string;
  updated?: string;
  type?: string;
}

/**
 * A location string Jooble will actually resolve.
 *
 * Verified against the live API: "Riyadh" returns totalCount 0 for every
 * keyword, "Riyadh, Saudi Arabia" returns results, and "Saudi Arabia" returns
 * fewer. The country is not optional.
 */
function joobleLocation(handle: string): string {
  const base = (handle || "Riyadh").trim();
  return /saudi|ksa/i.test(base) ? base : `${base}, Saudi Arabia`;
}
export const jooble: Adapter = async (source) => {
  const key = process.env.JOOBLE_API_KEY;
  if (!key) throw new MissingCredential("JOOBLE_API_KEY");

  const out: RawJob[] = [];
  const seen = new Set<string>();

  const terms = [...QUERY_TERMS, ...STUDENT_TERMS];
  const errors: string[] = [];
  for (const keywords of terms) {
    try {
      const data = await getJson<{ jobs?: JoobleJob[] }>(`https://jooble.org/api/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /*
         * The country has to be in the location string.
         *
         * Jooble resolves "Riyadh, Saudi Arabia" and returns results; bare
         * "Riyadh" resolves to nothing and answers 200 with totalCount 0, for
         * every keyword. The tab looked like a missing key or a spent quota
         * when the request was simply unanswerable.
         */
        body: JSON.stringify({
          keywords,
          location: joobleLocation(source.handle),
          page: "1",
        }),
        retries: 1,
      });
      for (const j of data.jobs ?? []) {
        // Same reasoning as Careerjet: key on the posting, never on a link.
        const id = contentId("jb", j.company || "Unknown", htmlToText(j.title), j.location ?? "");
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          sourceId: source.id,
          externalId: id,
          title: htmlToText(j.title),
          company: j.company || "Unknown",
          locationText: j.location ?? "",
          descriptionText: htmlToText(j.snippet),
          url: j.link,
          postedAt: toIso(j.updated),
          employmentType: j.type ?? null,
        });
      }
    } catch (err) {
      /* one bad term should not sink the whole source */
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  failIfNothingWorked("Jooble", terms.length, errors);
  return out;
};

/* ----------------------------------- JSearch ----------------------------- */

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_description?: string;
  job_apply_link?: string;
  job_google_link?: string;
  job_posted_at_datetime_utc?: string;
  job_employment_type?: string;
  job_publisher?: string;
  job_required_experience?: { required_experience_in_months?: number | null };
}

/**
 * An ID that survives between calls.
 *
 * JSearch's own job_id changes its suffix from one request to the next, and
 * every changed id was a "new" posting: 230 roles were stored under more than
 * one id in a fortnight, each reappearing daily as new while yesterday's copy
 * was retired. A LinkedIn job number or the employer's own apply URL is
 * stable; failing both, the content is.
 */
/** A posting key from its content, for sources whose own ids are not stable. */
export function contentId(prefix: string, company: string, title: string, location: string): string {
  return `${prefix}:${shortHash(companyKey(company), titleKey(title), normalize(location))}`;
}

function stableJsearchId(j: JSearchJob, company: string, title: string): string {
  return jsearchIdFor(j.job_apply_link ?? "", company, title, j.job_city ?? "");
}

/** Exported for the one-off migration of rows stored under the old ids. */
export function jsearchIdFor(applyLink: string, company: string, title: string, city: string): string {
  const link = applyLink;
  const li = link.match(/linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/i);
  if (li) return `li:${li[1]}`;
  try {
    const u = new URL(link);
    if (!/google\.com$/i.test(u.hostname)) {
      for (const p of [...u.searchParams.keys()]) {
        if (/^(utm_|ref|src|source|trk|refid|gh_src|lever-source|jobboard)/i.test(p)) u.searchParams.delete(p);
      }
      return `url:${shortHash(`${u.hostname}${u.pathname}${u.search}`.toLowerCase())}`;
    }
  } catch {
    /* no usable link; fall through to the content key */
  }
  return contentId("js", company, title, city);
}

export class QuotaExceeded extends Error {
  constructor(api: string) {
    super(`${api} monthly quota exhausted`);
    this.name = "QuotaExceeded";
  }
}

/**
 * Broad sweeps, deliberately few.
 *
 * The free JSearch plan allows ~200 requests *per month* - about six a day. An
 * earlier version fanned out 34 keyword terms across two city sources, which is
 * 68 requests per run and burned the whole month's allowance in three runs.
 *
 * So this asks a small number of wide questions instead of many narrow ones.
 * JSearch is a full-text search over Google for Jobs, so "cybersecurity cloud
 * IT engineer" matches the union of those words rather than the intersection,
 * and one broad call returns roughly what ten narrow ones did.
 */
/**
 * How many pages of results to take per sweep.
 *
 * JSearch returns ten results a page and defaults to one page, which is why
 * the whole tab held 27 postings: five sweeps could never see more than
 * fifty results between them, however many boards JSearch itself reaches.
 * For a service that proxies LinkedIn, Indeed, Bayt and GulfTalent at once,
 * fifty is a sampling error rather than a search.
 *
 * It is deliberately a setting because it is also the meter: JSearch bills
 * one request PER PAGE, so this number multiplies the cost of a run. The
 * default of two pages over twelve sweeps is twenty-four requests. One page
 * returned 67 postings of a possible 120, so the sweeps overlap by about 44%
 * - a second page of the same query is guaranteed-new results, which makes it
 * a better buy per request than a thirteenth sweep would be.
 */
const JSEARCH_PAGES = (() => {
  const raw = Number(process.env.JSEARCH_PAGES);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  // The API rejects anything outside 1-20.
  return Math.min(20, Math.max(1, Math.trunc(raw)));
})();

/**
 * One plain phrase per sweep, not one boolean expression per sweep.
 *
 * JSearch proxies Google for Jobs, which reads a query the way a person types
 * it into a search box. The old sweeps asked for things like "information
 * technology OR software OR cybersecurity jobs in Riyadh, Saudi Arabia" - five
 * of those returned 27 unique postings between them, for a service that
 * reaches LinkedIn, Indeed, Bayt and GulfTalent at once. Raising the page
 * count changed nothing, which is what ruled the depth out as the cause: the
 * queries themselves were matching almost nothing.
 *
 * Short phrases, more of them. Overlap between sweeps costs nothing - results
 * are deduplicated by job_id - so breadth is the only thing being bought.
 */
export const JSEARCH_SWEEPS: Array<{ query: string; internOnly?: boolean }> = [
  // Security + cloud only since 2026-10-13. Six sweeps at one page is six
  // requests a run; the weekly schedule keeps a month under ~30 of ~200.
  { query: "cybersecurity in Riyadh" },
  { query: "SOC analyst in Riyadh" },
  { query: "information security GRC in Riyadh" },
  { query: "cloud engineer in Riyadh" },
  { query: "devops engineer in Riyadh" },
  { query: "cybersecurity internship in Riyadh", internOnly: true },
];

/**
 * JSearch proxies Google for Jobs, so a single call reaches LinkedIn, Indeed,
 * Bayt, GulfTalent and company career pages at once. The widest-coverage source
 * in the registry by a wide margin.
 *
 * Endpoint note: the documented path is `/search-v2`. The older `/search` was
 * retired and now 404s, which is silent breakage if the adapter swallows errors.
 */
/**
 * The two places a JSearch key can come from.
 *
 * JSearch is built by OpenWeb Ninja and sold both on the RapidAPI marketplace
 * and directly from openwebninja.com. Same endpoint path, same response shape -
 * and a completely different host and auth header:
 *
 *   rapidapi      https://jsearch.p.rapidapi.com    X-RapidAPI-Key + X-RapidAPI-Host
 *   openwebninja  https://api.openwebninja.com/jsearch   x-api-key
 *
 * A key from one sent to the other is simply rejected, so the platform travels
 * with the key rather than being assumed.
 */
export type JsearchProvider = "rapidapi" | "openwebninja";

interface JsearchKey {
  key: string;
  provider: JsearchProvider;
  /** Which variable it came from, so failures name something findable. */
  label: string;
}

export const PROVIDER_BASE: Record<JsearchProvider, string> = {
  rapidapi: "https://jsearch.p.rapidapi.com",
  openwebninja: "https://api.openwebninja.com/jsearch",
};

export function jsearchHeadersFor(
  provider: JsearchProvider,
  key: string,
): Record<string, string> {
  return providerHeaders({ key, provider, label: "test" });
}

function providerHeaders(k: JsearchKey): Record<string, string> {
  return k.provider === "openwebninja"
    ? { "x-api-key": k.key }
    : { "X-RapidAPI-Key": k.key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" };
}

/**
 * Every configured key, in preference order.
 *
 * Each is a separate account with its own monthly allowance, which is the whole
 * point: one free plan is ~200 requests a month, two is ~400. They can come
 * from different platforms - the rotation does not care, because each key
 * carries its own base URL and headers.
 *
 * `JSEARCH_RAPIDAPI_KEY*` is read as a RapidAPI key unless `JSEARCH_PROVIDER`
 * says otherwise, which keeps existing setups working. Naming a key by its
 * platform is clearer and is what the docs now recommend.
 */
function jsearchKeys(): JsearchKey[] {
  const out: JsearchKey[] = [];
  const add = (raw: string | undefined, provider: JsearchProvider, label: string) => {
    const key = raw?.trim();
    if (key) out.push({ key, provider, label });
  };

  // Platform-explicit variables come first: they are unambiguous.
  add(process.env.JSEARCH_OPENWEBNINJA_KEY, "openwebninja", "JSEARCH_OPENWEBNINJA_KEY");
  add(process.env.JSEARCH_OPENWEBNINJA_KEY_2, "openwebninja", "JSEARCH_OPENWEBNINJA_KEY_2");
  add(process.env.JSEARCH_OPENWEBNINJA_KEY_3, "openwebninja", "JSEARCH_OPENWEBNINJA_KEY_3");

  // The original names. RapidAPI unless told otherwise.
  const legacy: JsearchProvider =
    process.env.JSEARCH_PROVIDER?.trim().toLowerCase() === "openwebninja"
      ? "openwebninja"
      : "rapidapi";
  add(process.env.JSEARCH_RAPIDAPI_KEY, legacy, "JSEARCH_RAPIDAPI_KEY");
  add(process.env.JSEARCH_RAPIDAPI_KEY_2, legacy, "JSEARCH_RAPIDAPI_KEY_2");
  add(process.env.JSEARCH_RAPIDAPI_KEY_3, legacy, "JSEARCH_RAPIDAPI_KEY_3");

  return out;
}

/**
 * JSearch proxies Google for Jobs, so a single call reaches LinkedIn, Indeed,
 * Bayt, GulfTalent and company career pages at once. The widest-coverage source
 * in the registry by a wide margin.
 *
 * Key rotation: the run always *starts* on the primary key. If it answers 429
 * the run moves to the next key and carries on from the same sweep - no sweep
 * is lost and no result is dropped mid-search. Starting at the primary every
 * time is what makes the monthly reset self-healing: the moment the allowance
 * refills, the very next run is back on key 1 with no state to remember and
 * nothing to reset by hand. The cost is one rejected request per run while the
 * primary is spent, and RapidAPI does not charge quota for a 429.
 *
 * Endpoint note: the documented path is `/search-v2`. The older `/search` was
 * retired and now 404s, which is silent breakage if the adapter swallows errors.
 */
export const jsearch: Adapter = async (source) => {
  const keys = jsearchKeys();
  if (keys.length === 0) {
    throw new MissingCredential("JSEARCH_OPENWEBNINJA_KEY or JSEARCH_RAPIDAPI_KEY");
  }

  const out: RawJob[] = [];
  const seen = new Set<string>();
  let keyIndex = 0;
  const exhausted: number[] = [];

  // Overridable so the adapter can be exercised against a local mock without
  // spending requests from a metered monthly allowance. When set it applies to
  // every key, whatever platform they came from.
  const override = process.env.JSEARCH_BASE_URL?.trim();
  const baseFor = (k: JsearchKey) => override || PROVIDER_BASE[k.provider];

  for (const sweep of JSEARCH_SWEEPS) {
    const query =
      `/search-v2?query=${encodeURIComponent(sweep.query)}` +
      `&num_pages=${JSEARCH_PAGES}&country=sa&date_posted=week` +
      (sweep.internOnly ? "&employment_types=INTERN" : "");

    let body: unknown;
    let delivered = false;

    // This app's own monthly cap, shared by every machine (budget.ts), so the
    // plan's limit is never the thing that stops a run. Not counted against
    // the local mock (JSEARCH_BASE_URL), which costs nothing.
    if (!override && !(await reserve("jsearch"))) {
      if (out.length > 0) break;
      throw new QuotaExceeded("JSearch (this app's monthly budget, BUDGET_JSEARCH_MONTH)");
    }

    // Retry this sweep on each remaining key before giving up on it.
    while (keyIndex < keys.length && !delivered) {
      try {
        const active = keys[keyIndex];
        body = await getJson<unknown>(`${baseFor(active)}${query}`, {
          headers: providerHeaders(active),
          retries: 0,
        });
        delivered = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message.includes("429")) {
          // This key is spent for the month. Move to the next one and retry the
          // same sweep, so the switch costs nothing but a redirect.
          exhausted.push(keyIndex + 1);
          keyIndex++;
          continue;
        }
        if (message.includes("401") || message.includes("403")) {
          /*
           * The key was refused. Almost always a key from one platform sent to
           * the other - the two use different hosts and different headers, and
           * a RapidAPI key means nothing to api.openwebninja.com or the
           * reverse. Naming the variable turns a silent zero-result run into a
           * one-line fix.
           */
          const k = keys[keyIndex];
          throw new Error(
            `JSearch rejected ${k.label} (${message}). It is being sent to ` +
              `${baseFor(k)} as a ${k.provider} key - if that key is from the other ` +
              `platform, move it to ${
                k.provider === "rapidapi" ? "JSEARCH_OPENWEBNINJA_KEY" : "JSEARCH_RAPIDAPI_KEY"
              }.`,
          );
        }
        if (message.includes("404")) {
          throw new Error(`JSearch endpoint rejected the request (${message}) - check the path`);
        }
        // A one-off failure on this sweep; keep the key and move on.
        break;
      }
    }

    if (keyIndex >= keys.length) {
      // Every key is spent. Return what was collected rather than nothing.
      if (out.length > 0) break;
      throw new QuotaExceeded(
        `JSearch (all ${keys.length} key${keys.length === 1 ? "" : "s"} exhausted)`,
      );
    }
    if (!delivered) continue;

    // The payload has moved between `data: []` and `data: { jobs: [] }` across
    // versions, so accept either rather than silently reading zero jobs.
    const container = body as { data?: unknown };
    const jobs: JSearchJob[] = Array.isArray(container?.data)
      ? (container.data as JSearchJob[])
      : Array.isArray((container?.data as { jobs?: unknown })?.jobs)
        ? ((container.data as { jobs: JSearchJob[] }).jobs)
        : [];

    for (const j of jobs) {
      if (!j?.job_id) continue;
      const title = htmlToText(j.job_title);
      const company = j.employer_name || "Unknown";
      const applyLink = j.job_apply_link ?? j.job_google_link ?? "";
      const id = stableJsearchId(j, company, title);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        sourceId: source.id,
        externalId: id,
        title,
        company,
        locationText: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "),
        // The employer's words only. This used to append JSearch's own estimate
        // ("Requires 3 years of experience.") to the text, which then read as
        // something the posting said - and would be quoted back as evidence.
        descriptionText: htmlToText(j.job_description),
        url: applyLink,
        postedAt: toIso(j.job_posted_at_datetime_utc),
        employmentType: j.job_employment_type ?? null,
        publisher: j.job_publisher ?? null,
      });
    }
  }

  if (exhausted.length > 0) {
    console.warn(
      `[jsearch] key${exhausted.length > 1 ? "s" : ""} ${exhausted.join(", ")} out of quota; ` +
        `finished on key ${keyIndex + 1} of ${keys.length}`,
    );
  }
  return out.filter((j) => j.url);
};

/* ---------------------------------- Careerjet ---------------------------- */

interface CareerjetJob {
  title: string;
  company?: string;
  locations?: string;
  description?: string;
  url: string;
  date?: string;
}

export const careerjet: Adapter = async (source) => {
  const affid = process.env.CAREERJET_AFFID;
  if (!affid) throw new MissingCredential("CAREERJET_AFFID");

  const out: RawJob[] = [];
  const seen = new Set<string>();

  const terms = [...QUERY_TERMS, ...STUDENT_TERMS];
  const errors: string[] = [];
  for (const keywords of terms) {
    try {
      /*
       * Two things this endpoint insists on, both found the hard way.
       *
       * 1. HTTP, not HTTPS. public.api.careerjet.net resolves but refuses TLS
       *    outright - the connection fails before any status code, which the
       *    fetch reported as a plain network error and the tab showed as "no
       *    results yet". The affiliate id is not a credential in the sense a
       *    password is, and this is the only transport the API offers.
       *
       * 2. A Referer header. Without one it answers 403 with "Undeclared
       *    referrer. Please add a Referer header so we know who is calling this
       *    API and from which page." - a real error, invisible from the UI.
       */
      const url =
        `http://public.api.careerjet.net/search?locale_code=en_SA` +
        `&keywords=${encodeURIComponent(keywords)}` +
        `&location=${encodeURIComponent(source.handle || "Riyadh")}` +
        `&affid=${affid}&pagesize=99&page=1` +
        `&user_ip=1.1.1.1&user_agent=${encodeURIComponent("Mozilla/5.0")}`;
      const data = await getJson<{ jobs?: CareerjetJob[]; type?: string; error?: string }>(url, {
        retries: 1,
        headers: { Referer: envStr("APP_URL") ?? "https://saudi-job-alert.local/" },
      });

      // The API answers 200 with a type of ERROR for some failures, so a
      // successful fetch is not the same as a successful search.
      if (data.type === "ERROR") {
        throw new Error(`Careerjet refused the request: ${data.error ?? "unknown reason"}`);
      }

      for (const j of data.jobs ?? []) {
        /*
         * Keyed on the posting, not the link. Careerjet's URL is a tracking
         * redirect (jobviewtrack.com) minted fresh on every call, so keying on
         * it made all ~890 rows "new" every day and retired yesterday's copies -
         * and the same posting returned by two keywords was stored twice.
         */
        const title = htmlToText(j.title);
        const company = j.company || "Unknown";
        const id = contentId("cj", company, title, j.locations ?? "");
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          sourceId: source.id,
          externalId: id,
          title,
          company,
          locationText: j.locations ?? "",
          descriptionText: htmlToText(j.description),
          url: j.url,
          postedAt: toIso(j.date),
        });
      }
    } catch (err) {
      /* keep going */
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  failIfNothingWorked("Careerjet", terms.length, errors);
  return out;
};