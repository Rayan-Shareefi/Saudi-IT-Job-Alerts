import { Suspense } from "react";
import { Board } from "@/components/Board";
import { BoardTabs } from "@/components/BoardTabs";
import { SiteReport } from "@/components/SiteReport";
import { RefreshButton } from "@/components/RefreshButton";
import { ResumeMatch } from "@/components/ResumeMatch";
import { ApplyByEmail } from "@/components/ApplyByEmail";
import { FailingSources } from "@/components/FailingSources";
import { HumanIntervene } from "@/components/HumanIntervene";
import { UrlCheck } from "@/components/UrlCheck";
import { SetupNotice } from "@/components/SetupNotice";
import { isConfigured, openUrlFindings, urlDecisions, sourceHealth, sourceReports, urlCheckProgress } from "@/lib/db";
import { BOARD_TABS, loadBoard, tabCounts, type BoardTab } from "@/lib/board";
import { COMPANIES } from "@/lib/sources/companies";
import { disabledSources, latestFixes, readNothing, withOverrides } from "@/lib/source-fix";
import { dynamicSources, enabledSources } from "@/lib/sources/registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function Stat({ value, label, accent }: { value: number | string; label: string; accent?: boolean }) {
  return (
    <div className="surface px-3 py-2.5 text-center sm:px-4 sm:py-3" style={{ borderRadius: "var(--radius)", boxShadow: "var(--shadow-sm)" }}>
      <div className="nums text-lg font-bold leading-none sm:text-2xl" style={{ color: accent ? "var(--accent)" : "var(--ink)", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      <div className="mt-1 text-[10px] font-medium uppercase leading-tight tracking-wide sm:text-[11px]" style={{ color: "var(--ink-3)" }}>
        {label}
      </div>
    </div>
  );
}

async function Results({ searchParams }: { searchParams: SearchParams }) {
  // ?tab= is the board; the old ?view= links (email, human, urls, failing) still work.
  const tab = one(searchParams.tab) ?? one(searchParams.view) ?? "all";
  const counts = await tabCounts();
  const isBoard = (BOARD_TABS as readonly string[]).includes(tab);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Stat value={counts.all} label="Verified jobs" accent />
        <Stat value={counts.saved} label="Saved" />
        <Stat value={counts.unclassified} label="Waiting for the jury" />
        <Stat value={counts.review} label="Your call" />
      </div>

      <RefreshButton />

      <ResumeMatch />

      <BoardTabs active={tab} counts={counts} />

      {tab === "email" ? (
        <ApplyByEmail />
      ) : tab === "failing" ? (
        <FailingSourcesBoundary />
      ) : tab === "human" ? (
        <HumanInterveneBoundary />
      ) : tab === "sites" ? (
        <SiteReportBoundary />
      ) : tab === "urls" ? (
        <UrlCheckBoundary />
      ) : (
        <BoardBoundary tab={isBoard ? (tab as BoardTab) : "all"} />
      )}
    </>
  );
}

async function BoardBoundary({ tab }: { tab: BoardTab }) {
  const jobs = await loadBoard(tab);
  return (
    <>
      <TabNote tab={tab} />
      <Board jobs={jobs} tab={tab} />
    </>
  );
}

async function SiteReportBoundary() {
  const [rows, fixes] = await Promise.all([sourceReports().catch(() => []), latestFixes()]);
  return <SiteReport rows={rows} fixes={fixes} />;
}

async function HumanInterveneBoundary() {
  return <HumanIntervene fixes={await latestFixes()} />;
}

/** One line under the tabs saying what this tab is, in plain words. */
function TabNote({ tab }: { tab: BoardTab }) {
  const notes: Partial<Record<BoardTab, string>> = {
    unclassified:
      "Full postings the AI jury has not read yet. The laptop reads them every two hours; each one then moves to All jobs or Hidden. Nothing uncertain stays here.",
    review:
      "Co-op and internship openings outside cyber / cloud. You asked to judge these yourself: Keep moves one to All jobs, Hide removes it. Physical security is never here.",
    saudi: "Verified cyber / cloud roles in Saudi Arabia whose posting does not say the city. Not in All jobs, which is Riyadh only.",
    senior: "Roles that state 5 or more years, or have a senior title (Senior, Lead, Principal, Manager, Head, Director...) with no years stated. Kept out of All jobs.",
    hidden: "Out of scope, too old, not in Saudi Arabia, not a job, or not proven (the models disagreed or could not tell), each with its reason. Keep brings one back.",
    saved: "Everything you saved or applied to. Nothing here is removed automatically, even after the posting closes.",
    linkedin: "LinkedIn job listings and company hiring posts.",
    boards: "Found through JSearch (Indeed, Bayt, Glassdoor and others), Sabbar, Workable, Telegram channels, Careerjet and Jooble, and not on the employer's own site.",
  };
  const note = notes[tab];
  if (!note) return null;
  return (
    <p className="mb-3 px-4 py-2.5 text-[12.5px] leading-relaxed" style={{ background: "var(--info-soft)", color: "var(--info-ink)", borderRadius: "var(--radius)" }}>
      {note}
    </p>
  );
}

async function UrlCheckBoundary() {
  const [findings, decisions, progress, fixes] = await Promise.all([
    openUrlFindings().catch(() => []),
    urlDecisions().catch(() => []),
    urlCheckProgress().catch(() => ({ checked: 0, open: 0 })),
    latestFixes(),
  ]);
  return <UrlCheck findings={findings} decisions={decisions} progress={progress} total={COMPANIES.length} fixes={fixes} />;
}

async function FailingSourcesBoundary() {
  const [fixes, disabled, dynamic] = await Promise.all([latestFixes(), disabledSources(), dynamicSources()]);
  // A source a fix replaced or switched off is no longer run, so its last
  // status stays "failing" for good: shown for three days with the fix, then gone.
  const gone = new Set([...disabled, ...dynamic.flatMap((d) => d.replaces ?? [])]);
  const recentFix = new Set(
    Object.values(fixes)
      .filter((f) => f.page === "failing" && f.sourceId && Date.now() - new Date(f.checkedAt ?? f.createdAt).getTime() < 3 * 86_400_000)
      .map((f) => f.sourceId as string),
  );
  try {
    const health = await sourceHealth();
    const live = new Set(withOverrides(enabledSources({ includeBrowser: true }), dynamic, disabled).map((s) => s.id));
    return (
      <FailingSources
        rows={health.filter((h) => !h.ok && (!gone.has(h.sourceId) || recentFix.has(h.sourceId)))}
        empty={health.filter((h) => readNothing(h, live) || (recentFix.has(h.sourceId) && h.ok && h.fetched === 0))}
        fixes={fixes}
      />
    );
  } catch {
    return <FailingSources rows={[]} fixes={fixes} />;
  }
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading roles">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="surface h-40 animate-pulse" style={{ borderRadius: "var(--radius-lg)" }} />
      ))}
    </div>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  if (!isConfigured()) return <SetupNotice />;
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ResultsBoundary searchParams={params} />
    </Suspense>
  );
}

async function ResultsBoundary({ searchParams }: { searchParams: SearchParams }) {
  try {
    return await Results({ searchParams });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return <SetupNotice error={message} />;
  }
}
