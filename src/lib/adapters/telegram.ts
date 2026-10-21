import { reserve } from "../budget";
import { fetchAllRows, supabaseAdmin } from "../db";
import { envInt, envStr } from "../env";
import { getText, htmlToText, sleep, toIso } from "../http";
import { imageText, stopOcr } from "../ocr";
import type { RawJob, SourceDefinition } from "../types";

/**
 * Saudi job channels on Telegram, read through Telegram's public channel
 * pages (t.me/s/<channel>: the latest 20 posts, no login, no robots.txt).
 *
 * Measured 2026-10-21: four large channels post daily - @ewdifh (1.26M
 * subscribers), @cd4cd (798K), @jobzaty (228K), @fu1sa (106K). They are
 * announcement feeds: "<employer> announces jobs / co-op / Tamheer in several
 * fields", a picture, and a link to an article on the channel's own site,
 * which carries the full text and the official apply link. So a pass, per
 * channel:
 *
 *   1. reads the latest two pages of posts;
 *   2. keeps the ones about technology, security, cloud or a training
 *      programme - restaurants and drivers are dropped here;
 *   3. reads the linked article where the site allows it (jobzaty.com,
 *      wdeftksa.com: a schema.org record with the full text), otherwise the
 *      text printed in the post's picture (OCR) when the post itself is short;
 *   4. reports posts already stored again while they are under 30 days old.
 *
 * Every post then goes through the same rules and jury as any other posting.
 * Many are broad announcements ("IT majors welcome"); those that never name
 * security or cloud duties wait in Unclassified rather than being shown.
 */

interface Channel {
  handle: string;
  /** Articles on the channel's own site that may be read (robots.txt allows it). */
  articles?: RegExp;
}

const CHANNELS: Channel[] = [
  { handle: "jobzaty", articles: /^https?:\/\/(www\.)?jobzaty\.com\/(j|job)\//i },
  { handle: "cd4cd", articles: /^https?:\/\/(www\.)?wdeftksa\.com\/sa\/jobs\//i },
  // ewdifh.com refused the connection (2026-10-21): its posts and pictures only.
  { handle: "ewdifh" },
  { handle: "fu1sa" },
];

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  "accept-language": "ar,en;q=0.8",
};

/** Worth a closer look: technology, security or cloud, in Arabic or English. */
const TECH =
  /سيبران|أمن المعلومات|امن المعلومات|تقنية المعلومات|التخصصات التقنية|تقني|الحاسب|حاسب آلي|علوم الحاسب|نظم المعلومات|الشبكات|سحاب|cyber|security|cloud|devops|\bIT\b|information technology|computer science|software|network/i;

/** A post announcing openings or a programme, whose fields the article lists. */
const ANNOUNCEMENT = /تعلن|يعلن|وظائف|وظيفة|فرص|فرصة|شاغر|تدريب|برنامج|تمهير|توظيف|hiring|vacanc|jobs|opening|internship|program/i;

/** Saudi cities an announcement may list, Arabic and English. "المدينة" alone means "the city", so only the full name counts. */
const CITIES: Array<[RegExp, string]> = [
  [/الرياض|riyadh/i, "Riyadh"],
  [/جدة|jeddah/i, "Jeddah"],
  [/الدمام|dammam/i, "Dammam"],
  [/الخبر|khobar/i, "Al Khobar"],
  [/الظهران|dhahran/i, "Dhahran"],
  [/مكة|makkah|mecca/i, "Makkah"],
  [/المدينة المنورة|madinah|medina/i, "Madinah"],
  [/الطائف|taif/i, "Taif"],
  [/تبوك|tabuk/i, "Tabuk"],
  [/أبها|ابها|abha/i, "Abha"],
  [/حائل|\bhail\b/i, "Hail"],
  [/بريدة|القصيم|buraydah|qassim/i, "Qassim"],
  [/جازان|jazan/i, "Jazan"],
  [/نجران|najran/i, "Najran"],
  [/الجبيل|jubail/i, "Jubail"],
  [/ينبع|yanbu/i, "Yanbu"],
  [/الخرج|kharj/i, "Al Kharj"],
  [/الأحساء|الاحساء|ahsa/i, "Al Ahsa"],
  [/رابغ|rabigh/i, "Rabigh"],
  [/حفر الباطن|hafar/i, "Hafar Al Batin"],
  [/الجوف|jouf/i, "Al Jouf"],
  [/نيوم|neom/i, "NEOM"],
];

export interface ChannelPost {
  id: string;
  text: string;
  links: string[];
  photo: string | null;
  at: string | null;
}

/** The posts on one t.me/s page, oldest first, and the id to ask for older ones. Exported for tests. */
export function parseChannelPage(html: string, handle: string): { posts: ChannelPost[]; before: string | null } {
  const posts: ChannelPost[] = [];
  for (const block of html.split('class="tgme_widget_message_wrap').slice(1)) {
    const id = block.match(/data-post="[^"/]+\/(\d+)"/)?.[1];
    if (!id) continue;
    const body = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const links = [...body.matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1].replace(/&amp;/g, "&"))
      .filter((u) => /^https?:\/\//.test(u) && !/^https?:\/\/(t\.me|telegram\.me|api\.whatsapp\.com|wa\.me|x\.com|twitter\.com)\//i.test(u));
    posts.push({
      id,
      // Line by line: htmlToText joins lines, and the post's lines matter
      // (the headline, one city per line).
      text: body
        .split(/<br\s*\/?>/i)
        .map((line) => htmlToText(line))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      links: [...new Set(links)],
      photo: block.match(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/)?.[1] ?? null,
      at: block.match(/<time datetime="([^"]+)"/)?.[1] ?? null,
    });
  }
  const before = html.match(new RegExp(`href="/s/${handle}\\?before=(\\d+)"`, "i"))?.[1] ?? null;
  return { posts, before };
}

/** The post's headline: its first line that says something, without the decoration. Exported for tests. */
export function headline(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw
      .replace(/^[^\p{L}\p{N}]*\([^)]{0,40}\)\s*/u, "") // "(حكومي)", "(🔴)", "(توظيف مباشر - عاجل)"
      .replace(/^[^\p{L}\p{N}]+/u, "")
      // "عاااجل |", "هام:", "جديد -", "توظيف حكومي 🌟": urgency labels, not the headline.
      .replace(/^(?:عا+جل|هام|جديد|توظيف حكومي|urgent|new)(?=[\s|:\-–🌟]|$)[\s|:\-–🌟]*/iu, "")
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line.length >= 8) return line.slice(0, 140);
  }
  return "";
}

/** The employer, where the announcement names it: "شركة بنده تعلن", "فتح التوظيف لدى X في". Exported for tests. */
export function employerOf(text: string): string | null {
  const t = headline(text);
  // Whole words only: "لدى شركة بنده في" must not stop at the "ب" of "بنده".
  // (\b does not work for Arabic letters, so the next character is checked.)
  const end = String.raw`(?=[\s(:،.\-]|$)`;
  const m =
    t.match(new RegExp(String.raw`لدى\s+(.{2,60}?)\s+(?:في|فى|بعدة|بمختلف|لحملة|للجنسين|عن)${end}`)) ??
    t.match(/لدى\s+(.{2,60}?)\s*[(:،.\-]/) ??
    t.match(new RegExp(String.raw`^(.{2,60}?)\s+(?:تعلن|يعلن|تفتح|يفتح|توفر|يوفر|تطلق|يطلق|تبدأ|يبدأ)${end}`)) ??
    t.match(/^(.{2,60}?)\s+is\s+hiring/i);
  const name = m?.[1]?.replace(/^(فتح التوظيف|التوظيف)\s+/, "").trim();
  return name && name.length >= 2 ? name : null;
}

/** "All regions of the Kingdom" - which includes Riyadh. "Several cities" does not say which. */
const ALL_REGIONS = /جميع المناطق|جميع مناطق|كافة المناطق|كافة مناطق|جميع مدن المملكة|كافة مدن المملكة|all regions|across the kingdom|all cities/i;

/**
 * The cities a post or article names, as a location line. These are Saudi
 * channels, so a post naming no city is "Saudi Arabia" - the city unproven,
 * which waits in Unclassified rather than being hidden or guessed. Exported
 * for tests.
 */
export function citiesOf(text: string): string {
  const found = CITIES.filter(([re]) => re.test(text)).map(([, name]) => name);
  if (found.length) return `${found.join(", ")}, Saudi Arabia`;
  if (ALL_REGIONS.test(text)) return "Riyadh (all regions of the Kingdom), Saudi Arabia";
  return "Saudi Arabia";
}

interface Article {
  title?: string;
  text: string;
  company?: string;
  closesAt?: string | null;
  location?: string;
  applyUrl?: string | null;
}

/** The schema.org record in an article page - top level, in a list or in an @graph. Exported for tests. */
export function articleRecord(html: string): Article | null {
  const objects: Array<Record<string, unknown>> = [];
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") {
      objects.push(v as Record<string, unknown>);
      collect((v as Record<string, unknown>)["@graph"]);
    }
  };
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      collect(JSON.parse(m[1]));
    } catch {
      /* the next block */
    }
  }
  const p =
    objects.find((o) => [o["@type"]].flat().includes("JobPosting")) ??
    objects.find((o) => typeof o.title === "string" && typeof o.description === "string");
  if (!p) return null;
  const org = p.hiringOrganization as { name?: string } | undefined;
  const loc = [p.jobLocation].flat()[0] as { address?: { addressLocality?: string; addressRegion?: string } } | undefined;
  // The official apply link: the first link leaving the site that is not social media.
  const host = html.match(/<link rel="canonical" href="https?:\/\/(?:www\.)?([^/"]+)/)?.[1] ?? "";
  const apply = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)]
    .map((m) => m[1].replace(/&amp;/g, "&"))
    .find((u) => !(host && u.includes(host)) && !/facebook|twitter|x\.com|t\.me|whatsapp|wa\.me|instagram|snapchat|tiktok|youtube|google|apple\.com|linkedin\.com\/company|telegram|jobzaty|wdeftksa|ewdifh/i.test(u));
  return {
    title: typeof p.title === "string" ? htmlToText(p.title) : undefined,
    text: htmlToText(String(p.description ?? "")),
    company: org?.name?.trim() || undefined,
    closesAt: toIso((p.validThrough as string) ?? null),
    location: [loc?.address?.addressLocality, loc?.address?.addressRegion].filter((x) => x && !/غير محدد/.test(x)).join(", ") || undefined,
    applyUrl: apply ?? null,
  };
}

/** Channels to read: the built-in list, or TELEGRAM_CHANNELS="handle,handle" to replace it. */
function channels(): Channel[] {
  const fromEnv = envStr("TELEGRAM_CHANNELS");
  if (!fromEnv) return CHANNELS;
  return fromEnv
    .split(",")
    .map((h) => h.trim().replace(/^@/, ""))
    .filter(Boolean)
    .map((h) => CHANNELS.find((c) => c.handle.toLowerCase() === h.toLowerCase()) ?? { handle: h });
}

export const telegram = async (source: SourceDefinition): Promise<RawJob[]> => {
  // 20 posts a page. Four pages keep up with daily channels between passes;
  // a full search (launcher F) reads 15, the last two weeks or so.
  const pages = envInt("TELEGRAM_PAGES", 4);
  const ocrBudget = envInt("TELEGRAM_OCR_MAX", 12);

  // Posts already stored: reported again while under 30 days old (a post
  // stays up; the age rule decides when it leaves the board), never re-read.
  const stored = new Map<string, RawJob>();
  try {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const rows = await fetchAllRows<Record<string, unknown>>(
      (from, to) =>
        supabaseAdmin()
          .from("jobs")
          .select("external_id,title,company,location_text,description_text,url,apply_url,posted_at,closes_at")
          .eq("source_id", source.id)
          .gte("posted_at", since)
          .range(from, to),
      "stored Telegram posts",
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
        applyUrl: (r.apply_url as string) ?? null,
        postedAt: (r.posted_at as string) ?? null,
        closesAt: (r.closes_at as string) ?? null,
        publisher: "Telegram",
      });
    }
  } catch {
    /* nothing stored yet */
  }

  const out = new Map<string, RawJob>(stored);
  let attempts = 0;
  const failures: string[] = [];
  let read = 0;
  let kept = 0;
  let pictures = 0;
  try {
    for (const ch of channels()) {
      let before: string | null = null;
      for (let page = 0; page < pages; page++) {
        if (!(await reserve("telegram"))) break;
        attempts++;
        let parsed: { posts: ChannelPost[]; before: string | null };
        try {
          const html = await getText(`https://t.me/s/${ch.handle}${before ? `?before=${before}` : ""}`, { headers: HEADERS, timeoutMs: 20_000, retries: 1 });
          parsed = parseChannelPage(html, ch.handle);
        } catch (err) {
          failures.push(`@${ch.handle}: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
        for (const p of parsed.posts) {
          read++;
          const externalId = `tg:${ch.handle}:${p.id}`;
          if (out.has(externalId)) continue;
          if (p.at && Date.now() - Date.parse(p.at) > 30 * 86_400_000) continue;

          // A short post with a picture: the announcement is often in the picture.
          let text = p.text;
          if (p.photo && text.length < 400 && pictures < ocrBudget) {
            pictures++;
            try {
              const res = await fetch(p.photo, { headers: HEADERS });
              const words = res.ok ? await imageText(Buffer.from(await res.arrayBuffer())) : null;
              if (words) text = `${text}\n\n[Text in the post's picture]\n${words}`;
            } catch {
              /* the post's own text stands */
            }
          }
          /*
           * The full article, where the channel's site allows reading it -
           * read before deciding, for an announcement. "Company X announces
           * jobs in several fields" names the fields only in the article, so
           * filtering on the post alone dropped most of them: 11 posts kept
           * from four daily channels in a week (2026-10-21).
           */
          const link = ch.articles ? p.links.find((u) => ch.articles?.test(u)) : undefined;
          if (!TECH.test(text) && !(link && ANNOUNCEMENT.test(text))) continue;
          let article: Article | null = null;
          if (link && (await reserve("telegram"))) {
            try {
              article = articleRecord(await getText(link, { headers: HEADERS, timeoutMs: 20_000, retries: 1 }));
            } catch {
              /* the post alone */
            }
            await sleep(1200 + Math.floor(Math.random() * 800));
          }
          if (!TECH.test(`${text}\n${article?.title ?? ""}\n${article?.text ?? ""}`)) continue;

          const body = [text, article?.text ? `[From the article ${link}]\n${article.text}` : ""].filter(Boolean).join("\n\n");
          const title = article?.title || headline(text);
          if (!title) continue;
          kept++;
          out.set(externalId, {
            sourceId: source.id,
            externalId,
            title,
            company: article?.company || employerOf(text) || `Telegram @${ch.handle}`,
            locationText: article?.location ? `${article.location}, Saudi Arabia` : citiesOf(body),
            descriptionText: body.slice(0, 9000),
            url: `https://t.me/${ch.handle}/${p.id}`,
            applyUrl: article?.applyUrl ?? link ?? p.links[0] ?? null,
            postedAt: toIso(p.at),
            closesAt: article?.closesAt ?? null,
            publisher: "Telegram",
          });
        }
        before = parsed.before;
        if (!before) break;
        await sleep(1500 + Math.floor(Math.random() * 1000));
      }
    }
  } finally {
    await stopOcr();
  }
  // Every channel failing is an outage, not "no posts": keep the stored rows.
  if (attempts > 0 && failures.length === attempts) throw new Error(`Telegram: every channel failed - ${failures[0]}`);
  console.log(`  Telegram: ${read} post(s) read, ${kept} new about technology or training (${pictures} picture(s) read), ${stored.size} stored kept${failures.length ? `; failed: ${failures.join("; ")}` : ""}`);
  return [...out.values()];
};
