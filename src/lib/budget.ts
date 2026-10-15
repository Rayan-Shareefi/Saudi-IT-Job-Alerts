import { supabaseAdmin } from "./db";
import { envInt } from "./env";

/**
 * One budget for every free quota, shared by GitHub Actions, the laptop worker
 * and local dev - they all draw on the same keys.
 *
 * Free tiers stop rather than bill, but hitting the wall mid-run loses work and
 * (for JSearch) produced a "100% of your quota" email the user never expected.
 * So callers reserve before they spend, and stop cleanly when told no.
 *
 * Caps are env-tunable because providers change them without notice (Google
 * cut Gemini's free tier in December 2025). Defaults sit safely under the
 * limits measured in October 2026.
 */

export type Provider =
  | "jsearch"
  | "gemini"
  | "gemma"
  | "groq"
  | "groq-senior"
  | "linkedin"
  | "resend-alert"
  | "resend-system";

interface Cap {
  period: "day" | "month";
  requests: number;
  tokens: number;
}

function caps(): Record<Provider, Cap> {
  return {
    // ~200/month per key on the free plan; leave headroom for a manual run.
    jsearch: { period: "month", requests: envInt("BUDGET_JSEARCH_MONTH", 150), tokens: 0 },
    gemini: { period: "day", requests: envInt("BUDGET_GEMINI_DAY", 400), tokens: 0 },
    gemma: { period: "day", requests: envInt("BUDGET_GEMMA_DAY", 1200), tokens: 0 },
    // Groq's free tier binds on tokens per day, not requests.
    groq: { period: "day", requests: envInt("BUDGET_GROQ_DAY", 900), tokens: envInt("BUDGET_GROQ_TOKENS_DAY", 180_000) },
    "groq-senior": { period: "day", requests: envInt("BUDGET_GROQ_SENIOR_DAY", 300), tokens: envInt("BUDGET_GROQ_SENIOR_TOKENS_DAY", 180_000) },
    linkedin: { period: "day", requests: envInt("BUDGET_LINKEDIN_DAY", 250), tokens: 0 },
    // Instant alerts: Resend free is 100/day; alerts are capped at 20 so the
    // digest and system mails always fit (see HANDOVER, email maths).
    "resend-alert": { period: "day", requests: envInt("BUDGET_ALERT_EMAILS_DAY", 20), tokens: 0 },
    "resend-system": { period: "day", requests: 2, tokens: 0 },
  };
}

function periodKey(period: Cap["period"], now = new Date()): string {
  // UTC, matching how the providers reset (Gemini resets at Pacific midnight;
  // UTC is close enough and errs early).
  const iso = now.toISOString();
  return period === "month" ? iso.slice(0, 7) : iso.slice(0, 10);
}

/**
 * Reserve usage. True means go ahead; false means the budget is spent for this
 * period. Without a database (tests, dry runs) everything is allowed.
 */
export async function reserve(provider: Provider, use: { requests?: number; tokens?: number } = {}): Promise<boolean> {
  const cap = caps()[provider];
  let db;
  try {
    db = supabaseAdmin();
  } catch {
    return true;
  }
  const { data, error } = await db.rpc("bump_usage", {
    p_provider: provider,
    p_period: periodKey(cap.period),
    p_requests: use.requests ?? 1,
    p_tokens: use.tokens ?? 0,
    p_cap_requests: cap.requests,
    p_cap_tokens: cap.tokens,
  });
  if (error) {
    // A broken budget table must not stop collection; say so loudly instead.
    console.warn(`[budget] could not check ${provider}: ${error.message}`);
    return true;
  }
  return data === true;
}

/** What has been used this period, for the UI ("JSearch: 12 of 150 this month"). */
export async function usage(provider: Provider): Promise<{ requests: number; tokens: number; cap: Cap }> {
  const cap = caps()[provider];
  try {
    const { data } = await supabaseAdmin()
      .from("api_usage")
      .select("requests,tokens")
      .eq("provider", provider)
      .eq("period", periodKey(cap.period))
      .maybeSingle();
    return { requests: Number(data?.requests ?? 0), tokens: Number(data?.tokens ?? 0), cap };
  } catch {
    return { requests: 0, tokens: 0, cap };
  }
}
