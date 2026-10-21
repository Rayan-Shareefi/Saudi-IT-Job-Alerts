/**
 * Large-enterprise recruiting platforms. Most Saudi banks, telcos, energy and
 * giga-project employers sit on one of these four, and they publish to their
 * own tenant well before anything reaches a public board.
 */
import { getJson, getText, htmlToText, mapLimit, toIso } from "../http";
import type { RawJob, SourceDefinition } from "../types";
import type { Adapter } from "./ats";

const SAUDI_HINT = /saudi|ksa|riyadh|jeddah|dammam|khobar|dhahran|neom|mecca|makkah|medina|tabuk|jubail|yanbu|السعود|الرياض/i;

/* ---------------------------------- Workday ------------------------------ */

interface WdPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

/**
 * A Workday requisition id: "R00344036", "REQ-12345", "JR0091" or a bare
 * number. These share `bulletFields` with the location and must not be
 * mistaken for one.
 */
const WD_REQ_ID = /^[A-Za-z]{0,4}[-_ ]?[0-9][0-9-]*$/;

/** Values Workday tenants put in bulletFields that are not places. */
const WD_NOT_A_PLACE = /^(full|part)[ -]?time$|^regular$|^temporary$|^contract$|^permanent$|^[0-9]+ locations?$/i;

/**
 * Where a Workday posting says it is.
 *
 * `locationsText` is the documented field and most tenants fill it in. Some do
 * not: Accenture's returns `bulletFields: ["R00344036", "Sao Paulo, Torre
 * Paineira"]` and no `locationsText` at all, so every one of its postings
 * arrived with an empty location. That is worse than cosmetic - a posting with
 * no location cannot be shown to be outside Riyadh, so 18 Brazilian roles sat
 * on the board as "not stated" rather than being filtered out.
 *
 * bulletFields is an unlabelled display array, so the place is found by
 * elimination: skip requisition ids and the employment-type strings tenants
 * also put there, and take the first thing left.
 */
function workdayLocation(j: WdPosting): string {
  const stated = (j.locationsText ?? "").trim();
  if (stated && !WD_NOT_A_PLACE.test(stated)) return stated;

  const bullets = Array.isArray(j.bulletFields) ? j.bulletFields : [];
  for (const raw of bullets) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || WD_REQ_ID.test(value) || WD_NOT_A_PLACE.test(value)) continue;
    return value;
  }

  // "2 Locations" is not a place, but it is better than nothing for a reader.
  return stated;
}

/**
 * handle: "<host>/<site>", e.g. "company.wd3.myworkdayjobs.com/External".
 * The CXS endpoint is the same JSON API the Workday careers UI calls.
 */
export const workday: Adapter = async (source) => {
  const [host, ...siteParts] = source.handle.split("/");
  const site = siteParts.join("/");
  const tenant = host.split(".")[0];
  const cxs = `https://${host}/wday/cxs/${tenant}/${site}`;

  const out: RawJob[] = [];
  const seen = new Set<string>();

  const readPages = async (searchText: string): Promise<void> => {
    /*
     * Workday reports `total` on the FIRST page only; every page after it comes
     * back with `total: 0`. Testing `out.length >= data.total` per page
     * therefore ended the walk after two pages, so Accenture's tenant gave up 40
     * of its 2,000 postings and the Riyadh ones were never reached. Learn the
     * total once and hold it.
     */
    let total = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset < 400; offset += 20) {
      const data = await getJson<{ jobPostings?: WdPosting[]; total?: number }>(`${cxs}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }),
      });
      const batch = data.jobPostings ?? [];
      if (offset === 0 && typeof data.total === "number" && data.total > 0) total = data.total;

      for (const j of batch) {
        if (!j.externalPath || seen.has(j.externalPath)) continue;
        seen.add(j.externalPath);
        out.push({
          sourceId: source.id,
          externalId: j.externalPath,
          title: j.title,
          company: source.company ?? source.label,
          locationText: workdayLocation(j),
          descriptionText: "",
          url: `https://${host}/en-US/${site}${j.externalPath}`,
          postedAt: parseWorkdayPostedOn(j.postedOn),
        });
      }
      if (batch.length < 20 || offset + batch.length >= total) break;
    }
  };

  /*
   * Ask Workday where the job is, rather than reading the whole board.
   *
   * Workday's own search matches on location, so a tenant can be asked
   * directly - and the answer is both cheaper and more complete than walking
   * it blind. Accenture's tenant carries 2,000 postings; the unfiltered walk
   * reaches 400 of them and none are Saudi, while the search returns exactly
   * the 18 in Riyadh, among them an Identity Management Consultant.
   */
  for (const term of ["Riyadh", "Saudi Arabia"]) {
    try {
      await readPages(term);
    } catch {
      /* a tenant that rejects a search still gets the walk below */
    }
  }

  /*
   * The unfiltered walk, for tenants where reading everything is the point.
   *
   * On a Saudi tenant the whole board is in scope, so it runs unconditionally.
   * On a global one it is skipped, because the first 400 postings of a 2,000
   * posting international board are 400 roles in Kronberg, Bogota and
   * Newcastle - none of them Saudi, none of them recognised by name, and so
   * all of them stored as "location not stated" on a Riyadh board.
   *
   * It still runs when the scoped searches found nothing at all, which is the
   * signal that this tenant's search cannot be relied on.
   */
  if (source.region !== "global" || out.length === 0) await readPages("");
  // Descriptions live behind a per-posting call; only spend it on Saudi rows.
  // Unplaced rows too: the posting itself often says where it is. Raised from
  // 60 on 2026-10-13 - the full posting is what the scope and years checks read.
  const saudi = out.filter((j) => SAUDI_HINT.test(j.locationText ?? "") || !(j.locationText ?? "").trim());
  await mapLimit(saudi.slice(0, 200), 4, async (job) => {
    try {
      const detail = await getJson<{ jobPostingInfo?: { jobDescription?: string } }>(
        `${cxs}${job.externalId}`,
      );
      job.descriptionText = htmlToText(detail.jobPostingInfo?.jobDescription ?? "");
    } catch {
      /* best effort */
    }
  });

  return out;
};

/** Workday returns "Posted 3 Days Ago" / "Posted Today" rather than a date. */
function parseWorkdayPostedOn(text: string | undefined): string | null {
  if (!text) return null;
  const now = Date.now();
  const day = 86_400_000;
  if (/today/i.test(text)) return new Date(now).toISOString();
  if (/yesterday/i.test(text)) return new Date(now - day).toISOString();
  const m = text.match(/(\d+)\+?\s*(day|week|month)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === "day" ? day : unit === "week" ? day * 7 : day * 30;
  return new Date(now - n * mult).toISOString();
}

/* ------------------------------- Oracle Cloud ---------------------------- */

interface OracleReq {
  Id: string;
  Title: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  ShortDescriptionStr?: string;
  ExternalDescriptionStr?: string;
  JobFamily?: string;
}

/**
 * handle: "<host>|<siteNumber>|<siteName>", e.g.
 * "ecab.fa.em2.oraclecloud.com|CX_1001|CareerSite".
 */
export const oraclecloud: Adapter = async (source) => {
  const [host, siteNumber, siteName] = source.handle.split("|");
  const out: RawJob[] = [];

  for (let offset = 0; offset < 400; offset += 100) {
    const url =
      `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
      `?onlyData=true&expand=requisitionList.secondaryLocations` +
      `&finder=findReqs;siteNumber=${siteNumber},limit=100,offset=${offset},sortBy=POSTING_DATES_DESC`;
    const data = await getJson<{
      items?: Array<{ requisitionList?: OracleReq[]; TotalJobsCount?: number }>;
    }>(url);

    const batch = data.items?.[0]?.requisitionList ?? [];
    for (const j of batch) {
      out.push({
        sourceId: source.id,
        externalId: j.Id,
        title: j.Title,
        company: source.company ?? source.label,
        locationText: j.PrimaryLocation ?? "",
        descriptionText: htmlToText(j.ExternalDescriptionStr ?? j.ShortDescriptionStr ?? ""),
        url: `https://${host}/hcmUI/CandidateExperience/en/sites/${siteName}/job/${j.Id}`,
        postedAt: toIso(j.PostedDate),
        department: j.JobFamily ?? null,
      });
    }
    if (batch.length < 100) break;
  }
  return out;
};

/* ------------------------------- SAP SuccessFactors ---------------------- */

/**
 * handle: full career-site search URL. SF renders server-side, so the listing
 * markup is parsed rather than an API called. Layouts vary by tenant, so this
 * matches the two anchor shapes SF has shipped rather than one rigid selector.
 */
export const successfactors: Adapter = async (source) => {
  const base = new URL(source.handle).origin;
  const out: RawJob[] = [];
  const seen = new Set<string>();

  /*
   * Every results page, not just the first. These career sites show 25 jobs
   * a page and take the rest with `startrow` (the user, 2026-10-21: "the
   * first page only shows 10 jobs, the second page shows another 10"). Stops
   * at the first page that adds nothing new, or after 12 pages.
   */
  for (let pageNo = 0; pageNo < 12; pageNo++) {
    const before = out.length;
    const url = pageNo === 0 ? source.handle : withStartRow(source.handle, out.length);
    const html = await getText(url).catch((err) => {
      if (pageNo === 0) throw err;
      return "";
    });
    readSuccessFactorsPage(html, base, source, seen, out);
    if (out.length === before) break;
  }
  return out;
};

function withStartRow(handle: string, startrow: number): string {
  const u = new URL(handle);
  u.searchParams.set("startrow", String(startrow));
  return u.toString();
}

function readSuccessFactorsPage(html: string, base: string, source: SourceDefinition, seen: Set<string>, out: RawJob[]): void {
  const anchorRe =
    /<a[^>]+href="([^"]*\/job\/[^"]*?)"[^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1].startsWith("http") ? m[1] : `${base}${m[1]}`;
    const title = htmlToText(m[2]).trim();
    if (!title || title.length < 3 || seen.has(href)) continue;
    seen.add(href);
    // SF puts the location in a sibling cell; grab the surrounding row text.
    const rowStart = Math.max(0, m.index - 400);
    const context = htmlToText(html.slice(rowStart, m.index + m[0].length + 400));
    out.push({
      sourceId: source.id,
      externalId: href.split("/job/")[1]?.split(/[?#]/)[0] ?? href,
      title,
      company: source.company ?? source.label,
      locationText: SAUDI_HINT.test(context) ? extractSaudiCity(context) : "",
      descriptionText: context,
      url: href,
      postedAt: null,
    });
  }
}

/* ------------------------------------ Taleo ------------------------------ */

/**
 * handle: "<host>|<portalCode>". Taleo's jobboard REST endpoint is what the
 * career-section UI itself posts to.
 */
export const taleo: Adapter = async (source) => {
  const [host, portal] = source.handle.split("|");
  const out: RawJob[] = [];

  for (let page = 1; page <= 5; page++) {
    const data = await getJson<{
      requisitionList?: Array<{
        contestNo?: string;
        jobId?: string;
        column?: string[];
        descriptionTeaser?: string;
      }>;
      pagingData?: { totalCount?: number };
    }>(`https://${host}/careersection/rest/jobboard/searchjobs?lang=en&portal=${portal}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", tzname: "Asia/Riyadh" },
      body: JSON.stringify({
        multilineEnabled: false,
        sortingSelection: { sortBySelectionParam: "3", ascendingSortingOrder: "false" },
        fieldData: { fields: {}, valid: true },
        filterSelectionParam: { searchFilterSelections: [] },
        advancedSearchFiltersSelectionParam: { searchFilterSelections: [] },
        pageNo: page,
      }),
    });

    const batch = data.requisitionList ?? [];
    for (const j of batch) {
      const cols = j.column ?? [];
      out.push({
        sourceId: source.id,
        externalId: String(j.jobId ?? j.contestNo ?? cols[0]),
        title: cols[0] ?? "",
        company: source.company ?? source.label,
        locationText: cols.slice(1).find((c) => SAUDI_HINT.test(c ?? "")) ?? cols[1] ?? "",
        descriptionText: htmlToText(j.descriptionTeaser ?? ""),
        url: `https://${host}/careersection/${portal}/jobdetail.ftl?job=${j.jobId ?? j.contestNo}`,
        postedAt: null,
      });
    }
    if (batch.length === 0) break;
  }
  return out.filter((j) => j.title);
};

function extractSaudiCity(text: string): string {
  const m = text.match(
    /(riyadh|jeddah|dammam|al khobar|khobar|dhahran|neom|jubail|yanbu|makkah|mecca|medina|tabuk|saudi arabia)/i,
  );
  return m ? m[1] : "Saudi Arabia";
}

export const enterpriseAdapters: Record<string, Adapter> = {
  workday,
  oraclecloud,
  successfactors,
  taleo,
};
