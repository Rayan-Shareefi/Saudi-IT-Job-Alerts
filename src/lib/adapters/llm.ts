/**
 * Reads a careers page the way a person would, using a free-tier LLM.
 *
 * The structural extractors get a long way, but they cannot tell a *category*
 * from a *vacancy*. Tahakom's results page lists "Operations", "Entry Level",
 * "التدريب التعاوني"; Elm's lists "المالية والاستثمار". Those are job families,
 * and no amount of shape-matching distinguishes them from real postings,
 * because structurally they are identical. Reading the words does.
 *
 * Default provider is **Google Gemini**, whose free tier allows ~1,500 requests
 * a day - comfortably more than 513 employers need, at no cost and with no card.
 * Anthropic is supported as an alternative for anyone who prefers it and is
 * happy to pay; nothing here requires it.
 *
 *   LLM_PROVIDER=gemini   (default)   GEMINI_API_KEY=...
 *   LLM_PROVIDER=anthropic            ANTHROPIC_API_KEY=...
 */
import type { RawJob, SourceDefinition } from "../types";
import type { Adapter } from "./ats";

/** Characters of page text sent per request. ~30K chars is ~8K tokens. */
const MAX_PAGE_CHARS = 30_000;

export class MissingLlmKey extends Error {
  constructor(which: string) {
    super(`missing ${which}`);
    this.name = "MissingLlmKey";
  }
}

interface ExtractedJob {
  title: string;
  location: string | null;
  department: string | null;
  employmentType: string | null;
  experience: string | null;
  url: string | null;
  description: string | null;
}

const INSTRUCTIONS = `You extract job vacancies from the text of a company careers page.

Return only roles the page advertises as individually open and applicable-for.

Do NOT return:
- job categories, families or departments ("Operations", "Entry Level",
  "Finance & Investment", "التدريب التعاوني", "المالية والاستثمار") - these are
  filters, not vacancies, and are the single most common mistake here
- navigation, benefits copy, culture statements or "why work here" marketing
- links such as "View all openings" or "Search jobs"

For each real vacancy:
- title: copy exactly as written, including Arabic
- location: copy the city or region exactly as stated; null if the page does not
  say. Never guess, and never use the company headquarters as the location
- experience: copy any stated requirement verbatim ("3-5 years",
  "خبرة لا تقل عن ٥ سنوات", "cooperative training", "internship"); null if absent
- url: link to that specific posting if shown, else null
- description: short factual summary of duties and qualifications; null if none

If the page advertises no individual vacancies, return an empty array. An empty
array is the correct answer for a careers landing page that only invites you to
search or upload a CV.`;

const JOB_PROPERTIES = {
  title: { type: "string" },
  location: { type: "string", nullable: true },
  department: { type: "string", nullable: true },
  employmentType: { type: "string", nullable: true },
  experience: { type: "string", nullable: true },
  url: { type: "string", nullable: true },
  description: { type: "string", nullable: true },
};

/* -------------------------------------------------------------------------- */
/* providers                                                                   */
/* -------------------------------------------------------------------------- */

async function extractWithGemini(prompt: string): Promise<ExtractedJob[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new MissingLlmKey("GEMINI_API_KEY");
  const model = process.env.LLM_MODEL ?? "gemini-2.0-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              jobs: {
                type: "array",
                items: {
                  type: "object",
                  properties: JOB_PROPERTIES,
                  required: ["title"],
                },
              },
            },
            required: ["jobs"],
          },
        },
      }),
    },
  );

  if (res.status === 429) throw new Error("Gemini daily free quota reached");
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) return [];
  try {
    return (JSON.parse(text) as { jobs?: ExtractedJob[] }).jobs ?? [];
  } catch {
    return [];
  }
}

async function extractWithAnthropic(prompt: string): Promise<ExtractedJob[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new MissingLlmKey("ANTHROPIC_API_KEY");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const response = await client.messages.create({
    model: process.env.LLM_MODEL ?? "claude-opus-5",
    max_tokens: 8000,
    system: INSTRUCTIONS,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            jobs: {
              type: "array",
              items: {
                type: "object",
                properties: JOB_PROPERTIES,
                required: Object.keys(JOB_PROPERTIES),
                additionalProperties: false,
              },
            },
          },
          required: ["jobs"],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return [];
  try {
    return (JSON.parse(block.text) as { jobs?: ExtractedJob[] }).jobs ?? [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */

/** Visible text of the rendered page, trimmed to what is worth sending. */
async function renderedText(url: string): Promise<{ text: string; finalUrl: string }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    // innerText, not HTML: it is already visible reading order, and it drops the
    // script and style noise that would otherwise be most of the payload.
    const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    return {
      text: text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_PAGE_CHARS),
      finalUrl: page.url(),
    };
  } finally {
    await browser.close();
  }
}

/**
 * Loose form of a string, for comparing what the model said against what the
 * page said. Case, punctuation and whitespace all vary between the two.
 */
export function loose(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Was this title actually on the page, or did the model produce it?
 *
 * The model is asked to copy titles verbatim, and mostly does - but nothing
 * about asking makes it so, and an invented vacancy is indistinguishable from
 * a real one downstream: it has a plausible title, a plausible department and
 * a URL pointing at a careers page that really exists. The classifier can tell
 * that a posting is not in Riyadh or not technical; it cannot tell that the
 * posting was never there.
 *
 * The page text is already in hand - it is what was sent to the model - so
 * grounding each title against it costs nothing and is decisive. A title the
 * source does not contain did not come from the source.
 */
export function appearsInSource(title: string, sourceText: string): boolean {
  const needle = loose(title);
  if (needle.length < 3) return false;

  /*
   * A contiguous match, deliberately - not "every word appears somewhere".
   *
   * That looser test passed "Senior Cloud Security Engineer" on a page whose
   * real postings were "Senior Cloud Engineer" and "Co-op Trainee -
   * Information Security": each word was present, in different vacancies. An
   * invented title assembled from a page's own vocabulary is exactly the
   * failure this check exists to catch, so borrowing words is not enough.
   *
   * Normalising both sides first is what makes contiguity fair: case,
   * punctuation, Arabic diacritics and runs of whitespace differ between what
   * the model writes and what the page renders, and none of those differences
   * mean the posting is not there.
   */
  return sourceText.includes(needle);
}

export const llm: Adapter = async (source: SourceDefinition): Promise<RawJob[]> => {
  const provider = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();

  const { text, finalUrl } = await renderedText(source.handle);
  // A page with almost no words has nothing to extract; do not spend a request
  // finding that out.
  if (text.length < 200) return [];

  const prompt = `Careers page for ${source.company ?? source.label} (${finalUrl}):\n\n${text}`;
  const jobs =
    provider === "anthropic" ? await extractWithAnthropic(prompt) : await extractWithGemini(prompt);

  const seen = new Set<string>();
  const grounded = loose(text);

  return jobs
    .filter((j) => j?.title && j.title.trim().length > 2)
    // Only what the page itself says. See appearsInSource.
    .filter((j) => appearsInSource(j.title, grounded))
    .map((j) => {
      let url = j.url ?? finalUrl;
      if (url && !/^https?:/i.test(url)) {
        try {
          url = new URL(url, finalUrl).toString();
        } catch {
          url = finalUrl;
        }
      }
      return {
        sourceId: source.id,
        externalId: `${j.title}|${j.location ?? ""}`.slice(0, 400),
        title: j.title.trim(),
        company: source.company ?? source.label,
        locationText: j.location ?? "",
        // Experience is folded into the body because that is where the existing
        // classifier already looks for it.
        descriptionText: [j.description ?? "", j.experience ?? ""].filter(Boolean).join(". "),
        url,
        postedAt: null,
        department: j.department ?? null,
        employmentType: j.employmentType ?? null,
      } satisfies RawJob;
    })
    .filter((j) => !seen.has(j.externalId) && seen.add(j.externalId));
};
