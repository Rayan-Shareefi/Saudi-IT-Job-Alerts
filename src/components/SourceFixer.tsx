"use client";

import { useCallback, useEffect, useState } from "react";
import { DECISION_WORDS, VERDICT_WORDS, type FixDecision, type FixPage, type FixRow } from "@/lib/fix-words";
import { writeKeyOrPrompt } from "./useWriteKey";

/**
 * The repair box on a card (Human intervene, Site report, Failing sources,
 * Check URLs): paste a working URL, see what the laptop's check found, and
 * decide when it could not. See src/lib/source-fix.ts for what is checked.
 */

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; message?: string; error?: string; fix?: FixRow; queued?: FixRow }> {
  const key = writeKeyOrPrompt("repairing sources");
  if (!key) return { ok: false, error: "The write key is needed for this." };
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-removal-secret": key }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; fix?: FixRow; queued?: FixRow };
  if (res.status === 401) return { ok: false, error: "That key was not accepted." };
  return { ok: Boolean(data.ok), ...data };
}

const button = (primary: boolean, busy: boolean) =>
  ({
    background: primary ? "var(--accent)" : "var(--surface-2)",
    color: primary ? "var(--accent-on)" : "var(--ink-2)",
    border: primary ? "none" : "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: busy ? "wait" : "pointer",
  }) as const;

export function FixBox({
  page,
  company,
  sourceId,
  oldUrl,
  fix: initial,
}: {
  page: FixPage;
  company: string;
  sourceId?: string | null;
  oldUrl?: string | null;
  fix?: FixRow | null;
}) {
  const [fix, setFix] = useState<FixRow | null>(initial ?? null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const waiting = fix?.status === "queued" || fix?.status === "checking";

  // While the laptop is checking, look again every 20 s (for up to 15 min).
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const t = setInterval(async () => {
      if (++tries > 45) return clearInterval(t);
      const res = await fetch(`/api/fixes?page=${page}&company=${encodeURIComponent(company)}`).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { fixes?: FixRow[] } | null;
      const latest = data?.fixes?.[0];
      if (latest && latest.id !== fix?.id) setFix(latest);
      else if (latest && latest.status !== fix?.status) setFix(latest);
    }, 20_000);
    return () => clearInterval(t);
  }, [waiting, page, company, fix?.id, fix?.status]);

  const check = useCallback(async () => {
    setBusy(true);
    setNote(null);
    const r = await post("/api/fixes", { page, company, sourceId, oldUrl, newUrl: url.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setNote(r.error ?? "Could not queue that.");
    setFix(r.fix ?? null);
    setNote(r.message ?? null);
    setUrl("");
  }, [page, company, sourceId, oldUrl, url]);

  const choose = useCallback(
    async (decision: FixDecision) => {
      if (!fix) return;
      if ((decision === "replace" || (decision === "linkedin" && !fix.detail.linkedinSlug)) && !url.trim()) {
        return setNote(decision === "replace" ? "Paste the URL to try in the box first." : "Paste the company's LinkedIn page (linkedin.com/company/...) in the box first.");
      }
      setBusy(true);
      setNote(null);
      const r = await post("/api/fixes/decide", { id: fix.id, decision, url: url.trim() || undefined });
      setBusy(false);
      if (!r.ok) return setNote(r.error ?? "Could not save that.");
      setNote(r.message ?? null);
      if (r.queued) setFix(r.queued);
      else setFix({ ...fix, status: decision === "accept" ? "applied" : "done", decision });
      setUrl("");
    },
    [fix, url],
  );

  const tone =
    fix?.status === "applied" ? { bg: "var(--success-soft)", ink: "var(--success-ink)" } : fix?.status === "needs_you" ? { bg: "var(--warn-soft)", ink: "var(--warn-ink)" } : { bg: "var(--surface-2)", ink: "var(--ink-2)" };

  return (
    <div className="mt-3 border-t pt-2.5" style={{ borderColor: "var(--border)" }}>
      {fix && fix.company !== "*" && (
        <div className="mb-2 px-2.5 py-2 text-[12px] leading-relaxed" style={{ background: tone.bg, color: tone.ink, borderRadius: "var(--radius-sm)" }}>
          {waiting ? (
            <span>
              Checking on the laptop{fix.newUrl ? `: ${fix.newUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}` : " for a working URL"} (asked {ago(fix.createdAt)}). It looks every 2 minutes.
            </span>
          ) : (
            <>
              <strong>
                {fix.status === "done" && fix.decision ? DECISION_WORDS[fix.decision] : fix.verdict ? VERDICT_WORDS[fix.verdict] : fix.status}
              </strong>
              {fix.reason && <span className="block">{fix.reason}</span>}
              {fix.detail.learned && <span className="block italic">Decided by habit: {fix.detail.learned}.</span>}
              {fix.detail.sample && fix.detail.sample.length > 0 && <span className="block opacity-80">e.g. {fix.detail.sample.slice(0, 2).join(" · ")}</span>}
              {fix.status === "needs_you" && fix.detail.linkedinSlug && <span className="block">Its LinkedIn page: linkedin.com/company/{fix.detail.linkedinSlug}</span>}
              <span className="block opacity-70">checked {ago(fix.checkedAt ?? fix.createdAt)}</span>
            </>
          )}
        </div>
      )}

      {fix && (fix.status === "needs_you" || fix.status === "applied") && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {fix.options.map((o) => (
            <button key={o} type="button" disabled={busy} onClick={() => choose(o)} className="px-2.5 py-1 text-[11.5px] font-semibold" style={button(o === fix.options[0], busy)}>
              {DECISION_WORDS[o]}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a working careers URL (or a LinkedIn company page)"
          className="min-w-0 flex-1 px-2.5 text-[12px] outline-none"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--ink)", height: "2rem" }}
          aria-label={`A working careers URL for ${company}`}
        />
        <button type="button" disabled={busy || waiting} onClick={check} className="shrink-0 px-2.5 text-[11.5px] font-semibold" style={{ ...button(true, busy), height: "2rem", opacity: waiting ? 0.6 : 1 }} title={url.trim() ? "Check this URL and use it if it works" : "Look for a working URL by itself"}>
          {busy ? "…" : url.trim() ? "Check & replace" : "Find a fix"}
        </button>
      </div>
      {note && <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-2)" }}>{note}</p>}
    </div>
  );
}

/** "Find fixes" for every card on a page, with what the last such run did. */
export function FindAllFixes({ page, count, last }: { page: FixPage; count: number; last?: FixRow | null }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const run = useCallback(async () => {
    setBusy(true);
    const r = await post("/api/fixes", { page, all: true });
    setBusy(false);
    setNote(r.ok ? (r.message ?? "Queued.") : (r.error ?? "Could not queue that."));
  }, [page]);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
      <div className="max-w-2xl text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        <strong style={{ color: "var(--ink)" }}>Find fixes by itself.</strong> The laptop checks each of the {count} card(s): robots.txt, bot protection, the job system,
        and a real read. What works replaces the old URL; a site that cannot be read is read through its LinkedIn page when one is known; anything unclear goes to the AI
        jury, then to you with the reason.
        {last && last.status === "done" && last.reason && <span className="mt-1 block" style={{ color: "var(--ink-3)" }}>Last run {ago(last.checkedAt)}: {last.reason}.</span>}
        {last && last.status === "queued" && <span className="mt-1 block" style={{ color: "var(--ink-3)" }}>Asked {ago(last.createdAt)} - waiting for the laptop.</span>}
        {note && <span className="mt-1 block" style={{ color: "var(--accent-ink)" }}>{note}</span>}
      </div>
      <button type="button" onClick={run} disabled={busy} className="px-4 text-[13px] font-semibold" style={{ ...button(true, busy), height: "var(--control-h)" }}>
        {busy ? "Queuing…" : "Find fixes for all"}
      </button>
    </div>
  );
}
