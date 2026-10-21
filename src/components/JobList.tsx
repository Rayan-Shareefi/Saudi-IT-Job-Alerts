"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { scoreJob, type MatchResult } from "@/lib/resume";
import { useResumeProfile } from "./ResumeMatch";
import { safeLink } from "@/lib/safe-link";
import { useWriteKey } from "./useWriteKey";
import {
  CITY_LABELS,
  EXPERIENCE_LABELS,
  TRACK_LABELS,
  effectivePostedAt,
  type JobRecord,
} from "@/lib/types";

export interface CompanyGroup {
  company: string;
  jobs: JobRecord[];
}

const VIEWED_KEY = "sja:viewed:v1";

/** A posting this fresh gets a badge. */
const FRESH_HOURS = 72;

/**
 * Which postings have already been opened, remembered per browser.
 *
 * localStorage rather than the database on purpose: "have I read this" is a
 * per-device convenience, and writing it server-side would mean a round trip on
 * every card click for something that does not need to survive a lost laptop.
 * Every access is guarded - private windows and blocked site data throw here.
 */
function useViewed(): [Set<string>, (id: string) => void, () => void] {
  const [viewed, setViewed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VIEWED_KEY);
      if (raw) setViewed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* unreadable storage - carry on with nothing marked */
    }
  }, []);

  const markViewed = useCallback((id: string) => {
    setViewed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(VIEWED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage full or blocked - the badge just will not persist */
      }
      return next;
    });
  }, []);

  const clearViewed = useCallback(() => {
    setViewed(new Set());
    try {
      localStorage.removeItem(VIEWED_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  return [viewed, markViewed, clearViewed];
}

/* -------------------------------------------------------------------------- */
/* small pieces                                                                */
/* -------------------------------------------------------------------------- */

type Tone = "neutral" | "accent" | "info" | "warn" | "success" | "danger";

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  const tones: Record<Tone, { background: string; color: string }> = {
    neutral: { background: "var(--surface-2)", color: "var(--ink-2)" },
    accent: { background: "var(--accent-soft)", color: "var(--accent-ink)" },
    info: { background: "var(--info-soft)", color: "var(--info-ink)" },
    warn: { background: "var(--warn-soft)", color: "var(--warn-ink)" },
    success: { background: "var(--success-soft)", color: "var(--success-ink)" },
    danger: { background: "var(--danger-soft)", color: "var(--danger-ink)" },
  };
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 text-[11px] font-semibold"
      style={{ ...tones[tone], borderRadius: "999px" }}
    >
      {children}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * The exact moment, in Riyadh time.
 *
 * Pinned to Asia/Riyadh rather than the viewer's locale: every posting here is
 * a Riyadh role, and a closing date that shifts because you opened the page on
 * a trip is worse than no timestamp at all.
 */
function absoluteTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Riyadh",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "employer site";
  }
}

function experienceText(job: JobRecord): string {
  if (job.experienceBand === "coop" || job.experienceBand === "internship") {
    return EXPERIENCE_LABELS[job.experienceBand];
  }
  if (job.minYears !== null && job.maxYears !== null) return `${job.minYears}-${job.maxYears} yrs`;
  if (job.minYears !== null) return `${job.minYears}+ yrs`;
  return EXPERIENCE_LABELS[job.experienceBand];
}

/** Description text arrives as one long run; split it into readable blocks. */
function paragraphs(text: string): string[] {
  return text
    .split(/(?<=[.:!?])\s+(?=[A-Z؀-ۿ])/)
    .reduce<string[]>((acc, sentence) => {
      const last = acc[acc.length - 1];
      if (last && last.length < 220) acc[acc.length - 1] = `${last} ${sentence}`;
      else acc.push(sentence);
      return acc;
    }, [])
    .filter((p) => p.trim().length > 0)
    .slice(0, 14);
}

function TrashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* posting age                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * When the posting went live, shown exactly as the age filter measured it.
 *
 * The filter and this line read the same `effectivePostedAt`, so a card can
 * never sit inside "last 12 hours" while displaying a date from last week -
 * which is what happened when the filter tested posted_at and the card printed
 * first_seen_at.
 *
 * "Posted" and "Found" are distinguished on purpose: the second is the honest
 * label for a source that publishes no date, where all we can say is when this
 * app first saw it.
 */
function PostedLine({ job }: { job: JobRecord }) {
  const { iso, exact } = effectivePostedAt(job);
  return (
    <span
      className="inline-flex items-center gap-1"
      title={
        exact
          ? `Posted ${absoluteTime(iso)} (Riyadh time), as stated by the source`
          : `This source publishes no date. First seen by this app ${absoluteTime(iso)} (Riyadh time).`
      }
    >
      <ClockIcon />
      <span>{exact ? "Posted" : "Found"}</span>
      <time dateTime={iso} className="nums">
        {relativeTime(iso)}
      </time>
      <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
      <time dateTime={iso} className="nums" style={{ opacity: 0.85 }}>
        {absoluteTime(iso)}
      </time>
    </span>
  );
}

/** The freshness badge: anything posted within three days. */
function FreshBadge({ job }: { job: JobRecord }) {
  const { iso, exact } = effectivePostedAt(job);
  const hrs = hoursSince(iso);
  if (hrs > FRESH_HOURS) return null;
  const label = hrs < 24 ? "Today" : hrs < 48 ? "1 day" : `${Math.floor(hrs / 24)} days`;
  return (
    <Badge tone="success">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--success)" }}
        aria-hidden="true"
      />
      {label}
      {!exact && <span style={{ opacity: 0.7, fontWeight: 500 }}>(found)</span>}
    </Badge>
  );
}

/**
 * "Recommended" - shown only when a CV is loaded, and always able to say why.
 *
 * The matched skills go in the tooltip rather than the badge: the badge has to
 * survive being one of six on a narrow card, but a recommendation you cannot
 * interrogate is one you cannot disagree with, so the reason is always a hover
 * away.
 */
function MatchBadge({ match }: { match: MatchResult }) {
  if (!match.recommended) return null;
  const why =
    match.matchedSkills.length > 0
      ? `Matches your CV on ${match.matchedSkills.join(", ")}${match.reasons.length ? ` — ${match.reasons[0]}` : ""}`
      : match.reasons.join("; ");
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 text-[11px] font-semibold"
      style={{
        background: "var(--accent-soft)",
        color: "var(--accent-ink)",
        borderRadius: "999px",
        border: "1px solid var(--accent)",
      }}
      title={why}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2l2.9 6.3 6.8.8-5 4.7 1.3 6.7L12 17.3 5.9 20.5 7.3 13.8l-5-4.7 6.8-.8z" />
      </svg>
      Recommended
    </span>
  );
}

/**
 * How long is left to apply.
 *
 * Shown only when the posting states a deadline, and only when it is close
 * enough to matter - a date four months out is not urgent and a permanent
 * "closes in 118 days" badge is just noise. Expired postings never reach the
 * board at all, so this never has to say "closed".
 */
function ClosingBadge({ job }: { job: JobRecord }) {
  if (!job.closesAt) return null;
  const ms = new Date(job.closesAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days > 21) return null;

  const label =
    days === 0 ? "Closes today" : days === 1 ? "Closes tomorrow" : `Closes in ${days} days`;
  // Under a week is the point at which it changes what you do today.
  const tone = days <= 6 ? "danger" : "warn";

  return (
    <Badge tone={tone}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {label}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* removal                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Confirm a removal, asking for the key the first time.
 *
 * Removal is reversible (the row is flagged, never deleted) but it still takes
 * a posting off the board, so it asks rather than firing on a stray tap.
 */
function RemoveDialog({
  job,
  storedKey,
  onSaveKey,
  onDone,
  onClose,
}: {
  job: JobRecord;
  storedKey: string | null;
  onSaveKey: (k: string) => void;
  onDone: (id: string) => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState(storedKey ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/remove", {
        method: "POST",
        headers: { "content-type": "application/json", "x-removal-secret": key },
        body: JSON.stringify({ id: job.id, action: "remove", reason: reason || undefined }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; changed?: boolean };
      if (!res.ok || !data.ok) {
        setError(
          res.status === 401
            ? "That key was not accepted."
            : res.status === 503
              ? "Removal is not configured on the server yet (set REMOVAL_SECRET)."
              : (data.error ?? "Removal failed."),
        );
        setBusy(false);
        return;
      }
      onSaveKey(key);
      onDone(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Removal failed.");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6"
      style={{ background: "rgb(31 29 26 / 0.55)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Remove posting"
        onClick={(e) => e.stopPropagation()}
        className="surface w-full max-w-md p-5"
        style={{ borderRadius: "var(--radius-lg)" }}
      >
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>
          Remove this posting?
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          <strong style={{ color: "var(--ink)" }}>{job.title}</strong> at {job.company}. It comes
          off the board and stays off, even after the next collection run.
        </p>

        <label className="mt-4 block text-[12px] font-semibold" style={{ color: "var(--ink-2)" }}>
          Reason (optional)
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Link is dead, role filled..."
            className="mt-1 w-full px-3 text-[13px] font-normal outline-none"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--ink)",
              height: "var(--control-h)",
            }}
          />
        </label>

        {!storedKey && (
          <label className="mt-3 block text-[12px] font-semibold" style={{ color: "var(--ink-2)" }}>
            Removal key
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="REMOVAL_SECRET"
              autoFocus
              className="mt-1 w-full px-3 text-[13px] font-normal outline-none"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--ink)",
                height: "var(--control-h)",
              }}
            />
            <span className="mt-1 block text-[11px] font-normal" style={{ color: "var(--ink-3)" }}>
              Asked once, then remembered in this browser.
            </span>
          </label>
        )}

        {error && (
          <p
            className="mt-3 px-3 py-2 text-[12px]"
            style={{
              background: "var(--danger-soft)",
              color: "var(--danger-ink)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 text-[13px] font-semibold"
            style={{
              background: "var(--surface-2)",
              color: "var(--ink-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              height: "var(--control-h)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || key.trim() === ""}
            className="px-4 text-[13px] font-semibold"
            /* danger, not accent - white stays correct on red in both themes */
            style={{
              background: busy || key.trim() === "" ? "var(--surface-3)" : "var(--danger)",
              color: busy || key.trim() === "" ? "var(--ink-3)" : "#fff",
              border: "none",
              borderRadius: "var(--radius-sm)",
              height: "var(--control-h)",
              cursor: busy || key.trim() === "" ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Removing..." : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="grid shrink-0 place-items-center opacity-45 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      style={{
        width: "30px",
        height: "30px",
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        color: "var(--ink-3)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--danger-soft)";
        e.currentTarget.style.color = "var(--danger-ink)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--ink-3)";
      }}
    >
      <TrashIcon />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* detail modal                                                                */
/* -------------------------------------------------------------------------- */

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0" style={{ color: "var(--ink-3)" }}>
        {label}
      </dt>
      <dd style={{ color: "var(--ink-2)" }}>{value}</dd>
    </div>
  );
}

/**
 * Full posting in a modal.
 *
 * A dialog rather than an inline expansion: descriptions run to several hundred
 * words, and unfolding that inside a grid cell pushed every other card down the
 * page and lost your place in the list.
 */
function JobModal({
  job,
  onClose,
  onRequestRemove,
  match,
}: {
  job: JobRecord;
  onClose: () => void;
  onRequestRemove: () => void;
  match?: MatchResult;
}) {
  // Escape to close, and stop the page behind from scrolling while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const blocks = paragraphs(job.descriptionText ?? "");
  const { iso, exact } = effectivePostedAt(job);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      style={{ background: "rgb(31 29 26 / 0.55)" }}
      onClick={onClose}
      role="presentation"
    >
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
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {match && <MatchBadge match={match} />}
              <ClosingBadge job={job} />
              <FreshBadge job={job} />
              {job.sourceKind === "ats" && <Badge tone="accent">Direct from employer</Badge>}
              {job.experienceBand === "coop" && <Badge tone="warn">Co-op</Badge>}
              {job.experienceBand === "internship" && <Badge tone="warn">Internship</Badge>}
            </div>
            <h2
              className="text-[18px] font-bold leading-snug"
              style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}
            >
              {job.title}
            </h2>
            <p className="mt-1 text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
              {job.company}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <RemoveButton onClick={onRequestRemove} label="Remove this posting" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid place-items-center text-[18px] leading-none"
              style={{
                width: "30px",
                height: "30px",
                background: "var(--surface-2)",
                color: "var(--ink-2)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              &times;
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <dl className="mb-4 grid gap-1.5 text-[12.5px] sm:grid-cols-2">
            <DetailRow
              label="Location"
              value={job.locationText?.trim() || CITY_LABELS[job.city] || "Not stated"}
            />
            <DetailRow label="Experience" value={experienceText(job)} />
            {job.department && <DetailRow label="Team" value={job.department} />}
            {job.employmentType && <DetailRow label="Type" value={job.employmentType} />}
            <DetailRow label="Source" value={job.sourceLabel} />
            <DetailRow
              label={exact ? "Posted" : "First seen"}
              value={`${absoluteTime(iso)} · ${relativeTime(iso)}`}
            />
            {job.closesAt && (
              <DetailRow label="Applications close" value={absoluteTime(job.closesAt)} />
            )}
          </dl>

          {match && (match.blockers.length > 0 || match.missingSkills.length > 0) && (
            <div
              className="mb-4 px-3 py-2.5"
              style={{
                background: "var(--surface-2)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
              }}
            >
              {match.blockers.length > 0 && (
                <>
                  <p className="text-[12px] font-semibold" style={{ color: "var(--ink-2)" }}>
                    Why this is not recommended
                  </p>
                  <ul className="mt-1 list-disc pl-4 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
                    {match.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </>
              )}
              {match.missingSkills.length > 0 && (
                <p
                  className={match.blockers.length > 0 ? "mt-2 text-[12px]" : "text-[12px]"}
                  style={{ color: "var(--ink-3)" }}
                >
                  <span style={{ color: "var(--ink-2)" }}>
                    Asks for, and your CV does not show:{" "}
                  </span>
                  {match.missingSkills.join(", ")}
                </p>
              )}
            </div>
          )}


          {blocks.length > 0 ? (
            blocks.map((para, i) => (
              <p key={i} className="mb-2.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {para}
              </p>
            ))
          ) : (
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
              This source did not include a description. Open the posting to read the full details
              and qualifications.
            </p>
          )}
        </div>

        <div className="border-t p-4">
          <a
            href={safeLink(job.url) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-1.5 px-4 py-3 text-[13.5px] font-semibold no-underline"
            style={{ background: "var(--accent)", color: "var(--accent-on)", borderRadius: "var(--radius)" }}
          >
            Apply on {hostOf(job.url)} <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* rows and cards                                                              */
/* -------------------------------------------------------------------------- */

function JobRow({
  job,
  isViewed,
  onOpen,
  onRequestRemove,
  compact = false,
  isDuplicate = false,
  match,
}: {
  job: JobRecord;
  isViewed: boolean;
  onOpen: () => void;
  onRequestRemove: () => void;
  compact?: boolean;
  isDuplicate?: boolean;
  match?: MatchResult;
}) {
  return (
    <div style={{ opacity: isViewed ? 0.66 : 1 }}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {match && <MatchBadge match={match} />}
            <ClosingBadge job={job} />
            <FreshBadge job={job} />
            {job.sourceKind === "ats" && !compact && <Badge tone="accent">Direct from employer</Badge>}
            {job.experienceBand === "coop" && <Badge tone="warn">Co-op</Badge>}
            {job.experienceBand === "internship" && <Badge tone="warn">Internship</Badge>}
            {job.experienceBand === "0" && <Badge tone="info">No experience</Badge>}
            {job.experienceBand === "1-2" && <Badge tone="info">1-2 yrs</Badge>}
            {isViewed && <Badge>Viewed</Badge>}
          </div>

          <h3
            className={`mt-2 font-semibold leading-snug ${compact ? "text-[14px]" : "text-[15px] sm:text-[16px]"}`}
            style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}
          >
            {job.title}
          </h3>

          {!compact && (
            <p className="mt-1 text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
              {job.company}
            </p>
          )}

          <p
            className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
            style={{ color: "var(--ink-3)" }}
          >
            <span>{CITY_LABELS[job.city] ?? job.city}</span>
            <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
            <span>{experienceText(job)}</span>
          </p>

          {/* The timestamp gets its own line: it is the thing the age filter
              acts on, so it should not be competing for space with the city. */}
          <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
            <PostedLine job={job} />
          </p>

          <span
            className="mt-2.5 inline-block text-[12px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            View details
          </span>

          {/*
            A role that scored well but did not qualify says why.

            "Recommended" with no explanation is bad enough; silently NOT
            recommending something squarely in your field is worse, because you
            cannot tell whether the matcher is wrong or the job is out of reach.
          */}
          {match && !match.recommended && match.blockers.length > 0 && match.score >= 35 && (
            <span
              className="mt-2 flex items-start gap-1.5 text-[11px]"
              style={{ color: "var(--ink-3)" }}
              title={match.blockers.join("; ")}
            >
              <span aria-hidden="true" style={{ opacity: 0.7 }}>&#9888;</span>
              Not recommended: {match.blockers[0]}
            </span>
          )}

          {/* Sits at the bottom on purpose: it qualifies the row rather than
              leading it, and the title is what you are scanning for. */}
          {isDuplicate && (
            <span
              className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold"
              style={{ color: "var(--ink-3)" }}
              title="This role also appears under All company sources, where it was found first"
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--ink-3)" }}
                aria-hidden="true"
              />
              Duplicate — already on the company board
            </span>
          )}
        </button>

        <RemoveButton onClick={onRequestRemove} label={`Remove ${job.title}`} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function JobList({
  groups,
  duplicateOf = new Set<string>(),
}: {
  groups: CompanyGroup[];
  /**
   * Fingerprints already seen on a company board. Only ever populated on the
   * aggregator tabs - a duplicate there means the employer's own site carried
   * the same role, and carried it earlier.
   */
  duplicateOf?: Set<string>;
}) {
  const [viewed, markViewed, clearViewed] = useViewed();
  const [removalKey, saveRemovalKey] = useWriteKey();
  const resume = useResumeProfile();
  const [openJob, setOpenJob] = useState<JobRecord | null>(null);
  const [removing, setRemoving] = useState<JobRecord | null>(null);
  // Removed rows disappear immediately rather than waiting for a refetch; the
  // server is the source of truth, this is just so the click feels answered.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const openDetails = useCallback(
    (job: JobRecord) => {
      setOpenJob(job);
      markViewed(job.id);
    },
    [markViewed],
  );

  const onRemoved = useCallback((id: string) => {
    setRemovedIds((prev) => new Set(prev).add(id));
    setRemoving(null);
    setOpenJob(null);
  }, []);

  /*
   * Scored once per render pass rather than per card. Matching is cheap - it is
   * substring tests over a fixed vocabulary - but a page can hold a thousand
   * postings inside company groups, and re-running it inside each card would
   * mean scoring the same job every time an unrelated piece of state moved.
   */
  const matches = useMemo(() => {
    if (!resume) return new Map<string, MatchResult>();
    const out = new Map<string, MatchResult>();
    for (const g of groups) {
      for (const j of g.jobs) out.set(j.id, scoreJob(j, resume));
    }
    return out;
  }, [groups, resume]);

  /*
   * With a CV loaded, recommended roles come first.
   *
   * Ordering happens here rather than in the query because matching is done in
   * the browser - the CV never reaches the server, which is the whole point of
   * how it works - so the server has no idea which rows are recommended.
   *
   * Two levels: companies carrying a recommendation float above those that do
   * not, and inside a company card the recommended roles are listed first.
   * Within each level the incoming order is preserved, so whichever sort you
   * chose still decides the rest.
   */
  const visible = useMemo(() => {
    const live = groups
      .map((g) => ({ ...g, jobs: g.jobs.filter((j) => !removedIds.has(j.id)) }))
      .filter((g) => g.jobs.length > 0);

    if (matches.size === 0) return live;

    const scoreOf = (id: string) => matches.get(id)?.score ?? 0;
    const isRec = (id: string) => matches.get(id)?.recommended === true;

    const reordered = live.map((g) => ({
      ...g,
      jobs: [...g.jobs].sort((a, b) => {
        const ra = isRec(a.id) ? 1 : 0;
        const rb = isRec(b.id) ? 1 : 0;
        if (ra !== rb) return rb - ra;
        return ra === 1 ? scoreOf(b.id) - scoreOf(a.id) : 0;
      }),
    }));

    // Array.prototype.sort is stable, so groups with no recommendation keep
    // exactly the order the server sent them in.
    return reordered.sort((a, b) => {
      const ca = a.jobs.filter((j) => isRec(j.id)).length;
      const cb = b.jobs.filter((j) => isRec(j.id)).length;
      if ((ca > 0) !== (cb > 0)) return cb - ca;
      if (ca === 0) return 0;
      // Both carry recommendations: the strongest single match leads.
      const best = (g: CompanyGroup) => Math.max(...g.jobs.map((j) => scoreOf(j.id)));
      return best(b) - best(a);
    });
  }, [groups, removedIds, matches]);

  const recommendedCount = useMemo(
    () =>
      visible.reduce(
        (n, g) => n + g.jobs.filter((j) => matches.get(j.id)?.recommended).length,
        0,
      ),
    [visible, matches],
  );

  const viewedCount = visible.reduce(
    (n, g) => n + g.jobs.filter((j) => viewed.has(j.id)).length,
    0,
  );

  return (
    <>
      {recommendedCount > 0 && (
        <p
          className="mb-3 px-3 py-2 text-[12.5px]"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent-ink)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <strong>{recommendedCount}</strong> role{recommendedCount === 1 ? "" : "s"} on this page
          match your CV, listed first.
        </p>
      )}

      {(viewedCount > 0 || removedIds.size > 0) && (
        <div className="mb-3 flex items-center justify-end gap-3 text-[12px]">
          {removedIds.size > 0 && (
            <span style={{ color: "var(--ink-3)" }}>
              {removedIds.size} removed this session
            </span>
          )}
          {viewedCount > 0 && (
            <button
              type="button"
              onClick={clearViewed}
              className="underline-offset-2 hover:underline"
              style={{ color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer" }}
            >
              Clear {viewedCount} viewed
            </button>
          )}
        </div>
      )}

      <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((group) => {
          // One posting: a plain card. Several: collapse them under the company
          // so a single employer with 40 openings cannot swamp the whole page.
          if (group.jobs.length === 1) {
            const job = group.jobs[0];
            return (
              <li key={job.id} className="fade-up">
                <article className="card p-4 sm:p-5">
                  <JobRow
                    job={job}
                    isViewed={viewed.has(job.id)}
                    onOpen={() => openDetails(job)}
                    onRequestRemove={() => setRemoving(job)}
                    isDuplicate={duplicateOf.has(job.fingerprint)}
                    match={matches.get(job.id)}
                  />
                </article>
              </li>
            );
          }

          // Several roles from one employer: a card that opens that company's
          // own page in a new tab, so comparing employers is two tabs rather
          // than a lot of scrolling.
          const unseen = group.jobs.filter((j) => !viewed.has(j.id)).length;
          const tracks = [...new Set(group.jobs.map((j) => j.primaryTrack))].slice(0, 3);
          const students = group.jobs.filter(
            (j) => j.experienceBand === "coop" || j.experienceBand === "internship",
          ).length;
          const fresh = group.jobs.filter(
            (j) => hoursSince(effectivePostedAt(j).iso) <= FRESH_HOURS,
          ).length;
          // The newest role in the group, so the card carries a timestamp too.
          const newest = group.jobs.reduce((best, j) =>
            effectivePostedAt(j).iso > effectivePostedAt(best).iso ? j : best,
          );
          const recommendedHere = group.jobs.filter((j) => matches.get(j.id)?.recommended).length;

          return (
            <li key={group.company} className="fade-up">
              <article className="card group relative p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* So you can tell from the grid that this employer is worth
                      opening, without expanding every company in turn. */}
                  {recommendedHere > 0 && (
                    <span
                      className="inline-flex items-center gap-1 whitespace-nowrap px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        background: "var(--accent-soft)",
                        color: "var(--accent-ink)",
                        borderRadius: "999px",
                        border: "1px solid var(--accent)",
                      }}
                      title={`${recommendedHere} role${recommendedHere === 1 ? "" : "s"} here match your CV`}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2l2.9 6.3 6.8.8-5 4.7 1.3 6.7L12 17.3 5.9 20.5 7.3 13.8l-5-4.7 6.8-.8z" />
                      </svg>
                      {recommendedHere} recommended
                    </span>
                  )}
                  <Badge tone="accent">{group.jobs.length} open roles</Badge>
                  {fresh > 0 && (
                    <Badge tone="success">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--success)" }}
                        aria-hidden="true"
                      />
                      {fresh} new
                    </Badge>
                  )}
                  {students > 0 && <Badge tone="warn">{students} co-op / intern</Badge>}
                  {unseen === 0 && <Badge>All viewed</Badge>}
                </div>

                <h3
                  className="mt-2 text-[15px] font-semibold leading-snug sm:text-[16px]"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  <a
                    href={`/company/${encodeURIComponent(group.company)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="no-underline outline-offset-4 after:absolute after:inset-0 after:content-['']"
                    style={{ color: "var(--ink)" }}
                  >
                    {group.company}
                  </a>
                </h3>

                <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
                  {tracks.map((t) => TRACK_LABELS[t]).join(" · ")}
                </p>

                <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                  <PostedLine job={newest} />
                </p>

                <span
                  className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-semibold"
                  style={{ color: "var(--accent)" }}
                >
                  Open {group.jobs.length} roles in a new tab
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                    &rarr;
                  </span>
                </span>
              </article>
            </li>
          );
        })}
      </ul>

      {openJob && (
        <JobModal
          job={openJob}
          onClose={() => setOpenJob(null)}
          onRequestRemove={() => setRemoving(openJob)}
          match={matches.get(openJob.id)}
        />
      )}

      {removing && (
        <RemoveDialog
          job={removing}
          storedKey={removalKey}
          onSaveKey={saveRemovalKey}
          onDone={onRemoved}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}
