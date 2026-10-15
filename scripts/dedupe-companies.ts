/**
 * Finds employers listed twice.
 *
 * "solutions by stc" and "Saudi Telecom Solutions" are the same company with
 * the same careers URL, so the board polled one site twice and showed its
 * postings under two names. Anyone reading it sees two employers where there is
 * one, and the duplicate detection between aggregator and company boards cannot
 * help, because both copies are company boards.
 *
 * Reports rather than edits: which of two names is the right one is a judgement
 * call, and getting it wrong renames an employer for good.
 *
 *   npx tsx scripts/dedupe-companies.ts
 */
import { COMPANIES } from "../src/lib/sources/companies";

/** Normalise a URL enough to spot "the same page, written differently". */
function urlKey(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return raw.toLowerCase();
  }
}

/** Normalise a name enough to spot "the same company, written differently". */
function nameKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(company|co|group|holding|holdings|ltd|llc|inc|plc|the|for|and|of)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function main(): void {
  const byUrl = new Map<string, string[]>();
  const byName = new Map<string, string[]>();

  for (const c of COMPANIES) {
    const u = urlKey(c.careersUrl);
    byUrl.set(u, [...(byUrl.get(u) ?? []), c.name]);
    const n = nameKey(c.name);
    if (n.length >= 4) byName.set(n, [...(byName.get(n) ?? []), c.name]);
  }

  const urlDupes = [...byUrl.entries()].filter(([, names]) => names.length > 1);
  const nameDupes = [...byName.entries()].filter(([, names]) => names.length > 1);

  console.log(`${COMPANIES.length} employers on file\n`);

  console.log(`Same careers URL (${urlDupes.length}):`);
  for (const [url, names] of urlDupes) {
    console.log(`  ${url}`);
    for (const n of names) console.log(`      ${n}`);
  }
  if (urlDupes.length === 0) console.log("  none");

  console.log(`\nSame name once normalised (${nameDupes.length}):`);
  for (const [, names] of nameDupes) console.log(`  ${names.join("  ==  ")}`);
  if (nameDupes.length === 0) console.log("  none");

  const total = urlDupes.length + nameDupes.length;
  console.log(
    total > 0
      ? `\n${total} duplicate group(s). Remove the redundant entry from src/lib/sources/companies.ts.`
      : `\nno duplicates`,
  );
}

main();
