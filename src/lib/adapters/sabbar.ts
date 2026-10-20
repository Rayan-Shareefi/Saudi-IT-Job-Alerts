import { reserve } from "../budget";
import { fetchAllRows, supabaseAdmin } from "../db";
import { envInt } from "../env";
import { getText, htmlToText, sleep, toIso } from "../http";
import type { RawJob, SourceDefinition } from "../types";

/**
 * Sabbar (sabbar.com), a Saudi job platform.
 *
 * Its robots.txt allows everything and publishes a sitemap of every job -
 * 16,180 on 2026-10-20 - whose URLs name the city and the role
 * (/en/jobs/c-riyadh-r-cyber-security-engineer/id-<uuid>), and every job page
 * carries a schema.org JobPosting: full text, employer, posted date, closing
 * date. So a pass:
 *
 *   1. reads the sitemap - at most twice a day, it is 7 MB;
 *   2. keeps Riyadh (or nationwide) jobs whose role looks like security,
 *      cloud or a student programme, changed in the last 30 days;
 *   3. opens only the ones not stored yet (60 a pass, ~2 s apart);
 *   4. reports the stored ones again from storage, so they stay listed while
 *      Sabbar lists them, and retire when it stops.
 *
 * Every posting then goes through the same rules and jury as any other; the
 * URL filter only decides which pages are worth opening.
 */

export class NotDue extends Error {
  constructor(why: string) {
    super(`not due yet: ${why}`);
    this.name = "NotDue";
  }
}

const SITEMAP = "https://sabbar.com/en/jobs/sitemaps/job-details.xml";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

/** Roles worth opening, read from the URL's role part (English or Arabic). */
const ROLE = /cyber|secur|\bsoc\b|siem|grc|penetration|pentest|vulnerab|threat|incident|forensic|\biam\b|identity|cloud|devops|devsecops|\bsre\b|site-reliability|\baws\b|azure|\bgcp\b|kubernetes|سيبران|أمن-المعلومات|امن-المعلومات|سحاب/;
const STUDENT = /intern|trainee|co-?op|graduate|تدريب|متدرب|خريج/;
/* In Saudi listings "security officer" is mostly guarding; information
   security officers keep their qualifier, so only the bare forms are dropped. */
const GUARDING = /guard|حارس|safety|سلامة|security-officer|security-supervisor|security-guard/;
const IT_QUALIFIER = /information|cyber|\bit-|network|cloud|data-security/;

export interface SitemapJob {
  url: string;
  id: string;
  city: string | null;
  role: string;
  lastmod: string | null;
}

/** Every job URL in the sitemap, with its city and role. Exported for tests. */
export function parseSitemap(xml: string): SitemapJob[] {
  const out: SitemapJob[] = [];
  for (const block of xml.split("<url>").slice(1)) {
    const url = block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
    if (!url) continue;
    const m = url.match(/\/jobs\/([^/]+)\/id-([0-9a-f-]{36})/i);
    if (!m) continue;
    let slug = m[1];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      /* keep it encoded */
    }
    const parts = slug.match(/^(?:c-(.+?)-)?r-(.+)$/);
    if (!parts) continue;
    out.push({ url, id: m[2].toLowerCase(), city: parts[1] ?? null, role: parts[2].toLowerCase(), lastmod: block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? null });
  }
  return out;
}

/** Worth opening: a Riyadh or nationwide job whose role looks like ours. Exported for tests. */
export function worthOpening(j: SitemapJob, now = Date.now()): "role" | "student" | null {
  if (j.city && !/riyadh|الرياض/.test(j.city)) return null;
  if (j.lastmod && now - Date.parse(j.lastmod) > 30 * 86_400_000) return null;
  if (GUARDING.test(j.role) && !IT_QUALIFIER.test(j.role)) return null;
  if (ROLE.test(j.role)) return "role";
  if (STUDENT.test(j.role)) return "student";
  return null;
}

interface LdPosting {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressCountry?: string } } | Array<{ address?: { addressLocality?: string } }>;
}

/** The JobPosting on a job page. Exported for tests. */
export function parseJobPage(html: string): LdPosting | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]) as LdPosting | LdPosting[];
      const list = Array.isArray(j) ? j : [j];
      const p = list.find((x) => (Array.isArray(x["@type"]) ? x["@type"].includes("JobPosting") : x["@type"] === "JobPosting"));
      if (p?.title) return p;
    } catch {
      /* the next block */
    }
  }
  return null;
}

export const sabbar = async (source: SourceDefinition): Promise<RawJob[]> => {
  // The sitemap is 7 MB: read it at most twice a day, whichever machine asks.
  if (!(await reserve("sabbar-sitemap"))) throw new NotDue("Sabbar's job list is read at most twice a day");
  const listed = parseSitemap(await getText(SITEMAP, { headers: HEADERS, timeoutMs: 60_000 }));
  const wanted = listed
    .map((j) => ({ j, why: worthOpening(j) }))
    .filter((x): x is { j: SitemapJob; why: "role" | "student" } => x.why !== null);

  const stored = new Map<string, RawJob>();
  try {
    const rows = await fetchAllRows<Record<string, unknown>>(
      (from, to) =>
        supabaseAdmin()
          .from("jobs")
          .select("external_id,title,company,location_text,description_text,url,posted_at,closes_at,employment_type")
          .eq("source_id", source.id)
          .range(from, to),
      "stored Sabbar jobs",
    );
    for (const r of rows) {
      stored.set(String(r.external_id), {
        sourceId: source.id,
        externalId: String(r.external_id),
        title: String(r.title),
        company: String(r.company),
        locationText: String(r.location_text ?? ""),
        descriptionText: String(r.description_text ?? ""),
        url: String(r.url),
        postedAt: (r.posted_at as string) ?? null,
        closesAt: (r.closes_at as string) ?? null,
        employmentType: (r.employment_type as string) ?? null,
        publisher: "Sabbar",
      });
    }
  } catch {
    /* nothing stored yet */
  }

  const out: RawJob[] = [];
  const fresh: SitemapJob[] = [];
  for (const { j } of wanted.sort((a, b) => (a.why === b.why ? String(b.j.lastmod).localeCompare(String(a.j.lastmod)) : a.why === "role" ? -1 : 1))) {
    const known = stored.get(`sb:${j.id}`);
    if (known) out.push(known);
    else fresh.push(j);
  }

  const maxNew = envInt("SABBAR_MAX_NEW", 60);
  let failures = 0;
  for (const j of fresh.slice(0, maxNew)) {
    if (!(await reserve("sabbar"))) break;
    try {
      const p = parseJobPage(await getText(j.url, { headers: HEADERS, timeoutMs: 30_000, retries: 1 }));
      if (!p) continue;
      const loc = Array.isArray(p.jobLocation) ? p.jobLocation[0]?.address : p.jobLocation?.address;
      const city = loc?.addressLocality?.trim() || (j.city ? j.city.replace(/-/g, " ") : "");
      out.push({
        sourceId: source.id,
        externalId: `sb:${j.id}`,
        title: htmlToText(p.title ?? ""),
        company: (p.hiringOrganization?.name ?? "").trim() || "Unknown",
        locationText: [city, "Saudi Arabia"].filter(Boolean).join(", "),
        descriptionText: htmlToText(p.description ?? ""),
        url: j.url,
        postedAt: toIso(p.datePosted ?? null),
        closesAt: toIso(p.validThrough ?? null),
        employmentType: Array.isArray(p.employmentType) ? p.employmentType.join(", ") : (p.employmentType ?? null),
        publisher: "Sabbar",
      });
    } catch {
      if (++failures >= 5) break; // the site is having a bad moment; the rest wait for the next pass
    }
    await sleep(1500 + Math.floor(Math.random() * 1000));
  }
  console.log(`  Sabbar: ${listed.length} jobs listed, ${wanted.length} look like ours, ${out.length - Math.min(fresh.length, maxNew)} already stored, opened ${Math.min(fresh.length, maxNew)} new`);
  return out;
};
