/**
 * Run the model jury over postings the rules could not settle, then recompute
 * every posting's state.
 *
 *   npm run judge                       # up to 60 postings, every configured model
 *   npm run judge -- --max 300          # more (the backlog)
 *   npm run judge -- --providers gemini,gemma
 *   npm run judge -- --deadline-min 40  # stop starting new postings after 40 min
 *   npm run judge -- --no-apply         # judge, but do not write states
 *
 * Free models only, every call through the shared budget (src/lib/budget.ts).
 * Each posting text is read once per prompt version; re-runs cost nothing.
 */
import "./load-env";
import { judgeScope } from "../src/lib/scope";
import { recompute, recomputeStates, loadActiveRows } from "../src/lib/review";
import { judgeOne, loadJudgements, recentExamples, votesFor, warmUp, AUDIT_SAMPLE, type JuryStats } from "../src/lib/judge/run";
import { jurors, seniors } from "../src/lib/judge/providers";
import { shortHash } from "../src/lib/company-key";
import { normalize } from "../src/lib/text";
import { mapLimit } from "../src/lib/http";
import { detectExperience } from "../src/lib/experience";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(`--${n}`);

async function main(): Promise<void> {
  const max = Number(arg("max") ?? 60);
  const deadlineMin = Number(arg("deadline-min") ?? 0);
  const deadline = deadlineMin > 0 ? Date.now() + deadlineMin * 60_000 : Infinity;
  const only = arg("providers")?.split(",").map((s) => s.trim());
  if (only) {
    // Restrict by blanking the others' availability for this process.
    for (const p of [...jurors(), ...seniors()]) if (!only.includes(p.id)) process.env[`DISABLE_${p.id.toUpperCase().replace(/-/g, "_")}`] = "1";
  }

  const ready = await warmUp();
  console.log(`jurors : ${ready.jurors.join(", ") || "none configured"}`);
  console.log(`senior : ${ready.seniors.join(", ") || "none configured"}\n`);

  const rows = await loadActiveRows();
  for (const r of rows) r.text_hash = shortHash(normalize(r.description_text ?? ""));
  const judgements = await loadJudgements(rows.map((r) => r.text_hash ?? ""));

  /*
   * The queue: postings whose place on the board a reading could change.
   *
   * Decided in memory with the same arbiter the board uses, so quota is never
   * spent on a posting already hidden for its age, location or for not being
   * a job, nor on a duplicate copy (its primary is read instead). Rows the
   * rules settled decisively are read only as an audit sample, which is how
   * the rules' own error rate gets measured.
   *
   * Order: student intakes first, then what the rules lean towards keeping,
   * then the unclear middle, then what they lean towards dropping - so a short
   * run spends its quota where it matters most.
   */
  const settledByOtherRules = new Set(["too_old", "stale", "closed", "not_riyadh", "not_a_job", "human"]);
  const queue = rows
    .filter((r) => r.human_override === null && !r.duplicate_of)
    .map((r) => {
      const stored = judgements.get(r.text_hash ?? "") ?? [];
      const decision = recompute(r, votesFor(r, stored)).decision;
      const scope = judgeScope(r.title, r.department, r.description_text, (r.text_quality ?? "none") as never);
      const exp = detectExperience(r.title, r.description_text ?? "");
      const audit = scope.confidence === "decisive" && Number.parseInt((r.text_hash ?? "0").slice(0, 4), 16) / 0xffff < AUDIT_SAMPLE;
      const open = decision.state === "unclassified" || decision.state === "needs_review";
      const worth = !settledByOtherRules.has(decision.hiddenReason ?? "") && (open || audit);
      const priority =
        (exp.source === "programme" ? 0 : 10) +
        (scope.verdict === "in" ? 0 : scope.verdict === "unclear" ? 1 : 2) +
        (scope.confidence === "decisive" ? 5 : 0);
      return { r, worth, audit, priority, stored };
    })
    .filter((x) => x.worth && x.stored.filter((s) => s.role === "juror").length < 2)
    .sort((a, b) => a.priority - b.priority);

  console.log(`${queue.length} posting(s) need a reading; judging up to ${max}\n`);

  const stats: JuryStats = { judged: 0, calls: 0, byProvider: {}, spent: [], unavailable: [], errors: [] };
  const spent = new Set<string>();
  for (const p of [...jurors(), ...seniors()]) if (process.env[`DISABLE_${p.id.toUpperCase().replace(/-/g, "_")}`]) spent.add(p.id);
  const examples = await recentExamples();

  // Two postings at a time: each model's own pacing (providers.ts) keeps the
  // per-minute limits, and the waiting on slow models overlaps.
  let stop = "";
  await mapLimit(queue.slice(0, max), Number(arg("concurrency") ?? 2), async ({ r, audit }) => {
    if (stop) return;
    if (Date.now() > deadline) {
      stop = "deadline reached";
      return;
    }
    if ([...jurors()].filter((p) => p.available() && !spent.has(p.id)).length === 0) {
      stop = "every juror is out of free quota for now";
      return;
    }
    const votes = await judgeOne(r, judgements.get(r.text_hash ?? "") ?? [], { stats, spent, examples, force: audit });
    const summary = votes.map((v) => `${v.provider}:${v.scope ?? "-"}${v.hallucinated ? `(${v.hallucinated} bad quote)` : ""}`).join(" ");
    console.log(`  ${r.title.slice(0, 50).padEnd(50)} ${summary}`);
  });
  if (stop) console.log(stop);

  console.log(`\njudged ${stats.judged} posting(s) with ${stats.calls} model call(s)`);
  for (const [p, n] of Object.entries(stats.byProvider)) console.log(`  ${p.padEnd(14)} ${n}`);
  if (stats.spent.length) console.log(`out of free quota for now: ${stats.spent.join(", ")}`);
  if (stats.unavailable.length) console.log(`unavailable: ${stats.unavailable.join("; ")}`);
  if (stats.errors.length) {
    console.log(`errors (${stats.errors.length}):`);
    for (const e of stats.errors.slice(0, 10)) console.log(`  ${e}`);
  }

  if (!has("no-apply")) {
    const results = await recomputeStates({ log: (s) => console.log(s) });
    const counts: Record<string, number> = {};
    for (const x of results) {
      const k = x.decision.state === "hidden" ? `hidden:${x.decision.hiddenReason}` : x.decision.state;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    console.log("\nboard now:");
    for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
