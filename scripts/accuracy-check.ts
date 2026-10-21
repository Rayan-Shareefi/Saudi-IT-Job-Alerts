/**
 * The weekly accuracy check: is what the board shows really right?
 *
 *   npx tsx scripts/accuracy-check.ts               # 20 jobs (the laptop runs this weekly)
 *   npx tsx scripts/accuracy-check.ts --sample 5    # fewer
 *   npx tsx scripts/accuracy-check.ts --dry         # report only: no record, no email
 *
 * A random sample of the jobs on the board - not one the owner already kept
 * (that is final), not one checked in the last 30 days - is read again, from
 * scratch, by the strongest free model available (the senior reviewer's
 * models first). Its claims count only with quotes found in the posting, as
 * everywhere else (judge/verify.ts). A job is flagged when the reading says it
 * is not security or cloud work, not in Riyadh, asks for 5+ years, or is not
 * a vacancy at all.
 *
 * A flag never hides a job: one model is one signal. It puts a "Double-check"
 * badge on the card and lists the job in one email; the owner's Keep or Hide
 * settles it for good.
 */
import "./load-env";
import { sendAccuracyReport } from "../src/lib/alerts";
import { fetchAllRows, supabaseAdmin } from "../src/lib/db";
import { jurorPrompt } from "../src/lib/judge/prompt";
import { jurors, seniors, type JudgeProvider } from "../src/lib/judge/providers";
import { inputOf, warmUp, type JudgeRow } from "../src/lib/judge/run";
import { parseAnswer, verifyAnswer } from "../src/lib/judge/verify";
import type { Vote } from "../src/lib/judge/types";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SAMPLE = Number(arg("sample") ?? 20);
const DRY = process.argv.includes("--dry");
const DEADLINE = Date.now() + 35 * 60_000;

interface Row extends JudgeRow {
  url: string;
}

/** What a fresh, verified reading says is wrong with a shown job, if anything. */
export function problemsIn(vote: Vote): string[] {
  const out: string[] = [];
  if (vote.isJob === false) out.push("may not be a job posting");
  if (vote.scope === "out") out.push("is not security or cloud work");
  if (vote.riyadh === false) out.push(`may not be in Riyadh ("${(vote.locationEvidence ?? "").slice(0, 80)}")`);
  if (vote.minYears !== null && vote.minYears >= 5) out.push(`asks for ${vote.minYears}+ years ("${(vote.yearsEvidence ?? "").slice(0, 80)}")`);
  return out;
}

async function main(): Promise<void> {
  const db = supabaseAdmin();
  const rows = await fetchAllRows<Row>(
    (from, to) =>
      db
        .from("jobs")
        .select("id,title,company,location_text,department,description_text,text_hash,text_quality,source_kind,url")
        .eq("review_state", "show")
        .eq("is_active", true)
        .is("removed_at", null)
        .is("duplicate_of", null)
        .is("human_override", null)
        .in("text_quality", ["full", "partial"])
        .range(from, to),
    "shown jobs",
  );
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: recent } = await db.from("accuracy_checks").select("job_id").gte("checked_at", since);
  const done = new Set((recent ?? []).map((r) => String(r.job_id)));
  const pool = rows.filter((r) => !done.has(r.id));
  // A fair random sample (Fisher-Yates), so every shown job gets its turn.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sample = pool.slice(0, SAMPLE);
  console.log(`${rows.length} shown jobs with full text; ${pool.length} not checked in 30 days; checking ${sample.length}`);
  if (sample.length === 0) return;

  await warmUp().catch(() => {});
  // The strongest free models first; the jurors only if none of those answers.
  const readers: JudgeProvider[] = [...seniors(), ...jurors()].filter((p) => p.available());
  if (readers.length === 0) {
    console.log("no AI model available - nothing checked");
    return;
  }

  const flagged: Array<{ title: string; company: string; url: string; why: string }> = [];
  let checked = 0;
  for (const row of sample) {
    if (Date.now() > DEADLINE) {
      console.log("time limit reached - the rest wait for next week");
      break;
    }
    let vote: Vote | null = null;
    let reader: JudgeProvider | null = null;
    for (const p of readers) {
      try {
        const answer = parseAnswer(await p.call(jurorPrompt(inputOf(row))));
        if (!answer) continue;
        vote = verifyAnswer(answer, { title: row.title, text: row.description_text ?? "", location: row.location_text }, { provider: p.id, model: p.model, role: p.role });
        reader = p;
        break;
      } catch {
        /* the next model */
      }
    }
    if (!vote || !reader) {
      console.log(`  skip  ${row.title.slice(0, 60)} - no model answered`);
      continue;
    }
    checked++;
    const problems = problemsIn(vote);
    const why = problems.join("; ");
    console.log(`  ${problems.length ? "FLAG" : "ok  "}  ${row.title.slice(0, 55).padEnd(55)} ${row.company.slice(0, 22).padEnd(22)} ${why.slice(0, 90)}`);
    if (problems.length) flagged.push({ title: row.title, company: row.company, url: row.url, why });
    if (!DRY) {
      await db.from("accuracy_checks").insert({ job_id: row.id, provider: reader.id, model: reader.model, flagged: problems.length > 0, why: why || null });
    }
  }

  console.log(`\nchecked ${checked}: ${checked - flagged.length} look right, ${flagged.length} to double-check`);
  if (!DRY && flagged.length) {
    const sent = await sendAccuracyReport(checked, flagged).catch(() => false);
    console.log(sent ? "emailed the list" : "not emailed (no email settings, or today's allowance is used)");
  }
}

const invokedDirectly = process.argv[1]?.endsWith("accuracy-check.ts");
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
