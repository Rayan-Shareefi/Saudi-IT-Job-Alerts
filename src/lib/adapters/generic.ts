/**
 * Fallbacks for career pages with no public API.
 *
 * Escalation order, cheapest first:
 *   1. `jsonld`  - schema.org JobPosting embedded in the page. Google requires
 *                  this for jobs to appear in Google for Jobs, so a surprising
 *                  share of career sites emit it even when they have no API.
 *   2. `rss`     - classic feed.
 *   3. `browser` - real Chromium via Playwright, for sites that render their
 *                  listing client-side. Slowest, so it runs in its own pass.
 */
import * as cheerio from "cheerio";
import { getText, htmlToText, toIso } from "../http";
import type { RawJob, SourceDefinition } from "../types";
import { isPlausiblePosting } from "../plausible";
import { isTechnologyRole } from "../relevance";
import { storedTexts } from "../db";
import type { Adapter } from "./ats";
import {
  REPEATED_BLOCK_SCRIPT,
  isPlausibleVacancy,
  locationFromText,
  type RepeatedCandidate,
} from "./repeated";

/* ---------------------------------- JSON-LD ------------------------------ */

interface JobPostingLd {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string | string[];
  url?: string;
  identifier?: unknown;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: unknown;
  experienceRequirements?: unknown;
}

/** Walk any JSON-LD shape (@graph, arrays, nested) collecting JobPosting nodes. */
function collectJobPostings(node: unknown, acc: JobPostingLd[] = []): JobPostingLd[] {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectJobPostings(item, acc);
    return acc;
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("JobPosting")) acc.push(obj as JobPostingLd);
  for (const key of ["@graph", "itemListElement", "item", "mainEntity"]) {
    if (key in obj) collectJobPostings(obj[key], acc);
  }
  return acc;
}

function locationOf(jobLocation: unknown): string {
  const parts: string[] = [];
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    const o = n as Record<string, unknown>;
    const addr = o.address as Record<string, unknown> | undefined;
    if (addr) {
      for (const k of ["addressLocality", "addressRegion", "addressCountry"]) {
        const v = addr[k];
        if (typeof v === "string") parts.push(v);
        else if (v && typeof v === "object" && typeof (v as { name?: string }).name === "string") {
          parts.push((v as { name: string }).name);
        }
      }
    }
    if (typeof o.name === "string") parts.push(o.name);
  };
  visit(jobLocation);
  return [...new Set(parts)].join(", ");
}

function experienceOf(req: unknown): string {
  if (!req) return "";
  if (typeof req === "string") return req;
  if (typeof req === "object") {
    const o = req as Record<string, unknown>;
    if (typeof o.monthsOfExperience === "number") {
      return `${Math.round(o.monthsOfExperience / 12)} years of experience`;
    }
    if (typeof o.description === "string") return o.description;
  }
  return "";
}

/** Extract every JobPosting from a page's JSON-LD blocks. */
export function parseJsonLd(html: string, source: SourceDefinition, pageUrl: string): RawJob[] {
  const $ = cheerio.load(html);
  const postings: JobPostingLd[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      collectJobPostings(JSON.parse(raw), postings);
    } catch {
      // Some sites emit slightly invalid JSON-LD; try to salvage the objects.
      const matches = raw.match(/\{[\s\S]*?"@type"\s*:\s*"JobPosting"[\s\S]*?\}(?=\s*[,\]}]|\s*$)/g);
      for (const chunk of matches ?? []) {
        try {
          collectJobPostings(JSON.parse(chunk), postings);
        } catch {
          /* give up on this block */
        }
      }
    }
  });

  return postings
    .filter((p) => p.title)
    .map((p) => {
      const org = typeof p.hiringOrganization === "string"
        ? p.hiringOrganization
        : p.hiringOrganization?.name;
      const url = p.url ?? pageUrl;
      return {
        sourceId: source.id,
        externalId: String(
          (typeof p.identifier === "object" && p.identifier
            ? (p.identifier as { value?: string }).value
            : p.identifier) ?? url,
        ),
        title: String(p.title),
        company: org ?? source.company ?? source.label,
        locationText: locationOf(p.jobLocation),
        descriptionText: `${htmlToText(p.description)} ${experienceOf(p.experienceRequirements)}`.trim(),
        url,
        postedAt: toIso(p.datePosted),
        // schema.org states the deadline here, which is more reliable than
        // anything the body says.
        closesAt: toIso(p.validThrough),
        employmentType: Array.isArray(p.employmentType)
          ? p.employmentType.join(", ")
          : (p.employmentType ?? null),
      };
    });
}

export const jsonld: Adapter = async (source) => {
  const html = await getText(source.handle);
  return parseJsonLd(html, source, source.handle);
};

/* ------------------------------------ RSS -------------------------------- */

export const rss: Adapter = async (source) => {
  const xml = await getText(source.handle);
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: RawJob[] = [];

  const nodes = $("item").length ? $("item") : $("entry");
  nodes.each((_, el) => {
    const $el = $(el);
    const title = $el.find("title").first().text().trim();
    if (!title) return;
    const link =
      $el.find("link").first().attr("href") ?? $el.find("link").first().text().trim();
    const description = htmlToText(
      $el.find("description").first().text() ||
        $el.find("content").first().text() ||
        $el.find("summary").first().text(),
    );
    const guid = $el.find("guid").first().text().trim() || link;
    const date =
      $el.find("pubDate").first().text() ||
      $el.find("published").first().text() ||
      $el.find("updated").first().text();

    out.push({
      sourceId: source.id,
      externalId: guid || title,
      title,
      company: source.company ?? source.label,
      // Feeds rarely have a location field; the classifier reads the body.
      locationText: "",
      descriptionText: description,
      url: link || source.handle,
      postedAt: toIso(date),
    });
  });
  return out;
};

/* ---------------------------------- Browser ------------------------------ */

/**
 * Keys a JSON job object is likely to use for each field. Career-page APIs are
 * all bespoke, so the parser matches on shape rather than on a known schema.
 */
const TITLE_KEYS = [
  "title", "jobTitle", "job_title", "name", "positionName", "position_name",
  "position", "jobName", "job_name", "vacancyTitle", "displayName", "titleEn",
];
const URL_KEYS = [
  "url", "jobUrl", "job_url", "applyUrl", "apply_url", "link", "permalink",
  "absolute_url", "hostedUrl", "canonicalUrl", "detailUrl", "jobPostingUrl",
];
const LOCATION_KEYS = [
  "location", "locationName", "location_name", "city", "jobLocation",
  "locations", "primaryLocation", "workLocation", "office", "region", "country",
];
const ID_KEYS = ["id", "jobId", "job_id", "requisitionId", "reqId", "code", "slug", "externalId"];
const DESC_KEYS = [
  "description", "jobDescription", "job_description", "summary", "content",
  "details", "requirements", "qualifications", "responsibilities", "snippet",
];
const DATE_KEYS = [
  "postedDate", "posted_date", "postedAt", "posted_at", "createdAt", "created_at",
  "publishedAt", "published_at", "datePosted", "startDate", "updatedAt",
];

function pick(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    // Case-insensitive so camelCase / snake_case / PascalCase all resolve.
    const match = Object.keys(obj).find((o) => o.toLowerCase() === k.toLowerCase());
    if (match !== undefined && obj[match] !== null && obj[match] !== "") return obj[match];
  }
  return undefined;
}

/** Flatten whatever shape a location field arrived in into readable text. */
function asText(value: unknown, depth = 0): string {
  if (value === null || value === undefined || depth > 3) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => asText(v, depth + 1)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of ["name", "label", "text", "city", "displayName", "value", "title"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
    return Object.values(o).map((v) => asText(v, depth + 1)).filter(Boolean).slice(0, 3).join(", ");
  }
  return "";
}

/** Does this object look like a job posting rather than a menu item or facet? */
function looksLikeJobObject(o: Record<string, unknown>): boolean {
  const title = pick(o, TITLE_KEYS);
  if (typeof title !== "string" || title.length < 4 || title.length > 160) return false;
  // A bare {name: "..."} is usually a filter option; require corroboration.
  const supporting =
    pick(o, URL_KEYS) !== undefined ||
    pick(o, LOCATION_KEYS) !== undefined ||
    pick(o, DESC_KEYS) !== undefined ||
    pick(o, DATE_KEYS) !== undefined;
  return supporting && Object.keys(o).length >= 3;
}

/**
 * Walk arbitrary JSON collecting the largest array of job-shaped objects.
 * Career APIs bury the list at wildly different paths (`data.jobs`,
 * `content.items`, `result.requisitions`), so the shape is the only reliable
 * signal.
 */
function findJobArrays(node: unknown, out: Array<Record<string, unknown>[]> = [], depth = 0): Array<Record<string, unknown>[]> {
  if (!node || typeof node !== "object" || depth > 8) return out;

  if (Array.isArray(node)) {
    const objects = node.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v));
    if (objects.length > 0) {
      const jobs = objects.filter(looksLikeJobObject);
      // Require most of the array to look like jobs, so a page's nav array
      // containing one job-shaped entry does not qualify.
      if (jobs.length >= 2 && jobs.length >= objects.length * 0.6) out.push(jobs);
    }
    for (const item of node.slice(0, 200)) findJobArrays(item, out, depth + 1);
    return out;
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    findJobArrays(value, out, depth + 1);
  }
  return out;
}

function jobsFromJson(
  payloads: string[],
  source: SourceDefinition,
  pageUrl: string,
): RawJob[] {
  const collected: Record<string, unknown>[] = [];

  for (const body of payloads) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    for (const arr of findJobArrays(parsed)) collected.push(...arr);
  }

  const seen = new Set<string>();
  const out: RawJob[] = [];

  for (const o of collected) {
    const title = String(pick(o, TITLE_KEYS) ?? "").trim();
    if (!title) continue;

    const rawUrl = asText(pick(o, URL_KEYS));
    let url = rawUrl;
    if (url && !/^https?:/i.test(url)) {
      try {
        url = new URL(url, pageUrl).toString();
      } catch {
        url = "";
      }
    }
    // No per-job link: the listing page is still a usable destination.
    if (!url) url = pageUrl;

    const id = asText(pick(o, ID_KEYS)) || url || title;
    const key = `${title}|${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      sourceId: source.id,
      externalId: String(id).slice(0, 400),
      title,
      company: source.company ?? source.label,
      locationText: asText(pick(o, LOCATION_KEYS)),
      descriptionText: htmlToText(asText(pick(o, DESC_KEYS))).slice(0, 14000),
      url,
      postedAt: toIso(pick(o, DATE_KEYS)),
    });
  }
  return out;
}

/**
 * Last resort for client-rendered boards.
 *
 * Modern career pages are single-page apps: the markup contains no job links at
 * all, and the listing arrives as JSON over XHR after hydration. So rather than
 * scraping the DOM, this records every JSON response the page fetches and looks
 * for arrays of job-shaped objects in them. That is where the data actually is.
 *
 * Escalation: intercepted JSON -> JSON-LD in the rendered HTML -> anchor sweep.
 *
 * Kept out of the fast ingest pass (`--skip-browser`) because it costs seconds
 * per source rather than milliseconds.
 */
/**
 * Result routes to try when the seeded page turns out to be a front door.
 *
 * Measured, not guessed. Loading the careers pages that returned nothing shows
 * they mostly contain no vacancies at all: Alinma's is 1,078 characters of
 * marketing and an "Apply now" button, NEOM's offers to take your CV, Tahakom's
 * is a search form with "Search by Keyword". The jobs are real - they live one
 * route deeper, behind a search nobody submitted.
 *
 * `/search/` and `/viewalljobs/` are first because SAP SuccessFactors powers a
 * large share of Saudi enterprise career sites and uses both; that is the same
 * route that turned SAP's own board from 0 into 52 postings.
 */
const RESULT_ROUTES = [
  "/search/",
  "/viewalljobs/",
  "/jobs",
  "/search",
  "/vacancies",
  "/openings",
  "/go/All-Jobs/",
  "/search-results",
];

/** Buttons that reveal the list without needing a query typed in. */
/**
 * How many pages of a board to walk before giving up.
 *
 * Boards paginate in wildly different sizes - Deloitte serves six roles a page,
 * so their ~130 openings need 22 requests. The cap exists to stop a broken
 * "next" control from walking forever, not to limit real boards, so it is
 * generous. Collection stops early the moment a page adds nothing new.
 */
const MAX_PAGES = 40;

/**
 * How long to spend paging one board.
 *
 * Pagination is what took Deloitte from 6 postings to 165, and it also took
 * that source from 8 seconds to 136. With hundreds of browser sources in a run,
 * one board with 40 pages of slow-loading results would otherwise dominate the
 * whole pass. Whatever has been collected when the budget runs out is kept - a
 * partial board is still far better than its first page.
 */
const PAGINATION_BUDGET_MS = 90_000;

/** Controls that advance to the next page of results. */
const NEXT_CONTROL =
  /^(next|older|more(\s+results)?|show more|load more|view more|التالي|المزيد)(\s*(page|»|›|>{1,2}|→))?$|^(>{1,2}|»|›|→|⟩)$/i;

/**
 * The next page's URL, worked out by comparing the pagination links against the
 * current one.
 *
 * Deliberately not a whitelist of parameter names. Boards use `page`, `offset`,
 * `start`, `from`, `startrow`, `pageIndex`, `pipelineOffset` and worse, and any
 * list would be out of date within a month. Instead: among links to the *same
 * path*, find one that differs only in numeric parameters and whose number is
 * the next step up. That works on a board nobody has seen before.
 */
function nextPageUrl(currentUrl: string, hrefs: string[]): string | null {
  let current: URL;
  try {
    current = new URL(currentUrl);
  } catch {
    return null;
  }

  let best: { url: string; delta: number } | null = null;

  for (const href of hrefs) {
    let u: URL;
    try {
      u = new URL(href, currentUrl);
    } catch {
      continue;
    }
    if (u.origin !== current.origin || u.pathname !== current.pathname) continue;
    if (u.href === current.href) continue;

    // Every parameter must match except numeric ones that moved forward.
    const keys = new Set([...current.searchParams.keys(), ...u.searchParams.keys()]);
    let forward = 0;
    let mismatch = false;

    for (const k of keys) {
      const a = current.searchParams.get(k) ?? "";
      const b = u.searchParams.get(k) ?? "";
      if (a === b) continue;
      const na = Number(a || "0");
      const nb = Number(b);
      if (!Number.isFinite(na) || !Number.isFinite(nb) || !/^\d+$/.test(b)) {
        mismatch = true;
        break;
      }
      if (nb <= na) {
        mismatch = true;
        break;
      }
      forward = forward === 0 ? nb - na : Math.min(forward, nb - na);
    }

    if (mismatch || forward <= 0) continue;
    // The smallest forward step is the immediate next page, not page 12.
    if (!best || forward < best.delta) best = { url: u.href, delta: forward };
  }

  return best?.url ?? null;
}

const REVEAL_BUTTON =
  /^(search|search jobs|view all|view all jobs|see all jobs|all jobs|browse jobs|show all|find jobs|بحث|عرض الكل)$/i;

/**
 * Last resort for client-rendered boards.
 *
 * Walks a small set of candidate URLs and, at each one, runs the full
 * extraction chain: the JSON the page fetched for itself, then schema.org data,
 * then a job list found by its repeating shape, then job-shaped anchors. The
 * first stop that yields three or more postings wins.
 *
 * Walking rather than parsing harder is the point - the earlier versions all
 * assumed the seeded page held the jobs, and on most of these employers it
 * simply does not.
 */
export const browser: Adapter = async (source) => {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true });

  try {
    /*
     * An explicit context, not `browser.newPage()`.
     *
     * The convenience form puts the page in a hidden default context that
     * refuses any second page - `page.context().newPage()` throws "Please use
     * browser.newContext()". That is what stopped the detail pass dead: it
     * opens a few tabs to read postings in parallel, the very first one threw,
     * and the caller's `.catch()` turned the whole pass into a silent no-op.
     * Every browser-scraped posting was therefore stored with whatever the
     * listing card happened to say, which for most boards is no location.
     *
     * Owning the context also means the lanes share cookies and any consent
     * the walk has already dealt with.
     */
    const context = await b.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    const page = await context.newPage();

    const payloads: string[] = [];
    page.on("response", (res) => {
      const type = res.headers()["content-type"] ?? "";
      if (!type.includes("json") || payloads.length >= 60) return;
      res
        .text()
        .then((t) => {
          if (t.length > 200 && t.length < 4_000_000) payloads.push(t);
        })
        .catch(() => {});
    });

    /** Everything we know how to read, applied to whatever is on screen now. */
    const extractHere = async (): Promise<RawJob[]> => {
      /*
       * Structured data is authoritative, but only once it has been judged.
       * An intercepted JSON payload can be a config blob or a cookie manifest,
       * and three entries out of one was enough to win here and shut every
       * other strategy out - which is how Deloitte's board, whose job links the
       * anchor pass reads perfectly, reported nothing at all.
       */
      const fromJson = jobsFromJson(payloads, source, page.url()).filter((j) =>
        isPlausiblePosting(j.title, j.descriptionText, j.url),
      );
      if (fromJson.length >= 3) return fromJson;

      const html = await page.content();
      const fromLd = parseJsonLd(html, source, page.url()).filter((j) =>
        isPlausiblePosting(j.title, j.descriptionText, j.url),
      );
      if (fromLd.length > 0) return fromLd;

      const groups = (await page
        .evaluate(REPEATED_BLOCK_SCRIPT)
        .catch(() => [])) as RepeatedCandidate[];

      /*
       * The two DOM strategies are now run side by side, and the better result
       * wins - rather than the block pass returning early and shutting the
       * anchor pass out.
       *
       * Deloitte is why. Their board paginates six roles at a time, and the
       * block pass squeezed three weak rows out of the surrounding chrome. That
       * was enough to "succeed", so the anchor pass - which reads their
       * /PipelineDetail/<slug>/<id> links perfectly - never ran, and the
       * employer looked like it had no openings.
       */
      let fromBlocks: RawJob[] = [];

      for (const group of groups) {
        // The block's own text is passed too: a cookie table's rows have
        // innocuous-looking names and give themselves away in the body
        // ("Used by Adobe Experience Manager to ...").
        const rows = group.items.filter((i) => isPlausibleVacancy(i.title, i.text));
        // A real vacancy list keeps most of its rows through the sanity filter;
        // a nav menu or a tag cloud loses nearly all of them.
        if (rows.length < 3 || rows.length < group.items.length * 0.5) continue;
        const seen = new Set<string>();
        const jobs = rows
          .filter((r) => !seen.has(r.title) && seen.add(r.title))
          .map((r) => ({
            sourceId: source.id,
            externalId: r.url ?? `${source.id}|${r.title}`,
            title: r.title,
            company: source.company ?? source.label,
            locationText: locationFromText(r.text),
            descriptionText: r.text,
            url: r.url ?? page.url(),
            postedAt: null,
          }));
        if (jobs.length >= 3 && jobs.length > fromBlocks.length) fromBlocks = jobs;
      }

      const anchors = await page
        .$$eval("a[href]", (els) =>
          els
            .map((el) => ({
              href: (el as HTMLAnchorElement).href,
              text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
              context: (el.closest("li,tr,article,div")?.textContent ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 600),
            }))
            .filter(function (a) {
              // A real page address. Share-by-email links carry the posting URL
              // inside them - 'mailto:?body=https://jobs.lenovo.com/...' - so a
              // keyword test on the href matches them and they were stored as
              // job URLs, pointing at a mail composer.
              if (a.href.slice(0, 5).toLowerCase() !== "http:" &&
                  a.href.slice(0, 6).toLowerCase() !== "https:") {
                return false;
              }
              return /job|career|vacan|position|opening|requisition|wazifa/i.test(a.href);
            }),
        )
        .catch(() => [] as Array<{ href: string; text: string; context: string }>);

      const seenHref = new Set<string>();
      const fromAnchors = anchors
        .filter(
          (a) =>
            isJobLink(a.href, a.text) &&
            // The same judge the block pass uses, so a nav link cannot get in
            // through the anchor door after being turned away at the other.
            isPlausiblePosting(a.text, a.context, a.href) &&
            !seenHref.has(a.href) &&
            seenHref.add(a.href),
        )
        .map((a) => ({
          sourceId: source.id,
          externalId: a.href,
          title: a.text,
          company: companyFrom(a.context) ?? source.company ?? source.label,
          locationText: locationFrom(a.context),
          descriptionText: a.context,
          url: a.href,
          postedAt: null,
        }));

      return fromAnchors.length > fromBlocks.length ? fromAnchors : fromBlocks;
    };

/**
 * How many postings per source to open individually.
 *
 * Opening a job page costs a page load, so this is a budget rather than a
 * promise. Sources are polled repeatedly, and each run works on the postings
 * that are still unplaced, so a large board fills in over a few passes instead
 * of one very long one.
 */
const DETAIL_BUDGET = 350;

/** How a cookie banner reads, when one is all that was scraped. */
const CONSENT_TEXT =
  /we use cookies|accept all cookies|cookie (policy|preferences|settings)|manage (your )?(cookie|consent)|privacy preference cent/i;

/**
 * Detail pages read at once.
 *
 * Sized against what the boards actually need: one collection wanted 7,100
 * postings opened and reached 3,654 of them, so HCLTech (152), Wipro (72) and
 * DXC (70) each ran out of clock with most of their postings still holding
 * nothing but a listing card - which is to say still reading "not stated".
 * Six tabs and a six-minute ceiling covers the largest board in one pass, and
 * costs nothing on the great majority of sources, which need a handful.
 */
const DETAIL_LANES = 6;

/** How long to spend on detail pages for one source. */
const DETAIL_BUDGET_MS = 360_000;

/**
 * The detail-page extractor, as a STRING rather than a function.
 *
 * This is not stylistic. Passing a function to page.evaluate() means Playwright
 * serialises it and runs it in the browser - but esbuild, which tsx uses to
 * transpile this file, rewrites inner named functions to call a `__name`
 * helper it injects at module scope. That helper does not exist in the page, so
 * every such evaluate threw `ReferenceError: __name is not defined` the moment
 * it ran.
 *
 * It failed silently: the call was wrapped in .catch(), so the detail pass
 * appeared to run and simply never filled anything in. A string is immune,
 * which is why REPEATED_BLOCK_SCRIPT is one too.
 */
const DETAIL_SCRIPT = `(() => {
  var pick = function (sel) {
    var el = document.querySelector(sel);
    return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  };

  // Where boards mark the location up, in rough order of reliability.
  var location =
    pick('[itemprop="jobLocation"]') ||
    pick('[data-testid*="location" i]') ||
    pick('[class*="job-location" i]') ||
    pick('[class*="jobLocation" i]') ||
    pick('[class*="location" i]') ||
    '';

  // schema.org, when the page publishes it, beats any guess at the markup.
  try {
    var blocks = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < blocks.length; i++) {
      var data = JSON.parse(blocks[i].textContent || '{}');
      var nodes = Array.isArray(data) ? data : [data];
      for (var n = 0; n < nodes.length; n++) {
        var node = nodes[n];
        if (!node || node['@type'] !== 'JobPosting' || !node.jobLocation) continue;
        var jl = Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation;
        var addr = jl && jl.address ? jl.address : null;
        if (addr) {
          var parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
            .filter(function (p) { return typeof p === 'string' && p; });
          if (parts.length) { location = parts.join(', '); }
        }
      }
    }
  } catch (e) { /* malformed JSON-LD is common; ignore it */ }

  /*
   * Take the cookie banner out of the page before reading it.
   *
   * The body text is whichever candidate is longest, and on HCLTech board
   * pages the longest block is the consent notice - so 319 postings were
   * stored with "We use cookies for the best user experience on our
   * website..." as their description. That is worse than storing nothing:
   * there is no location in it to find, and its marketing language was
   * enough to talk the relevance filter into keeping sales roles like Client
   * Director and Account Manager on an IT board.
   *
   * The page is discarded straight after this, so removing nodes from it
   * costs nothing. Navigation, headers and footers go too - they are the
   * other reliable way to win the longest-block contest without being the job.
   *
   * Menus and dropdowns are deliberately NOT stripped, though they cause the
   * same trouble - HCLTech postings fall back to a country picker naming
   * thirty countries. Removing anything whose class contains "menu" took the
   * description with it at Saudi Business Machines, where a full 3,769
   * character body dropped to nothing. A site that hides its postings behind
   * automation blocking is better handled by not scraping it at all.
   */
  try {
    var pageChars = document.body ? (document.body.innerText || '').length : 0;

    // Structural chrome: never the posting, always safe to drop.
    var chrome = document.querySelectorAll('nav, header, footer, script, style, noscript');
    for (var c = 0; c < chrome.length; c++) {
      if (chrome[c] && chrome[c].parentNode) { chrome[c].parentNode.removeChild(chrome[c]); }
    }

    /*
     * Consent notices, but only when the match IS the notice.
     *
     * Saudi Business Machines wraps its whole page in a cookie-consent
     * container, so '[class*=cookie]' matched 3,997 characters on a 3,791
     * character page - removing it deleted the site, and all 22 of their
     * postings went back to reading nothing. An element holding most of the
     * page is the page, whatever it is called.
     */
    var banners = document.querySelectorAll(
      '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i],' +
      '[id*="onetrust" i], [class*="onetrust" i], [aria-label*="cookie" i]'
    );
    for (var k = 0; k < banners.length; k++) {
      var el = banners[k];
      if (!el || !el.parentNode) { continue; }
      var own = (el.innerText || el.textContent || '').length;
      if (pageChars > 0 && own > pageChars * 0.4) { continue; }
      el.parentNode.removeChild(el);
    }
  } catch (e) { /* a page that will not let us tidy it is still readable */ }

  // The LONGEST candidate, not the first that matches.
  //
  // Taking the first hit picked a heading on Workable: the selector
  // [class*=job-description] matched an element whose entire text was the
  // word 'Description', so an 11-character body looked like a successful
  // read and the posting stayed unplaced.
  var candidates = [
    pick('[data-ui="job-description"]'),
    pick('[class*="job-description" i]'),
    pick('[class*="jobdescription" i]'),
    pick('[id*="job-description" i]'),
    pick('[class*="description" i]'),
    pick('article'),
    pick('main'),
    document.body ? (document.body.innerText || '').replace(/\\s+/g, ' ').trim() : ''
  ];
  var body = '';
  for (var b = 0; b < candidates.length; b++) {
    if (candidates[b] && candidates[b].length > body.length) { body = candidates[b]; }
  }

  return { location: location.slice(0, 300), body: body.slice(0, 14000) };
})()`;

/**
 * Reads the location and body text off a posting's own page.
 *
 * The list card is not enough. DXC's Cyber Security Intern arrived with a
 * 41-character description - "Cyber Security InternApprentice & Interns" -
 * while its actual page says "Work Location: Milan with smart working
 * possibility". With only the card text there is nothing for the classifier to
 * read, which is why 730 postings claimed no location: not because the
 * employers did not say, but because nobody had opened the page they said it
 * on.
 */
async function fillFromDetailPages(
  page: import("playwright").Page,
  jobs: RawJob[],
  alreadyFull: Set<string> = new Set(),
): Promise<number> {
  // Only the ones that need it, and only those with somewhere to go.
  /*
   * Only postings that will actually be kept, and only real page addresses.
   *
   * Two things were wasting the budget entirely:
   *
   *   - "mailto:?body=https://..." share-by-email links were being stored as
   *     job URLs, so the pass tried to open a mail composer;
   *   - the budget was spent in extraction order, which on a board like
   *     Lenovo's meant thirty non-IT postings were opened and then discarded by
   *     the relevance filter, while the roles worth placing never got looked at.
   *
   * Filtering first means the spend goes on the postings that survive: of 654
   * unplaced browser postings, only 44 had been reached.
   */
  /*
   * ...and every posting whose card is all we have, not only the unplaced ones.
   *
   * Since 2026-10-13 the board judges the whole posting - its duties decide
   * whether it is security or cloud work, its requirements state the years.
   * A 300-character card carries neither, so a posting that showed its city
   * on the card used to stay a card forever. Postings already read in full on
   * an earlier run are skipped (alreadyFull), so after the first pass this
   * opens only what is new.
   */
  const needy = jobs.filter(
    (j) =>
      (!(j.locationText ?? "").trim() || (j.descriptionText ?? "").length < 600) &&
      !alreadyFull.has(j.externalId) &&
      /^https?:\/\//i.test(j.url ?? "") &&
      isPlausiblePosting(j.title, j.descriptionText, j.url),
  );

  /*
   * Technology roles first, rather than only technology roles.
   *
   * Relevance was a filter here, which is too strong a judgement to make on
   * what is often a 60-character listing snippet: "Windows Support Engineer"
   * and an NOC specialist were both ruled out as non-technical, never opened,
   * and stored as "location not stated" - while the ingest that follows judged
   * the same two postings relevant and kept them. Ordering keeps the budget on
   * the roles that plainly qualify while still spending what is left on the
   * ambiguous ones, and it is the enrichment itself that gives the classifier
   * enough text to judge either of them properly.
   */
  needy.sort((a, b) => {
    const at = isTechnologyRole(a.title, a.descriptionText, a.department) ? 0 : 1;
    const bt = isTechnologyRole(b.title, b.descriptionText, b.department) ? 0 : 1;
    return at - bt;
  });
  if (needy.length === 0) {
    if (process.env.INGEST_VERBOSE) {
      console.log(`      detail pass: nothing needed it (${jobs.length} posting(s))`);
    }
    return 0;
  }

  const deadline = Date.now() + DETAIL_BUDGET_MS;
  const queue = needy.slice(0, DETAIL_BUDGET);
  let filled = 0;
  let attempted = 0;
  let cursor = 0;

  /**
   * One worker: takes the next posting off the queue until the queue or the
   * clock runs out. Its own tab, so lanes never fight over navigation.
   */
  const lane = async (tab: import("playwright").Page): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= queue.length || Date.now() > deadline) return;
      const job = queue[i];
      attempted++;
      try {
        const res = await tab.goto(job.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        if (!res || res.status() >= 400) continue;
        /*
         * Wait for the page to settle, not merely to arrive.
         *
         * Workable renders the posting client-side: at domcontentloaded the
         * description container exists but holds only the word "Description".
         * Waiting for the network to go quiet is the difference between an
         * 11-character body and the real one.
         */
        await tab.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
        await tab.waitForTimeout(600);

        const detail = (await tab
          .evaluate(DETAIL_SCRIPT)
          .catch(() => null)) as { location: string; body: string } | null;
        if (!detail) continue;
        if (detail.location) job.locationText = detail.location.slice(0, 300);
        /*
         * A body that OPENS as a consent notice is a banner, not a description.
         *
         * Testing the whole body was far too blunt: Saudi Business Machines
         * mentions cookies somewhere down its posting pages, so a 3,769
         * character description was thrown away and all 22 of its postings went
         * back to reading nothing. Only the opening is evidence about what the
         * block IS.
         */
        if (CONSENT_TEXT.test(detail.body.slice(0, 200))) detail.body = "";
        // Keep whichever text is longer: the card sometimes carries more than a
        // sparse detail page.
        if (detail.body.length > (job.descriptionText ?? "").length) {
          job.descriptionText = detail.body;
        }
        if (detail.location || detail.body.length > 200) filled++;
      } catch {
        /* one unreadable posting must not stop the rest */
      }
    }
  };

  /*
   * Read several postings at once.
   *
   * The pass was serial on a single tab, and a detail page costs up to nine
   * seconds - twenty for the navigation, six waiting for the network to go
   * quiet, then a settle. Against a 150-second budget that is sixteen to
   * thirty-seven postings per source, so Saudi Business Machines (69 unplaced)
   * and Lenovo (67) ran out of clock long before they ran out of postings, and
   * the ones never opened were stored as "location not stated".
   *
   * Lanes share the browser context and each drive their own tab, so the same
   * wall-clock budget covers roughly four times as many postings and the
   * per-source cap becomes the binding limit again, which is what it was for.
   */
  const context = page.context();
  const tabs: Array<import("playwright").Page> = [];
  try {
    const lanes = Math.min(DETAIL_LANES, queue.length);
    for (let i = 0; i < lanes; i++) tabs.push(await context.newPage());
    await Promise.all(tabs.map((tab) => lane(tab)));
  } finally {
    for (const tab of tabs) await tab.close().catch(() => {});
  }

  // Reported rather than silent: this pass has failed quietly twice already
  // (a serialisation error, then a budget spent on postings that were later
  // discarded), and both times it looked exactly like it was working.
  if (process.env.INGEST_VERBOSE) {
    console.log(
      `      detail pass: ${needy.length} needed, ${attempted} opened, ${filled} filled`,
    );
  }

  return filled;
}

    const visit = async (url: string): Promise<boolean> => {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 });
      if (!res || res.status() >= 400) return false;
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2200);
      return true;
    };

    /** Submit an empty search, which on these sites lists everything. */
    const clickReveal = async (): Promise<boolean> => {
      const clicked = await page
        .$$eval(
          "button, a, input[type=submit]",
          (els, pattern) => {
            const re = new RegExp(pattern, "i");
            for (const el of els) {
              const label =
                (el as HTMLInputElement).value ||
                (el.textContent ?? "").replace(/\s+/g, " ").trim();
              if (label && re.test(label)) {
                (el as HTMLElement).click();
                return true;
              }
            }
            return false;
          },
          REVEAL_BUTTON.source,
        )
        .catch(() => false);
      if (!clicked) return false;
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      return true;
    };

    if (!(await visit(source.handle).catch(() => false))) return [];

    /*
     * Keep the best attempt, not the last one.
     *
     * The walk used to fall out of the loop and `return found`, which is
     * whatever the final route happened to yield - usually a 404 shell or an
     * empty search page. A good result from the landing page was discarded
     * because a later route was tried and produced less.
     */
    let best: RawJob[] = [];

    /*
     * The single exit from the walk.
     *
     * Enrichment has to happen on EVERY path out, and the walk returns from
     * four places - as soon as any attempt clears the threshold. Putting the
     * detail pass only before the final return meant it never ran for a source
     * that succeeded early, which is almost all of them: DXC came back with
     * 185 postings, no locations, and 59-character descriptions.
     */
    /*
     * Every caller writes `return await finish()`, and the await is not
     * decoration.
     *
     * `return finish()` inside a `try` whose `finally` closes the browser hands
     * back an unsettled promise and lets the `finally` run immediately - so
     * `await b.close()` tore the browser down while the detail pass was still
     * opening pages on it. Every posting then failed with "Target page, context
     * or browser has been closed", each one swallowed by the per-posting catch,
     * and the pass reported nothing. That is why browser-scraped postings kept
     * arriving with their 60-character listing snippet and no location, no
     * matter how much the pass itself was improved.
     */
    const finish = async (): Promise<RawJob[]> => {
      if (best.length > 0) {
        /*
         * A failure here must not lose the postings already collected, but it
         * must not be invisible either. A bare `.catch(() => 0)` is how this
         * pass broke twice without anyone noticing - once on a serialisation
         * error thrown inside the page, once on a budget spent before the
         * filter. Both times the run reported success and stored postings with
         * no location.
         */
        // Postings already stored with their full text are not opened again.
        const stored = await storedTexts(source.id, best.map((b) => b.externalId)).catch(() => new Map<string, string>());
        const alreadyFull = new Set([...stored].filter(([, t]) => t.length >= 900).map(([id]) => id));
        await fillFromDetailPages(page, best, alreadyFull).catch((err) => {
          if (process.env.INGEST_VERBOSE) {
            console.log(`      detail pass FAILED: ${(err as Error)?.message ?? err}`);
          }
          return 0;
        });
      }
      return best;
    };

    /**
     * Read this page, then every following page of the same list.
     *
     * Boards paginate, and reading only the first page silently loses most of
     * an employer's openings - Deloitte serves six at a time, so a single page
     * was showing 6 of roughly 130. Three ways to advance, tried in order:
     *
     *   1. a "next" control (link or button),
     *   2. a pagination link that steps a numeric parameter forward,
     *   3. a "load more" button that appends in place.
     *
     * It stops as soon as a page contributes nothing new, so a board that
     * ignores its own paging parameter costs one extra request rather than 40.
     */
    const collectAllPages = async (): Promise<RawJob[]> => {
      const all = new Map<string, RawJob>();
      const absorb = (jobs: RawJob[]): number => {
        for (const j of jobs) all.set(j.externalId || `${j.url}|${j.title}`, j);
        return all.size;
      };

      absorb(await extractHere());
      if (all.size === 0) return [];

      const visited = new Set<string>([page.url()]);
      const deadline = Date.now() + PAGINATION_BUDGET_MS;

      for (let i = 1; i < MAX_PAGES; i++) {
        if (Date.now() > deadline) break;
        const before = all.size;
        let advanced = false;

        /*
         * 1. Find the "next" control and read its href.
         *
         * Reading the href rather than clicking, wherever there is one: an
         * anchor click navigates immediately, which destroys the execution
         * context the $$eval is still running in, so the call throws and the
         * step silently reports "no next page". Navigating ourselves is both
         * more reliable and easier to de-duplicate against.
         */
        const nextControl = await page
          .$$eval(
            "a, button, [role=button]",
            (els, pattern) => {
              const re = new RegExp(pattern, "i");
              for (const el of els) {
                const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
                const aria = el.getAttribute("aria-label") ?? "";
                const rel = el.getAttribute("rel") ?? "";
                const disabled =
                  el.hasAttribute("disabled") ||
                  el.getAttribute("aria-disabled") === "true" ||
                  /\bdisabled\b/i.test(el.className?.toString() ?? "");
                if (disabled) continue;
                if (rel === "next" || re.test(label) || re.test(aria)) {
                  const href = (el as HTMLAnchorElement).href || "";
                  return { href: href.endsWith("#") ? "" : href, label };
                }
              }
              return null;
            },
            NEXT_CONTROL.source,
          )
          .catch(() => null);

        if (nextControl?.href && !visited.has(nextControl.href)) {
          visited.add(nextControl.href);
          advanced = await visit(nextControl.href).catch(() => false);
        } else if (nextControl && !nextControl.href) {
          // No usable href - a scripted "load more". Click it in place.
          const clicked = await page
            .$$eval(
              "a, button, [role=button]",
              (els, pattern) => {
                const re = new RegExp(pattern, "i");
                for (const el of els) {
                  const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
                  if (re.test(label) || re.test(el.getAttribute("aria-label") ?? "")) {
                    (el as HTMLElement).click();
                    return true;
                  }
                }
                return false;
              },
              NEXT_CONTROL.source,
            )
            .catch(() => false);
          if (clicked) {
            await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
            await page.waitForTimeout(1600);
            advanced = true;
          }
        }

        if (!advanced) {
          // 2. A pagination link that steps a numeric parameter forward.
          const hrefs = await page
            .$$eval("a[href]", (els) => els.map((e) => (e as HTMLAnchorElement).href))
            .catch(() => [] as string[]);
          const next = nextPageUrl(page.url(), hrefs);
          if (next && !visited.has(next)) {
            visited.add(next);
            advanced = await visit(next).catch(() => false);
          }
        }

        if (!advanced) break;
        absorb(await extractHere());
        // A page that adds nothing means the paging did not really move.
        if (all.size === before) break;
      }

      return [...all.values()];
    };

    const consider = (jobs: RawJob[]): boolean => {
      if (jobs.length > best.length) best = jobs;
      return best.length >= 3;
    };

    if (consider(await collectAllPages())) return await finish();

    // The page had no list. Try submitting its search, then the result routes.
    if (await clickReveal()) {
      if (consider(await collectAllPages())) return await finish();
    }

    const origin = new URL(page.url()).origin;
    for (const route of RESULT_ROUTES) {
      const target = `${origin}${route}`;
      if (target === source.handle) continue;
      if (!(await visit(target).catch(() => false))) continue;
      if (consider(await collectAllPages())) return await finish();
      if (await clickReveal()) {
        if (consider(await collectAllPages())) return await finish();
      }
    }

    return await finish();
  } finally {
    await b.close();
  }
};

/* ------------------------- anchor-sweep heuristics ------------------------ */

/**
 * Navigation chrome that sits on every listing page and matches the same href
 * patterns real postings do ("/jobs/remote-jobs", "/en/job-search").
 */
const NAV_TITLES = new Set([
  "job search", "jobs by location", "jobs by company", "jobs by industry",
  "executive jobs", "remote jobs", "all locations", "all jobs", "browse jobs",
  "search jobs", "view all", "view all jobs", "see all jobs", "load more",
  "next", "previous", "relevance", "language", "sign in", "log in", "register",
  "post a job", "employers", "career advice", "salaries", "companies",
  "العربية", "english", "الوظائف", "بحث", "تسجيل الدخول",
]);

/**
 * A link to one specific posting, as opposed to a listing or nav page.
 *
 * The decisive signal is the URL: detail pages carry a numeric requisition id
 * or a long slug, while nav links do not. Without this check a single Bayt
 * listing page contributes ~100 rows titled "Job Search" and "Remote Jobs".
 */
function isJobLink(href: string, text: string): boolean {
  /*
   * Only a real page address can be a posting.
   *
   * Share-by-email links carry the posting's URL inside them -
   * "mailto:?body=https://jobs.lenovo.com/..." - so a keyword test on the href
   * matches, and several were stored as job URLs pointing at a mail composer.
   * Guarded here as well as at the anchor filter, so no other path can admit
   * one.
   */
  if (!/^https?:\/\//i.test(href)) return false;
  const t = text.toLowerCase().replace(/[.!?]+$/, "").trim();
  if (t.length < 6 || t.length > 130) return false;
  if (NAV_TITLES.has(t)) return false;
  // Marketing calls to action rather than titles.
  if (/^(click|explore|find|browse|discover|apply now|learn more|get started)\b/i.test(t)) return false;
  if (/[!?]$/.test(text.trim())) return false;
  // Taxonomy pages, which look exactly like postings in the markup:
  // "Security Officer Jobs", "Jobs in Riyadh", "وظائف".
  if (/\b(jobs|vacancies|careers|وظائف)$/i.test(t)) return false;
  if (/^jobs?\s+(in|by|at|for)\b/i.test(t)) return false;
  // "<Role> Jobs in Saudi Arabia" - a search page, not a posting.
  if (/\b(jobs|vacancies)\s+(in|at|near)\b/i.test(t)) return false;
  // Location breadcrumbs such as "Bahrain / Manama".
  if (t.split(/\s+/).length <= 4 && GULF_PLACE.test(t) && /[·/|,–-]/.test(t)) return false;
  // A title is at least two words (Arabic included).
  if (!/\s/.test(t)) return false;

  // Detail pages: a numeric id, or a long hyphenated slug after /job(s)/.
  const hasId = /[-/](\d{4,})(?:[/?#]|$)/.test(href);
  const hasSlug = /\/(jobs?|careers?|vacancy|vacancies|position)\/[a-z0-9][a-z0-9-]{10,}/i.test(href);
  return hasId || hasSlug;
}

/** Gulf places generally, used to spot location breadcrumbs posing as titles. */
const GULF_PLACE =
  /\b(bahrain|manama|kuwait|qatar|doha|dubai|abu dhabi|uae|oman|muscat|egypt|cairo|jordan|amman|lebanon|iraq|riyadh|jeddah|saudi)\b/i;

const CITY_RE =
  /\b(riyadh|jeddah|dammam|al khobar|khobar|dhahran|jubail|yanbu|makkah|mecca|medina|madinah|tabuk|neom|abha|qassim|buraidah|hail|jazan|najran|taif|saudi arabia)\b/i;

function locationFrom(context: string): string {
  return context.match(CITY_RE)?.[1] ?? "";
}

/**
 * Listing rows usually read "<title> <company> <city> <date>". The company is
 * whatever sits between the two, when the row is shaped that way.
 */
function companyFrom(context: string): string | null {
  const m = context.match(/·\s*([^·]{3,60}?)\s*·/) ?? context.match(/\|\s*([^|]{3,60}?)\s*\|/);
  const candidate = m?.[1]?.trim();
  if (!candidate || CITY_RE.test(candidate) || /^\d/.test(candidate)) return null;
  return candidate;
}
