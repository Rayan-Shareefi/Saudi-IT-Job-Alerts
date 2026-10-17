/**
 * Which free models can this machine use right now, and do they still read
 * postings correctly?
 *
 *   npm run llm:check
 *
 * Free models are renamed, retired and re-limited without notice (Google cut
 * Gemini's free tier in December 2025). This lists what each key can reach,
 * then runs the canary postings with known answers (judge/canaries.ts) through
 * every configured juror and the senior reviewer, and checks the answers
 * through the same evidence check the jury uses.
 *
 * Spends ~7 requests of free quota per model. `npm run llm:upgrade` uses the
 * same canaries to move to newer models by itself (weekly, on the laptop);
 * docs/ai-models.md explains both.
 */
import "./load-env";
import { envStr } from "../src/lib/env";
import { runCanaries } from "../src/lib/judge/canaries";
import { jurors, loadModelChoices, ollamaAvailable, seniors, type JudgeProvider } from "../src/lib/judge/providers";

async function listGemini(): Promise<void> {
  const key = envStr("GEMINI_API_KEY");
  if (!key) return console.log("Gemini   : GEMINI_API_KEY not set");
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
  if (!res.ok) return console.log(`Gemini   : HTTP ${res.status}`);
  const j = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
  const names = (j.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace("models/", ""));
  console.log(`Gemini   : ${names.filter((n) => /flash|gemma/.test(n) && !/tts|image|audio/.test(n)).join(", ")}`);
}

async function listGroq(): Promise<void> {
  const key = envStr("GROQ_API_KEY");
  if (!key) return console.log("Groq     : GROQ_API_KEY not set (free key: console.groq.com)");
  const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) return console.log(`Groq     : HTTP ${res.status}`);
  const j = (await res.json()) as { data?: Array<{ id: string }> };
  console.log(`Groq     : ${(j.data ?? []).map((m) => m.id).join(", ")}`);
}

async function canary(p: JudgeProvider): Promise<void> {
  const r = await runCanaries(p);
  console.log(`  ${p.id.padEnd(16)} ${p.model.padEnd(28)} ${r.passed}/${r.total}${r.notes.length ? `  - ${r.notes.join("; ")}` : ""}`);
}

async function main(): Promise<void> {
  console.log("Models each key can use:\n");
  await listGemini();
  await listGroq();
  const [local] = await Promise.all([ollamaAvailable(), loadModelChoices()]);
  console.log(`Ollama   : ${local ? `running (${envStr("OLLAMA_URL") ?? "http://127.0.0.1:11434"})` : "not running on this machine"}`);

  console.log("\nCanary postings (answers checked by the evidence check):\n");
  for (const p of [...jurors(), ...seniors()].filter((x) => x.available())) await canary(p);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
