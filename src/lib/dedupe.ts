import { platformOf } from "./platform";
import { companyKey, titleKey, titleSimilarity } from "./company-key";
import { fetchAllRows, supabaseAdmin } from "./db";
import { normalize } from "./text";
import type { AlsoOn } from "./types";

/**
 * One card per vacancy.
 *
 * The same role reaches the board from the company ATS, LinkedIn, JSearch,
 * Careerjet and Jooble. The user wants one card, with "Also on ..." badges,
 * and was explicit about the failure that matters: never merge two different
 * jobs. So merging needs agreement, and every guard below blocks a merge
 * rather than allowing one:
 *
 *   same employer (companyKey)  AND
 *   ( same role exactly (titleKey) | near-same role + the postings' own text
 *     overlaps | the same apply link / LinkedIn id )
 *
 *   never across: the same source (two real requisitions), different levels
 *   (Senior vs plain, I vs II), different stated cities, stated years 2+ apart,
 *   two full texts that barely overlap, or a one-to-many match.
 *
 * Merging is reversible: copies get `duplicate_of`, nothing is deleted, and
 * this is recomputed from scratch on every run.
 */

export interface DedupRow {
  id: string;
  source_id: string;
  source_kind: string;
  source_label: string;
  publisher: string | null;
  company: string;
  title: string;
  city: string;
  url: string;
  apply_url: string | null;
  description_text: string | null;
  text_quality: string | null;
  min_years: number | null;
  experience_source: string | null;
  /** "internship" / "coop" when the posting states a programme, title or not. */
  experience_band?: string | null;
  posted_at: string | null;
  first_seen_at: string;
  last_refreshed_at: string | null;
  duplicate_of: string | null;
  also_on: AlsoOn[] | null;
}

/** Lower is preferred as the card everyone sees. */
const SOURCE_RANK: Record<string, number> = {
  ats: 0,
  "career-page": 1,
  linkedin: 2,
  jsearch: 3,
  indeed: 3,
  jooble: 4,
  careerjet: 5,
  "linkedin-post": 6,
  // Workable search: the employer's own posting, in full, via Workable's board.
  aggregator: 2,
};
const QUALITY_RANK: Record<string, number> = { full: 0, partial: 1, snippet: 2, none: 3 };

const LEVEL_WORDS = [
  "senior", "junior", "lead", "principal", "staff", "manager", "head", "director",
  "chief", "intern", "internship", "coop", "trainee", "graduate", "associate", "1", "2", "3", "4",
];

/** Programme words that mean the same level. */
const SAME_LEVEL: Record<string, string> = { internship: "intern", trainee: "intern" };

/*
 * The level of a posting: from its title, plus a programme the posting itself
 * states. Sabbar lists COGNNA's "Security Engineer - Intern" (Workable) as
 * "Security Engineer", with the internship only in the text, and the two
 * were shown as separate jobs (2026-10-20).
 */
function levelOf(key: string, band?: string | null): string {
  const words = new Set(key.split(" "));
  const levels = new Set(LEVEL_WORDS.filter((w) => words.has(w)).map((w) => SAME_LEVEL[w] ?? w));
  if (band === "internship" && !levels.has("intern") && !levels.has("coop")) levels.add("intern");
  if (band === "coop" && !levels.has("coop")) levels.add("coop");
  return [...levels].sort().join(",");
}

/** The title without its level words: "security engineer intern" -> "security engineer". */
function bareTitle(key: string): string {
  return key.split(" ").filter((w) => w && !LEVEL_WORDS.includes(w)).join(" ");
}

/** 3-word shingles of the first 3,000 characters, for text overlap. */
function shingles(text: string): Set<string> {
  const words = normalize(text.slice(0, 3000)).replace(/[^a-z0-9؀-ۿ]+/g, " ").split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** A LinkedIn job id, or an apply link without tracking parameters. */
function canonicalApply(row: DedupRow): string | null {
  for (const raw of [row.apply_url, row.url]) {
    if (!raw) continue;
    const li = raw.match(/linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/i);
    if (li) return `li:${li[1]}`;
    try {
      const u = new URL(raw);
      // Trackers mint a new URL per click; they identify nothing.
      if (/jobviewtrack|jooble|careerjet|google\.com/i.test(u.hostname)) continue;
      for (const p of [...u.searchParams.keys()]) if (/^(utm_|ref|src|source|trk|gh_src)/i.test(p)) u.searchParams.delete(p);
      return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
    } catch {
      continue;
    }
  }
  return null;
}

export type PairVerdict = { same: true; how: "exact" | "text" | "link" | "level" } | { same: false; why: string };

interface Prepared {
  row: DedupRow;
  key: string;
  level: string;
  bare: string;
  text: Set<string>;
  full: boolean;
  link: string | null;
}

function prepare(row: DedupRow): Prepared {
  const key = titleKey(row.title);
  return {
    row,
    key,
    level: levelOf(key, row.experience_band),
    bare: bareTitle(key),
    text: shingles(row.description_text ?? ""),
    full: row.text_quality === "full" || row.text_quality === "partial",
    link: canonicalApply(row),
  };
}

/** Are these two rows the same vacancy? Pure; the heart of the file. */
export function samePosting(a: Prepared, b: Prepared): PairVerdict {
  if (a.row.source_id === b.row.source_id) return { same: false, why: "same source: two separate requisitions" };
  if (a.level !== b.level) return { same: false, why: `different level (${a.level || "none"} vs ${b.level || "none"})` };
  const known = (c: string) => c && c !== "unknown";
  if (known(a.row.city) && known(b.row.city) && a.row.city !== b.row.city) return { same: false, why: "different cities" };
  const ya = a.row.experience_source === "stated" ? a.row.min_years : null;
  const yb = b.row.experience_source === "stated" ? b.row.min_years : null;
  if (ya !== null && yb !== null && Math.abs(ya - yb) >= 2) return { same: false, why: "stated years differ" };

  const overlap = a.full && b.full ? jaccard(a.text, b.text) : null;
  // Two complete postings that barely share a sentence are two jobs, however
  // alike their titles.
  if (overlap !== null && overlap < 0.2) return { same: false, why: `full texts differ (${overlap.toFixed(2)})` };

  const sim = titleSimilarity(a.key, b.key);
  // A shared link alone is not enough: Foodics lists six different vacancies
  // on one Workable address (HANDOVER §6), so the titles must agree as well.
  if (a.link && b.link && a.link === b.link && sim >= 0.5) return { same: true, how: "link" };
  if (a.key === b.key && a.key.length > 0) return { same: true, how: "exact" };
  // The same title once the level words are set aside, at the same level
  // (checked above): one platform kept "- Intern", the other only said so in the text.
  if (a.bare === b.bare && a.bare.split(" ").length >= 2) return { same: true, how: "level" };
  if (sim >= 0.75 && overlap !== null && overlap >= 0.4) return { same: true, how: "text" };
  return { same: false, why: `titles ${sim.toFixed(2)} alike, text overlap ${overlap === null ? "unknown" : overlap.toFixed(2)}` };
}

function better(a: DedupRow, b: DedupRow): DedupRow {
  /*
   * The card everyone sees must be one that can be read: its text is what the
   * rules and the jury judge. A LinkedIn listing LinkedIn would not let us
   * open outranked the same job's full text from JSearch, and the vacancy
   * sat in Unclassified (2026-10-20).
   */
  const readable = (r: DedupRow) => r.text_quality === "full" || r.text_quality === "partial";
  if (readable(a) !== readable(b)) return readable(a) ? a : b;
  const ra = SOURCE_RANK[a.source_kind] ?? 9;
  const rb = SOURCE_RANK[b.source_kind] ?? 9;
  if (ra !== rb) return ra < rb ? a : b;
  const qa = QUALITY_RANK[a.text_quality ?? "none"] ?? 3;
  const qb = QUALITY_RANK[b.text_quality ?? "none"] ?? 3;
  if (qa !== qb) return qa < qb ? a : b;
  return a.first_seen_at <= b.first_seen_at ? a : b;
}

function labelFor(row: DedupRow): string {
  return platformOf(row.source_kind, row.source_label, row.publisher);
}

export interface Group {
  primary: DedupRow;
  copies: DedupRow[];
  how: string[];
}

/** Group rows into vacancies. Exported for the tests. */
export function groupDuplicates(rows: DedupRow[]): Group[] {
  const byCompany = new Map<string, Prepared[]>();
  for (const r of rows) {
    const k = companyKey(r.company);
    if (!k || k === "unknown") continue;
    byCompany.set(k, [...(byCompany.get(k) ?? []), prepare(r)]);
  }

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) && parent.get(x) !== x) x = parent.get(x) as string;
    return x;
  };
  const how = new Map<string, string[]>();

  for (const list of byCompany.values()) {
    if (list.length < 2) continue;
    // Every row each row matches, per other source.
    const matches: Array<Map<string, Array<{ j: number; how: string }>>> = list.map(() => new Map());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const v = samePosting(list[i], list[j]);
        if (!v.same) continue;
        const si = list[i].row.source_id;
        const sj = list[j].row.source_id;
        matches[i].set(sj, [...(matches[i].get(sj) ?? []), { j, how: v.how }]);
        matches[j].set(si, [...(matches[j].get(si) ?? []), { j: i, how: v.how }]);
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (const found of matches[i].values()) {
        // One-to-many, in either direction: this row looks like two different
        // rows on one source, or the other row looks like two of ours. That
        // source has two real requisitions; merging with either would be a
        // guess, so neither happens.
        if (found.length !== 1) continue;
        const { j, how: h } = found[0];
        if ((matches[j].get(list[i].row.source_id) ?? []).length !== 1) continue;
        const a = list[i].row.id;
        const b = list[j].row.id;
        parent.set(a, find(a));
        parent.set(b, find(b));
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
        how.set(ra, [...(how.get(ra) ?? []), h]);
      }
    }
  }

  /*
   * Across employer names: the exact same apply link with a near-identical
   * title is one vacancy, whatever name each source filed it under (an
   * acquired brand, a recruiter posting for a client). Both signals are
   * required; the per-pair guards (level, city, years, text) still apply.
   */
  const byLink = new Map<string, Prepared[]>();
  for (const list of byCompany.values()) {
    for (const p of list) if (p.link) byLink.set(p.link, [...(byLink.get(p.link) ?? []), p]);
  }
  for (const group of byLink.values()) {
    const companies = new Set(group.map((g) => companyKey(g.row.company)));
    if (group.length < 2 || companies.size < 2 || group.length > 4) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (companyKey(a.row.company) === companyKey(b.row.company)) continue;
        const v = samePosting(a, b);
        if (!v.same || titleSimilarity(a.key, b.key) < 0.75) continue;
        parent.set(a.row.id, find(a.row.id));
        parent.set(b.row.id, find(b.row.id));
        const ra = find(a.row.id);
        const rb = find(b.row.id);
        if (ra !== rb) parent.set(rb, ra);
        how.set(ra, [...(how.get(ra) ?? []), "link-across-names"]);
      }
    }
  }

  const clusters = new Map<string, DedupRow[]>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of parent.keys()) {
    const root = find(id);
    const row = byId.get(id);
    if (row) clusters.set(root, [...(clusters.get(root) ?? []), row]);
  }

  const groups: Group[] = [];
  for (const [root, members] of clusters) {
    // A group may hold one row per source; two from the same source mean the
    // chain linked separate requisitions through a third copy. Keep it apart.
    const sources = new Set(members.map((m) => m.source_id));
    if (members.length < 2 || sources.size !== members.length) continue;
    const primary = members.reduce(better);
    groups.push({ primary, copies: members.filter((m) => m.id !== primary.id), how: how.get(root) ?? [] });
  }
  return groups;
}

/** Recompute every duplicate group and write the result. */
export async function rebuildDuplicates(opts: { dry?: boolean; log?: (s: string) => void } = {}): Promise<Group[]> {
  const log = opts.log ?? (() => {});
  const db = supabaseAdmin();
  const rows = await fetchAllRows<DedupRow>(
    (from, to) =>
      db
        .from("jobs")
        .select(
          "id,source_id,source_kind,source_label,publisher,company,title,city,url,apply_url,description_text,text_quality,min_years,experience_source,experience_band,posted_at,first_seen_at,last_refreshed_at,duplicate_of,also_on",
        )
        .eq("is_active", true)
        .is("removed_at", null)
        .range(from, to) as unknown as PromiseLike<{ data: DedupRow[] | null; error: { message: string } | null }>,
    "jobs",
  );
  const groups = groupDuplicates(rows);
  log(`${rows.length} active posting(s), ${groups.length} vacancy group(s) seen on more than one source`);

  const updates = new Map<string, { id: string; duplicate_of: string | null; also_on: AlsoOn[]; last_refreshed_at: string | null }>();
  for (const r of rows) updates.set(r.id, { id: r.id, duplicate_of: null, also_on: [], last_refreshed_at: null });
  for (const g of groups) {
    // A newer posting date on any copy is a repost: the vacancy is fresh again.
    const newest = [g.primary, ...g.copies]
      .map((r) => r.posted_at)
      .filter((d): d is string => Boolean(d) && new Date(d as string).getTime() <= Date.now() + 3_600_000)
      .sort()
      .pop() ?? null;
    updates.set(g.primary.id, {
      id: g.primary.id,
      duplicate_of: null,
      also_on: g.copies.map((c) => ({ kind: c.source_kind, label: labelFor(c), url: c.apply_url ?? c.url })),
      last_refreshed_at: newest && (!g.primary.posted_at || newest > g.primary.posted_at) ? newest : null,
    });
    for (const c of g.copies) updates.set(c.id, { id: c.id, duplicate_of: g.primary.id, also_on: [], last_refreshed_at: null });
  }

  // Only rows whose duplicate state actually changes. Compared canonically:
  // jsonb reorders object keys and Postgres reformats timestamps, so a naive
  // comparison rewrote every group on every run.
  const canon = (list: AlsoOn[] | null | undefined) =>
    JSON.stringify((list ?? []).map((a) => [a.kind, a.label, a.url]).sort());
  const sameTime = (a: string | null, b: string | null) =>
    (a === null && b === null) || (a !== null && b !== null && new Date(a).getTime() === new Date(b).getTime());
  const byId = new Map(rows.map((r) => [r.id, r]));
  const changed = [...updates.values()].filter((u) => {
    const r = byId.get(u.id);
    if (!r) return false;
    return (
      (r.duplicate_of ?? null) !== u.duplicate_of ||
      canon(r.also_on) !== canon(u.also_on) ||
      (u.last_refreshed_at !== null && !sameTime(u.last_refreshed_at, r.last_refreshed_at))
    );
  });
  if (!opts.dry) {
    for (let i = 0; i < changed.length; i += 300) {
      const { error } = await db.rpc("apply_duplicates", { p_rows: changed.slice(i, i + 300) });
      if (error) throw new Error(`apply_duplicates failed: ${error.message}`);
    }
    log(`wrote ${changed.length} duplicate change(s)`);
  }
  return groups;
}
