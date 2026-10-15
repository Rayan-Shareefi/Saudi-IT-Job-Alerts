/**
 * Re-apply every rule to the postings already stored. No fetching, no model
 * calls, no deletes.
 *
 *   npm run reclassify              # recompute and write states
 *   npm run reclassify -- --dry     # show what would move, write nothing
 *
 * Recomputes, per posting: is it a job (plausible.ts), is it cyber/cloud
 * (scope.ts plus any cached, re-verified model votes), years of experience
 * (experience.ts), Riyadh, age, and the user's own Keep/Hide - then moves it
 * between show / unclassified / needs_review / hidden.
 *
 * This used to hard-DELETE rows a rule rejected, which is how wrong rules
 * destroyed real vacancies (HANDOVER §6). Now a rule fix plus a re-run brings
 * back whatever the old rule wrongly hid.
 */
import "dotenv/config";
import { recomputeStates } from "../src/lib/review";

const DRY = process.argv.includes("--dry");

async function main(): Promise<void> {
  const results = await recomputeStates({ dry: DRY, log: (s) => console.log(s) });

  const label = (state: string, reason: string | null) => (state === "hidden" ? `hidden:${reason}` : state);
  const matrix = new Map<string, number>();
  const samples = new Map<string, string[]>();
  const after: Record<string, number> = {};
  for (const x of results) {
    const before = label(x.row.review_state, x.row.hidden_reason);
    const now = label(x.decision.state, x.decision.hiddenReason);
    after[now] = (after[now] ?? 0) + 1;
    if (before === now) continue;
    const k = `${before.padEnd(26)} -> ${now}`;
    matrix.set(k, (matrix.get(k) ?? 0) + 1);
    const list = samples.get(k) ?? [];
    if (list.length < 4) list.push(`${x.row.title.slice(0, 54)}  (${x.decision.note.slice(0, 70)})`);
    samples.set(k, list);
  }

  console.log(`\nboard after recompute (${results.length} active postings):`);
  for (const [k, n] of Object.entries(after).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${n}`);

  console.log(`\nmoves:`);
  for (const [k, n] of [...matrix.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
    for (const s of samples.get(k) ?? []) console.log(`           ${s}`);
  }
  if (DRY) console.log(`\n--dry given; nothing written`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
