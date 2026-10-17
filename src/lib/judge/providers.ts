import { adjust, reserve, type Provider as BudgetName } from "../budget";
import { envStr } from "../env";
import { sleep } from "../http";
import { ANSWER_SCHEMA, SENIOR_SCHEMA } from "./prompt";
import { jsonObjectIn } from "./verify";
import { ProviderQuotaHit, ProviderUnavailable, type Role } from "./types";

/**
 * The free models that read postings. Every one is optional: whatever is
 * configured takes part, and the arbiter decides with whatever votes exist.
 *
 *   gemini   GEMINI_API_KEY   Gemini Flash-Lite        (Google free tier)
 *   gemma    GEMINI_API_KEY   Gemma, an open model     (same key, separate quota)
 *   groq     GROQ_API_KEY     Llama on Groq            (free tier)
 *   ollama   OLLAMA_URL       a local model on the laptop, unlimited, slow
 *   senior   GROQ_API_KEY     the largest free Groq model; Gemini Flash as fallback
 *
 * Model names come from env with sensible defaults, because free models are
 * renamed and retired often. `npm run llm:check` lists what each key can use.
 */

export interface JudgeProvider {
  id: string;
  model: string;
  role: Role;
  available(): boolean;
  /** Returns the raw text of the model's reply. */
  call(prompt: string): Promise<string>;
}

/**
 * Minimum gap between calls per provider, to stay under per-minute limits.
 * Serialised per provider, so concurrent postings cannot both slip through
 * the same gap.
 */
const lastCall = new Map<string, number>();
const queue = new Map<string, Promise<void>>();
async function pace(id: string, minGapMs: number): Promise<void> {
  const prev = queue.get(id) ?? Promise.resolve();
  const mine = prev.then(async () => {
    const wait = (lastCall.get(id) ?? 0) + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(id, Date.now());
  });
  queue.set(id, mine.catch(() => {}));
  await mine;
}

/**
 * POST with retries on the provider's own transient failures (500, 502, 503 -
 * "the model is experiencing high demand"), which free tiers return often.
 * Rate limits (429) are handled by each provider (perMinuteWait).
 */
async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; json: unknown; text: string }> {
  let last: { status: number; json: unknown; text: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(4000 * attempt * attempt);
    try {
      last = await postOnce(url, body, headers, timeoutMs);
    } catch (err) {
      if (attempt === 2) throw err;
      continue;
    }
    if (![500, 502, 503, 504].includes(last.status)) return last;
  }
  return last as { status: number; json: unknown; text: string };
}

async function postOnce(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; json: unknown; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON; the caller reports the status */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function spend(budget: BudgetName, provider: string, tokens = 0): Promise<void> {
  if (!(await reserve(budget, { requests: 1, tokens }))) throw new ProviderQuotaHit(provider);
}

/**
 * How long to wait out a 429, or null when it is a daily limit (or does not
 * say). A per-minute limit is over in seconds: Groq's senior model allows
 * 8,000 tokens a minute, about one posting, so two disputes in a row hit it -
 * and treating that as "quota reached" benched the senior for the whole run.
 */
export function perMinuteWait(text: string): number | null {
  if (/per.?day|PerDay|\bRPD\b|\bTPD\b/i.test(text)) return null;
  const m = text.match(/(?:try again|retry) in ([\d.]+)\s*(ms|s)\b/i) ?? text.match(/"retryDelay"\s*:\s*"([\d.]+)(s)"/);
  if (!m) return null;
  const ms = Number(m[1]) * (m[2] === "ms" ? 1 : 1000);
  return ms > 0 && ms <= 90_000 ? ms + 1000 : null;
}

/** A provider's error body as one short line: its own message, not a JSON dump. */
function briefly(text: string, json: unknown): string {
  const message = (json as { error?: { message?: unknown } } | null)?.error?.message;
  return (typeof message === "string" ? message : text).replace(/\s+/g, " ").trim().slice(0, 140);
}

/*
 * Free models are retired without notice (Groq dropped llama-3.3-70b on
 * 2026-10-17, Gemma 4 31b failed every call on 2026-10-13), so every provider
 * holds a list and moves to the next model when one is gone - for the rest of
 * the process, since a retired model does not come back.
 */
const retired = new Set<string>();

function liveModel(id: string, models: string[]): string | null {
  return models.find((m) => !retired.has(`${id}:${m}`)) ?? null;
}

/** The env choice first, then the defaults it did not name. */
function chain(fromEnv: string | undefined, defaults: string[]): string[] {
  return fromEnv ? [fromEnv, ...defaults.filter((m) => m !== fromEnv)] : defaults;
}

/*
 * Server errors (5xx) that survive postJson's retries. Three in a row and the
 * provider rests for the rest of the run: on 2026-10-17 Gemma answered 500 to
 * a run of requests, and each one cost ~20 s of retries for nothing. The
 * other jurors carry the run meanwhile.
 */
const serverFailures = new Map<string, number>();
const REST_AFTER = 3;

function serverError(id: string, status: number, text: string, json: unknown): Error {
  const n = (serverFailures.get(id) ?? 0) + 1;
  serverFailures.set(id, n);
  if (n >= REST_AFTER) return new ProviderUnavailable(id, `${n} server errors in a row (HTTP ${status}) - resting for the rest of this run`);
  return new Error(`${id} HTTP ${status}: ${briefly(text, json)}`);
}

function answered(id: string): void {
  serverFailures.delete(id);
}

/* --------------------------------- Gemini API ------------------------------ */

function geminiProvider(id: string, budget: BudgetName, models: string[], role: Role, structured: boolean, gapMs: number): JudgeProvider {
  return {
    id,
    role,
    get model() {
      return liveModel(id, models) ?? models[models.length - 1];
    },
    available: () => Boolean(envStr("GEMINI_API_KEY")),
    async call(prompt) {
      const key = envStr("GEMINI_API_KEY");
      if (!key) throw new ProviderUnavailable(id, "GEMINI_API_KEY not set");
      let waits = 0;
      for (;;) {
        const model = liveModel(id, models);
        if (!model) throw new ProviderUnavailable(id, `none of ${models.join(", ")} is available - run npm run llm:check`);
        await spend(budget, id);
        await pace(id, gapMs);
        // The key travels in a header, never in the URL, so it cannot end up in
        // a log line or an error message.
        const { status, json, text } = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              // Thinking models spend output tokens on reasoning before answering.
              maxOutputTokens: 4000,
              ...(structured
                ? { responseMimeType: "application/json", responseSchema: role === "senior" ? SENIOR_SCHEMA : ANSWER_SCHEMA }
                : {}),
            },
          },
          { "x-goog-api-key": key },
          90_000,
        );
        if (status === 429) {
          await adjust(budget, { requests: -1 }); // turned away: not a use
          const wait = waits < 2 ? perMinuteWait(text) : null;
          if (wait === null) throw new ProviderQuotaHit(id);
          waits++;
          await sleep(wait);
          continue;
        }
        if (status === 404) {
          retired.add(`${id}:${model}`);
          continue;
        }
        if (status >= 500) throw serverError(id, status, text, json);
        if (status >= 400) throw new Error(`${id} HTTP ${status}: ${briefly(text, json)}`);
        answered(id);
        // Gemma 4 and the thinking Gemini models return their reasoning as
        // separate parts flagged `thought`; only the answer parts are the reply.
        const parts = (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> })?.candidates?.[0]?.content?.parts ?? [];
        return parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      }
    },
  };
}

/* ----------------------------------- Groq ---------------------------------- */

function groqProvider(id: string, budget: BudgetName, models: string[], role: Role): JudgeProvider {
  return {
    id,
    role,
    get model() {
      return liveModel(id, models) ?? models[models.length - 1];
    },
    available: () => Boolean(envStr("GROQ_API_KEY")),
    async call(prompt) {
      const key = envStr("GROQ_API_KEY");
      if (!key) throw new ProviderUnavailable(id, "GROQ_API_KEY not set");
      let jsonMode = true;
      let waits = 0;
      for (;;) {
        const model = liveModel(id, models);
        if (!model) throw new ProviderUnavailable(id, `none of ${models.join(", ")} is available - run npm run llm:check`);
        // Groq's free tier binds on tokens; ~4 characters per token, plus the
        // reply - which for a reasoning model includes its thinking. Settled
        // to the real count once Groq answers.
        const estimate = Math.ceil(prompt.length / 3.5) + 2500;
        await spend(budget, id, estimate);
        await pace(id, 2500);
        const { status, json, text } = await postJson(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model,
            temperature: 0,
            // gpt-oss and qwen3 think before answering, inside this limit: at
            // 1200 the answer was cut off and JSON mode refused it (HTTP 400
            // "Failed to generate JSON", 2026-10-17).
            max_tokens: 4000,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
            ...(/qwen3/i.test(model) ? { reasoning_format: "hidden" } : {}),
            messages: [{ role: "user", content: prompt }],
          },
          { authorization: `Bearer ${key}` },
          90_000,
        );
        if (status === 429) {
          await adjust(budget, { requests: -1, tokens: -estimate }); // turned away: not a use
          const wait = waits < 2 ? perMinuteWait(text) : null;
          if (wait === null) throw new ProviderQuotaHit(id);
          waits++;
          await sleep(wait);
          continue;
        }
        const used = (json as { usage?: { total_tokens?: number } } | null)?.usage?.total_tokens;
        if (typeof used === "number") await adjust(budget, { tokens: used - estimate });
        const error = (json as { error?: { code?: string; failed_generation?: string } } | null)?.error;
        if (status === 404 || error?.code === "model_not_found" || error?.code === "model_decommissioned" || /model .*(does not exist|decommissioned)/i.test(briefly(text, json))) {
          retired.add(`${id}:${model}`);
          continue;
        }
        if (status === 400 && (error?.code === "json_validate_failed" || error?.failed_generation !== undefined)) {
          // JSON mode rejected what the model wrote; it is often a readable
          // answer anyway (text around it, a trailing comma).
          if (error?.failed_generation && jsonObjectIn(error.failed_generation)) return error.failed_generation;
          if (jsonMode) {
            jsonMode = false; // once more, with JSON asked for in the prompt only
            continue;
          }
        }
        if (status >= 500) throw serverError(id, status, text, json);
        if (status >= 400) throw new Error(`${id} HTTP ${status}: ${briefly(text, json)}`);
        answered(id);
        return (json as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? "";
      }
    },
  };
}

/* ---------------------------------- Ollama --------------------------------- */

let ollamaUp: boolean | null = null;

/** Is a local Ollama server answering? Checked once per process. */
export async function ollamaAvailable(): Promise<boolean> {
  if (ollamaUp !== null) return ollamaUp;
  const base = envStr("OLLAMA_URL") ?? "http://127.0.0.1:11434";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    ollamaUp = res.ok;
  } catch {
    ollamaUp = false;
  }
  return ollamaUp;
}

function ollamaProvider(): JudgeProvider {
  const model = envStr("OLLAMA_MODEL") ?? "qwen2.5:7b-instruct";
  return {
    id: "ollama",
    model,
    role: "juror",
    // Decided asynchronously by ollamaAvailable() before a run starts.
    available: () => ollamaUp === true,
    async call(prompt) {
      const base = envStr("OLLAMA_URL") ?? "http://127.0.0.1:11434";
      // CPU inference on the laptop is slow; give it time rather than fail.
      const { status, json, text } = await postJson(
        `${base}/api/chat`,
        {
          model,
          stream: false,
          format: ANSWER_SCHEMA,
          options: { temperature: 0, num_ctx: 8192 },
          messages: [{ role: "user", content: prompt }],
        },
        {},
        envStr("OLLAMA_TIMEOUT_MS") ? Number(envStr("OLLAMA_TIMEOUT_MS")) : 600_000,
      );
      if (status === 404) throw new ProviderUnavailable("ollama", `model "${model}" not pulled - run: ollama pull ${model}`);
      if (status >= 400) throw new Error(`ollama HTTP ${status}: ${briefly(text, json)}`);
      return (json as { message?: { content?: string } })?.message?.content ?? "";
    },
  };
}

/* --------------------------------- registry -------------------------------- */

export function jurors(): JudgeProvider[] {
  return [
    ollamaProvider(),
    geminiProvider("gemini", "gemini", chain(envStr("GEMINI_MODEL"), ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"]), "juror", true, 4500),
    // Gemma rejects Gemini's JSON mode; it is asked for JSON in the prompt.
    // gemma-4-31b-it answered HTTP 500 to every request on 2026-10-13.
    geminiProvider("gemma", "gemma", chain(envStr("GEMMA_MODEL"), ["gemma-4-26b-a4b-it", "gemma-4-31b-it"]), "juror", false, 2500),
    // llama-3.3-70b-versatile was retired by Groq on 2026-10-17.
    groqProvider("groq", "groq", chain(envStr("GROQ_MODEL"), ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]), "juror"),
  ];
}

/**
 * Strongest free model first, then a chain of Gemini Flash models. On
 * 2026-10-13 every Flash model answered "high demand" (503) to some requests;
 * a failure moves to the next model rather than leaving a dispute undecided.
 */
export function seniors(): JudgeProvider[] {
  const gemini = envStr("GEMINI_SENIOR_MODEL")
    ? [envStr("GEMINI_SENIOR_MODEL") as string]
    : ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-flash-latest"];
  return [
    groqProvider("groq-senior", "groq-senior", chain(envStr("GROQ_SENIOR_MODEL"), ["openai/gpt-oss-120b"]), "senior"),
    ...gemini.map((m, i) => geminiProvider(i === 0 ? "gemini-senior" : `gemini-senior-${i + 1}`, "gemini", [m], "senior", true, 4500)),
  ];
}
