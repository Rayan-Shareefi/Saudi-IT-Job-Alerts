"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardJob } from "@/lib/board";
import { platformName, platformOf } from "@/lib/platform";
import { byPostTime, postTime } from "@/lib/post-time";
import { forgetWriteKey, writeKeyOrPrompt } from "./useWriteKey";

/* -------------------------------------------------------------------------- */
/* badges                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every badge a card can carry. The same ids drive the badge filter: the user
 * picks which badges to bring forward or hide, and the board ranks by how
 * many of the chosen badges a job has (ties: newest first).
 */
const BADGES: Array<{ id: string; label: string; tone: Tone; hint: string }> = [
  { id: "time-sensitive", label: "Time-sensitive", tone: "danger", hint: "Applies through a form (Google Forms etc.) or closes within 7 days" },
  { id: "recommended", label: "Recommended", tone: "success", hint: "Matches your CV" },
  { id: "coop", label: "Co-op", tone: "warn", hint: "Cooperative training (تدريب تعاوني)" },
  { id: "internship", label: "Internship", tone: "warn", hint: "Internship or trainee programme" },
  { id: "entry", label: "No experience", tone: "info", hint: "Entry level / fresh graduates, quoted from the posting" },
  { id: "y12", label: "1-2 yrs", tone: "info", hint: "States 1-2 years" },
  { id: "y34", label: "3-4 yrs", tone: "info", hint: "States 3-4 years" },
  { id: "new", label: "New", tone: "accent", hint: "Posted or reposted in the last 72 hours" },
  { id: "old", label: "Old", tone: "neutral", hint: "Posted 14 or more days ago" },
  { id: "duplicate", label: "Duplicate", tone: "neutral", hint: "Found on more than one platform - shown once, with every platform named" },
  { id: "saved", label: "Saved", tone: "accent", hint: "In your Saved tab" },
  { id: "applied", label: "Applied", tone: "success", hint: "You pressed Apply" },
  { id: "viewed", label: "Viewed", tone: "neutral", hint: "Opened in this browser" },
];
const FOCUS = ["SOC", "DFIR", "Threat Intel", "GRC", "IAM", "AppSec", "Pentest", "OT Security", "Network Security", "Cloud Security", "Cloud", "DevOps"];

type Tone = "neutral" | "accent" | "info" | "warn" | "success" | "danger";
const TONES: Record<Tone, { background: string; color: string }> = {
  neutral: { background: "var(--surface-2)", color: "var(--ink-2)" },
  accent: { background: "var(--accent-soft)", color: "var(--accent-ink)" },
  info: { background: "var(--info-soft)", color: "var(--info-ink)" },
  warn: { background: "var(--warn-soft)", color: "var(--warn-ink)" },
  success: { background: "var(--success-soft)", color: "var(--success-ink)" },
  danger: { background: "var(--danger-soft)", color: "var(--danger-ink)" },
};

function Badge({ children, tone = "neutral", title }: { children: React.ReactNode; tone?: Tone; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 text-[11px] font-semibold"
      style={{ ...TONES[tone], borderRadius: "999px" }}
    >
      {children}
    </span>
  );
}

const DAY = 86_400_000;

/** The age the New / Old badges use: the posting date, or when we found it if no site says. */
function refreshedAt(j: BoardJob): { at: number; exact: boolean } {
  const t = postTime(j);
  return t !== null ? { at: t, exact: true } : { at: new Date(j.firstSeenAt).getTime(), exact: false };
}

/** Every platform this vacancy was found on, its own first. */
function platformsOf(j: BoardJob): string[] {
  const own = platformOf(j.sourceKind, j.sourceLabel, j.publisher);
  return [...new Set([own, ...j.alsoOn.map((a) => platformName(a.label)), ...j.listedOn.map(platformName)])];
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.ceil((t - Date.now()) / DAY) : null;
}

function badgesOf(j: BoardJob, viewed: boolean): Set<string> {
  const b = new Set<string>();
  const closesIn = daysUntil(j.closesAt);
  if (j.applyKind === "form" || (closesIn !== null && closesIn >= 0 && closesIn <= 7)) b.add("time-sensitive");
  if (j.recommended) b.add("recommended");
  if (j.experienceBand === "coop") b.add("coop");
  if (j.experienceBand === "internship") b.add("internship");
  if (j.experienceBand === "0") b.add("entry");
  if (j.experienceBand === "1-2") b.add("y12");
  if (j.experienceBand === "3-5" && (j.minYears ?? 0) < 5) b.add("y34");
  const age = (Date.now() - refreshedAt(j).at) / DAY;
  if (age <= 3) b.add("new");
  if (age >= 14) b.add("old");
  const platforms = platformsOf(j);
  if (platforms.length > 1) b.add("duplicate");
  for (const p of platforms) b.add(`platform:${p}`);
  if (j.saved) b.add("saved");
  if (j.saved?.appliedAt) b.add("applied");
  if (viewed) b.add("viewed");
  for (const f of j.focus) b.add(`focus:${f}`);
  return b;
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function relative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 3_600_000) return "just now";
  const h = Math.floor(diff / 3_600_000);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(diff / DAY);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return `${Math.floor(d / 30)} mo ago`;
}

function dateOnly(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Riyadh" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function experienceLine(j: BoardJob): string {
  if (j.experienceBand === "coop") return "Co-op training";
  if (j.experienceBand === "internship") return "Internship / trainee";
  if (j.minYears !== null && j.maxYears !== null && j.minYears !== j.maxYears) return `${j.minYears}-${j.maxYears} years`;
  if (j.minYears !== null) return j.minYears === 0 ? "No experience required" : `${j.minYears}+ years`;
  return "Experience not stated";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the employer";
  }
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n+|(?<=[.:!?])\s+(?=[A-Z؀-ۿ•])/)
    .reduce<string[]>((acc, s) => {
      const last = acc[acc.length - 1];
      if (last && last.length < 200) acc[acc.length - 1] = `${last} ${s}`;
      else acc.push(s);
      return acc;
    }, [])
    .map((p) => p.trim())
    .filter(Boolean);
}

const VIEWED_KEY = "sja:viewed:v1";
const FILTER_KEY = "sja:badge-filter:v2";

function useViewed(): [Set<string>, (id: string) => void] {
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setViewed(new Set(JSON.parse(localStorage.getItem(VIEWED_KEY) ?? "[]") as string[]));
    } catch {
      /* storage blocked - nothing remembered */
    }
  }, []);
  const mark = useCallback((id: string) => {
    setViewed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(VIEWED_KEY, JSON.stringify([...next].slice(-3000)));
      } catch {
        /* not persisted */
      }
      return next;
    });
  }, []);
  return [viewed, mark];
}

type Pick = "include" | "exclude";

/* -------------------------------------------------------------------------- */
/* writes                                                                      */
/* -------------------------------------------------------------------------- */

async function post(url: string, body: unknown, purpose: string): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  const key = writeKeyOrPrompt(purpose);
  if (!key) return { ok: false, error: "No key entered." };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-removal-secret": key },
    body: JSON.stringify(body),
  });
  if (res.status === 401) forgetWriteKey();
  try {
    return (await res.json()) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
}

/* -------------------------------------------------------------------------- */
/* detail view                                                                 */
/* -------------------------------------------------------------------------- */

interface Detail {
  description_text: string | null;
  employment_type: string | null;
  decision_note: string | null;
  decided_by: string | null;
  scope_evidence: string[] | null;
  experience_evidence: string | null;
  text_quality: string | null;
  text_fetched_at: string | null;
}

function DetailView({ job, onClose, onApply }: { job: BoardJob; onClose: () => void; onApply: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/jobs/${job.id}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; job?: Detail }) => live && (d.ok && d.job ? setDetail(d.job) : setFailed(true)))
      .catch(() => live && setFailed(true));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      live = false;
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [job.id, onClose]);

  const fresh = refreshedAt(job);
  const evidence = detail?.scope_evidence?.length ? detail.scope_evidence : job.scopeEvidence;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" style={{ background: "rgb(31 29 26 / 0.55)" }} onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={job.title}
        onClick={(e) => e.stopPropagation()}
        className="surface flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden"
        style={{ borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)" }}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold leading-snug" style={{ color: "var(--ink)" }}>{job.title}</h2>
            <p className="mt-1 text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>{job.company}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid place-items-center text-[18px]" style={{ width: 30, height: 30, background: "var(--surface-2)", color: "var(--ink-2)", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
            &times;
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 text-[13px]" style={{ color: "var(--ink-2)" }}>
          <dl className="mb-4 grid gap-1.5 sm:grid-cols-2">
            <Row label="Location" value={job.location || (job.city === "riyadh" ? "Riyadh" : "Not stated")} />
            <Row label="Experience" value={experienceLine(job)} />
            <Row label={fresh.exact ? "Posted" : "First seen"} value={`${dateOnly(new Date(fresh.at).toISOString())} · ${relative(fresh.at)}`} />
            {job.closesAt && <Row label="Applications close" value={dateOnly(job.closesAt)} />}
            {detail?.employment_type && <Row label="Type" value={detail.employment_type} />}
            <Row label="Source" value={job.publisher ? `${job.sourceLabel} (via ${job.publisher})` : job.sourceLabel} />
          </dl>

          {/* Every claim on the card, with the posting's own words behind it. */}
          <section className="mb-4 p-3" style={{ background: "var(--surface-2)", borderRadius: "var(--radius-sm)" }}>
            <p className="text-[12px] font-semibold" style={{ color: "var(--ink)" }}>Why this is here</p>
            {job.decisionNote && <p className="mt-1 text-[12.5px]">{job.decisionNote}{job.decidedBy ? ` — decided by ${job.decidedBy === "human" ? "you" : job.decidedBy}` : ""}</p>}
            {job.experienceEvidence && (
              <p className="mt-2 text-[12.5px]">
                <span style={{ color: "var(--ink-3)" }}>Experience, as the posting says it: </span>
                <q>{job.experienceEvidence}</q>
              </p>
            )}
            {evidence.length > 0 && (
              <div className="mt-2 text-[12.5px]">
                <span style={{ color: "var(--ink-3)" }}>Duties that make it {job.scope === "cloud" ? "cloud" : job.scope === "both" ? "security and cloud" : "security"} work:</span>
                <ul className="mt-1 list-disc pl-5">
                  {evidence.slice(0, 3).map((e) => (
                    <li key={e}><q>{e}</q></li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
              {job.textQuality === "snippet" || job.textQuality === "none"
                ? "Only a short search snippet could be read - open the posting to check the details."
                : `Read the full posting${job.textFetchedAt ? ` on ${dateOnly(job.textFetchedAt)}` : ""}.`}
            </p>
          </section>

          {job.alsoOn.length > 0 && (
            <p className="mb-4 text-[12.5px]">
              <span style={{ color: "var(--ink-3)" }}>Also posted on: </span>
              {job.alsoOn.map((a, i) => (
                <span key={`${a.url}-${i}`}>
                  {i > 0 && " · "}
                  <a href={a.url} target="_blank" rel="noopener noreferrer">{a.label}</a>
                </span>
              ))}
            </p>
          )}

          {failed ? (
            <p style={{ color: "var(--ink-3)" }}>Could not load the posting text. Open the posting to read it.</p>
          ) : !detail ? (
            <p style={{ color: "var(--ink-3)" }}>Loading the posting…</p>
          ) : paragraphs(detail.description_text ?? "").length ? (
            paragraphs(detail.description_text ?? "").map((p, i) => (
              <p key={i} className="mb-2.5 leading-relaxed">{p}</p>
            ))
          ) : (
            <p style={{ color: "var(--ink-3)" }}>This source gave no description. Open the posting to read it.</p>
          )}
        </div>

        <div className="border-t p-4">
          <button type="button" onClick={onApply} className="w-full px-4 py-3 text-[13.5px] font-semibold" style={{ background: "var(--accent)", color: "var(--accent-on)", border: "none", borderRadius: "var(--radius)", cursor: "pointer" }}>
            {job.applyKind === "form" ? "Apply through the form" : `Apply on ${hostOf(job.applyUrl ?? job.url)}`} →
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0" style={{ color: "var(--ink-3)" }}>{label}</dt>
      <dd className="font-medium" style={{ color: "var(--ink)" }}>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* card                                                                        */
/* -------------------------------------------------------------------------- */

function Card({
  job,
  badges,
  tab,
  busy,
  onOpen,
  onApply,
  onSave,
  onDecide,
}: {
  job: BoardJob;
  badges: Set<string>;
  tab: string;
  busy: boolean;
  onOpen: () => void;
  onApply: () => void;
  onSave: () => void;
  onDecide: (d: "show" | "hide" | "clear") => void;
}) {
  const fresh = refreshedAt(job);
  const platforms = platformsOf(job);
  const closesIn = daysUntil(job.closesAt);
  const viewed = badges.has("viewed");
  const decisionTab = tab === "unclassified" || tab === "review" || tab === "hidden" || tab === "senior";

  return (
    <article className="surface flex flex-col p-4" style={{ borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", opacity: viewed ? 0.72 : 1 }}>
      <div className="flex flex-wrap items-center gap-1.5">
        {badges.has("time-sensitive") && (
          <Badge tone="danger" title={job.applyKind === "form" ? "Applies through a form - these intakes often close without notice" : "Closes soon"}>
            {job.applyKind === "form" ? "Form · time-sensitive" : `Closes in ${closesIn}d`}
          </Badge>
        )}
        {badges.has("recommended") && <Badge tone="success" title={job.matchNote ?? undefined}>Recommended</Badge>}
        {badges.has("coop") && <Badge tone="warn">Co-op</Badge>}
        {badges.has("internship") && <Badge tone="warn">Internship</Badge>}
        {badges.has("entry") && <Badge tone="info">No experience</Badge>}
        {badges.has("y12") && <Badge tone="info">1-2 yrs</Badge>}
        {badges.has("y34") && <Badge tone="info">3-4 yrs</Badge>}
        {badges.has("new") && <Badge tone="accent">New</Badge>}
        {badges.has("old") && <Badge>Old</Badge>}
        {job.focus.map((f) => (
          <Badge key={f} tone="neutral">{f}</Badge>
        ))}
        {badges.has("applied") ? <Badge tone="success">Applied</Badge> : badges.has("saved") && <Badge tone="accent">Saved</Badge>}
        {!job.isActive && <Badge tone="danger">No longer listed</Badge>}
        <Badge tone="info" title="Where this posting was found">{platforms[0]}</Badge>
        {platforms.length > 1 && (
          <Badge title="The same vacancy was found on these platforms; it is shown once">Duplicate · {platforms.join(", ")}</Badge>
        )}
      </div>

      <button type="button" onClick={onOpen} className="mt-2 text-left" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
        <h3 className="text-[15.5px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>{job.title}</h3>
        <p className="mt-0.5 text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>{job.company}</p>
      </button>

      <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
        {job.location || (job.city === "riyadh" ? "Riyadh" : "Location not stated")} · {experienceLine(job)}
      </p>
      {job.experienceEvidence && job.experienceSource === "stated" && (
        <p className="mt-1 text-[11.5px] italic" style={{ color: "var(--ink-3)" }} title="Quoted from the posting">
          “{job.experienceEvidence.length > 130 ? `${job.experienceEvidence.slice(0, 127)}…` : job.experienceEvidence}”
        </p>
      )}
      <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {fresh.exact ? `Posted ${relative(fresh.at)}` : `No posting date given · found ${relative(fresh.at)}`}
        {job.textQuality === "snippet" ? " · snippet only" : ""}
        {job.publisher && job.sourceKind === "jsearch" ? ` · via ${job.sourceLabel}` : ""}
      </p>
      {decisionTab && job.decisionNote && (
        <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--warn-ink)" }}>{job.decisionNote}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={onApply} disabled={busy} className="px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: "var(--accent)", color: "var(--accent-on)", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
          Apply
        </button>
        <button type="button" onClick={onOpen} className="px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: "var(--surface-2)", color: "var(--ink-2)", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
          Details
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          aria-pressed={Boolean(job.saved)}
          className="px-3 py-1.5 text-[12.5px] font-semibold"
          style={{ background: "var(--surface-2)", color: job.saved ? "var(--accent-ink)" : "var(--ink-2)", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
        >
          {tab === "saved" ? "Remove from saved" : job.saved ? "★ Saved" : "☆ Save"}
        </button>
        {decisionTab ? (
          <>
            <button type="button" disabled={busy} onClick={() => onDecide("show")} className="px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: "var(--success-soft)", color: "var(--success-ink)", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
              Keep
            </button>
            {tab !== "hidden" && (
              <button type="button" disabled={busy} onClick={() => onDecide("hide")} className="px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: "var(--danger-soft)", color: "var(--danger-ink)", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
                Hide
              </button>
            )}
            {job.humanOverride && (
              <button type="button" disabled={busy} onClick={() => onDecide("clear")} className="px-2 py-1.5 text-[12px]" style={{ background: "none", color: "var(--ink-3)", border: "none", cursor: "pointer" }}>
                Undo my decision
              </button>
            )}
          </>
        ) : (
          tab !== "saved" && (
            <button type="button" disabled={busy} onClick={() => onDecide("hide")} className="ml-auto px-2 py-1.5 text-[12px]" style={{ background: "none", color: "var(--ink-3)", border: "none", cursor: "pointer" }} title="Not a fit - hide it (restorable from the Hidden tab)">
              Hide
            </button>
          )
        )}
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* the board                                                                   */
/* -------------------------------------------------------------------------- */

const PAGE = 30;

export function Board({ jobs: initial, tab }: { jobs: BoardJob[]; tab: string }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initial);
  useEffect(() => setJobs(initial), [initial]);
  const [viewed, markViewed] = useViewed();
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<BoardJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      setPicks(JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") as Record<string, Pick>);
    } catch {
      /* no stored filter */
    }
  }, []);
  const savePicks = (next: Record<string, Pick>) => {
    setPicks(next);
    setShown(PAGE);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      /* not persisted */
    }
  };
  // One click brings a badge forward, a second hides jobs that have it, a third clears it.
  const cycle = (id: string) => {
    const next = { ...picks };
    if (!next[id]) next[id] = "include";
    else if (next[id] === "include") next[id] = "exclude";
    else delete next[id];
    savePicks(next);
  };

  const withBadges = useMemo(() => jobs.map((j) => ({ job: j, badges: badgesOf(j, viewed.has(j.id)) })), [jobs, viewed]);
  const included = Object.entries(picks).filter(([, p]) => p === "include").map(([id]) => id);
  const excluded = Object.entries(picks).filter(([, p]) => p === "exclude").map(([id]) => id);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = withBadges.filter(({ job, badges }) => {
      if (q && !`${job.title} ${job.company}`.toLowerCase().includes(q)) return false;
      if (excluded.some((e) => badges.has(e))) return false;
      if (included.length > 0 && !included.some((i) => badges.has(i))) return false;
      return true;
    });
    if (included.length > 0) {
      // The user's ranking: most of the chosen badges first, ties by posting time.
      const score = (b: Set<string>) => included.filter((i) => b.has(i)).length;
      rows = [...rows].sort((a, b) => score(b.badges) - score(a.badges) || byPostTime(a.job, b.job));
    } else {
      // Default: time-sensitive, then recommended, then co-op, then
      // internship, then everything else - each group newest posting first.
      const rank = (b: Set<string>) => (b.has("time-sensitive") ? 0 : b.has("recommended") ? 1 : b.has("coop") ? 2 : b.has("internship") ? 3 : 4);
      rows = [...rows].sort((a, b) => rank(a.badges) - rank(b.badges) || byPostTime(a.job, b.job));
    }
    return rows;
  }, [withBadges, query, included.join(), excluded.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const { badges } of withBadges) for (const b of badges) c[b] = (c[b] ?? 0) + 1;
    return c;
  }, [withBadges]);
  // One chip per platform present, the busiest first.
  const platformChips = useMemo(
    () =>
      Object.entries(counts)
        .filter(([k]) => k.startsWith("platform:"))
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k.slice("platform:".length)),
    [counts],
  );

  const patch = (id: string, change: Partial<BoardJob>) => setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...change } : j)));

  const apply = async (job: BoardJob) => {
    // Open first, synchronously, so the browser does not treat it as a popup.
    window.open(job.applyUrl ?? job.url, "_blank", "noopener,noreferrer");
    markViewed(job.id);
    setBusy(job.id);
    const r = await post("/api/saved", { jobId: job.id, action: "applied" }, "saving jobs you apply to");
    setBusy(null);
    if (r.ok) patch(job.id, { saved: { savedAt: job.saved?.savedAt ?? new Date().toISOString(), appliedAt: new Date().toISOString() } });
    else setMessage(`Opened the posting, but could not save it: ${r.error ?? "unknown error"}`);
  };

  const toggleSave = async (job: BoardJob) => {
    setBusy(job.id);
    const r = await post("/api/saved", { jobId: job.id, action: job.saved ? "unsave" : "save" }, "saving jobs");
    setBusy(null);
    if (!r.ok) return setMessage(`Could not update Saved: ${r.error ?? "unknown error"}`);
    if (tab === "saved" && job.saved) setJobs((prev) => prev.filter((j) => j.id !== job.id));
    else patch(job.id, { saved: job.saved ? null : { savedAt: new Date().toISOString(), appliedAt: null } });
  };

  const decide = async (job: BoardJob, d: "show" | "hide" | "clear") => {
    setBusy(job.id);
    const r = await post("/api/jobs/decide", { jobId: job.id, decision: d }, "keeping or hiding postings");
    setBusy(null);
    if (!r.ok) return setMessage(`Could not save your decision: ${r.error ?? "unknown error"}`);
    // The card leaves this tab; the server has already moved it.
    if (tab !== "saved") setJobs((prev) => prev.filter((j) => j.id !== job.id));
    setMessage(d === "show" ? `Kept "${job.title}".` : d === "hide" ? `Hidden "${job.title}" - restore it from the Hidden tab.` : "Handed back to the rules.");
    router.refresh();
  };

  const chip = (id: string, label: string, hint?: string) => {
    const p = picks[id];
    const n = counts[id] ?? 0;
    if (n === 0 && !p) return null;
    return (
      <button
        key={id}
        type="button"
        data-badge={id}
        onClick={() => cycle(id)}
        title={`${hint ? `${hint}. ` : ""}Click: bring forward · again: hide these · again: off`}
        aria-pressed={Boolean(p)}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-semibold"
        style={{
          background: p === "include" ? "var(--accent)" : p === "exclude" ? "var(--danger-soft)" : "var(--surface)",
          color: p === "include" ? "var(--accent-on)" : p === "exclude" ? "var(--danger-ink)" : "var(--ink-2)",
          border: `1px solid ${p === "include" ? "var(--accent)" : p === "exclude" ? "var(--danger)" : "var(--border)"}`,
          borderRadius: "999px",
          cursor: "pointer",
          textDecoration: p === "exclude" ? "line-through" : "none",
        }}
      >
        {p === "include" ? "+ " : p === "exclude" ? "− " : ""}
        {label}
        <span className="nums" style={{ opacity: 0.7 }}>{n}</span>
      </button>
    );
  };

  return (
    <div>
      <div className="surface mb-4 p-3" style={{ borderRadius: "var(--radius-lg)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Search title or company"
            className="min-w-[180px] flex-1 px-3 py-2 text-[13px]"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--ink)" }}
          />
          {Object.keys(picks).length > 0 && (
            <button type="button" onClick={() => savePicks({})} className="px-3 py-2 text-[12.5px] font-semibold" style={{ background: "none", color: "var(--accent-ink)", border: "none", cursor: "pointer" }}>
              Clear badge filter
            </button>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {BADGES.map((b) => chip(b.id, b.label, b.hint))}
          {FOCUS.map((f) => chip(`focus:${f}`, f))}
          {platformChips.map((p) => chip(`platform:${p}`, p, `Found on ${p}`))}
        </div>
        <p className="mt-2 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
          {included.length > 0
            ? `Showing jobs with ${included.length === 1 ? "this badge" : "any of these badges"}, most matches first, then newest posting.`
            : "Order: time-sensitive → recommended → co-op → internship → the rest; inside each, newest posting first (jobs whose site gives no date last). Click a badge to bring it forward; click again to hide jobs that have it."}
        </p>
      </div>

      {message && (
        <p className="mb-3 px-3 py-2 text-[12.5px]" role="status" style={{ background: "var(--info-soft)", color: "var(--info-ink)", borderRadius: "var(--radius-sm)" }}>
          {message}{" "}
          <button type="button" onClick={() => setMessage(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 700 }}>×</button>
        </p>
      )}

      <p className="mb-3 text-[13px]" style={{ color: "var(--ink-2)" }} data-testid="job-count">
        <strong style={{ color: "var(--ink)" }}>{list.length}</strong> {list.length === 1 ? "job" : "jobs"}
        {list.length !== jobs.length && <span style={{ color: "var(--ink-3)" }}> of {jobs.length}</span>}
      </p>

      {list.length === 0 ? (
        <div className="surface px-6 py-12 text-center text-[13px]" style={{ borderRadius: "var(--radius-lg)", color: "var(--ink-2)" }}>
          {jobs.length === 0 ? "Nothing here yet." : "No job matches this badge filter and search."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.slice(0, shown).map(({ job, badges }) => (
            <Card
              key={job.id}
              job={job}
              badges={badges}
              tab={tab}
              busy={busy === job.id}
              onOpen={() => {
                markViewed(job.id);
                setOpen(job);
              }}
              onApply={() => void apply(job)}
              onSave={() => void toggleSave(job)}
              onDecide={(d) => void decide(job, d)}
            />
          ))}
        </div>
      )}

      {list.length > shown && (
        <div className="mt-5 text-center">
          <button type="button" onClick={() => setShown((s) => s + PAGE)} className="px-5 py-2.5 text-[13px] font-semibold" style={{ background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer" }}>
            Show more ({list.length - shown} left)
          </button>
        </div>
      )}

      {open && <DetailView job={open} onClose={() => setOpen(null)} onApply={() => void apply(open)} />}
    </div>
  );
}
