/** Shared fetch helpers: polite defaults, retries, timeouts, HTML -> text. */
import { obviouslyPrivate, PrivateAddressRefused } from "./net-guard";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Fetch with a timeout and bounded retries. 4xx (other than 429) fails fast --
 * a wrong board token will never start working, so retrying just wastes budget.
 */
export async function request(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { method = "GET", headers = {}, body, timeoutMs = 20_000, retries = 2 } = opts;
  // Boards found on scraped pages become sources: never an address inside
  // the laptop's home network (net-guard.ts). Literal addresses and local
  // names only here - no DNS lookup on every request.
  // ALLOW_LOCAL_FETCH: the offline test suites' local mock servers only.
  try {
    if (!process.env.ALLOW_LOCAL_FETCH && obviouslyPrivate(new URL(url).hostname)) throw new PrivateAddressRefused(url);
  } catch (err) {
    if (err instanceof PrivateAddressRefused) throw err;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/html, application/xhtml+xml, */*",
          "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
          ...headers,
        },
        body,
        signal: controller.signal,
        redirect: "follow",
      });

      if (res.ok) return res;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) throw new HttpError(`HTTP ${res.status} for ${url}`, res.status);
      lastError = new HttpError(`HTTP ${res.status} for ${url}`, res.status);
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      await sleep(800 * 2 ** attempt + Math.random() * 400);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await request(url, opts);
  return (await res.json()) as T;
}

export async function getText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await request(url, opts);
  return await res.text();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip markup to readable text; keeps sentence boundaries for the classifier. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, ". ")
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s*\.\s*(\.\s*)+/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Run tasks with bounded concurrency so we never hammer a host. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Best-effort ISO date from the many shapes job APIs return. */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    // Seconds vs milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
