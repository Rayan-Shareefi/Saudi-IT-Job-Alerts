import { supabaseAdmin } from "../db";
import { envFlag, envInt } from "../env";
import { imageText, stopOcr } from "../ocr";
import { announcesOpenings } from "../plausible";
import type { RawJob, SourceDefinition } from "../types";
import { MissingCredential } from "./aggregators";
import { LinkedInRefused, gentleGet, withNote } from "./linkedin";
import { HIRING, postTitle } from "./linkedin-posts";

/**
 * LinkedIn company pages, read without signing in.
 *
 * The user (2026-10-21): go through each company's page and read its posts,
 * instead of a feed that mixes in adverts and AI-written posts, and without
 * following a hundred companies on the secondary account. A company's public
 * page (linkedin.com/company/<slug>) carries its ~10 latest posts as
 * schema.org records - text, exact time, link - plus its numeric id, which
 * LinkedIn's public job search filters by (linkedin.ts reads those jobs).
 *
 * The list of companies fills itself from the company named on every
 * LinkedIn job card (linkedin_companies). A pass visits a few, the longest-
 * unvisited first; hiring, co-op and internship posts from the last 30 days
 * are kept, with the text in their pictures read when the post is short. Same
 * pacing and the same rule as every LinkedIn request: stop at the first
 * refusal, keep what was read.
 */

export interface CompanyPage {
  name: string | null;
  orgId: string | null;
  website: string | null;
  posts: Array<{ id: string; text: string; at: string | null; url: string; images: string[] }>;
}

/** A public company page's posts and facts. Exported for tests. */
export function parseCompanyPage(html: string): CompanyPage {
  const objects: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]) as Record<string, unknown>;
      const graph = (j["@graph"] as Array<Record<string, unknown>>) ?? [j];
      objects.push(...graph);
    } catch {
      /* the next block */
    }
  }
  const org = objects.find((o) => o["@type"] === "Organization");
  const posts: CompanyPage["posts"] = [];
  for (const o of objects.filter((x) => x["@type"] === "SocialMediaPosting")) {
    const url = String(o.url ?? "");
    const id = url.match(/activity-(\d{8,})/)?.[1] ?? url.match(/urn:li:activity:(\d{8,})/)?.[1];
    const text = String(o.text ?? o.articleBody ?? "").trim();
    if (!id || !text) continue;
    // The post's own pictures, from its card on the page (not the company logo).
    const at = html.indexOf(`urn:li:activity:${id}`);
    const card = at >= 0 ? html.slice(at, html.indexOf("</article>", at) > at ? html.indexOf("</article>", at) : at + 20000) : "";
    const images = [...new Set([...card.matchAll(/data-delayed-url="(https:\/\/media\.licdn\.com\/dms\/image\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))]
      .filter((u) => /feedshare|image-shrink|articleshare/i.test(u))
      .slice(0, 2);
    posts.push({ id, text, at: typeof o.datePublished === "string" ? o.datePublished : null, url, images });
  }
  return {
    name: typeof org?.name === "string" ? org.name : null,
    orgId: html.match(/urn:li:(?:organization|fsd_company|company):(\d+)/)?.[1] ?? html.match(/[?&]f_C=(\d+)/)?.[1] ?? null,
    website: typeof org?.sameAs === "string" ? org.sameAs : null,
    posts,
  };
}

/** Saudi cities named in a post, as a location line; empty when none is named. */
function locationOf(text: string): string {
  if (/riyadh|الرياض/i.test(text)) return "Riyadh, Saudi Arabia";
  if (/saudi|ksa|المملكة|السعودية/i.test(text)) return "Saudi Arabia";
  return "";
}

export const linkedinCompanies = async (source: SourceDefinition): Promise<RawJob[]> => {
  if (!envFlag("LINKEDIN_ENABLED")) {
    throw new MissingCredential("LINKEDIN_ENABLED=1 (LinkedIn is read from the laptop only)");
  }
  const perRun = envInt("LINKEDIN_COMPANIES_PER_RUN", 6);
  const ocrBudget = envInt("LINKEDIN_OCR_MAX", 10);
  const db = supabaseAdmin();
  const { data: due } = await db
    .from("linkedin_companies")
    .select("slug,name")
    .neq("status", "dead")
    .order("last_visited_at", { ascending: true, nullsFirst: true })
    .order("seen_count", { ascending: false })
    .limit(perRun);

  const out: RawJob[] = [];
  let refusal: LinkedInRefused | null = null;
  let pictures = 0;
  let visited = 0;
  try {
    for (const c of due ?? []) {
      let html: string;
      try {
        html = await gentleGet(`https://www.linkedin.com/company/${encodeURIComponent(String(c.slug))}`);
      } catch (err) {
        if (err instanceof LinkedInRefused) {
          refusal = err;
          break;
        }
        // A page that is not there (renamed, removed): not asked for again.
        if (/HTTP 404/.test(String(err))) await db.from("linkedin_companies").update({ status: "dead", last_visited_at: new Date().toISOString() }).eq("slug", c.slug);
        continue;
      }
      visited++;
      const page = parseCompanyPage(html);
      const company = page.name ?? String(c.name ?? c.slug);
      let found = 0;
      for (const p of page.posts) {
        if (p.at && Date.now() - Date.parse(p.at) > 30 * 86_400_000) continue;
        let text = p.text;
        // A picture and two sentences: the announcement is often only in the picture.
        if (p.images.length && pictures < ocrBudget && (text.length < 600 || !HIRING.test(text) || !postTitle(text))) {
          for (const src of p.images) {
            if (pictures >= ocrBudget) break;
            pictures++;
            try {
              const res = await fetch(src);
              const words = res.ok ? await imageText(Buffer.from(await res.arrayBuffer())) : null;
              if (words) text = `${text}\n\n[Text in the post's picture]\n${words}`;
            } catch {
              /* the post's own text stands */
            }
          }
        }
        if (!HIRING.test(text)) continue;
        const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length >= 8) ?? "";
        const title = postTitle(text) ?? (announcesOpenings(firstLine) ? firstLine.slice(0, 140) : null);
        if (!title) continue;
        found++;
        out.push({
          sourceId: source.id,
          externalId: `post:${p.id}`,
          title,
          company,
          locationText: locationOf(text),
          descriptionText: text.slice(0, 9000),
          url: `https://www.linkedin.com/feed/update/urn:li:activity:${p.id}/`,
          applyUrl: text.match(/https?:\/\/(?!(?:www\.)?linkedin\.com)[^\s)]+/)?.[0] ?? null,
          postedAt: p.at,
          publisher: "LinkedIn post",
        });
      }
      await db
        .from("linkedin_companies")
        .update({ status: "ok", name: company, org_id: page.orgId, website: page.website, last_visited_at: new Date().toISOString(), posts_found: found })
        .eq("slug", c.slug);
    }
  } finally {
    await stopOcr();
  }
  console.log(`  LinkedIn company pages: ${visited} visited, ${out.length} hiring post(s) kept, ${pictures} picture(s) read`);
  if (refusal) {
    if (out.length === 0 && visited === 0) throw refusal;
    return withNote(out, `partial: ${(refusal as LinkedInRefused).message} - kept what ${visited} page(s) showed`);
  }
  return out;
};
