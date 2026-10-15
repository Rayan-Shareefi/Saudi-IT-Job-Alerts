/**
 * Re-applies the registry's enable policy to data/discovered.json.
 *
 * Browser-adapter sources are all enabled. They used to be limited to priority
 * 1-2 because they returned nothing; once the adapter learned to walk to a
 * site's results page they became the largest source of new employers, so the
 * minutes they cost per run are now well spent.
 *
 * Everything with a real ATS or JSON-LD stays on regardless of priority.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { COMPANIES } from "../src/lib/sources/companies";
import type { SourceDefinition } from "../src/lib/types";

const DRY = process.argv.includes("--dry");

function main(): void {
  const file = JSON.parse(readFileSync("data/discovered.json", "utf8")) as {
    sources: SourceDefinition[];
    [k: string]: unknown;
  };
  const priority = new Map(COMPANIES.map((c) => [c.name, c.priority]));

  let on = 0;
  let off = 0;

  file.sources = file.sources.map((s) => {
    // Never resurrect something an audit proved broken.
    if (s.enabled === false && s.adapter !== "browser") return s;

    if (s.adapter === "browser") {
      // Every priority now. When these returned nothing they were dead weight
      // at minutes apiece; since the adapter learned to walk to the results
      // page they are the single largest untapped block of employers.
      on++;
      return { ...s, enabled: true };
    }
    on++;
    return { ...s, enabled: true };
  });

  const browserOn = file.sources.filter((s) => s.adapter === "browser" && s.enabled !== false).length;
  const total = file.sources.filter((s) => s.enabled !== false).length;

  console.log(`enabled : ${total}  (browser sources: ${browserOn})`);
  console.log(`disabled: ${off}`);

  if (DRY) {
    console.log("--dry given; discovered.json left unchanged");
    return;
  }
  writeFileSync("data/discovered.json", JSON.stringify(file, null, 2));
  console.log("wrote data/discovered.json");
}

main();
