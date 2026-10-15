"use client";

import { useMemo, useState } from "react";
import { JobList, type CompanyGroup } from "@/components/JobList";
import {
  EXPERIENCE_BANDS,
  EXPERIENCE_LABELS,
  TRACKS,
  TRACK_LABELS,
  effectivePostedAt,
  type ExperienceBand,
  type JobRecord,
  type TrackId,
} from "@/lib/types";

/**
 * Filters for one employer's page.
 *
 * An employer with 150 open roles is unusable without them - Qiddiya alone runs
 * to eight pages - and the dashboard's filters do not reach here because this
 * page opens in its own tab.
 *
 * Filtering happens in the browser rather than through the URL: the page has
 * already fetched every one of that company's roles to count them, so
 * re-querying the server to hide some of them would be a round trip for
 * nothing.
 */
export function CompanyFilters({ jobs }: { jobs: JobRecord[] }) {
  const [band, setBand] = useState<ExperienceBand | "all">("all");
  const [track, setTrack] = useState<TrackId | "all">("all");
  const [hours, setHours] = useState<number | "all">("all");
  const [q, setQ] = useState("");

  // Only offer a filter that can actually return something.
  const bandCounts = useMemo(() => {
    const m = new Map<ExperienceBand, number>();
    for (const j of jobs) m.set(j.experienceBand, (m.get(j.experienceBand) ?? 0) + 1);
    return m;
  }, [jobs]);

  const trackCounts = useMemo(() => {
    const m = new Map<TrackId, number>();
    for (const j of jobs) for (const t of j.tracks) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [jobs]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const cutoff = hours === "all" ? 0 : Date.now() - hours * 3_600_000;
    return jobs.filter((j) => {
      if (band !== "all" && j.experienceBand !== band) return false;
      if (track !== "all" && !j.tracks.includes(track)) return false;
      if (cutoff && new Date(effectivePostedAt(j).iso).getTime() < cutoff) return false;
      if (term && !`${j.title} ${j.department ?? ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [jobs, band, track, hours, q]);

  const groups: CompanyGroup[] = shown.map((j) => ({ company: j.company, jobs: [j] }));
  const filtered = shown.length !== jobs.length;

  const control = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--ink)",
    height: "var(--control-h)",
  } as const;

  return (
    <>
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search this employer's roles..."
          className="w-full px-3.5 text-[14px] outline-none"
          style={control}
          aria-label="Search roles at this employer"
        />

        <select
          value={band}
          onChange={(e) => setBand(e.target.value as ExperienceBand | "all")}
          className="px-3 text-[14px] font-medium outline-none"
          style={{ ...control, cursor: "pointer" }}
          aria-label="Years of experience"
        >
          <option value="all">Any experience ({jobs.length})</option>
          {EXPERIENCE_BANDS.filter((b) => (bandCounts.get(b) ?? 0) > 0).map((b) => (
            <option key={b} value={b}>
              {EXPERIENCE_LABELS[b]} ({bandCounts.get(b)})
            </option>
          ))}
        </select>

        <select
          value={track}
          onChange={(e) => setTrack(e.target.value as TrackId | "all")}
          className="px-3 text-[14px] font-medium outline-none"
          style={{ ...control, cursor: "pointer" }}
          aria-label="Career track"
        >
          <option value="all">Any track</option>
          {TRACKS.filter((t) => (trackCounts.get(t) ?? 0) > 0).map((t) => (
            <option key={t} value={t}>
              {TRACK_LABELS[t]} ({trackCounts.get(t)})
            </option>
          ))}
        </select>

        <select
          value={String(hours)}
          onChange={(e) => setHours(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="px-3 text-[14px] font-medium outline-none"
          style={{ ...control, cursor: "pointer" }}
          aria-label="Posted within"
        >
          <option value="all">All time</option>
          <option value="12">Last 12 hours</option>
          <option value="24">Last 24 hours</option>
          <option value="72">Last 3 days</option>
          <option value="168">Last week</option>
        </select>
      </div>

      {filtered && (
        <p className="mb-3 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          Showing <strong style={{ color: "var(--ink-2)" }}>{shown.length}</strong> of {jobs.length}{" "}
          roles.{" "}
          <button
            type="button"
            onClick={() => {
              setBand("all");
              setTrack("all");
              setHours("all");
              setQ("");
            }}
            className="underline-offset-2 hover:underline"
            style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}
          >
            Clear filters
          </button>
        </p>
      )}

      {shown.length === 0 ? (
        <div className="surface px-6 py-12 text-center" style={{ borderRadius: "var(--radius-lg)" }}>
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
            No roles match these filters
          </p>
        </div>
      ) : (
        <JobList groups={groups} />
      )}
    </>
  );
}
