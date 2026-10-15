/**
 * Switches browser-fallback sources over to the LLM extractor.
 *
 * Those sources are companies whose careers page carries no machine-readable
 * listing, so the browser adapter returns nothing from them. The LLM adapter
 * reads the page as text instead. It costs money per page, so this is an
 * explicit opt-in rather than a default - see docs/llm-extraction.md.
 *
 *   npx tsx scripts/enable-llm.ts --priority 2   # priority 1-2 employers
 *   npx tsx scripts/enable-llm.ts --all
 *   npx tsx scripts/enable-llm.ts --revert       # back to the browser adapter
 */
import { readFileSync, writeFileSync } from "node:fs";
import { COMPANIES } from "../src/lib/sources/companies";
import type { SourceDefinition } from "../src/lib/types";

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(`--${n}`);

function main(): void {
  const file = JSON.parse(readFileSync("data/discovered.json", "utf8")) as {
    sources: SourceDefinition[];
    [k: string]: unknown;
  };
  const priority = new Map(COMPANIES.map((c) => [c.name, c.priority]));
  const maxPriority = has("all") ? 3 : Number(arg("priority") ?? 2);
  const revert = has("revert");

  let changed = 0;
  file.sources = file.sources.map((s) => {
    if (revert) {
      if (s.adapter !== "llm") return s;
      changed++;
      return { ...s, adapter: "browser", needsBrowser: true };
    }
    if (s.adapter !== "browser") return s;
    const p = priority.get(s.company ?? s.label) ?? 3;
    if (p > maxPriority) return s;
    changed++;
    // Still needsBrowser: the extractor renders the page before reading it.
    return { ...s, adapter: "llm", needsBrowser: true, enabled: true };
  });

  writeFileSync("data/discovered.json", JSON.stringify(file, null, 2));

  const onLlm = file.sources.filter((s) => s.adapter === "llm").length;
  console.log(revert ? `reverted ${changed} sources to the browser adapter` : `switched ${changed} sources to the LLM extractor`);
  console.log(`sources on the LLM extractor: ${onLlm}`);
  if (!revert && onLlm > 0) {
    const perRunOpus = (onLlm * 0.065).toFixed(2);
    const perRunHaiku = (onLlm * 0.013).toFixed(2);
    console.log(`\nestimated cost per full pass: ~$${perRunOpus} on claude-opus-5, ~$${perRunHaiku} on claude-haiku-4-5`);
    console.log(`set ANTHROPIC_EXTRACTION_MODEL=claude-haiku-4-5 to use the cheaper one`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(`\nANTHROPIC_API_KEY is not set - these sources will skip until it is.`);
    }
  }
}

main();
