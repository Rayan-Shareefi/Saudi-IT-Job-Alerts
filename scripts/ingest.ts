/**
 * Fetch every enabled source, classify what comes back, write it to Supabase.
 *
 *   npx tsx scripts/ingest.ts                  # everything
 *   npx tsx scripts/ingest.ts --skip-browser   # skip the slow Playwright sources
 *   npx tsx scripts/ingest.ts --source <id>    # one source
 *   npx tsx scripts/ingest.ts --dry            # fetch + classify, write nothing
 *   npx tsx scripts/ingest.ts --kind ats       # only one class of source
 *   npx tsx scripts/ingest.ts --no-api        # skip every aggregator API (JSearch, Jooble, Careerjet)
 *   npx tsx scripts/ingest.ts --no-metered    # skip JSearch only (the one that costs quota)
 *   npx tsx scripts/ingest.ts --deadline-min 45   # start no new source after 45 minutes
 *   npx tsx scripts/ingest.ts --order stale-first # least-recently-run sources first
 *   npx tsx scripts/ingest.ts --shard 2/6     # this runner's slice of the sources
 *
 * With no Supabase credentials present it falls back to --dry automatically and
 * writes data/cache-sample-jobs.json, so the pipeline can be exercised before any
 * account exists.
 */
import "./load-env";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { orderStaleFirst, runIngest, runSource } from "../src/lib/ingest";
import { ALL_SOURCES, dynamicSources, enabledSources, sourceById, sourceStats } from "../src/lib/sources/registry";
import { COMPANIES } from "../src/lib/sources/companies";
import { AGGREGATOR_KINDS, isConfigured, lastRunTimes, retireOrphanedSources } from "../src/lib/db";
import { rebuildDuplicates } from "../src/lib/dedupe";
import { recomputeStates } from "../src/lib/review";
import type { EnrichedJob, IngestResult, SourceDefinition } from "../src/lib/types";
import { claimRun, finishRun, heartbeat, recordVersion, startRun } from "../src/lib/runs";
import { codeVersion } from "./code-version";
import { envFlag } from "../src/lib/env";
import { disabledSources, withOverrides } from "../src/lib/source-fix";

/** Sources only the laptop reads, and the settings that must all be on there. */
const LAPTOP_ONLY: Record<string, string[]> = {
  linkedin: ["LINKEDIN_ENABLED"],
  "linkedin-companies": ["LINKEDIN_ENABLED"],
  // The signed-in post search is off unless asked for (local-worker.ts).
  "linkedin-posts": ["LINKEDIN_POSTS_ENABLED", "LINKEDIN_SEARCH_POSTS"],
};
const laptopMay = (adapter: string) => (LAPTOP_ONLY[adapter] ?? []).every((flag) => envFlag(flag));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const configured = isConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const dryRun = has("dry") || !configured;

  if (!configured) {
    console.log(
      "! Supabase not configured - running in dry mode and writing data/cache-sample-jobs.json\n" +
        "  Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to persist.\n",
    );
  }

  const single = arg("source");
  const kind = arg("kind");
  const skipBrowser = has("skip-browser");
  // JSearch and friends are metered per request, so the frequent pass leaves
  // them out and the daily pass picks them up. See docs/jsearch-setup.md.
  const noApi = has("no-api");
  // JSearch alone. The scheduled nightly run passed no flag at all and spent
  // ~24 requests every day, exhausting the ~200/month plan on 2026-10-11.
  const noMetered = has("no-metered") || noApi;
  const deadlineMin = Number(arg("deadline-min") ?? 0);
  const deadlineAt = deadlineMin > 0 ? Date.now() + deadlineMin * 60_000 : undefined;
  const shard = parseShard(arg("shard"));

  let sources: SourceDefinition[];
  if (single) {
    // One source, or several: --source workable-riyadh,sabbar-riyadh
    const dynamic = await dynamicSources();
    sources = [];
    for (const id of single.split(",").map((s) => s.trim()).filter(Boolean)) {
      const s = sourceById(id) ?? dynamic.find((d) => d.id === id);
      if (!s) {
        console.error(`unknown source "${id}"`);
        process.exit(1);
      }
      sources.push(s);
    }
  } else {
    // Plus employers the worker discovered and added by itself, and the
    // repairs from the fix pages: switched-off sources go, and a board a fix
    // found stands in for the ones it replaces (source-fix.ts).
    const dynamic = configured ? await dynamicSources() : [];
    const disabled = configured ? await disabledSources() : new Set<string>();
    sources = withOverrides(enabledSources({ includeBrowser: !skipBrowser }), dynamic.filter((d) => !skipBrowser || !d.needsBrowser), disabled);
    if (kind) sources = sources.filter((s) => s.kind === kind);
    /*
     * LinkedIn is read from the laptop only. Elsewhere its sources are left
     * out rather than run as "skipped": the skip overwrote the laptop's real
     * status, and the website said LinkedIn was skipped while the laptop was
     * reading it (2026-10-21).
     */
    sources = sources.filter((s) => laptopMay(s.adapter));
    // Every metered aggregator, not just two of them. Leaving jooble and
    // careerjet in meant --no-api still spent quota on the runs that exist
    // precisely to avoid spending it.
    if (noApi) {
      sources = sources.filter(
        (s) => !(AGGREGATOR_KINDS as readonly string[]).includes(s.kind),
      );
    }
    // What the two buttons mean: employer boards, or the search APIs.
    const scope = arg("scope");
    // LinkedIn (listings, company pages, posts) and the job platforms are not
    // employer boards: the company pass (launcher F) read the company pages
    // twice when "linkedin-post" counted as a company source.
    const isApi = (k: string) => (AGGREGATOR_KINDS as readonly string[]).includes(k) || k === "linkedin" || k === "linkedin-post";
    if (scope === "company") sources = sources.filter((s) => !isApi(s.kind));
    if (scope === "api") sources = sources.filter((s) => isApi(s.kind));
    // JSearch only when asked for by name: it is the one that costs quota.
    if (noMetered || (scope === "api" && !has("with-jsearch"))) sources = sources.filter((s) => !METERED_KINDS.includes(s.kind));
    if (has("order") && arg("order") === "stale-first" && configured) {
      sources = orderStaleFirst(sources, await lastRunTimes());
    }
    // Sharding slices the *ordered* list round-robin, so every shard gets a
    // fair share of the stalest sources.
    if (shard) sources = sources.filter((_, i) => i % shard.count === shard.index - 1);
  }

  const stats = sourceStats();
  console.log(
    `Registry: ${stats.total} enabled sources across ${Object.keys(stats.byAdapter).length} adapters` +
      (stats.discoveredAt ? ` (discovered ${stats.discoveredAt.slice(0, 10)})` : ""),
  );
  console.log(`Running ${sources.length} sources${skipBrowser ? " (browser sources skipped)" : ""}...\n`);

  // Browser sources each spin up Chromium, so they run last and much less wide.
  const fast = sources.filter((s) => !s.needsBrowser);
  const slow = sources.filter((s) => s.needsBrowser);

  const collected: EnrichedJob[] = [];
  const log = (line: string) => console.log(line);

  // Employers the aggregators surface that the registry has never heard of.
  // These are the gaps in the company list, found from real postings rather
  // than guesswork - review data/suggested-employers.json and add the good ones.
  const known = new Set(COMPANIES.map((c) => normaliseName(c.name)));
  const unknownEmployers = new Map<string, { count: number; example: string; source: string }>();
  const onJobs = (jobs: EnrichedJob[], source: SourceDefinition) => {
    if (source.kind !== "aggregator" && source.kind !== "job-board") return;
    for (const j of jobs) {
      const key = normaliseName(j.company);
      if (!key || key.length < 3 || known.has(key)) continue;
      const entry = unknownEmployers.get(key) ?? { count: 0, example: j.url, source: source.label };
      entry.count++;
      unknownEmployers.set(key, entry);
    }
  };

  /*
   * Run tracking: progress goes to an ingest_runs row that the page reads, so
   * the button shows real progress wherever this runs. A run started by the
   * button arrives with --run-id; a scheduled run registers itself.
   */
  const runner = process.env.GITHUB_ACTIONS ? "github" : (process.env.WORKER_NAME ?? "local");
  let runId = arg("run-id") ?? null;
  if (runId && !dryRun) {
    if (!(await claimRun(runId, runner))) {
      console.log(`run ${runId} was already taken by another machine; nothing to do`);
      return;
    }
  } else if (!dryRun && !single) {
    const scopeName = arg("scope") === "api" ? "api" : "company";
    runId = (await startRun(scopeName, arg("trigger") ?? "schedule", runner))?.id ?? null;
  }
  activeRunId = runId;
  if (runId) await recordVersion(runId, codeVersion());
  const progress = { total: sources.length, done: 0, current: "", fetched: 0, kept: 0, inserted: 0, failed: 0, skipped: [] as string[] };
  const onSourceDone = (result: IngestResult, _done: number, _total: number, source: SourceDefinition) => {
    progress.done++;
    progress.current = source.label;
    progress.fetched += result.fetched;
    progress.kept += result.kept;
    progress.inserted += result.inserted;
    if (!result.ok) progress.failed++;
    if (result.ok && result.error) progress.skipped.push(`${source.label}: ${result.error}`.slice(0, 200));
    if (runId) void heartbeat(runId, progress);
  };
  if (runId) await heartbeat(runId, progress, true);

  const fastSummary = await runIngest(fast, {
    dryRun,
    onLog: log,
    onJobs,
    concurrency: 6,
    recordHealth: !dryRun,
    deadlineAt,
    onSourceDone,
  });

  let slowSummary = {
    results: [],
    notJobs: [],
    totalFetched: 0,
    totalKept: 0,
    totalInserted: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    durationMs: 0,
  } as Awaited<ReturnType<typeof runIngest>>;

  if (slow.length > 0) {
    console.log(`\n--- browser sources (${slow.length}) ---`);
    slowSummary = await runIngest(slow, {
      dryRun,
      onLog: log,
      onJobs,
      concurrency: 2,
      recordHealth: !dryRun,
      deadlineAt,
      onSourceDone,
    });
  }

  // In dry mode re-run the successful sources to capture rows for the sample
  // file; the batch runner intentionally drops job bodies to stay memory-light.
  if (dryRun) {
    const ok = [...fastSummary.results, ...slowSummary.results]
      .filter((r) => r.ok && r.kept > 0)
      .slice(0, 70);
    for (const r of ok) {
      const s = sourceById(r.sourceId);
      if (!s) continue;
      const run = await runSource(s, { dryRun: true }).catch(() => null);
      if (run) collected.push(...run.jobs);
    }
    if (!existsSync("data")) mkdirSync("data", { recursive: true });
    writeFileSync("data/cache-sample-jobs.json", JSON.stringify(collected.slice(0, 500), null, 2));
    console.log(`\nwrote data/cache-sample-jobs.json (${Math.min(collected.length, 500)} rows)`);
  }

  const totals = {
    fetched: fastSummary.totalFetched + slowSummary.totalFetched,
    kept: fastSummary.totalKept + slowSummary.totalKept,
    inserted: fastSummary.totalInserted + slowSummary.totalInserted,
    failed: fastSummary.failed + slowSummary.failed,
    skipped: fastSummary.skipped + slowSummary.skipped,
  };

  console.log(`\n--- ingest summary ---`);
  /*
   * Postings whose source has left the registry, retired on a full pass only.
   *
   * A single-source run has no business judging every other source's rows.
   */
  // --dry promises to write nothing; this used to retire rows even then.
  if (!single && !dryRun) {
    const retired = await retireOrphanedSources(ALL_SOURCES.map((x) => x.id));
    if (retired > 0) console.log(`retired       : ${retired} posting(s) whose source no longer exists`);
  }

  /*
   * New rows arrive as review_state "pending". Group duplicates and recompute
   * every state now, so the board never shows an unjudged posting and never
   * waits for a separate job to tidy up. No model calls here; the jury runs
   * in its own step (npm run judge) under its own budget.
   */
  if (!dryRun && !has("no-review")) {
    await rebuildDuplicates({ log: (s) => console.log(`dedupe        : ${s}`) });
    await recomputeStates({ log: (s) => console.log(`review        : ${s}`) });
  }

  console.log(`sources run   : ${sources.length}`);
  console.log(`postings seen : ${totals.fetched}`);
  console.log(`relevant      : ${totals.kept}`);
  console.log(`new           : ${totals.inserted}`);
  console.log(`failed        : ${totals.failed}`);
  console.log(`skipped       : ${totals.skipped} (no key, free quota spent, or LinkedIn asked us to wait)`);
  const deferred = fastSummary.deferred + slowSummary.deferred;
  if (deferred > 0) console.log(`deferred      : ${deferred} (deadline reached; they lead the next stale-first run)`);
  console.log(`elapsed       : ${Math.round((fastSummary.durationMs + slowSummary.durationMs) / 1000)}s`);
  if (runId) {
    await finishRun(runId, "done", {
      total: progress.total,
      done: progress.done,
      fetched: totals.fetched,
      kept: totals.kept,
      inserted: totals.inserted,
      failed: totals.failed,
      skipped: progress.skipped,
      current: null,
    });
  }

  /*
   * Sources that read a page successfully and found nothing but site furniture.
   *
   * This is the Deloitte signature: the URL is a careers *homepage*, the
   * repeated-block extractor latches onto the cookie-consent table, and every
   * row it produces is a cookie name. Reporting it as "0 jobs" would read like
   * the employer is not hiring, which is the wrong conclusion entirely.
   */
  const wrongUrls = [...fastSummary.notJobs, ...slowSummary.notJobs].filter((n) => {
    const r = [...fastSummary.results, ...slowSummary.results].find((x) => x.sourceId === n.sourceId);
    return r && r.kept === 0;
  });
  if (wrongUrls.length > 0) {
    console.log(
      `
--- ${wrongUrls.length} source(s) returned only non-job items: probably the wrong URL ---`,
    );
    for (const n of wrongUrls.slice(0, 25)) {
      console.log(
        `  ${n.label.slice(0, 34).padEnd(34)} ${String(n.count).padStart(3)} items  ` +
          `${n.reasons.map(([r, c]) => `${c} ${r}`).join(", ").slice(0, 60)}`,
      );
    }
    console.log(`  -> re-check these with: npm run urls:refresh`);
  }

  const failures = [...fastSummary.results, ...slowSummary.results].filter((r) => !r.ok);
  if (failures.length > 0) {
    console.log(`\nfailures:`);
    for (const f of failures.slice(0, 30)) {
      console.log(`  ${f.sourceId.padEnd(38)} ${f.error?.slice(0, 90)}`);
    }
  }
}

/** Aggregators that bill per request. Jooble and Careerjet are free. */
const METERED_KINDS: readonly string[] = ["jsearch"];

/** "2/6" -> { index: 2, count: 6 }; anything else -> null. */
function parseShard(value: string | undefined): { index: number; count: number } | null {
  const m = value?.match(/^(\d+)\/(\d+)$/);
  if (!m) return null;
  const index = Number(m[1]);
  const count = Number(m[2]);
  return index >= 1 && index <= count ? { index, count } : null;
}

/**
 * Loose key for comparing company names across sources.
 *
 * The suffix strip is word-bounded on purpose: an unanchored alternation eats
 * the "co" in Cisco and the "inc" in Princess, collapsing unrelated employers
 * onto a single key.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|ltd|llc|plc|co|company|group|holding|holdings|corporation|corp)\b/g, " ")
    .replace(/[^a-z0-9\u0600-\u06FF]/g, "");
}

/** The run row this process reports to, so a crash still closes it. */
let activeRunId: string | null = null;

main().catch(async (err) => {
  console.error(err);
  if (activeRunId) await finishRun(activeRunId, "failed", { error: String(err instanceof Error ? err.message : err).slice(0, 500) }).catch(() => {});
  process.exit(1);
});
