"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TRACK_LABELS, EXPERIENCE_LABELS } from "@/lib/types";
import { profileFromText, type ResumeProfile } from "@/lib/resume";
import { forgetWriteKey, writeKeyOrPrompt } from "./useWriteKey";
import demandData from "../../data/skill-demand.json";

export const RESUME_KEY = "sja:resume-profile:v1";

/** Fired when the profile changes, so the job list can re-badge immediately. */
export const RESUME_EVENT = "sja:resume-changed";

/**
 * Read the stored profile.
 *
 * Only the derived profile is ever stored - a list of skills and a seniority
 * band. The CV itself is parsed in the tab and discarded; it is never written
 * to storage, never sent to the server, and never reaches the database.
 */
export function readStoredProfile(): ResumeProfile | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    return raw ? (JSON.parse(raw) as ResumeProfile) : null;
  } catch {
    return null;
  }
}

/** Subscribe to the profile, for components that badge against it. */
export function useResumeProfile(): ResumeProfile | null {
  const [profile, setProfile] = useState<ResumeProfile | null>(null);

  useEffect(() => {
    const load = () => setProfile(readStoredProfile());
    load();
    window.addEventListener(RESUME_EVENT, load);
    // Another tab uploading a CV should update this one too.
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(RESUME_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  return profile;
}

/* -------------------------------------------------------------------------- */

function UploadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}

export function ResumeMatch() {
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProfile(readStoredProfile());
  }, []);

  const demand = demandData as {
    postingsRead: number;
    demand: Array<{ skill: string; count: number; share: number; track: string }>;
  };

  /**
   * Skills employers ask for that this CV does not list.
   *
   * Restricted to the tracks the CV is actually in - telling a security
   * candidate they are missing "flutter" is technically true and useless.
   */
  const gaps = useMemo(() => {
    if (!profile) return [];
    const have = new Set(profile.skills);
    const mine = new Set<string>(profile.tracks);
    return demand.demand
      .filter((d) => !have.has(d.skill))
      .filter((d) => mine.size === 0 || mine.has(d.track))
      .slice(0, 8);
  }, [profile, demand]);

  const publish = useCallback((next: ResumeProfile | null) => {
    setProfile(next);
    try {
      if (next) localStorage.setItem(RESUME_KEY, JSON.stringify(next));
      else localStorage.removeItem(RESUME_KEY);
    } catch {
      /* storage blocked - matching still works for this session */
    }
    window.dispatchEvent(new Event(RESUME_EVENT));
    /*
     * Also store the parsed profile (skills, certifications, years - never the
     * file) on the server, so "Recommended" works on every device and in the
     * emails, not only in this browser. Needs the editing key once.
     */
    const key = writeKeyOrPrompt("saving your CV skills for recommendations");
    if (!key) return;
    void fetch("/api/profile", {
      method: next ? "POST" : "DELETE",
      headers: { "content-type": "application/json", "x-removal-secret": key },
      body: next ? JSON.stringify({ profile: next }) : undefined,
    }).then((r) => {
      if (r.status === 401) forgetWriteKey();
    });
  }, []);

  const onFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const { extractResumeText } = await import("@/lib/resume-parse");
        const text = await extractResumeText(file);
        if (text.trim().length < 120) {
          setError(
            "Almost no text came out of that file. If it is a scanned CV, the page is an image — export a text-based PDF and try again.",
          );
          setBusy(false);
          return;
        }
        const next = profileFromText(text, file.name);
        if (next.skills.length === 0) {
          setError(
            "The file was read, but none of the skills this board matches on appeared in it. Nothing has been saved.",
          );
          setBusy(false);
          return;
        }
        publish(next);
        setOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read that file.");
      } finally {
        setBusy(false);
      }
    },
    [publish],
  );

  return (
    <section
      className="mb-4 px-4 py-3"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span style={{ color: "var(--accent)" }}>
            <UploadIcon />
          </span>
          {profile ? (
            <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>
              Matching against{" "}
              <strong style={{ color: "var(--ink)" }}>{profile.fileName}</strong> —{" "}
              {profile.skills.length} skills
              {profile.tracks.length > 0 && `, ${TRACK_LABELS[profile.tracks[0]]}`}
            </span>
          ) : (
            <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>
              <strong style={{ color: "var(--ink)" }}>Match jobs to your CV.</strong> Upload a PDF or
              Word file to badge the roles that fit.
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {profile && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-[12px] font-semibold underline-offset-2 hover:underline"
              style={{ background: "none", border: "none", color: "var(--ink-3)", cursor: "pointer" }}
            >
              {open ? "Hide" : "What it found"}
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center px-3.5 text-[12.5px] font-semibold"
            style={{
              background: profile ? "var(--surface-2)" : "var(--accent)",
              color: profile ? "var(--ink-2)" : "var(--accent-on)",
              border: profile ? "1px solid var(--border)" : "none",
              borderRadius: "var(--radius-sm)",
              height: "var(--control-h)",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Reading…" : profile ? "Replace CV" : "Upload CV"}
          </button>
          {profile && (
            <button
              type="button"
              onClick={() => {
                publish(null);
                setOpen(false);
              }}
              className="text-[12px] underline-offset-2 hover:underline"
              style={{ background: "none", border: "none", color: "var(--ink-3)", cursor: "pointer" }}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {error && (
        <p
          className="mt-2.5 px-3 py-2 text-[12px]"
          style={{
            background: "var(--danger-soft)",
            color: "var(--danger-ink)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {error}
        </p>
      )}

      {/* Shown so you can check what it actually read, and disagree with it. A
          recommendation you cannot inspect is not one you can trust. */}
      {profile && open && (
        <div className="mt-3 border-t pt-3">
          <dl className="grid gap-2 text-[12.5px] sm:grid-cols-2">
            <div className="flex gap-2">
              <dt style={{ color: "var(--ink-3)" }}>Level</dt>
              <dd style={{ color: "var(--ink-2)" }}>
                {profile.isStudent
                  ? "Student / new graduate — co-ops and internships are boosted"
                  : `${EXPERIENCE_LABELS[profile.band]}${profile.years !== null ? ` (${profile.years} yrs stated)` : ""}`}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt style={{ color: "var(--ink-3)" }}>Fields</dt>
              <dd style={{ color: "var(--ink-2)" }}>
                {profile.tracks.length > 0
                  ? profile.tracks.map((t) => TRACK_LABELS[t]).join(", ")
                  : "none identified"}
              </dd>
            </div>
          </dl>

          {profile.certifications.length > 0 && (
            <p className="mt-2 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
              <span style={{ color: "var(--ink-3)" }}>Certifications </span>
              {profile.certifications.join(", ")}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {profile.skills.slice(0, 28).map((s) => (
              <span
                key={s}
                className="px-2 py-0.5 text-[11px] font-medium"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--ink-2)",
                  borderRadius: "999px",
                }}
              >
                {s}
              </span>
            ))}
            {profile.skills.length > 28 && (
              <span className="px-2 py-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
                +{profile.skills.length - 28} more
              </span>
            )}
          </div>

          {/*
            The inverse of the match, and the more useful direction.

            Knowing which of your skills a posting mentions tells you about that
            posting. Knowing which skills Riyadh employers ask for that your CV
            does not list tells you what to learn next - and it is drawn from
            every active posting, not the handful on screen.

            The demand figures are computed server-side over all postings and
            know nothing about you; the subtraction happens here, on your
            machine.
          */}
          {gaps.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className="text-[12px] font-semibold" style={{ color: "var(--ink-2)" }}>
                Most asked for, and not on your CV
              </p>
              <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                Across {demand.postingsRead} active postings.
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {gaps.map((g) => (
                  <div key={g.skill} className="flex items-center gap-2">
                    <span
                      className="text-[12px]"
                      style={{ color: "var(--ink-2)", minWidth: "9.5rem" }}
                    >
                      {g.skill}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        height: "6px",
                        borderRadius: "999px",
                        background: "var(--accent)",
                        opacity: 0.85,
                        width: `${Math.max(4, Math.round((g.count / gaps[0].count) * 100))}%`,
                        maxWidth: "12rem",
                      }}
                    />
                    <span className="nums text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                      {g.count} role{g.count === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
            Your CV was read in this browser and was not uploaded. Only the list above is stored, on
            this device. Remove it and nothing remains.
          </p>
        </div>
      )}
    </section>
  );
}
