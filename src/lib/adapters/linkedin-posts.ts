import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envFlag, envInt, envStr } from "../env";
import { sleep } from "../http";
import { namesARole } from "../plausible";
import type { RawJob, SourceDefinition } from "../types";
import { MissingCredential } from "./aggregators";

/**
 * Company "we're hiring" posts on LinkedIn - vacancies that never become a job
 * listing. Read with the user's SECONDARY LinkedIn account, on the laptop.
 *
 * The user chose this knowingly (2026-10-13): LinkedIn's terms discourage
 * automation and the secondary account carries the risk, which is why it is
 * not the main one. To keep that risk small the reader is slow and read-only:
 * a handful of searches, a few page views, long pauses, no likes, no
 * messages, no connection requests - and it stops at the first sign of a
 * challenge rather than trying to get past it.
 *
 * Sign-in: a saved browser profile keeps the session for months. If it has
 * expired, the reader signs in again with LINKEDIN_EMAIL / LINKEDIN_PASSWORD,
 * which the user typed into the laptop's .env.local themselves. A
 * verification code or CAPTCHA is never answered by code - the run stops and
 * the user is emailed to clear it by hand (npm run linkedin:login).
 *
 * Privacy: the names of people who post are never stored. Only the post text,
 * its link, the company when the post comes from a company page, and links in
 * the post (an application form is the time-sensitive signal).
 */

export const PROFILE_DIR = envStr("LINKEDIN_PROFILE_DIR") ?? join(process.cwd(), ".linkedin-profile");

const SEARCHES = [
  "hiring cybersecurity Riyadh",
  "hiring SOC analyst Riyadh",
  "hiring cloud engineer Riyadh",
  "cybersecurity internship Riyadh",
  "co-op cybersecurity Riyadh",
  "تدريب تعاوني أمن سيبراني",
  "توظيف أمن سيبراني الرياض",
  "hiring GRC Riyadh",
];

const HIRING = /\b(hiring|we('| a)re looking|join (our|the) team|vacanc|open (role|position)|opportunit|apply|internship|co-?op|graduate program)\b|نبحث|توظيف|فرصه|فرصة|وظيف|تدريب تعاوني|شاغر/i;

export class LinkedInChallenge extends Error {
  constructor(why: string) {
    super(`LinkedIn needs you: ${why}. On the laptop, open "Saudi Job Alert" (desktop) and press L to sign in.`);
    this.name = "LinkedInChallenge";
  }
}

/** The first sentence or line of a post that names a role, as its title. */
export function postTitle(text: string): string | null {
  const lines = text
    .split(/\n+|(?<=[.!?؟])\s+/)
    .map((l) => l.replace(/[#*•|]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 6);
  const hit = lines.find((l) => namesARole(l) && l.length <= 160);
  return hit ? hit.replace(/^[^\p{L}\p{N}]+/u, "").slice(0, 140) : null;
}

interface ScrapedPost {
  urn: string;
  text: string;
  companyName: string | null;
  links: string[];
}

/** In-page extraction, as a string: esbuild's __name helper breaks evaluate(fn) (HANDOVER §5.3). */
const EXTRACT = `(() => {
  const out = [];
  const nodes = document.querySelectorAll('[data-urn^="urn:li:activity:"], [data-id^="urn:li:activity:"]');
  for (const n of nodes) {
    const urn = n.getAttribute('data-urn') || n.getAttribute('data-id') || '';
    const textEl = n.querySelector('.update-components-text, .feed-shared-inline-show-more-text, .feed-shared-text');
    const text = (textEl ? textEl.innerText : n.innerText || '').trim();
    const actorLink = n.querySelector('a.update-components-actor__meta-link, a.update-components-actor__image, .update-components-actor a');
    const href = actorLink ? actorLink.getAttribute('href') || '' : '';
    const nameEl = n.querySelector('.update-components-actor__title span[aria-hidden="true"], .update-components-actor__name span[aria-hidden="true"], .update-components-actor__title');
    const isCompany = /\\/company\\//.test(href);
    const links = [...(textEl ? textEl.querySelectorAll('a[href]') : [])].map(a => a.href).filter(h => !/linkedin\\.com\\/(in|feed|search|company)\\//.test(h));
    out.push({ urn, text, companyName: isCompany && nameEl ? nameEl.innerText.trim() : null, links });
  }
  return out;
})()`;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ensureSignedIn(page: any): Promise<void> {
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);
  if (!/login|authwall|checkpoint|signup/i.test(page.url())) return;

  const email = envStr("LINKEDIN_EMAIL");
  const password = envStr("LINKEDIN_PASSWORD");
  if (!email || !password) throw new LinkedInChallenge("the saved session has expired and no LINKEDIN_EMAIL / LINKEDIN_PASSWORD is set");
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill("#username", email);
  await sleep(800);
  await page.fill("#password", password);
  await sleep(600);
  await page.click('button[type="submit"]');
  await sleep(8000);
  if (/checkpoint|challenge|captcha|verification/i.test(page.url())) {
    throw new LinkedInChallenge("LinkedIn is asking for a verification step");
  }
  if (/login|authwall/i.test(page.url())) throw new LinkedInChallenge("the sign-in was not accepted");
}

export const linkedinPosts = async (source: SourceDefinition): Promise<RawJob[]> => {
  if (!envFlag("LINKEDIN_POSTS_ENABLED")) {
    throw new MissingCredential("LINKEDIN_POSTS_ENABLED=1 (hiring posts are read on the laptop, with the secondary account)");
  }
  if (!existsSync(PROFILE_DIR)) {
    throw new LinkedInChallenge("no saved LinkedIn session on this machine yet");
  }
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: envStr("LINKEDIN_HEADLESS") !== "0",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  const debugDir = envFlag("LINKEDIN_DEBUG") ? join(process.cwd(), "data", "linkedin-debug") : null;
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await ensureSignedIn(page);

    const posts = new Map<string, ScrapedPost>();
    const maxSearches = envInt("LINKEDIN_POST_SEARCHES", 6);
    for (const q of SEARCHES.slice(0, maxSearches)) {
      const url =
        `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}` +
        `&datePosted=%22past-week%22&sortBy=%22date_posted%22`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(5000 + Math.random() * 4000);
      if (/checkpoint|challenge|login|authwall/i.test(page.url())) throw new LinkedInChallenge("a search page asked for verification");
      // Two slow scrolls load a second batch, as a person reading would.
      for (let i = 0; i < 2; i++) {
        await page.mouse.wheel(0, 1600);
        await sleep(2500 + Math.random() * 2500);
      }
      if (debugDir) {
        mkdirSync(debugDir, { recursive: true });
        writeFileSync(join(debugDir, `${q.replace(/\W+/g, "_")}.html`), await page.content());
      }
      const found = (await page.evaluate(EXTRACT)) as ScrapedPost[];
      for (const p of found) if (p.urn && p.text && !posts.has(p.urn)) posts.set(p.urn, p);
      await sleep(6000 + Math.random() * 6000);
    }

    const out: RawJob[] = [];
    for (const p of posts.values()) {
      if (!HIRING.test(p.text)) continue;
      const title = postTitle(p.text);
      if (!title) continue;
      const id = p.urn.match(/activity:(\d+)/)?.[1] ?? p.urn;
      out.push({
        sourceId: source.id,
        externalId: `post:${id}`,
        title,
        company: p.companyName ?? "Hiring post",
        locationText: "",
        descriptionText: p.text.slice(0, 6000),
        url: `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`,
        applyUrl: p.links[0] ?? null,
        postedAt: null,
        publisher: "LinkedIn post",
      });
    }
    return out;
  } finally {
    await context.close();
  }
};
