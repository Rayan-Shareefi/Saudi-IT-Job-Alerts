import { sourceById } from "@/lib/sources/registry";
import { COMPANIES } from "@/lib/sources/companies";
import type { FixRow } from "@/lib/fix-words";
import { FindAllFixes, FixBox } from "./SourceFixer";

/** This card's own fix: by its source, or one made for the company as a whole. */
function fixFor(fixes: Record<string, FixRow>, company: string, sourceId: string): FixRow | undefined {
  const own = fixes[`failing|${company}|${sourceId}`];
  if (own) return own;
  const any = fixes[`failing|${company}`];
  return any && !any.sourceId ? any : undefined;
}

/** Platform sources fail for reasons no URL fixes (a key, a quota, LinkedIn's limits). */
const PLATFORM_KINDS = /^(aggregator|jsearch|jooble|careerjet|indeed|telegram|linkedin|linkedin-post)$/;

export interface HealthRow {
  sourceId: string;
  label: string;
  kind: string;
  adapter: string;
  ok: boolean;
  lastRunAt: string | null;
  lastOkAt: string | null;
  kept: number;
  consecutiveFailures: number;
  error: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Plain-English cause, because the raw error is usually an HTTP code and the
 * fix differs completely depending on which one it is.
 */
function explain(error: string | null): string {
  const e = (error ?? "").toLowerCase();
  if (e.includes("missing ")) return "Needs an API key";
  if (e.includes("quota")) return "Monthly API quota spent";
  if (e.includes("404")) return "URL is wrong or the board moved";
  if (e.includes("403") || e.includes("401")) return "Site refuses automated access";
  if (e.includes("429")) return "Rate limited";
  if (e.includes("timeout") || e.includes("aborted")) return "Timed out";
  if (e.includes("enotfound") || e.includes("name_not_resolved") || e.includes("fetch failed")) {
    return "Domain does not resolve";
  }
  if (e.includes("500") || e.includes("502") || e.includes("503")) return "Their server errored";
  return "Unknown error";
}

/** The employer's careers page, so a failing row is actionable by hand. */
function urlFor(sourceId: string, label: string): string | null {
  const src = sourceById(sourceId);
  if (src?.handle?.startsWith("http")) return src.handle;
  const company = COMPANIES.find((c) => c.name === label);
  return company?.careersUrl ?? null;
}

export function FailingSources({ rows, empty = [], fixes = {} }: { rows: HealthRow[]; empty?: HealthRow[]; fixes?: Record<string, FixRow> }) {
  const sorted = [...rows].sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
  const fixable = [...sorted.filter((r) => !PLATFORM_KINDS.test(r.kind)), ...empty];

  return (
    <section>
      <div
        className="mb-4 px-4 py-3 text-[13px] leading-relaxed"
        style={{ background: "var(--warn-soft)", color: "var(--warn-ink)", borderRadius: "var(--radius)" }}
        role="note"
      >
        <strong>{sorted.length} sources failed on the last run.</strong> Each row carries the reason
        and a link to the employer&apos;s careers page, so you can check whether the URL is wrong or
        the site is simply blocking us. Paste a working URL on a card, or let the laptop look for
        one: a URL that works replaces the failing source on the next run, no code change needed.
      </div>
      {fixable.length > 0 && <FindAllFixes page="failing" count={fixable.length} last={fixes["failing|*"]} />}

      {sorted.length === 0 ? (
        <div className="surface px-6 py-12 text-center" style={{ borderRadius: "var(--radius-lg)" }}>
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
            Nothing is failing
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13px]" style={{ color: "var(--ink-2)" }}>
            Every source returned a valid response on the last run. This list fills in after a run
            that hits an error.
          </p>
        </div>
      ) : (
        <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((r) => {
            const url = urlFor(r.sourceId, r.label);
            return (
              <li key={r.sourceId}>
                <article className="surface p-4" style={{ borderRadius: "var(--radius-lg)" }}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: "var(--warn-soft)", color: "var(--warn-ink)" }}
                    >
                      {r.consecutiveFailures > 1 ? `failing ×${r.consecutiveFailures}` : "failing"}
                    </span>
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
                    >
                      {r.adapter}
                    </span>
                  </div>

                  <h3 className="mt-2 text-[14px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>
                    {r.label}
                  </h3>

                  <p className="mt-1 text-[12.5px] font-medium" style={{ color: "var(--warn-ink)" }}>
                    {explain(r.error)}
                  </p>

                  <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                    last run {timeAgo(r.lastRunAt)}
                    {r.lastOkAt ? ` · last worked ${timeAgo(r.lastOkAt)}` : " · never succeeded"}
                  </p>

                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 block truncate text-[12px] font-semibold underline-offset-2 hover:underline"
                      style={{ color: "var(--accent)" }}
                      title={url}
                    >
                      Open {url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 46)} &rarr;
                    </a>
                  )}

                  {!PLATFORM_KINDS.test(r.kind) && (
                    <FixBox page="failing" company={sourceById(r.sourceId)?.company ?? r.label} sourceId={r.sourceId} oldUrl={url} fix={fixFor(fixes, sourceById(r.sourceId)?.company ?? r.label, r.sourceId)} />
                  )}

                  {r.error && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                        Raw error
                      </summary>
                      <p className="mt-1 break-words text-[11px]" style={{ color: "var(--ink-3)" }}>
                        {r.error}
                      </p>
                    </details>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {empty.length > 0 && (
        <details className="mt-8" open={sorted.length === 0}>
          <summary className="cursor-pointer text-[15px] font-bold" style={{ color: "var(--ink)" }}>
            Opened, but read nothing <span className="nums text-[12px] font-semibold" style={{ color: "var(--ink-3)" }}>{empty.length}</span>
          </summary>
          <p className="mb-3 mt-1 max-w-3xl text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            These main boards answered without an error and gave no postings at all on the last run - usually a list drawn in a way the reader cannot see, or a
            moved board, rarely an employer with nothing open anywhere. They never showed as failing, so they were easy to miss. Find fixes checks them too.
          </p>
          <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {empty.map((r) => {
              const url = urlFor(r.sourceId, r.label);
              const company = sourceById(r.sourceId)?.company ?? r.label;
              return (
                <li key={r.sourceId}>
                  <article className="surface p-4" style={{ borderRadius: "var(--radius-lg)" }}>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>
                      {r.adapter}
                    </span>
                    <h3 className="mt-2 text-[14px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>
                      {r.label}
                    </h3>
                    <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                      read nothing {timeAgo(r.lastRunAt)}
                    </p>
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 block truncate text-[12px] font-semibold underline-offset-2 hover:underline" style={{ color: "var(--accent)" }} title={url}>
                        Open {url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 46)} &rarr;
                      </a>
                    )}
                    <FixBox page="failing" company={company} sourceId={r.sourceId} oldUrl={url} fix={fixFor(fixes, company, r.sourceId)} />
                  </article>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
