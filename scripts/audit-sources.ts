/**
 * Health-check every source and prune the registry.
 *
 * Discovery is optimistic: it records anything that looked like a board. This
 * pass actually calls each one, and flips `enabled` to false for sources that
 * error out or return nothing usable -- so the ingest run stops paying for
 * dead endpoints.
 *
 *   npx tsx scripts/audit-sources.ts              # audit + rewrite discovered.json
 *   npx tsx scripts/audit-sources.ts --report     # report only, change nothing
 *   npx tsx scripts/audit-sources.ts --skip-browser
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { ADAPTERS } from "../src/lib/adapters";
import { enrich } from "../src/lib/classify";
import { isRelevant } from "../src/lib/ingest";
import { mapLimit } from "../src/lib/http";
import { ALL_SOURCES } from "../src/lib/sources/registry";
import type { SourceDefinition } from "../src/lib/types";

interface AuditRow {
  source: SourceDefinition;
  ok: boolean;
  fetched: number;
  relevant: number;
  ms: number;
  error?: string;
}

const has = (n: string) => process.argv.includes(`--${n}`);

async function audit(source: SourceDefinition): Promise<AuditRow> {
  const started = Date.now();
  const adapter = ADAPTERS[source.adapter];
  if (!adapter) {
    return { source, ok: false, fetched: 0, relevant: 0, ms: 0, error: "no adapter" };
  }
  try {
    const raw = await adapter(source);
    const relevant = raw
      .map((r) => enrich(r, source))
      .filter((j) => isRelevant(j, source)).length;
    return { source, ok: true, fetched: raw.length, relevant, ms: Date.now() - started };
  } catch (err) {
    return {
      source,
      ok: false,
      fetched: 0,
      relevant: 0,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const reportOnly = has("report");
  const skipBrowser = has("skip-browser");

  const targets = ALL_SOURCES.filter((s) => !skipBrowser || !s.needsBrowser);
  console.log(`Auditing ${targets.length} sources...\n`);

  let done = 0;
  const rows = await mapLimit(targets, skipBrowser ? 8 : 3, async (s) => {
    const r = await audit(s);
    done++;
    const flag = !r.ok ? "FAIL" : r.relevant > 0 ? "OK  " : "EMPTY";
    console.log(
      `[${String(done).padStart(3)}/${targets.length}] ${flag.padEnd(5)} ${s.label.slice(0, 32).padEnd(32)} ` +
        `${s.adapter.padEnd(16)} fetched=${String(r.fetched).padStart(4)} relevant=${String(r.relevant).padStart(3)}` +
        `${r.error ? `  ${r.error.slice(0, 60)}` : ""}`,
    );
    return r;
  });

  const working = rows.filter((r) => r.ok && r.relevant > 0);
  const empty = rows.filter((r) => r.ok && r.relevant === 0);
  const broken = rows.filter((r) => !r.ok);

  console.log(`\n--- audit summary ---`);
  console.log(`working (has Saudi-relevant postings) : ${working.length}`);
  console.log(`reachable but nothing relevant        : ${empty.length}`);
  console.log(`broken                                : ${broken.length}`);
  console.log(`total relevant postings available     : ${rows.reduce((n, r) => n + r.relevant, 0)}`);

  console.log(`\ntop sources by relevant postings:`);
  for (const r of [...working].sort((a, b) => b.relevant - a.relevant).slice(0, 25)) {
    console.log(`  ${String(r.relevant).padStart(4)}  ${r.source.label.slice(0, 40).padEnd(40)} ${r.source.adapter}`);
  }

  if (broken.length > 0) {
    console.log(`\nbroken sources:`);
    for (const r of broken.slice(0, 40)) {
      console.log(`  ${r.source.id.padEnd(40)} ${r.error?.slice(0, 80)}`);
    }
  }

  if (reportOnly) {
    console.log(`\n--report given; discovered.json left unchanged`);
    return;
  }

  // Rewrite discovered.json, disabling anything that failed outright. Sources
  // that merely returned nothing relevant stay enabled: a company with no
  // Riyadh openings this week may well have some next week.
  const file = JSON.parse(readFileSync("data/discovered.json", "utf8")) as {
    generatedAt: string | null;
    companies: number;
    sources: SourceDefinition[];
  };
  const brokenIds = new Set(broken.map((r) => r.source.id));
  // Only sources this run actually called may have their flag changed. A
  // skipped source (--skip-browser) keeps whatever discovery decided; blanket
  // re-enabling would silently switch on the priority-3 browser fallbacks that
  // discovery had deliberately turned off, and would vouch for sources that
  // were never tested.
  const testedIds = new Set(rows.map((r) => r.source.id));

  let disabled = 0;
  let reenabled = 0;
  file.sources = file.sources.map((s) => {
    if (!testedIds.has(s.id)) return s;
    if (brokenIds.has(s.id)) {
      if (s.enabled !== false) disabled++;
      return { ...s, enabled: false };
    }
    if (s.enabled === false) reenabled++;
    return { ...s, enabled: true };
  });

  writeFileSync(
    "data/discovered.json",
    JSON.stringify({ ...file, auditedAt: new Date().toISOString() }, null, 2),
  );
  console.log(
    `\ndisabled ${disabled} broken sources` +
      (reenabled > 0 ? `, re-enabled ${reenabled} recovered ones` : "") +
      `; wrote data/discovered.json`,
  );

  const kept = file.sources.filter((s) => s.enabled !== false).length;
  const untested = file.sources.filter((s) => !testedIds.has(s.id)).length;
  console.log(`registry now has ${kept} live company sources (${untested} untested this run)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
