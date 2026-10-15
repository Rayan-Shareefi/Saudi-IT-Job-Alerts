/**
 * Folds data/link-rescue.json back into companies.ts.
 *
 *   url-fixed          -> careersUrl replaced
 *   blocked-but-valid  -> left alone; the URL is fine, the site just refuses
 *                         bots. It stays a working manual link in the directory.
 *   ats-found          -> nothing to write here; the next discovery run probes
 *                         the same slugs and will pick the board up itself.
 *   dead               -> listed for a human to supply the right URL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { RescueResult } from "./rescue-links";

const DRY = process.argv.includes("--dry");
const FILE = "src/lib/sources/companies.ts";

function main(): void {
  const { results } = JSON.parse(readFileSync("data/link-rescue.json", "utf8")) as {
    results: RescueResult[];
  };
  const fixes = new Map(
    results.filter((r) => r.outcome === "url-fixed" && r.workingUrl).map((r) => [r.company, r.workingUrl!]),
  );

  const lines = readFileSync(FILE, "utf8").split("\n");
  let applied = 0;

  const out = lines.map((line) => {
    const m = line.match(
      /^(\s*)\{ name: "([^"]+)", careersUrl: "([^"]+)"(, sector: "[^"]+", priority: \d(?:, careersEmail: "[^"]*")?) \},\s*$/,
    );
    if (!m) return line;
    const [, indent, name, , rest] = m;
    const fixed = fixes.get(name);
    if (!fixed) return line;
    applied++;
    return `${indent}{ name: "${name}", careersUrl: "${fixed}"${rest} },`;
  });

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`rescue outcomes  : ${JSON.stringify(counts)}`);
  console.log(`urls updated     : ${applied}`);

  const ats = results.filter((r) => r.outcome === "ats-found");
  if (ats.length > 0) {
    console.log(`\nATS boards found (discovery will wire these up):`);
    for (const r of ats) console.log(`  ${r.company.slice(0, 38).padEnd(38)} ${r.atsAdapter}:${r.atsHandle}`);
  }

  const dead = results.filter((r) => r.outcome === "dead");
  if (dead.length > 0) {
    console.log(`\nno route found - paste a working careers URL for these:`);
    for (const r of dead) console.log(`  ${r.company.slice(0, 38).padEnd(38)} ${r.originalUrl}`);
  }

  if (DRY) {
    console.log(`\n--dry given; ${FILE} left unchanged`);
    return;
  }
  writeFileSync(FILE, out.join("\n"));
  console.log(`\nwrote ${FILE}`);
}

main();
