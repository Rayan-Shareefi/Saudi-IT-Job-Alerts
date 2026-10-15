import * as cheerio from "cheerio";
import { reserve } from "../budget";
import { supabaseAdmin } from "../db";
import { envFlag, envInt } from "../env";
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

const SEARCHES = [
  "cybersecurity",
  "information security",
  "SOC analyst",
  "GRC cybersecurity",
  "penetration testing",
  "security engineer",
  "cloud engineer",
  "cloud security",
  "DevOps engineer",
  "cybersecurity internship",
  "cooperative training",
  "أمن سيبراني",
];

const LOCATION = "Riyadh, Riyadh, Saudi Arabia";
const BASE = "https://www.linkedin.com/jobs-guest/jobs/api";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  accept: "text/html,application/xhtml+xml",
};

export class LinkedInRefused extends Error {
  constructor(why: string) {
    super(`LinkedIn refused (${why}); stopped for this run, not retried`);
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

/* ------------------------------- fetching --------------------------------- */

let lastRequest = 0;
async function gentleGet(url: string): Promise<string> {
  const gap = envInt("LINKEDIN_DELAY_MS", 4000) + Math.floor(Math.random() * 2500);
  const wait = lastRequest + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  if (!(await reserve("linkedin"))) throw new LinkedInRefused("this app's daily LinkedIn budget is used up");
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (res.status === 429 || res.status === 999) throw new LinkedInRefused(`HTTP ${res.status}`);
  if (/authwall|\/login|checkpoint|uas\/login/i.test(res.url)) throw new LinkedInRefused("redirected to a login page");
  if (!res.ok) throw new Error(`LinkedIn HTTP ${res.status}`);
  return res.text();
}

/** Stored full texts for listings already read, so they are not fetched again. */
async function alreadyRead(sourceId: string): Promise<Map<string, string>> {
  try {
    const { data } = await supabaseAdmin()
      .from("jobs")
      .select("external_id,description_text,text_quality")
      .eq("source_id", sourceId)
      .in("text_quality", ["full", "partial"])
      .limit(5000);
    return new Map((data ?? []).map((r) => [String(r.external_id), String(r.description_text ?? "")]));
  } catch {
    return new Map();
  }
}

export const linkedin = async (source: SourceDefinition): Promise<RawJob[]> => {
  if (!envFlag("LINKEDIN_ENABLED")) {
    throw new MissingCredential("LINKEDIN_ENABLED=1 (LinkedIn is read from the laptop only)");
  }
  const maxDetail = envInt("LINKEDIN_MAX_DETAIL", 120);
  const pages = envInt("LINKEDIN_PAGES", 2);
  const known = await alreadyRead(source.id);

  const cards = new Map<string, LinkedInCard>();
  let emptyPages = 0;
  for (const q of SEARCHES) {
    for (let page = 0; page < pages; page++) {
      const url =
        `${BASE}/seeMoreJobPostings/search?keywords=${encodeURIComponent(q)}` +
        `&location=${encodeURIComponent(LOCATION)}&f_TPR=r2592000&start=${page * 25}`;
      const found = parseSearch(await gentleGet(url));
      if (found.length === 0) {
        // Two empty pages in a row on searches that normally return results is
        // what a soft block looks like; stop rather than keep asking.
        if (++emptyPages >= 4) throw new LinkedInRefused("several result pages came back empty");
        break;
      }
      emptyPages = 0;
      for (const c of found) cards.set(c.id, c);
      if (found.length < 10) break;
    }
  }

  const out: RawJob[] = [];
  let fetched = 0;
  for (const c of cards.values()) {
    const externalId = `li:${c.id}`;
    let text = known.get(externalId) ?? "";
    let applyUrl: string | null = null;
    let employmentType: string | null = null;
    if (!text && fetched < maxDetail) {
      fetched++;
      const detail = parseDetail(await gentleGet(`${BASE}/jobPosting/${c.id}`));
      if (detail?.closed) continue;
      if (detail) {
        // LinkedIn's own fields are appended as labelled lines, so the
        // experience reader can see "Employment type: Internship".
        const meta = Object.entries(detail.criteria).map(([k, v]) => `${k}: ${v}.`).join(" ");
        text = `${detail.description}\n\n${meta}`.trim();
        applyUrl = detail.applyUrl;
        employmentType = detail.criteria["Employment type"] ?? null;
      }
    }
    out.push({
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
  }
  return out;
};
