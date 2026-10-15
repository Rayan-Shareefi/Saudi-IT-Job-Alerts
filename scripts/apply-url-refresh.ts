/**
 * Applies data/url-refresh.json to companies.ts.
 *
 * `moved` replaces the primary URL. `extra-found` appends to altUrls, which
 * discovery then resolves into extra sources for the same employer.
 *
 * `stale` is reported but never auto-applied: "this no longer looks like a
 * vacancy list" is a judgement the crawler can get wrong on a page that simply
 * has no openings today, and silently rewriting a good URL is worse than
 * leaving it alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { looksLikeSecondaryBoard } from "../src/lib/sources/secondary";
import type { UrlFinding } from "./refresh-urls";

const DRY = process.argv.includes("--dry");
const FILE = "src/lib/sources/companies.ts";

function main(): void {
  const { findings } = JSON.parse(readFileSync("data/url-refresh.json", "utf8")) as {
    findings: UrlFinding[];
  };
  const moved = new Map(findings.filter((f) => f.status === "moved" && f.replacementUrl).map((f) => [f.company, f.replacementUrl!]));
  const extras = new Map(
    // Re-checked against the corrected rule rather than trusted as recorded:
    // a crawl written before the word-boundary fix carries service pages that
    // matched "intern" inside "INTERNational", and single job postings that
    // matched "vacanc". Both would become sources that never produce a board.
    findings
      .map((f) => [f.company, f.secondaryUrls.filter((u) => looksLikeSecondaryBoard(u))] as const)
      .filter(([, urls]) => urls.length > 0),
  );

  const lines = readFileSync(FILE, "utf8").split("\n");
  let movedCount = 0;
  let extraCount = 0;

  const out = lines.map((line) => {
    const m = line.match(
      /^(\s*)\{ name: "([^"]+)", careersUrl: "([^"]+)"(, sector: "[^"]+", priority: \d)((?:, careersEmail: "[^"]*")?)(?:, altUrls: \[[^\]]*\])? \},\s*$/,
    );
    if (!m) return line;
    const [, indent, name, currentUrl, mid, email] = m;

    const url = moved.get(name) ?? currentUrl;
    if (moved.has(name)) movedCount++;

    const alt = (extras.get(name) ?? []).filter((u) => u !== url);
    let altPart = "";
    if (alt.length > 0) {
      extraCount += alt.length;
      altPart = `, altUrls: [${alt.map((u) => `"${u.replace(/"/g, '\\"')}"`).join(", ")}]`;
    }

    return `${indent}{ name: "${name}", careersUrl: "${url}"${mid}${email}${altPart} },`;
  });

  const stale = findings.filter((f) => f.status === "stale");
  console.log(`primary URLs moved   : ${movedCount}`);
  console.log(`secondary boards set : ${extraCount}`);
  console.log(`stale (not applied)  : ${stale.length}`);
  if (stale.length > 0) {
    console.log(`\nthese load but no longer look like a vacancy list - check by hand:`);
    for (const f of stale.slice(0, 20)) console.log(`  ${f.company.slice(0, 34).padEnd(34)} ${f.currentUrl.slice(0, 56)}`);
  }

  if (DRY) {
    console.log(`\n--dry given; ${FILE} left unchanged`);
    return;
  }
  writeFileSync(FILE, out.join("\n"));
  console.log(`\nwrote ${FILE} - run sources:discover to pick up the new boards`);
}

main();
