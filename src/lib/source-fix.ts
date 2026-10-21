/**
 * Repairs to the sites the collector reads.
 *
 * The user's request (2026-10-21): on the Human intervene, Site report,
 * Failing sources and Check URLs pages, a place on every card to paste a
 * working URL, and a button that looks for one by itself. Whatever the URL,
 * the laptop checks it before anything changes (scripts/fix-sources.ts):
 *
 *   1. robots.txt - a page the site asks crawlers to leave alone is left alone;
 *   2. bot protection or a login wall - reported, never got around;
 *   3. which job system the page runs on (Workday, SuccessFactors, ...);
 *   4. a real read with that system's reader, which must return real postings
 *      from this employer.
 *
 * A board that passes is applied by itself, replacing the broken source. A
 * page that loads but shows nothing goes to the AI jury ("is this the
 * company's careers page?", with quotes checked in the page). Anything still
 * unsettled waits for the user with the reason and the choices: keep, delete,
 * read the company's LinkedIn page instead, or paste another URL. The user's
 * choices are learned: three alike in a row for the same kind of problem and
 * the next one is handled the same way, saying so.
 *
 * This file holds the parts shared by the pages, the API and the laptop
 * script. Nothing here fetches a site.
 */
import { AGGREGATOR_KINDS, fetchAllRows, saveUrlDecision, supabaseAdmin, supabaseRead } from "./db";
import { COMPANIES, isGlobalEmployer } from "./sources/companies";
import { ALL_SOURCES, dynamicSources } from "./sources/registry";
import type { SourceDefinition } from "./types";

import { optionsFor, type FixDecision, type FixDetail, type FixPage, type FixRow, type FixStatus, type FixVerdict, type FoundBoard } from "./fix-words";
export * from "./fix-words";

/* -------------------------------------------------------------------------- */
/* checks that need no network                                                 */
/* -------------------------------------------------------------------------- */

/**
 * May a general crawler read this path? The group for `User-agent: *`; the
 * longest matching rule wins, Allow over Disallow on a tie (RFC 9309).
 */
export function robotsAllows(robots: string, path: string): boolean {
  const lines = robots.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  let inStar = false;
  let sawAgent = false;
  const rules: Array<{ allow: boolean; pattern: string }> = [];
  for (const line of lines) {
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      // A new group starts after any rule line.
      if (!sawAgent) inStar = false;
      sawAgent = true;
      if (value === "*") inStar = true;
      continue;
    }
    sawAgent = false;
    if (!inStar) continue;
    if (key === "disallow" && value) rules.push({ allow: false, pattern: value });
    if (key === "allow" && value) rules.push({ allow: true, pattern: value });
  }
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    const re = new RegExp(
      "^" + r.pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"),
    );
    if (!re.test(path)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

/**
 * Signs that a response is bot protection rather than the page. Returns the
 * name of what blocked us, or null. Only names it: it is never got around.
 */
export function blockedBy(status: number, headers: Record<string, string>, html: string): string | null {
  const h = (k: string) => headers[k.toLowerCase()] ?? "";
  const body = html.slice(0, 20000);
  if (h("cf-mitigated") || /cf-chl|challenge-platform|Just a moment\.\.\.|Attention Required! \| Cloudflare/i.test(body)) return "Cloudflare";
  if (/_Incapsula_Resource|Incapsula incident/i.test(body)) return "Imperva";
  if (/px-captcha|perimeterx/i.test(body)) return "PerimeterX";
  if (/datadome/i.test(body) || h("x-datadome")) return "DataDome";
  if (/Access Denied[\s\S]{0,400}Reference #|errors\.edgesuite\.net/i.test(body)) return "Akamai";
  if (/g-recaptcha|hcaptcha|captcha-delivery/i.test(body) && body.length < 15000) return "a CAPTCHA";
  if ((status === 403 || status === 429) && /cloudflare|akamai/i.test(h("server"))) return h("server");
  return null;
}

/**
 * A page that wants a personal sign-in (Nafath, SSO) before it shows jobs.
 * A sign-in page is one that asks for a password or sends you to Nafath -
 * not one that merely mentions them: center3's careers page has a Login link
 * and a word about Nafath and was taken for a wall (2026-10-21).
 */
export function loginWall(url: string, html: string): boolean {
  const u = new URL(url);
  if (/(^|\.)(nafath\.sa|iam\.gov\.sa)$/i.test(u.hostname)) return true;
  const loginPath = /\/(login|signin|sign-in|sso|auth)\b/i.test(u.pathname);
  return loginPath && (/<input[^>]+type=["']?password/i.test(html) || /nafath|نفاذ/i.test(html));
}

/**
 * The user's habit for a kind of problem: the last three decisions on fixes
 * with this verdict, if all the same and one the checker may repeat.
 * "replace", "accept" and "undo" depend on the case, so they are never
 * repeated by themselves.
 */
export function learnedChoice(history: Array<{ verdict: string | null; decision: string | null }>, verdict: FixVerdict): FixDecision | null {
  const mine = history.filter((h) => h.verdict === verdict && h.decision && h.decision !== "undo").map((h) => h.decision as FixDecision);
  const last = mine.slice(0, 3);
  if (last.length < 3 || !last.every((d) => d === last[0])) return null;
  return ["keep", "delete", "linkedin"].includes(last[0]) ? last[0] : null;
}

/** A LinkedIn company slug from a pasted URL or a page's links. */
export function linkedinSlugIn(text: string): string | null {
  const m = text.match(/linkedin\.com\/company\/([A-Za-z0-9_%.-]{2,100})/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).replace(/[/?#].*$/, "");
  return /^(linkedin|login|signup|jobs)$/i.test(slug) ? null : slug;
}

/**
 * The sources the collector reads after the fixes: switched-off sources go,
 * and a board a fix found stands in for the sources it replaces.
 */
export function withOverrides(
  sources: SourceDefinition[],
  dynamic: SourceDefinition[],
  disabled: Set<string>,
): SourceDefinition[] {
  const replaced = new Set(dynamic.flatMap((d) => d.replaces ?? []));
  const known = new Set(sources.map((s) => s.id));
  return [...sources, ...dynamic.filter((d) => !known.has(d.id))].filter((s) => !disabled.has(s.id) && !replaced.has(s.id));
}

/**
 * A main employer board, still read, that answered without error and gave no
 * postings at all. Broken just as surely as a failing one, only silently:
 * 110 of them on 2026-10-21, center3 and Cipher among them. Extra pages
 * ("alt" sources: graduate schemes, talent communities) often list nothing
 * by nature, so they are left out.
 */
export function readNothing(h: { sourceId: string; ok: boolean; fetched: number }, live: Set<string>): boolean {
  return h.ok && h.fetched === 0 && live.has(h.sourceId) && !/^alt\d/.test(h.sourceId);
}

/* -------------------------------------------------------------------------- */
/* database                                                                    */
/* -------------------------------------------------------------------------- */

function fromRow(r: Record<string, unknown>): FixRow {
  return {
    id: String(r.id),
    company: String(r.company),
    sourceId: (r.source_id as string) ?? null,
    page: r.page as FixPage,
    oldUrl: (r.old_url as string) ?? null,
    newUrl: (r.new_url as string) ?? null,
    requestedBy: (r.requested_by as "user" | "auto") ?? "user",
    status: r.status as FixStatus,
    verdict: (r.verdict as FixVerdict) ?? null,
    reason: (r.reason as string) ?? null,
    detail: (r.detail as FixDetail) ?? {},
    options: ((r.options as string[]) ?? []) as FixDecision[],
    decision: (r.decision as FixDecision) ?? null,
    decidedAt: (r.decided_at as string) ?? null,
    createdAt: String(r.created_at),
    checkedAt: (r.checked_at as string) ?? null,
  };
}

/** The latest fix per card (`page|company`), for the pages. */
export async function latestFixes(): Promise<Record<string, FixRow>> {
  const out: Record<string, FixRow> = {};
  try {
    const rows = await fetchAllRows<Record<string, unknown>>(
      (from, to) => supabaseRead().from("source_fixes").select("*").order("created_at", { ascending: false }).range(from, to),
      "source fixes",
    );
    for (const r of rows) {
      const f = fromRow(r);
      const key = `${f.page}|${f.company}`;
      if (!out[key]) out[key] = f;
    }
  } catch {
    /* no table yet: the pages show no fix state */
  }
  return out;
}

export function fixRowFrom(r: Record<string, unknown>): FixRow {
  return fromRow(r);
}

/** Sources switched off by the user or by a fix. */
export async function disabledSources(): Promise<Set<string>> {
  try {
    const { data } = await supabaseAdmin().from("source_overrides").select("source_id").eq("action", "disable");
    return new Set((data ?? []).map((r) => String(r.source_id)));
  } catch {
    return new Set();
  }
}

export interface QueueInput {
  company: string;
  page: FixPage;
  sourceId?: string | null;
  oldUrl?: string | null;
  newUrl?: string | null;
  requestedBy?: "user" | "auto";
  detail?: FixDetail;
}

export async function queueFix(input: QueueInput): Promise<FixRow> {
  const { data, error } = await supabaseAdmin()
    .from("source_fixes")
    .insert({
      company: input.company,
      page: input.page,
      source_id: input.sourceId ?? null,
      old_url: input.oldUrl ?? null,
      new_url: input.newUrl ?? null,
      requested_by: input.requestedBy ?? "user",
      detail: input.detail ?? {},
    })
    .select("*")
    .single();
  if (error) throw new Error(`could not queue the fix: ${error.message}`);
  return fromRow(data as Record<string, unknown>);
}

/* -------------------------------------------------------------------------- */
/* applying a fix                                                              */
/* -------------------------------------------------------------------------- */

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
}

/** The employer sources a fix for this company replaces or switches off. */
export async function companySourceIds(company: string, sourceId?: string | null): Promise<string[]> {
  if (sourceId) return [sourceId];
  const isPlatform = (s: SourceDefinition) =>
    (AGGREGATOR_KINDS as readonly string[]).includes(s.kind) || s.kind === "linkedin" || s.kind === "linkedin-post";
  const all = [...ALL_SOURCES, ...(await dynamicSources())];
  return [...new Set(all.filter((s) => !isPlatform(s) && (s.company === company || s.label === company)).map((s) => s.id))];
}

async function settle(fix: FixRow, change: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("source_fixes")
    .update({ checked_at: new Date().toISOString(), ...change })
    .eq("id", fix.id);
  if (error) throw new Error(`could not save the fix: ${error.message}`);
}

/** Switch sources off (reversible: undo deletes these rows). */
async function disable(ids: string[], company: string, reason: string, fixId: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin()
    .from("source_overrides")
    .upsert(
      ids.map((id) => ({ source_id: id, action: "disable", company, reason, fix_id: fixId })),
      { onConflict: "source_id" },
    );
  if (error) throw new Error(`could not switch the source off: ${error.message}`);
}

/**
 * Add a board that was read and works. It stands in for the company's broken
 * sources - except an extra board from Check URLs, which is added beside them.
 */
export async function applyBoard(
  fix: FixRow,
  board: FoundBoard,
  verdict: "works" | "works-empty",
  reason: string,
  detail: FixDetail = {},
): Promise<void> {
  const alternate = fix.page === "urls" && (detail.role ?? fix.detail.role) === "alternate";
  const replaces = alternate ? [] : await companySourceIds(fix.company, fix.sourceId);
  const seed = COMPANIES.find((c) => c.name === fix.company);
  const id = `fix-${board.adapter}-${slugOf(fix.company)}${alternate ? `-${Date.now().toString(36)}` : ""}`.slice(0, 80);
  const { error } = await supabaseAdmin().from("dynamic_sources").upsert(
    {
      id,
      company: fix.company,
      label: fix.company,
      kind: board.adapter === "browser" || board.adapter === "jsonld" ? "career-page" : "ats",
      adapter: board.adapter,
      handle: board.handle,
      handle2: board.handle2 ?? null,
      region: seed && isGlobalEmployer(seed) ? "global" : "ksa",
      needs_browser: board.needsBrowser,
      enabled: true,
      found_via: `fix (${fix.page}, ${fix.requestedBy})`,
      evidence: reason.slice(0, 400),
      replaces: replaces.filter((r) => r !== id),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`could not add the board: ${error.message}`);
  if (fix.page === "urls") {
    await saveUrlDecision(fix.company, board.url, alternate ? "alternate" : "primary", "accepted").catch(() => {});
  }
  await settle(fix, {
    status: "applied",
    verdict,
    reason,
    options: optionsFor(verdict),
    detail: { ...fix.detail, ...detail, board, addedSource: id, disabled: replaces },
  });
}

/**
 * Read the company through its LinkedIn page: its jobs (by the company's id)
 * and its hiring posts, on the laptop's next LinkedIn pass. A site that
 * cannot be read at all is switched off, so it stops failing every run.
 */
export async function applyLinkedIn(
  fix: FixRow,
  slug: string,
  reason: string,
  opts: { disableOld?: boolean; learned?: string } = {},
): Promise<void> {
  await linkedInCompany(slug, fix.company, "fix");
  const off = opts.disableOld ? await companySourceIds(fix.company, fix.sourceId) : [];
  await disable(off, fix.company, `replaced by its LinkedIn page (${slug})`, fix.id);
  await settle(fix, {
    status: "applied",
    verdict: "linkedin",
    reason,
    options: optionsFor("linkedin"),
    detail: { ...fix.detail, linkedinSlug: slug, disabled: off, ...(opts.learned ? { learned: opts.learned } : {}) },
  });
}

/** Add a company page to the laptop's LinkedIn reading list. */
async function linkedInCompany(slug: string, company: string, via: string): Promise<void> {
  const { error } = await supabaseAdmin().rpc("linkedin_company_seen", { p_slug: slug, p_name: company, p_via: via });
  if (error) throw new Error(`could not add the LinkedIn page: ${error.message}`);
}

/** Leave the fix waiting for the user, with why and what they can choose. */
export async function needsYou(fix: FixRow, verdict: FixVerdict, reason: string, detail: FixDetail = {}): Promise<void> {
  await settle(fix, { status: "needs_you", verdict, reason, options: optionsFor(verdict), detail: { ...fix.detail, ...detail } });
}

/** Close a fix the checker settled by the user's learned habit (keep / delete). */
export async function closeLearned(fix: FixRow, verdict: FixVerdict, decision: "keep" | "delete", reason: string, learned: string): Promise<void> {
  const off = decision === "delete" ? await companySourceIds(fix.company, fix.sourceId) : [];
  await disable(off, fix.company, `switched off (${learned})`, fix.id);
  await settle(fix, {
    status: "done",
    verdict,
    reason,
    decision,
    decided_at: new Date().toISOString(),
    options: ["undo"],
    detail: { ...fix.detail, learned, disabled: off },
  });
}

/**
 * The user's choice on a waiting (or applied) fix. Applied at once, in the
 * database only - nothing here fetches a site, so the website can call it.
 * "replace" queues the new URL; the laptop checks it.
 */
export async function decide(
  fix: FixRow,
  decision: FixDecision,
  input: { url?: string } = {},
): Promise<{ message: string; queued?: FixRow }> {
  const db = supabaseAdmin();
  const close = async (message: string, change: Record<string, unknown> = {}) => {
    const { error } = await db
      .from("source_fixes")
      .update({ status: "done", decision, decided_at: new Date().toISOString(), ...change })
      .eq("id", fix.id);
    if (error) throw new Error(error.message);
    return { message };
  };

  switch (decision) {
    case "keep":
      return close("Kept as it is. Find fixes will not ask about it again.");
    case "delete": {
      const ids = await companySourceIds(fix.company, fix.sourceId);
      await disable(ids, fix.company, "switched off by you", fix.id);
      return close(
        ids.length ? `Stopped reading ${ids.length} source(s) for ${fix.company}. Undo brings them back.` : `Nothing is read for ${fix.company} any more.`,
        { detail: { ...fix.detail, disabled: ids } },
      );
    }
    case "linkedin": {
      const slug = (input.url ? linkedinSlugIn(input.url) : null) ?? fix.detail.linkedinSlug ?? null;
      if (!slug) throw new Error("paste the company's LinkedIn page (linkedin.com/company/...) first");
      const unreadable = ["blocked", "robots", "login", "unreachable", "not-found"].includes(fix.verdict ?? "");
      const off = unreadable ? await companySourceIds(fix.company, fix.sourceId) : [];
      await linkedInCompany(slug, fix.company, "you");
      await disable(off, fix.company, `replaced by its LinkedIn page (${slug})`, fix.id);
      return close(
        `${fix.company} is now read through linkedin.com/company/${slug} - its jobs and hiring posts, from the laptop's next LinkedIn pass.`,
        { detail: { ...fix.detail, linkedinSlug: slug, disabled: off } },
      );
    }
    case "accept": {
      const board = fix.detail.board;
      if (!board) throw new Error("this check found no board to use");
      await applyBoard(fix, board, "works-empty", `Used because you chose to: ${board.url}`);
      await db.from("source_fixes").update({ decision, decided_at: new Date().toISOString() }).eq("id", fix.id);
      return { message: `Using ${board.url} for ${fix.company}.` };
    }
    case "replace": {
      const url = input.url?.trim();
      if (!url || !/^https?:\/\//i.test(url)) throw new Error("paste a full URL starting with https://");
      await close("Checking the new URL.");
      const queued = await queueFix({
        company: fix.company,
        page: fix.page,
        sourceId: fix.sourceId,
        oldUrl: fix.oldUrl,
        newUrl: url,
        requestedBy: "user",
        detail: { role: fix.detail.role },
      });
      return { message: "Queued: the laptop checks it within a few minutes.", queued };
    }
    case "undo": {
      if (fix.detail.addedSource) await db.from("dynamic_sources").update({ enabled: false }).eq("id", fix.detail.addedSource);
      await db.from("source_overrides").delete().eq("fix_id", fix.id);
      return close("Undone: the old sources are read again.");
    }
  }
}

/** Past decisions, newest first, for learnedChoice. */
export async function decisionHistory(): Promise<Array<{ verdict: string | null; decision: string | null }>> {
  const { data } = await supabaseAdmin()
    .from("source_fixes")
    .select("verdict,decision,decided_at")
    .not("decision", "is", null)
    .order("decided_at", { ascending: false })
    .limit(60);
  return (data ?? []).map((r) => ({ verdict: (r.verdict as string) ?? null, decision: (r.decision as string) ?? null }));
}
