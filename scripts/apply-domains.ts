/**
 * Applies domain-probe results, but only where the resolved domain plausibly
 * belongs to the same company.
 *
 * The probe finds *a* live domain, not necessarily the right one: "General
 * Electric" resolved to a staffing agency and "Allianz Saudi Fransi" to global
 * allianz.com, which is a different legal entity with a different job board.
 * Accepting those would quietly point the app at the wrong employer.
 *
 * So a candidate is only taken when its registrable stem overlaps the seeded
 * host or a slug of the company name. Everything else is printed for a human to
 * confirm and is left untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { COMPANIES } from "../src/lib/sources/companies";

const DRY = process.argv.includes("--dry");
const FILE = "src/lib/sources/companies.ts";

interface Found {
  company: string;
  current: string;
  candidate: string;
  status: number;
}

function stemOf(host: string): string {
  return host
    .replace(/^www\./, "")
    .split(".")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function nameKeys(company: string): string[] {
  const base = company.replace(/\([^)]*\)/g, " ").toLowerCase();
  const words = base.replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["the", "and", "group", "holding", "company", "co", "saudi", "arabia", "arabian"]);
  const core = words.filter((w) => !stop.has(w));
  return [core.join(""), words.join(""), core[0] ?? ""].filter(Boolean);
}

/**
 * Do these two hosts refer to the same company?
 *
 * Only a shared registrable stem counts. Stem *containment* is not enough and
 * was actively harmful: it matched "Saudi Payments" to payments.org, "Allianz
 * Saudi Fransi" (a Saudi joint venture with its own board) to global
 * allianz.com, and "Alinma Investment" to Alinma Bank, which is a separate
 * employer already in the registry.
 *
 * A TLD change on an identical stem (rasan.com.sa -> rasan.com) is accepted;
 * anything that needs a different word is left for a human.
 */
function plausible(seedHost: string, candidateHost: string, company: string): boolean {
  const a = stemOf(seedHost);
  const b = stemOf(candidateHost);
  if (!a || !b) return false;
  if (a === b) return true;
  // Allow only a suffix the company name itself justifies, e.g.
  // aljammaztech -> aljammaztechnologies.
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (!longer.startsWith(shorter) || shorter.length < 6) return false;
  return nameKeys(company).some((k) => k.length >= 6 && longer.startsWith(k.slice(0, 6)));
}

function main(): void {
  const { found } = JSON.parse(readFileSync("data/domain-probe.json", "utf8")) as { found: Found[] };
  const byName = new Map(COMPANIES.map((c) => [c.name, c]));

  const accepted: Array<{ company: string; url: string }> = [];
  const rejected: Found[] = [];

  for (const f of found) {
    const seed = byName.get(f.company);
    if (!seed) continue;
    let seedHost: string;
    let candHost: string;
    try {
      seedHost = new URL(seed.careersUrl).hostname;
      candHost = new URL(f.candidate).hostname;
    } catch {
      rejected.push(f);
      continue;
    }
    // A login wall or a deep query string is not a careers landing page.
    if (f.candidate.length > 120 || /login|connect\/authorize/i.test(f.candidate)) {
      rejected.push(f);
      continue;
    }
    if (!plausible(seedHost, candHost, f.company)) {
      rejected.push(f);
      continue;
    }
    accepted.push({ company: f.company, url: `https://${candHost}/careers` });
  }

  const fixes = new Map(accepted.map((a) => [a.company, a.url]));
  const lines = readFileSync(FILE, "utf8").split("\n");
  let applied = 0;

  const out = lines.map((line) => {
    const m = line.match(
      /^(\s*)\{ name: "([^"]+)", careersUrl: "([^"]+)"(, sector: "[^"]+", priority: \d(?:, careersEmail: "[^"]*")?) \},\s*$/,
    );
    if (!m) return line;
    const [, indent, name, , rest] = m;
    const fixed = fixes.get(name);
    if (!fixed) return line;
    applied++;
    return `${indent}{ name: "${name}", careersUrl: "${fixed}"${rest} },`;
  });

  console.log(`domains accepted : ${accepted.length}`);
  for (const a of accepted) console.log(`  ${a.company.slice(0, 34).padEnd(34)} ${a.url}`);

  console.log(`\ndomains rejected as a different company : ${rejected.length}`);
  for (const r of rejected) {
    console.log(`  ${r.company.slice(0, 34).padEnd(34)} ${r.candidate.slice(0, 60)}`);
  }

  if (DRY) {
    console.log(`\n--dry given; ${FILE} left unchanged`);
    return;
  }
  writeFileSync(FILE, out.join("\n"));
  console.log(`\nupdated ${applied} employers in ${FILE}`);
}

main();
