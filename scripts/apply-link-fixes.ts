/**
 * Rewrites companies.ts from the link-check report.
 *
 * Replaces careers URLs that were repaired, attaches any careers@ address that
 * was harvested, and prints what still needs a human decision.
 *
 *   npx tsx scripts/apply-link-fixes.ts            # apply
 *   npx tsx scripts/apply-link-fixes.ts --dry      # show the diff only
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { LinkResult } from "./check-links";

const DRY = process.argv.includes("--dry");
const FILE = "src/lib/sources/companies.ts";

interface Report {
  checkedAt: string;
  results: LinkResult[];
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function main(): void {
  const report = JSON.parse(readFileSync("data/link-check.json", "utf8")) as Report;
  const byName = new Map(report.results.map((r) => [r.company, r]));

  const src = readFileSync(FILE, "utf8");
  const lines = src.split("\n");

  let urlsFixed = 0;
  let emailsAdded = 0;

  const out = lines.map((line) => {
    const m = line.match(/^(\s*)\{ name: "([^"]+)", careersUrl: "([^"]+)", sector: "([^"]+)", priority: (\d)(?:, careersEmail: "[^"]*")? \},\s*$/);
    if (!m) return line;

    const [, indent, name, currentUrl, sector, priority] = m;
    const r = byName.get(name);
    if (!r) return line;

    let url = currentUrl;
    if (r.status === "fixed" && r.workingUrl && r.workingUrl !== currentUrl) {
      url = r.workingUrl;
      urlsFixed++;
    }

    let tail = "";
    if (r.careersEmail) {
      tail = `, careersEmail: "${esc(r.careersEmail)}"`;
      emailsAdded++;
    }

    return `${indent}{ name: "${esc(name)}", careersUrl: "${esc(url)}", sector: "${sector}", priority: ${priority}${tail} },`;
  });

  const dead = report.results.filter((r) => r.status === "unreachable");
  const emailOnly = report.results.filter((r) => r.status === "email-only");

  console.log(`urls repaired      : ${urlsFixed}`);
  console.log(`careers emails set : ${emailsAdded}`);
  console.log(`email-only         : ${emailOnly.length}`);
  console.log(`still unreachable  : ${dead.length}`);

  if (dead.length > 0) {
    console.log(`\nno careers page and no email - candidates for removal:`);
    for (const r of dead) console.log(`  ${r.company.slice(0, 42).padEnd(42)} ${r.originalUrl.slice(0, 60)}`);
  }

  if (DRY) {
    console.log(`\n--dry given; ${FILE} left unchanged`);
    return;
  }

  writeFileSync(FILE, out.join("\n"));
  console.log(`\nwrote ${FILE}`);
}

main();
