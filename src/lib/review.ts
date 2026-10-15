import { applyKindOf, formLinkIn } from "./apply-link";
import { companyKey, shortHash } from "./company-key";
import { fetchAllRows, supabaseAdmin } from "./db";
import { bandFor, detectExperience } from "./experience";
import { judgePosting, namesARole } from "./plausible";
import { judgeScope, textQualityOf } from "./scope";
import { decideState, type StateDecision } from "./state";
import { normalize } from "./text";
import { loadJudgements, votesFor, type JudgeRow } from "./judge/run";

/**
 * Recompute where every stored posting belongs, and write what changed.
 *
 * Nothing here deletes. A posting moves between show / unclassified /
 * needs_review / hidden, and every move is recomputable: fix a rule, run this
 * again, and the postings it wrongly hid come back. That is what makes a rule
 * change safe to try on live data (HANDOVER §6).
 *
 * Inputs per row: the deterministic rules (plausible, scope, experience) run
 * fresh on the stored text, the cached model answers re-verified against that
 * text (judge/run.ts), and the user's own Keep/Hide.
 */

export interface StoredRow extends JudgeRow {
  url: string;
  city: string;
  posted_at: string | null;
  first_seen_at: string;
  last_refreshed_at: string | null;
  closes_at: string | null;
  human_override: "show" | "hide" | null;
  review_state: string;
  hidden_reason: string | null;
  decision_note: string | null;
  experience_band: string;
  apply_url: string | null;
  duplicate_of: string | null;
}

const COLUMNS =
  "id,title,company,url,location_text,department,description_text,text_hash,text_quality,source_kind," +
  "city,posted_at,first_seen_at,last_refreshed_at,closes_at,human_override,review_state,hidden_reason," +
  "decision_note,experience_band,apply_url,duplicate_of";

export async function loadActiveRows(filter?: { ids?: string[] }): Promise<StoredRow[]> {
  const db = supabaseAdmin();
  if (filter?.ids) {
    const out: StoredRow[] = [];
    for (let i = 0; i < filter.ids.length; i += 200) {
      const { data, error } = await db.from("jobs").select(COLUMNS).in("id", filter.ids.slice(i, i + 200));
      if (error) throw new Error(`load rows failed: ${error.message}`);
      out.push(...((data ?? []) as unknown as StoredRow[]));
    }
    return out;
  }
  return fetchAllRows<StoredRow>(
    (from, to) =>
      db
        .from("jobs")
        .select(COLUMNS)
        .eq("is_active", true)
        .is("removed_at", null)
        .range(from, to) as unknown as PromiseLike<{ data: StoredRow[] | null; error: { message: string } | null }>,
    "jobs",
  );
}

export interface Recomputed {
  row: StoredRow;
  decision: StateDecision;
  update: Record<string, unknown>;
  changed: boolean;
}

/** Decide one row; pure apart from its inputs. */
export function recompute(row: StoredRow, votes: ReturnType<typeof votesFor>, now = new Date()): Recomputed {
  const text = row.description_text ?? "";
  const quality = textQualityOf(text, row.source_kind);
  const plausibility = judgePosting(row.title, text, row.url);
  const scope = judgeScope(row.title, row.source_kind === "jsearch" ? null : row.department, text, quality);
  const experience = detectExperience(row.title, text);
  const weakNotJob = !namesARole(row.title) || quality === "none" || text.trim().length < 150;

  const decision = decideState({
    title: row.title,
    city: row.city,
    postedAt: row.posted_at,
    firstSeenAt: row.first_seen_at,
    lastRefreshedAt: row.last_refreshed_at,
    closesAt: row.closes_at,
    textQuality: quality,
    plausibility,
    weakNotJob,
    scope,
    experience,
    votes,
    humanOverride: row.human_override,
    now,
  });

  // Experience as the rules read it, unless a model found a verified number
  // the patterns missed.
  const exp = decision.juryYears
    ? { band: bandFor(decision.juryYears.min), min: decision.juryYears.min, max: null, source: "stated", evidence: decision.juryYears.evidence }
    : { band: experience.band, min: experience.minYears, max: experience.maxYears, source: experience.source, evidence: experience.evidence };

  const note = decision.juryLocation ? `${decision.note} · location quoted: "${decision.juryLocation.slice(0, 80)}"` : decision.note;
  const update = {
    id: row.id,
    review_state: decision.state,
    hidden_reason: decision.hiddenReason,
    decided_by: decision.decidedBy,
    decision_note: note.slice(0, 400),
    scope: decision.scope,
    focus: decision.focus,
    scope_evidence: decision.scopeEvidence.map((e) => e.slice(0, 300)),
    experience_band: exp.band,
    min_years: exp.min,
    max_years: exp.max,
    experience_source: exp.source,
    experience_evidence: exp.evidence?.slice(0, 400) ?? null,
    company_key: companyKey(row.company),
    text_quality: quality,
    text_hash: shortHash(normalize(text)),
    apply_kind: applyKindOf(row.apply_url ?? row.url, row.source_kind, text),
    apply_url: row.apply_url ?? formLinkIn(text),
    city: decision.juryLocation ? "riyadh" : row.city,
  };
  const changed =
    row.review_state !== decision.state ||
    (row.hidden_reason ?? null) !== decision.hiddenReason ||
    (row.decision_note ?? "") !== update.decision_note ||
    row.experience_band !== exp.band ||
    (row.text_hash ?? "") !== update.text_hash ||
    (row.text_quality ?? "") !== quality;
  return { row, decision, update, changed };
}

/** Recompute and (unless dry) write. Returns every row's outcome. */
export async function recomputeStates(opts: { dry?: boolean; ids?: string[]; log?: (s: string) => void } = {}): Promise<Recomputed[]> {
  const log = opts.log ?? (() => {});
  const rows = await loadActiveRows(opts.ids ? { ids: opts.ids } : undefined);
  log(`loaded ${rows.length} active posting(s)`);
  // Judgements are keyed by the hash of the text as it is now.
  for (const r of rows) r.text_hash = shortHash(normalize(r.description_text ?? ""));
  const judgements = await loadJudgements(rows.map((r) => r.text_hash ?? ""));
  const now = new Date();
  const results = rows.map((r) => recompute(r, votesFor(r, judgements.get(r.text_hash ?? "") ?? []), now));

  if (!opts.dry) {
    const db = supabaseAdmin();
    const updates = results.filter((x) => x.changed).map((x) => x.update);
    for (let i = 0; i < updates.length; i += 300) {
      const { error } = await db.rpc("apply_job_states", { p_rows: updates.slice(i, i + 300) });
      if (error) throw new Error(`apply_job_states failed: ${error.message}`);
    }
    log(`wrote ${updates.length} state(s)`);
  }
  return results;
}
