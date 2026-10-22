"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { forgetWriteKey, writeKeyOrPrompt } from "./useWriteKey";

interface Run {
  id: string;
  scope: "company" | "api";
  status: "queued" | "running" | "done" | "failed" | "stalled";
  runner: string | null;
  requested_at: string;
  finished_at: string | null;
  total: number;
  done: number;
  current: string | null;
  kept: number;
  inserted: number;
  failed: number;
  skipped: string[];
  error: string | null;
}

interface State {
  runs: { company: Run | null; api: Run | null };
  jsearch: { used: number; cap: number };
  platforms?: Array<{ label: string; lastRunAt: string | null; kept: number; problem: string | null }>;
  /** The laptop's last run and its code version; `latest` is what this site was built from. */
  laptop?: { version: string | null; at: string | null; seenAt?: string | null; busyUntil?: string | null; state?: string | null } | null;
  latest?: string | null;
}

/**
 * Whether the laptop runs the current code. It ran a copied folder's old
 * code for days without a sign (2026-10-21); now it says so here.
 */
function LaptopLine({ laptop, latest }: { laptop: NonNullable<State["laptop"]>; latest: string | null }) {
  const v = laptop.version;
  const warn = { color: "var(--warn-ink)" };
  const riyadh = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", weekday: "short", hour: "2-digit", minute: "2-digit" });
  // The heartbeat: every 2 minutes, or a promise of how long a step may take.
  if (laptop.seenAt) {
    const seen = new Date(laptop.seenAt).getTime();
    const busy = laptop.busyUntil ? new Date(laptop.busyUntil).getTime() : 0;
    const online = Date.now() - seen < 10 * 60_000 || Date.now() < busy + 5 * 60_000;
    if (!online) {
      return <p style={warn}>Laptop: offline since {riyadh(laptop.seenAt)} - asleep, switched off, or without internet. It carries on by itself once it is awake.</p>;
    }
  } else {
    const quietHours = laptop.at ? (Date.now() - new Date(laptop.at).getTime()) / 3_600_000 : Infinity;
    if (quietHours > 6) return <p style={warn}>Laptop: no search for {Number.isFinite(quietHours) ? `${Math.floor(quietHours)} h` : "a long time"} - is it on? Open Saudi Job Alert on it.</p>;
  }
  if (v === "not a git copy") return <p style={warn}>Laptop: its folder is not a git copy, so it runs old code and cannot update - see docs/laptop-setup.md.</p>;
  if (v && latest && !latest.startsWith(v) && !v.startsWith(latest)) {
    return <p style={warn}>Laptop: online, but on an older version ({v}; the latest is {latest}) - it updates by itself within two hours, or press U in its launcher.</p>;
  }
  return (
    <p>
      Laptop: {laptop.seenAt ? "online" : `last search ${ago(laptop.at)}`}
      {laptop.state ? ` · ${laptop.state}` : ""}
      {laptop.seenAt && laptop.at ? ` · last search ${ago(laptop.at)}` : ""}
      {v ? ` · version ${v}${latest ? " (up to date)" : ""}` : ""}
    </p>
  );
}

/** "5h ago", "2d ago" - when a platform was last read. */
function ago(iso: string | null): string {
  if (!iso) return "not yet";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const LIVE = new Set(["queued", "running"]);

function describe(run: Run): string {
  const what = run.scope === "api" ? "Search by API (button)" : "Employer boards";
  if (run.status === "queued") return `${what}: queued, waiting for a machine to start it…`;
  if (run.status === "running") {
    return `${what}: ${run.done} of ${run.total || "?"} sources${run.current ? ` · ${run.current}` : ""} · ${run.inserted} new so far${run.runner ? ` (on ${run.runner})` : ""}`;
  }
  if (run.status === "stalled") return `${what}: stopped responding${run.error ? ` - ${run.error}` : ""}. Press the button to try again.`;
  if (run.status === "failed") return `${what}: failed - ${run.error ?? "unknown error"}`;
  const when = run.finished_at ? new Date(run.finished_at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  // GitHub's every-few-hours pass leaves out the boards that need a browser;
  // the nightly pass and the laptop's full search (F) read every board. "168
  // sources" read as if the rest had been lost (user, 2026-10-21).
  const part = run.scope === "company" && run.total > 0 && run.total < 300 ? " (quick pass without the browser boards; the nightly pass reads all of them)" : "";
  return `${what}: last run ${when} · ${run.total} sources${part} · ${run.kept} relevant · ${run.inserted} new${run.failed ? ` · ${run.failed} failing` : ""}`;
}

/**
 * The two search buttons. Each queues a run; GitHub Actions, the laptop or
 * this computer does the work and writes progress to the database, and this
 * follows it from there - so it survives reloads and works on the phone.
 */
export function RefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [withJsearch, setWithJsearch] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasLive = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/refresh", { cache: "no-store" });
      const data = (await res.json()) as State & { ok: boolean };
      if (!data.ok) return;
      setState(data);
      const live = [data.runs.company, data.runs.api].some((r) => r && LIVE.has(r.status));
      // A run just finished: show the new jobs.
      if (wasLive.current && !live) router.refresh();
      wasLive.current = live;
    } catch {
      /* a dropped poll is not a failed run */
    }
  }, [router]);

  useEffect(() => {
    void load();
    timer.current = setInterval(() => void load(), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  async function start(scope: "company" | "api") {
    const key = writeKeyOrPrompt("starting a search");
    if (!key) return;
    setNote(null);
    const res = await fetch("/api/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", "x-removal-secret": key },
      body: JSON.stringify({ scope, jsearch: scope === "api" && withJsearch }),
    });
    if (res.status === 401) forgetWriteKey();
    const data = (await res.json()) as { ok: boolean; error?: string; message?: string; where?: string };
    if (!data.ok) setNote(data.error ?? "Could not start the search.");
    else if (data.message) setNote(data.message);
    else if (data.where) setNote(`Started on ${data.where === "github" ? "GitHub" : data.where}.`);
    void load();
  }

  const company = state?.runs.company ?? null;
  const api = state?.runs.api ?? null;
  const busy = (r: Run | null) => Boolean(r && LIVE.has(r.status));
  const left = state ? Math.max(0, state.jsearch.cap - state.jsearch.used) : null;

  const button = (scope: "company" | "api", label: string, icon: string, primary: boolean) => {
    const run = scope === "company" ? company : api;
    return (
      <button
        type="button"
        onClick={() => void start(scope)}
        disabled={busy(run)}
        className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition-opacity disabled:opacity-60"
        style={{
          background: primary ? "var(--accent)" : "var(--surface)",
          color: primary ? "var(--accent-on)" : "var(--ink-2)",
          border: primary ? "none" : "1px solid var(--border)",
          borderRadius: "var(--radius)",
          cursor: busy(run) ? "wait" : "pointer",
        }}
      >
        <span aria-hidden="true" style={{ display: "inline-block", animation: busy(run) ? "spin 1s linear infinite" : "none" }}>
          {busy(run) ? "◌" : icon}
        </span>
        {busy(run) ? "Searching…" : label}
      </button>
    );
  };

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-3">
        {button("company", "Search for new jobs", "↻", true)}
        {button("api", "Search by API", "☁", false)}
        <label className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-3)" }} title="JSearch costs from a small monthly allowance; the weekly schedule already uses it">
          <input type="checkbox" checked={withJsearch} onChange={(e) => setWithJsearch(e.target.checked)} />
          include JSearch{left !== null ? ` (${left} of ${state?.jsearch.cap} left this month)` : ""}
        </label>
      </div>
      <div className="mt-2 space-y-0.5 text-[12px]" style={{ color: "var(--ink-3)" }} role="status">
        {company && <p>{describe(company)}</p>}
        {state?.platforms?.length ? (
          <p>
            Platforms, last read:{" "}
            {state.platforms.map((p, i) => (
              <span key={p.label} style={{ color: p.problem ? "var(--warn-ink)" : undefined }} title={p.problem ?? `${p.kept} relevant on the last read`}>
                {i > 0 ? " · " : ""}
                {p.label} {ago(p.lastRunAt)}
              </span>
            ))}
          </p>
        ) : null}
        {state?.laptop && <LaptopLine laptop={state.laptop} latest={state.latest ?? null} />}
        {api && (LIVE.has(api.status) || Date.now() - new Date(api.requested_at).getTime() < 3 * 86_400_000) && <p>{describe(api)}</p>}
        {note && <p style={{ color: "var(--warn-ink)" }}>{note}</p>}
        {[company, api].map((r) =>
          // LinkedIn is the laptop's by design; its "skipped" on GitHub is not news.
          r && r.status === "done" && r.skipped?.filter((s) => !/laptop/i.test(s)).length ? (
            <details key={r.id}>
              <summary style={{ cursor: "pointer" }}>Why {r.skipped.filter((s) => !/laptop/i.test(s)).length} source(s) were skipped</summary>
              <ul className="mt-1 list-disc pl-5">
                {r.skipped.filter((s) => !/laptop/i.test(s)).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
          ) : null,
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
