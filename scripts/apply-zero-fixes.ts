/**
 * Applies the URL replacements found by audit-zero.
 *
 * Only `landing-page` findings are applied: those are cases where the seeded
 * URL was a careers front page and a deeper page with real postings was found
 * and verified. Everything else is left alone, because "no openings right now"
 * is not a URL problem.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { ZeroFinding } from "./audit-zero";

const DRY = process.argv.includes("--dry");
const FILE = "src/lib/sources/companies.ts";

function main(): void {
  const { findings } = JSON.parse(readFileSync("data/zero-audit.json", "utf8")) as {
    findings: ZeroFinding[];
  };
  const fixes = new Map(
    findings
      .filter((f) => f.verdict === "landing-page" && f.suggestedUrl)
      .map((f) => [f.company, f.suggestedUrl!]),
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

  console.log(`landing-page URLs to replace: ${fixes.size}`);
  console.log(`applied                     : ${applied}`);

  if (DRY) {
    console.log(`\n--dry given; ${FILE} left unchanged`);
    return;
  }
  writeFileSync(FILE, out.join("\n"));
  console.log(`\nwrote ${FILE} - now run sources:discover to re-resolve them`);
}

main();
