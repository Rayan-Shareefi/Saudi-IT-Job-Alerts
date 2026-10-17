import { supabaseAdmin, fetchAllRows } from "../db";
import { judgeScope, type ScopeResult } from "../scope";
import { arbitrateScope } from "../state";
import { PROMPT_VERSION, jurorPrompt, seniorPrompt, type Example } from "./prompt";
import { jurors, ollamaAvailable, seniors, type JudgeProvider } from "./providers";
import { parseAnswer, verifyAnswer } from "./verify";
import { ProviderQuotaHit, ProviderUnavailable, type Answer, type JudgeInput, type Role, type Vote } from "./types";

/**
 * Runs the jury over postings the rules could not settle.
 *
 * Each model reads a posting text once per prompt version; answers are cached
 * in `judgements` by text hash, so the same vacancy on three sources costs one
 * reading, and a re-run costs nothing. Order per posting:
 *
 *   1. two jurors (Ollama when the laptop is up, then Gemini, Gemma, Groq);
 *   2. a third only if those two disagree or one abstained;
 *   3. the senior reviewer only if the arbiter still cannot decide.
 *
 * Postings the rules settled decisively are skipped, except a random sample
 * (AUDIT_SAMPLE) that is judged anyway to measure how often the rules are
 * wrong - the number that says whether "rules alone" can be trusted.
 */

export const AUDIT_SAMPLE = 0.1;

export interface StoredJudgement {
  provider: string;
  model: string;
  role: Role;
  answer: Answer;
}

export interface JudgeRow {
  id: string;
  title: string;
  company: string;
  location_text: string | null;
  department: string | null;
  description_text: string | null;
  text_hash: string | null;
  text_quality: string | null;
  source_kind: string;
}

export function inputOf(row: JudgeRow): JudgeInput {
  return {
    title: row.title,
    company: row.company,
    location: row.location_text ?? "",
    text: row.description_text ?? "",
    textQuality: row.text_quality ?? "none",
  };
}

/** Every stored answer for these texts under the current prompt. */
export async function loadJudgements(hashes: string[]): Promise<Map<string, StoredJudgement[]>> {
  const out = new Map<string, StoredJudgement[]>();
  const unique = [...new Set(hashes.filter(Boolean))];
  const db = supabaseAdmin();
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const rows = await fetchAllRows<{ text_hash: string; provider: string; model: string; role: Role; answer: Answer }>(
      (from, to) =>
        db
          .from("judgements")
          .select("text_hash,provider,model,role,answer")
          .eq("prompt_version", PROMPT_VERSION)
          .in("text_hash", chunk)
          .range(from, to),
      "judgements",
    );
    for (const r of rows) out.set(r.text_hash, [...(out.get(r.text_hash) ?? []), r]);
  }
  return out;
}

/**
 * Votes are re-verified from the stored raw answers every time, so an
 * improvement to the evidence check applies to every past answer at once.
 */
export function votesFor(row: JudgeRow, stored: StoredJudgement[]): Vote[] {
  return stored.map((s) =>
    verifyAnswer(s.answer, { title: row.title, text: row.description_text ?? "", location: row.location_text }, { provider: s.provider, model: s.model, role: s.role }),
  );
}

async function store(row: JudgeRow, p: JudgeProvider, answer: Answer, vote: Vote, ms: number): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("judgements")
    .upsert(
      {
        text_hash: row.text_hash,
        prompt_version: PROMPT_VERSION,
        provider: p.id,
        model: p.model,
        role: p.role,
        answer,
        verified: { scope: vote.scope, years: vote.minYears, isJob: vote.isJob, hallucinated: vote.hallucinated },
        latency_ms: ms,
      },
      { onConflict: "text_hash,prompt_version,provider,model,role" },
    );
  if (error) throw new Error(`could not store judgement: ${error.message}`);
}

export interface JuryStats {
  judged: number;
  calls: number;
  byProvider: Record<string, number>;
  spent: string[];
  unavailable: string[];
  errors: string[];
}

/** User decisions on similar postings, shown to the senior reviewer as examples. */
export async function recentExamples(limit = 8): Promise<Example[]> {
  const { data } = await supabaseAdmin()
    .from("jobs")
    .select("title,human_override,decision_note")
    .not("human_override", "is", null)
    .order("decided_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    title: String(r.title),
    decision: r.human_override === "show" ? "add" : "dont_add",
    why: String(r.decision_note ?? "decided by the user"),
  }));
}

/**
 * Judge one posting with as few model calls as it takes. Returns the votes
 * (existing plus new).
 */
export async function judgeOne(
  row: JudgeRow,
  existing: StoredJudgement[],
  ctx: { stats: JuryStats; spent: Set<string>; examples: Example[]; force?: boolean },
): Promise<Vote[]> {
  const input = inputOf(row);
  const rules: ScopeResult = judgeScope(row.title, row.department, row.description_text, (row.text_quality ?? "none") as never);
  const stored = [...existing];
  let votes = votesFor(row, stored);

  const decisive = rules.confidence === "decisive";
  if (decisive && !ctx.force) return votes;

  const call = async (p: JudgeProvider, prompt: string): Promise<Vote | null> => {
    if (ctx.spent.has(p.id)) return null;
    const started = Date.now();
    try {
      const raw = await p.call(prompt);
      ctx.stats.calls++;
      ctx.stats.byProvider[p.id] = (ctx.stats.byProvider[p.id] ?? 0) + 1;
      const answer = parseAnswer(raw);
      if (!answer) {
        const start = raw.replace(/\s+/g, " ").trim().slice(0, 70);
        ctx.stats.errors.push(`${p.id}: unparseable reply for "${row.title.slice(0, 40)}" (began: ${start || "empty"})`);
        return null;
      }
      const vote = verifyAnswer(answer, { title: row.title, text: row.description_text ?? "", location: row.location_text }, { provider: p.id, model: p.model, role: p.role });
      await store(row, p, answer, vote, Date.now() - started);
      stored.push({ provider: p.id, model: p.model, role: p.role, answer });
      return vote;
    } catch (err) {
      if (err instanceof ProviderQuotaHit) {
        ctx.spent.add(p.id);
        if (!ctx.stats.spent.includes(p.id)) ctx.stats.spent.push(p.id);
      } else if (err instanceof ProviderUnavailable) {
        ctx.spent.add(p.id);
        if (!ctx.stats.unavailable.includes(err.message)) ctx.stats.unavailable.push(err.message);
      } else {
        ctx.stats.errors.push(`${p.id}: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
      }
      return null;
    }
  };

  const have = new Set(stored.filter((s) => s.role === "juror").map((s) => s.provider));
  const pool = jurors().filter((p) => p.available() && !have.has(p.id));
  const prompt = jurorPrompt(input);
  const usable = () => votes.filter((v) => v.role === "juror" && v.scope !== null);

  // Two jurors with a usable answer: the first two asked together, then one
  // at a time if either abstained or failed.
  const live = pool.filter((p) => !ctx.spent.has(p.id));
  const needed = Math.max(0, 2 - usable().length);
  const firstWave = live.slice(0, needed);
  for (const v of await Promise.all(firstWave.map((p) => call(p, prompt)))) if (v) votes = [...votes, v];
  for (const p of live.slice(needed)) {
    if (usable().length >= 2) break;
    const v = await call(p, prompt);
    if (v) votes = [...votes, v];
  }
  // A third when the two disagree.
  const scopes = new Set(usable().map((v) => v.scope));
  if (scopes.has("in") && scopes.has("out")) {
    for (const p of pool.filter((x) => !votes.some((v) => v.provider === x.id))) {
      const v = await call(p, prompt);
      if (v) {
        votes = [...votes, v];
        break;
      }
    }
  }

  // The senior reviewer, only where the arbiter still has no answer.
  const verdict = arbitrateScope(rules, votes);
  const needsSenior = (verdict.kind === "review" || verdict.kind === "unclear") && !votes.some((v) => v.role === "senior");
  const hasTwoReadings = usable().length >= 2 || (usable().length >= 1 && verdict.kind === "review");
  if (needsSenior && hasTwoReadings) {
    for (const p of seniors().filter((x) => x.available())) {
      const v = await call(p, seniorPrompt(input, votes, ctx.examples));
      if (v) {
        votes = [...votes, v];
        break;
      }
    }
  }
  ctx.stats.judged++;
  return votes;
}

/** Prepare providers that need an async check (the laptop's Ollama). */
export async function warmUp(): Promise<{ jurors: string[]; seniors: string[] }> {
  await ollamaAvailable();
  return {
    jurors: jurors().filter((p) => p.available()).map((p) => `${p.id} (${p.model})`),
    seniors: seniors().filter((p) => p.available()).map((p) => `${p.id} (${p.model})`),
  };
}
