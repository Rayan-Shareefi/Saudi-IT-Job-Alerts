/**
 * Counts which skills Riyadh employers are actually asking for.
 *
 * Deliberately computed here rather than in the browser. It needs to read every
 * active posting to be meaningful - "the skills in demand" across 40 jobs on
 * one page is not a market signal - and running 350 vocabulary terms over a
 * thousand postings on each page load would be absurd.
 *
 * It also keeps the CV out of it entirely. This file knows what employers want;
 * the browser subtracts what your CV already has. The gap is computed on your
 * machine, and nothing about you reaches the server.
 *
 * Writes data/skill-demand.json.
 *
 *   npx tsx scripts/skill-demand.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fetchAllRows, isConfigured, supabasePublic } from "../src/lib/db";
import { skillsInText } from "../src/lib/resume";
import { TRACKS, type TrackId } from "../src/lib/types";

export interface SkillDemand {
  skill: string;
  /** How many active postings mention it. */
  count: number;
  /** Share of postings, for the UI to phrase it usefully. */
  share: number;
  /** Which track the skill belongs to, so the gap can be grouped. */
  track: TrackId;
}

async function main(): Promise<void> {
  if (!isConfigured()) {
    console.error("Supabase is not configured.");
    process.exit(1);
  }

  const db = supabasePublic();
  const rows = await fetchAllRows<{ title: string; description_text: string | null; tracks: string[] }>(
    (from, to) =>
      db
        .from("jobs")
        .select("title, description_text, tracks")
        .eq("is_active", true)
        .is("removed_at", null)
        .range(from, to),
    "skill demand",
  );

  console.log(`reading ${rows.length} active postings...`);

  const counts = new Map<string, number>();
  const byTrackCounts = new Map<TrackId, Map<string, number>>();
  for (const t of TRACKS) byTrackCounts.set(t, new Map());

  for (const row of rows) {
    const skills = skillsInText(`${row.title} ${row.description_text ?? ""}`);
    for (const s of skills) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
      for (const t of (row.tracks ?? []) as TrackId[]) {
        const m = byTrackCounts.get(t);
        if (m) m.set(s, (m.get(s) ?? 0) + 1);
      }
    }
  }

  // Which track does a skill belong to? The one whose postings mention it most.
  const trackOf = new Map<string, TrackId>();
  for (const skill of counts.keys()) {
    let best: TrackId = "unknown";
    let bestN = 0;
    for (const t of TRACKS) {
      const n = byTrackCounts.get(t)?.get(skill) ?? 0;
      if (n > bestN) {
        bestN = n;
        best = t;
      }
    }
    trackOf.set(skill, best);
  }

  const demand: SkillDemand[] = [...counts.entries()]
    .map(([skill, count]) => ({
      skill,
      count,
      share: rows.length > 0 ? count / rows.length : 0,
      track: trackOf.get(skill) ?? "unknown",
    }))
    // A skill mentioned once is noise, not demand.
    .filter((d) => d.count >= 3)
    .sort((a, b) => b.count - a.count);

  writeFileSync(
    "data/skill-demand.json",
    JSON.stringify(
      { generatedAt: new Date().toISOString(), postingsRead: rows.length, demand },
      null,
      2,
    ),
  );

  console.log(`\ntop skills employers are asking for:`);
  for (const d of demand.slice(0, 20)) {
    console.log(`  ${String(d.count).padStart(4)}  ${String(Math.round(d.share * 100)).padStart(3)}%  ${d.skill}`);
  }
  console.log(`\nwrote data/skill-demand.json (${demand.length} skills over ${rows.length} postings)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
