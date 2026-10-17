/**
 * Rebuild the duplicate groups: one card per vacancy, "Also on ..." badges.
 *
 *   npm run dedupe             # recompute and write
 *   npm run dedupe -- --dry    # print the groups, write nothing
 *
 * Reversible by construction: copies get duplicate_of, nothing is deleted,
 * and every run starts from scratch. See src/lib/dedupe.ts for the guards.
 */
import "./load-env";
import { rebuildDuplicates } from "../src/lib/dedupe";

const DRY = process.argv.includes("--dry");

async function main(): Promise<void> {
  const groups = await rebuildDuplicates({ dry: DRY, log: (s) => console.log(s) });
  const byHow: Record<string, number> = {};
  for (const g of groups) for (const h of g.how) byHow[h] = (byHow[h] ?? 0) + 1;
  console.log(`matched by: ${Object.entries(byHow).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}`);
  for (const g of groups.slice(0, Number(process.argv[process.argv.indexOf("--show") + 1]) || 25)) {
    console.log(`\n  [${g.primary.source_kind}] ${g.primary.title}  @ ${g.primary.company}`);
    for (const c of g.copies) console.log(`      = [${c.source_kind}] ${c.title}  @ ${c.company}`);
  }
  if (DRY) console.log(`\n--dry given; nothing written`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
