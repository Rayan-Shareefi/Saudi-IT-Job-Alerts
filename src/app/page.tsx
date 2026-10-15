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
        <Stat value={counts.unclassified} label="Unclassified" />
        <Stat value={counts.review} label="Need your review" />
      </div>

      <RefreshButton />

      <ResumeMatch />

      <BoardTabs active={tab} counts={counts} />

      {tab === "email" ? (
        <ApplyByEmail />
      ) : tab === "failing" ? (
        <FailingSourcesBoundary />
      ) : tab === "human" ? (
        <HumanIntervene />
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
  const rows = await sourceReports().catch(() => []);
  return <SiteReport rows={rows} />;
}

/** One line under the tabs saying what this tab is, in plain words. */
function TabNote({ tab }: { tab: BoardTab }) {
  const notes: Partial<Record<BoardTab, string>> = {
    unclassified:
      "Could not be proven either way: only a snippet could be read, the location or the kind of work is not stated, or the free AI readers have not reached it yet. Your Keep or Hide teaches the board.",
    review:
      "The rules and the AI readers disagree here, with quotes on both sides. Your Keep or Hide is final and becomes a permanent example for the reviewers.",
    senior: "Verified cyber / cloud roles that state 5 or more years. Kept out of All jobs; they will be here when you want them.",
    hidden: "Out of scope, too old, not in Riyadh, or not a job posting, each with its reason. Keep brings one back.",
    saved: "Everything you saved or applied to. Nothing here is removed automatically, even after the posting closes.",
    linkedin: "LinkedIn job listings and company hiring posts.",
    boards: "Found through JSearch (Indeed, Bayt, Glassdoor and others), Careerjet and Jooble, and not on the employer's own site.",
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
  const [findings, decisions, progress] = await Promise.all([
    openUrlFindings().catch(() => []),
    urlDecisions().catch(() => []),
    urlCheckProgress().catch(() => ({ checked: 0, open: 0 })),
  ]);
  return <UrlCheck findings={findings} decisions={decisions} progress={progress} total={COMPANIES.length} />;
}

async function FailingSourcesBoundary() {
  try {
    const health = await sourceHealth();
    return <FailingSources rows={health.filter((h) => !h.ok)} />;
  } catch {
    return <FailingSources rows={[]} />;
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
