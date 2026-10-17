/**
 * Move each AI role to a newer free model when one is available and proven.
 *
 *   npm run llm:upgrade            # check, and switch where a newer model passes
 *   npm run llm:upgrade -- --dry   # report only, change nothing
 *
 * Run weekly by the laptop worker; docs/ai-models.md is the owner's guide.
 * For each role (gemini, gemma, groq, groq-senior, gemini-senior):
 *
 *   1. test the model in use on the canary postings (judge/canaries.ts);
 *   2. list the models the free key can use and keep the newer ones of the
 *      same kind - stable names only: no preview, experimental, audio...;
 *   3. test up to two of them;
 *   4. switch only to one that gets EVERY canary right, and only if it is
 *      newer (bigger, for the senior on Groq) - or if the model in use has
 *      started getting canaries wrong or was retired.
 *
 * A switch is written to model_choices, which every machine reads, and the
 * owner gets one email listing the changes. A model pinned in .env.local
 * (GEMINI_MODEL, ...) is never changed. Nothing here can make a decision
 * worse by itself: every answer is still checked against the posting by code
 * (judge/verify.ts), and a posting still needs two signals to be shown or
 * hidden.
 */
import "./load-env";
import { sendSystemAlert } from "../src/lib/alerts";
import { supabaseAdmin } from "../src/lib/db";
import { envStr } from "../src/lib/env";
import { runCanaries, type CanaryResult } from "../src/lib/judge/canaries";
import { DEFAULT_MODELS, MODEL_ROLES, PIN_VAR, loadModelChoices, modelsFor, providerFor, type ModelRole } from "../src/lib/judge/providers";

const DRY = process.argv.includes("--dry");
const MAX_CANDIDATES = 2;

type Better = "version" | "size" | "none";

/** Which listed models can fill a role, and what "newer" means for it. */
const KIND: Record<ModelRole, { list: "gemini" | "groq"; match: RegExp; better: Better }> = {
  gemini: { list: "gemini", match: /^gemini-(?:\d+(?:\.\d+)?-)?flash-lite(?:-latest)?$/, better: "version" },
  "gemini-senior": { list: "gemini", match: /^gemini-(?:\d+(?:\.\d+)?-)?flash(?:-latest)?$/, better: "version" },
  gemma: { list: "gemini", match: /^gemma-\d+(?:\.\d+)?-[a-z0-9-]*it$/, better: "version" },
  // Groq hosts unrelated families side by side, and their names do not say
  // which is newer: the juror moves only when its model fails or is retired.
  groq: { list: "groq", match: /./, better: "none" },
  "groq-senior": { list: "groq", match: /./, better: "size" },
};

/** Never candidates: not chat models, or not stable. */
const NOT_A_CANDIDATE = /whisper|orpheus|guard|safeguard|tts|playai|compound|allam|distil|embed|audio|image|vision|native|preview|exp\b|experimental|tuning/i;

/** Google moves a -latest alias to its newest stable model by itself, so it counts as the newest. */
function versionOf(model: string): number {
  if (/latest/.test(model)) return Number.POSITIVE_INFINITY;
  const m = model.match(/^(?:gemini|gemma)-(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/** Parameters in billions, from the name ("gpt-oss-120b" -> 120); 0 if it does not say. */
function sizeOf(model: string): number {
  const m = model.match(/(\d+(?:\.\d+)?)b\b/i);
  return m ? Number(m[1]) : 0;
}

function isBetter(better: Better, candidate: string, current: string): boolean {
  if (better === "version") return versionOf(candidate) > versionOf(current);
  if (better === "size") return sizeOf(candidate) > sizeOf(current);
  return false;
}

function preference(better: Better): (a: string, b: string) => number {
  return better === "size"
    ? (a, b) => sizeOf(b) - sizeOf(a) || versionOf(b) - versionOf(a)
    : (a, b) => versionOf(b) - versionOf(a) || sizeOf(b) - sizeOf(a);
}

const listed = new Map<string, string[]>();
async function listModels(kind: "gemini" | "groq"): Promise<string[]> {
  if (listed.has(kind)) return listed.get(kind) as string[];
  let names: string[] = [];
  try {
    if (kind === "gemini") {
      const key = envStr("GEMINI_API_KEY");
      if (key) {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": key } });
        const j = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
        names = (j.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace("models/", ""));
      }
    } else {
      const key = envStr("GROQ_API_KEY");
      if (key) {
        const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${key}` } });
        const j = (await res.json()) as { data?: Array<{ id: string; active?: boolean }> };
        names = (j.data ?? []).filter((m) => m.active !== false).map((m) => m.id);
      }
    }
  } catch {
    /* no list: only the model in use is checked */
  }
  listed.set(kind, names);
  return names;
}

const score = (r: CanaryResult) => `${r.passed}/${r.total}`;
const passesAll = (r: CanaryResult) => !r.unreachable && r.passed === r.total;

async function test(role: ModelRole, model: string, stopAfter: number): Promise<CanaryResult> {
  const r = await runCanaries(providerFor(role, [model]), stopAfter);
  console.log(`    ${model.padEnd(30)} ${score(r)}${r.notes.length ? `  - ${r.notes.slice(0, 2).join("; ")}` : ""}`);
  return r;
}

async function main(): Promise<void> {
  const chosen = await loadModelChoices();
  const db = supabaseAdmin();
  const changes: string[] = [];

  for (const role of MODEL_ROLES) {
    const pinned = envStr(PIN_VAR[role]);
    const current = modelsFor(role)[0];
    console.log(`\n${role}: using ${current}${pinned ? " (pinned in settings)" : chosen[role] ? " (chosen by an earlier check)" : " (built-in default)"}`);
    if (pinned) {
      console.log(`  pinned by ${PIN_VAR[role]} - not changed. Remove it from .env.local to let this check choose.`);
      continue;
    }
    if (!providerFor(role, [current]).available()) {
      console.log("  no API key for this role on this machine - skipped");
      continue;
    }

    const cur = await test(role, current, Infinity);
    if (cur.unreachable && /quota/i.test(cur.notes.join(" "))) {
      console.log("  out of free quota today - checked again next week");
      continue;
    }
    const kind = KIND[role];
    const all = (await listModels(kind.list)).filter((m) => kind.match.test(m) && !NOT_A_CANDIDATE.test(m) && m !== current);
    let pool: string[];
    if (passesAll(cur)) {
      pool = all.filter((m) => isBetter(kind.better, m, current)).sort(preference(kind.better)).slice(0, MAX_CANDIDATES);
      if (pool.length === 0) {
        console.log("  passes every canary, and nothing newer of its kind is offered - kept");
      }
    } else {
      // Failing or retired: the known-good defaults first, then anything of the kind.
      const defaults = DEFAULT_MODELS[role].filter((m) => m !== current && (all.includes(m) || !listed.get(kind.list)?.length));
      pool = [...new Set([...defaults, ...all.sort(preference(kind.better))])].slice(0, MAX_CANDIDATES + 1);
      console.log(`  the model in use gets ${score(cur)} - looking for a replacement`);
    }

    let pick: { model: string; result: CanaryResult } | null = null;
    const tried: Array<{ model: string; result: CanaryResult }> = [];
    for (const m of pool) {
      const result = await test(role, m, 1);
      tried.push({ model: m, result });
      if (passesAll(result)) {
        pick = { model: m, result };
        break;
      }
    }
    // Nothing perfect, while the one in use is failing: the best that beats it.
    if (!pick && !passesAll(cur)) {
      const best = tried.filter((t) => !t.result.unreachable && t.result.passed > cur.passed).sort((a, b) => b.result.passed - a.result.passed)[0];
      if (best) pick = best;
    }

    const now = new Date().toISOString();
    if (!pick) {
      if (pool.length) console.log("  no candidate got every canary right - kept");
      // Only a row that already exists is touched: a default written down here
      // would outrank a better default shipped later in the code.
      if (!DRY && chosen[role]) await db.from("model_choices").update({ score: score(cur), checked_at: now }).eq("role", role);
      continue;
    }

    const reason = passesAll(cur) ? `newer and gets every canary right (${score(pick.result)})` : `the model in use got ${score(cur)}; this one gets ${score(pick.result)}`;
    console.log(`  SWITCH ${current} -> ${pick.model}: ${reason}`);
    changes.push(`${role}: ${current} -> ${pick.model} (${reason})`);
    if (DRY) continue;
    await db.from("model_choices").upsert({ role, model: pick.model, previous: current, score: score(pick.result), reason, checked_at: now, changed_at: now }, { onConflict: "role" });
    await db.from("audit_log").insert({ actor: "llm-upgrade", action: "model-change", detail: { role, from: current, to: pick.model, reason } });
  }

  if (changes.length && !DRY) {
    await sendSystemAlert(
      "models",
      "AI models updated",
      `The weekly model check moved to newer free models that got every test posting right:\n${changes.join("\n")}\n\nTo undo one, see docs/ai-models.md.`,
    ).catch(() => false);
  }
  console.log(`\n${changes.length ? `${changes.length} change(s)${DRY ? " (dry run - nothing written)" : ""}` : "no changes"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
