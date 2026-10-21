"use client";

import { useCallback, useMemo, useState } from "react";
import type { StoredUrlFinding, UrlDecision, UrlRole } from "@/lib/db";
import type { FixRow } from "@/lib/fix-words";
import { FindAllFixes, FixBox } from "./SourceFixer";
import { writeKeyOrPrompt } from "./useWriteKey";


const STATUS_LABEL: Record<string, { title: string; blurb: string; tone: string }> = {
  moved: {
    title: "The listing has moved",
    blurb:
      "The URL on file now redirects elsewhere, or turned out to be a landing page whose “Job search” button leads to the real board. Both are shown so you can see what changed before switching.",
    tone: "var(--accent)",
  },
  "extra-found": {
    title: "Additional boards found",
    blurb:
      "The same employer publishes more than one list — usually a graduate scheme, an internships portal or an Arabic listing. Adding one means the company gets polled for it as well.",
    tone: "var(--info)",
  },
  stale: {
    title: "No longer looks like a listing",
    blurb:
      "The page still loads but nothing on it reads as a vacancy. That can simply mean the employer has nothing open right now, so this is the group to check by eye rather than act on.",
    tone: "var(--warn)",
  },
  unreachable: {
    title: "Did not respond",
    blurb:
      "The page returned an error or timed out. Often temporary — worth re-checking before changing anything.",
    tone: "var(--danger)",
  },
};

/** One proposed URL, with the two buttons that decide its fate. */
interface Candidate {
  company: string;
  url: string;
  role: UrlRole;
}

function short(u: string): string {
  return u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 54);
}

function UrlRow({
  candidate,
  decision,
  busy,
  onDecide,
}: {
  candidate: Candidate;
  decision: "accepted" | "rejected" | undefined;
  busy: boolean;
  onDecide: (c: Candidate, d: "accepted" | "rejected" | "clear") => void;
}) {
  const settled = decision !== undefined;

  return (
    <div className="mt-1.5 flex items-start gap-2">
      <a
        href={candidate.url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate text-[12.5px] font-semibold underline-offset-2 hover:underline"
        style={{
          color: decision === "rejected" ? "var(--ink-3)" : "var(--accent)",
          textDecoration: decision === "rejected" ? "line-through" : undefined,
        }}
        title={candidate.url}
      >
        {short(candidate.url)}
      </a>

      {settled ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className="whitespace-nowrap px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: decision === "accepted" ? "var(--success-soft)" : "var(--surface-2)",
              color: decision === "accepted" ? "var(--success-ink)" : "var(--ink-3)",
              borderRadius: "999px",
            }}
          >
            {decision === "accepted"
              ? candidate.role === "primary"
                ? "Added as main URL"
                : "Added"
              : "Dismissed"}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(candidate, "clear")}
            className="text-[11px] underline-offset-2 hover:underline"
            style={{
              background: "none",
              border: "none",
              color: "var(--ink-3)",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            Undo
          </button>
        </span>
      ) : (
        <span className="flex shrink-0 gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(candidate, "accepted")}
            className="px-2.5 py-1 text-[11.5px] font-semibold"
            style={{
              background: "var(--accent)",
              color: "var(--accent-on)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: busy ? "wait" : "pointer",
            }}
            title={
              candidate.role === "primary"
                ? "Use this as the employer's careers URL"
                : "Poll this board as well as the current one"
            }
          >
            Add
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(candidate, "rejected")}
            className="px-2.5 py-1 text-[11.5px] font-semibold"
            style={{
              background: "var(--surface-2)",
              color: "var(--ink-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              cursor: busy ? "wait" : "pointer",
            }}
            title="Dismiss this suggestion and stop showing it"
          >
            Remove
          </button>
        </span>
      )}
    </div>
  );
}

function Finding({
  f,
  decisions,
  busy,
  onDecide,
  fix,
}: {
  f: StoredUrlFinding;
  decisions: Map<string, "accepted" | "rejected">;
  busy: boolean;
  onDecide: (c: Candidate, d: "accepted" | "rejected" | "clear") => void;
  fix?: FixRow;
}) {
  const candidates: Candidate[] = [
    ...(f.suggestedUrl ? [{ company: f.company, url: f.suggestedUrl, role: "primary" as const }] : []),
    ...f.extraUrls.map((u) => ({ company: f.company, url: u, role: "alternate" as const })),
  ];

  return (
    <li>
      <article className="surface p-4" style={{ borderRadius: "var(--radius-lg)" }}>
        <h3 className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
          {f.company}
        </h3>
        {f.note && (
          <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {f.note}
          </p>
        )}

        <p className="mt-2 truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
          on file:{" "}
          <a
            href={f.currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
            style={{ color: "var(--ink-2)" }}
            title={f.currentUrl}
          >
            {short(f.currentUrl)}
          </a>
        </p>

        {candidates.length > 0 ? (
          <div className="mt-2 border-t pt-2">
            {candidates.map((c) => (
              <UrlRow
                key={c.url}
                candidate={c}
                decision={decisions.get(`${c.company}|${c.url}`)}
                busy={busy}
                onDecide={onDecide}
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
            Nothing to add — this one needs a look by hand.
          </p>
        )}
        <FixBox page="urls" company={f.company} oldUrl={f.currentUrl} fix={fix} />
      </article>
    </li>
  );
}

/**
 * Re-checks employer careers URLs and lets you decide about each one.
 *
 * Every proposed URL carries **Add** and **Remove**, and neither happens on its
 * own. A careers URL is the single point of failure for an employer - point it
 * at the wrong page and that company silently produces nothing, which is worse
 * than the stale URL it replaced - so the checker only ever proposes.
 *
 * Accepted URLs are stored as overrides and merged by discovery on its next
 * run; the seed file is never rewritten from a browser.
 *
 * The check runs in batches because it opens a real browser on every employer:
 * 500+ takes about an hour, and no request survives that. Each press takes the
 * companies checked longest ago, so repeated presses sweep the whole list.
 */
export function UrlCheck({
  findings,
  decisions: initialDecisions,
  progress,
  total,
  fixes = {},
}: {
  findings: StoredUrlFinding[];
  decisions: UrlDecision[];
  progress: { checked: number; open: number };
  total: number;
  fixes?: Record<string, FixRow>;
}) {
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [manualCompany, setManualCompany] = useState("");
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Map<string, "accepted" | "rejected">>(
    () => new Map(initialDecisions.map((d) => [`${d.company}|${d.url}`, d.decision])),
  );

  const editingKey = useCallback((): string | null => writeKeyOrPrompt("editing URLs"), []);

  const addUrl = useCallback(async () => {
    const key = editingKey();
    if (!key) return;
    setAdding(true);
    setAddResult(null);
    try {
      const res = await fetch("/api/urls/add", {
        method: "POST",
        headers: { "content-type": "application/json", "x-removal-secret": key },
        body: JSON.stringify({
          url: manualUrl.trim(),
          company: manualCompany.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { ok: boolean; queued?: boolean; company?: string; error?: string };
      if (data.ok && data.queued) {
        setAddResult(
          `Queued for ${data.company}: the laptop opens it within a few minutes and adds it only if real postings come off it. Its result shows on the card.`,
        );
        setManualUrl("");
        setManualCompany("");
      } else {
        setAddResult(data.error ?? "Could not add that URL.");
      }
    } catch (err) {
      setAddResult(err instanceof Error ? err.message : "Could not add that URL.");
    } finally {
      setAdding(false);
    }
  }, [manualUrl, manualCompany, editingKey]);

  const onDecide = useCallback(
    async (c: Candidate, decision: "accepted" | "rejected" | "clear") => {
      const key = editingKey();
      if (!key) return;

      setDeciding(true);
      setError(null);
      const id = `${c.company}|${c.url}`;
      try {
        const res = await fetch("/api/urls/decide", {
          method: "POST",
          headers: { "content-type": "application/json", "x-removal-secret": key },
          body: JSON.stringify({ company: c.company, url: c.url, role: c.role, decision }),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !data.ok) {
          setError(
            res.status === 401
              ? "That key was not accepted."
              : res.status === 503
                ? "Not configured on the server yet (set REMOVAL_SECRET)."
                : (data.error ?? "Could not save that."),
          );
          return;
        }
        setDecisions((prev) => {
          const next = new Map(prev);
          if (decision === "clear") next.delete(id);
          else next.set(id, decision);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that.");
      } finally {
        setDeciding(false);
      }
    },
    [editingKey],
  );

  const accepted = useMemo(
    () => [...decisions.values()].filter((d) => d === "accepted").length,
    [decisions],
  );

  const groups = Object.keys(STATUS_LABEL)
    .map((status) => ({ status, list: findings.filter((f) => f.status === status) }))
    .filter((g) => g.list.length > 0);

  return (
    <section>
      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div className="text-[13px]" style={{ color: "var(--ink-2)" }}>
          <strong style={{ color: "var(--ink)" }}>
            {progress.checked} of {total} employers checked
          </strong>
          {progress.open > 0 && <span> &middot; {progress.open} with something to look at</span>}
          {accepted > 0 && <span> &middot; {accepted} URL{accepted === 1 ? "" : "s"} added</span>}
          <span className="mt-0.5 block text-[11.5px]" style={{ color: "var(--ink-3)" }}>
            A URL that is checked and works is used by itself; the unclear ones go to the AI jury, then to you with the reason.
          </span>
        </div>
      </div>

      <FindAllFixes page="urls" count={25} last={fixes["urls|*"]} />

      {/*
        Adding one by hand.

        The checker only proposes what it stumbles across, and plenty of boards
        are not linked from anywhere it looks. Everything except the address is
        filled in automatically: the URL is opened, checked that it really lists
        vacancies, matched to an employer, and any boards it links to are picked
        up at the same time.
      */}
      <div
        className="mb-4 px-4 py-3"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
          Found a careers page yourself?
        </p>
        <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          Paste the address. It is opened and checked before anything is stored, and the employer is
          worked out from the URL.
        </p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
          <input
            type="url"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="https://careers.example.com/jobs"
            className="px-3.5 text-[13px] outline-none"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--ink)",
              height: "var(--control-h)",
            }}
            aria-label="Careers page address"
          />
          <input
            type="text"
            value={manualCompany}
            onChange={(e) => setManualCompany(e.target.value)}
            placeholder="Employer (optional)"
            className="px-3.5 text-[13px] outline-none"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--ink)",
              height: "var(--control-h)",
            }}
            aria-label="Employer name, optional"
          />
          <button
            type="button"
            onClick={addUrl}
            disabled={adding || manualUrl.trim() === ""}
            className="px-4 text-[13px] font-semibold"
            style={{
              background: adding || !manualUrl.trim() ? "var(--surface-2)" : "var(--accent)",
              color: adding || !manualUrl.trim() ? "var(--ink-3)" : "var(--accent-on)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              height: "var(--control-h)",
              cursor: adding ? "wait" : manualUrl.trim() ? "pointer" : "not-allowed",
            }}
          >
            {adding ? "Checking…" : "Check and add"}
          </button>
        </div>
        {addResult && (
          <p className="mt-2 text-[12px]" style={{ color: "var(--ink-2)" }}>
            {addResult}
          </p>
        )}
      </div>

      {accepted > 0 && (
        <p
          className="mb-4 px-4 py-2.5 text-[12.5px] leading-relaxed"
          style={{
            background: "var(--success-soft)",
            color: "var(--success-ink)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {accepted} URL{accepted === 1 ? "" : "s"} added. Each one is checked on the laptop and read
          from the next run on - no code change needed.
        </p>
      )}

      {error && (
        <p className="mb-4 px-4 py-2.5 text-[12.5px]" style={{ background: "var(--danger-soft)", color: "var(--danger-ink)", borderRadius: "var(--radius-sm)" }}>
          {error}
        </p>
      )}

      {findings.length === 0 ? (
        <div className="surface px-6 py-12 text-center" style={{ borderRadius: "var(--radius-lg)" }}>
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
            Nothing flagged
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13px]" style={{ color: "var(--ink-2)" }}>
            {progress.checked === 0
              ? "No URLs have been checked yet. Press Find fixes for all to start."
              : "Every employer checked so far still points at a working job list."}
          </p>
        </div>
      ) : (
        groups.map((g) => {
          const meta = STATUS_LABEL[g.status];
          return (
            <div key={g.status} className="mb-7">
              <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: meta.tone }}>
                {meta.title} <span style={{ color: "var(--ink-3)" }}>({g.list.length})</span>
              </h2>
              <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {meta.blurb}
              </p>
              <ul className="mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {g.list.map((f) => (
                  <Finding
                    key={f.company}
                    f={f}
                    decisions={decisions}
                    busy={deciding}
                    onDecide={onDecide}
                    fix={fixes[`urls|${f.company}`]}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
