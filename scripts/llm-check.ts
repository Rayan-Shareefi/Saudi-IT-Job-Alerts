/**
 * Which free models can this machine use right now, and do they still read
 * postings correctly?
 *
 *   npm run llm:check
 *
 * Free models are renamed, retired and re-limited without notice (Google cut
 * Gemini's free tier in December 2025). This lists what each key can reach,
 * then runs three canary postings with known answers through every configured
 * juror and the senior reviewer, and checks the answers through the same
 * evidence check the jury uses. A model that fails its canaries should be
 * replaced (GEMINI_MODEL, GEMMA_MODEL, GROQ_MODEL, GROQ_SENIOR_MODEL, OLLAMA_MODEL).
 *
 * Spends at most ~10 requests of free quota.
 */
import "./load-env";
import { envStr } from "../src/lib/env";
import { jurorPrompt } from "../src/lib/judge/prompt";
import { jurors, ollamaAvailable, seniors, type JudgeProvider } from "../src/lib/judge/providers";
import { parseAnswer, verifyAnswer } from "../src/lib/judge/verify";

const CANARIES = [
  {
    name: "SOC analyst (in, 2 years)",
    title: "Security Operations Analyst",
    text: "Responsibilities: Monitor SIEM alerts in Microsoft Sentinel and triage security incidents. Escalate confirmed incidents to Tier 2. Requirements: 2+ years of experience in a security operations center. Location: Riyadh, Saudi Arabia.",
    want: { scope: "in", years: 2 },
  },
  {
    name: "data engineer on Azure (out)",
    title: "Data Engineer",
    text: "Responsibilities: Build ETL pipelines in Azure Data Factory and Databricks, model data in Synapse and publish Power BI reports. Requirements: 3 years of experience in data engineering. Location: Riyadh.",
    want: { scope: "out", years: 3 },
  },
  {
    name: "cookie banner (not a job)",
    title: "Manage Preferences",
    text: "We use cookies to improve your experience. Strictly necessary cookies are always active. Accept all or manage your preferences.",
    want: { scope: "out", years: null, notJob: true },
  },
];

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
  let ok = 0;
  const notes: string[] = [];
  for (const c of CANARIES) {
    try {
      const raw = await p.call(jurorPrompt({ title: c.title, company: "Canary Co", location: "Riyadh", text: c.text, textQuality: "full" }));
      const a = parseAnswer(raw);
      if (!a) {
        notes.push(`${c.name}: unparseable reply`);
        continue;
      }
      const v = verifyAnswer(a, { title: c.title, text: c.text, location: "Riyadh" }, { provider: p.id, model: p.model, role: "juror" });
      const scopeOk = v.scope === c.want.scope;
      const yearsOk = c.want.years === null || v.minYears === c.want.years;
      if (scopeOk && yearsOk) ok++;
      else notes.push(`${c.name}: scope=${v.scope} years=${v.minYears} bad-quotes=${v.hallucinated}`);
    } catch (err) {
      notes.push(`${c.name}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
      break;
    }
  }
  console.log(`  ${p.id.padEnd(14)} ${p.model.padEnd(28)} ${ok}/${CANARIES.length}${notes.length ? `  - ${notes.join("; ")}` : ""}`);
}

async function main(): Promise<void> {
  console.log("Models each key can use:\n");
  await listGemini();
  await listGroq();
  const local = await ollamaAvailable();
  console.log(`Ollama   : ${local ? `running (${envStr("OLLAMA_URL") ?? "http://127.0.0.1:11434"})` : "not running on this machine"}`);

  console.log("\nCanary postings (answers checked by the evidence check):\n");
  for (const p of [...jurors(), ...seniors()].filter((x) => x.available())) await canary(p);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
