import { reserve } from "../budget";
import { envInt } from "../env";
import { getJson, htmlToText, sleep, toIso } from "../http";
import type { RawJob, SourceDefinition } from "../types";
import type { Adapter } from "./ats";

/**
 * Workable's public job search, limited to Riyadh: postings from every
 * employer that hires through Workable - including the ones nobody has added
 * to the registry yet. On 2026-10-17 its first page held a Riyadh security
 * intern role at COGNNA and cloud/security roles at JODAYN, Mozn and Qiddiya,
 * none of them tracked.
 *
 * Free, no key, JSON, and each result carries the full posting, so nothing
 * has to be opened twice. Every employer found here is also a candidate for
 * scripts/discover-employers.ts, which adds its own board as a source.
 *
 * English terms only: an Arabic query returned nothing (Workable postings in
 * Riyadh are written in English).
 */

const QUERIES = ["cybersecurity", "security", "SOC", "cloud", "cloud security", "intern", "internship", "graduate", "co-op"];
const LOCATION = "Riyadh";
const BASE = "https://jobs.workable.com/api/v1/jobs";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  accept: "application/json",
};

interface SearchJob {
  id: string;
  title: string;
  description?: string;
  requirementsSection?: string;
  benefitsSection?: string;
  department?: string;
  employmentType?: string;
  url: string;
  created?: string;
  updated?: string;
  locations?: string[];
  location?: { city?: string; subregion?: string; countryName?: string };
  company?: { title?: string; website?: string };
}

interface SearchPage {
  jobs?: SearchJob[];
  nextPageToken?: string | null;
  totalSize?: number;
}

/** One result as a posting; null when it is not in Saudi Arabia. Exported for tests. */
export function toRawJob(sourceId: string, j: SearchJob): RawJob | null {
  const country = j.location?.countryName ?? "";
  const place = j.locations?.[0] ?? [j.location?.city, j.location?.subregion, country].filter(Boolean).join(", ");
  if (!/saudi/i.test(`${country} ${place}`)) return null;
  const text = [j.description, j.requirementsSection, j.benefitsSection].filter(Boolean).map((h) => htmlToText(h as string)).join("\n\n");
  return {
    sourceId,
    externalId: `wk:${j.id}`,
    title: htmlToText(j.title),
    company: (j.company?.title ?? "").trim() || "Unknown",
    locationText: place,
    descriptionText: text,
    url: j.url,
    postedAt: toIso(j.created ?? j.updated ?? null),
    department: j.department || null,
    employmentType: j.employmentType || null,
    publisher: "Workable",
  };
}

export const workableSearch: Adapter = async (source: SourceDefinition) => {
  const pages = envInt("WORKABLE_SEARCH_PAGES", 3);
  const seen = new Map<string, RawJob>();
  const errors: string[] = [];
  let attempts = 0;
  for (const q of QUERIES) {
    let token: string | null = null;
    for (let page = 0; page < pages; page++) {
      if (!(await reserve("workable"))) {
        console.warn("  workable search: daily budget used up - stopping here");
        return [...seen.values()];
      }
      attempts++;
      const url: string = `${BASE}?query=${encodeURIComponent(q)}&location=${encodeURIComponent(LOCATION)}${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
      try {
        const res: SearchPage = await getJson<SearchPage>(url, { headers: HEADERS, timeoutMs: 20_000 });
        for (const j of res.jobs ?? []) {
          const job = toRawJob(source.id, j);
          if (job) seen.set(job.externalId, job);
        }
        token = res.nextPageToken ?? null;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        break;
      }
      if (!token) break;
      await sleep(1500 + Math.floor(Math.random() * 1000));
    }
  }
  // Every request failing is an outage, not "no jobs": throwing keeps the
  // stored rows instead of retiring them all (see aggregators.ts).
  if (attempts > 0 && errors.length === attempts) throw new Error(`Workable search: all ${attempts} requests failed - first error: ${errors[0]}`);
  return [...seen.values()];
};
