/**
 * Last resort for employers whose domain itself does not resolve.
 *
 * "fetch failed" in the earlier passes is almost always DNS: the domain in the
 * seed was simply wrong. This tries plausible alternatives built from both the
 * seeded hostname and the company name, across the TLDs Saudi companies
 * actually use, and reports which ones answer.
 *
 * Read-only - it prints candidates for you to confirm rather than editing
 * companies.ts, because picking the right domain for an ambiguous name is a
 * judgement call, not something to guess at silently.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { COMPANIES } from "../src/lib/sources/companies";
import { mapLimit, request } from "../src/lib/http";
import type { RescueResult } from "./rescue-links";

const TLDS = [".com", ".com.sa", ".sa", ".net", ".sa.com", ".gov.sa", ".org", ".io", ".co"];

function nameSlugs(company: string): string[] {
  const base = company.replace(/\([^)]*\)/g, " ").toLowerCase();
  const words = base.replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["the", "and", "group", "holding", "company", "co", "saudi", "arabia", "arabian"]);
  const core = words.filter((w) => !stop.has(w));
  const out = new Set<string>();
  if (core.length) {
    out.add(core.join(""));
    out.add(core.join("-"));
    out.add(core[0]);
  }
  out.add(words.join(""));
  return [...out].filter((s) => s.length >= 3 && s.length <= 30);
}

/**
 * Does this site actually belong to the company we were looking for?
 *
 * Guessing a hostname from a company name produces confident nonsense: probing
 * turned up housing.com for the National Housing Strategy Office, sita.com (an
 * air-transport IT firm) for the Saudi Information Technology Academy, and a
 * parked GoDaddy sale page for Yaqeen Capital. Every one of those returned 200
 * and would have been reported as a find.
 *
 * So a candidate has to prove itself: a distinctive word from the company name
 * must actually appear on the page. Generic words are excluded from that test -
 * "saudi", "national" and "company" match half the web and prove nothing.
 */
const GENERIC_NAME_WORD = new Set([
  "saudi", "arabia", "arabian", "national", "company", "co", "group", "holding",
  "holdings", "international", "the", "and", "for", "of", "ksa", "gulf", "arab",
  "middle", "east", "general", "authority", "center", "centre", "services",
  "solutions", "technology", "technologies", "industries", "industrial", "trading",
  "investment", "investments", "capital", "finance", "financial", "bank", "insurance",
  "development", "projects", "contracting", "est", "llc", "ltd", "plc", "inc",
  // Place names and plain nouns that are common enough to match by accident.
  "riyadh", "jeddah", "dammam", "makkah", "mecca", "medina", "khobar", "dhahran",
  "data", "information", "digital", "systems", "steel", "cement", "cables",
  "schools", "school", "university", "hospital", "medical", "health", "energy",
  "power", "water", "food", "motors", "home", "loans", "pipe", "union", "city",
  "careers", "jobs", "office", "agency", "council", "commission", "ministry",
]);

function distinctiveWords(company: string): string[] {
  return company
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !GENERIC_NAME_WORD.has(w));
}

/** Fetch the candidate and look for the company's own name on it. */
async function belongsTo(url: string, company: string): Promise<boolean> {
  const words = distinctiveWords(company);
  // Nothing distinctive to test against - refuse to claim a match rather than
  // accept the domain on the strength of "Saudi" appearing somewhere.
  if (words.length === 0) return false;

  let html: string;
  try {
    const res = await request(url, { timeoutMs: 10_000, retries: 0 });
    html = await res.text();
  } catch {
    return false;
  }

  // A domain parked for sale answers 200 and mentions nothing real.
  if (/godaddy|sedo|domain (is )?for sale|buy this domain|parked/i.test(html.slice(0, 4000))) {
    return false;
  }

  /*
   * Match against where a site NAMES ITSELF, not anywhere in the markup.
   *
   * Searching the whole page found "data" on careers.com and called it NTT
   * DATA, and "riyadh" on riyadh.sa and called it both Riyadh Cables and Riyadh
   * Schools. A company puts its own name in the title, the og:site_name or the
   * first heading; a coincidental word in the body proves nothing.
   */
  const title = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ?? "";
  const ogSite = html.match(/property=["']og:site_name["'][^>]*content=["']([^"']{0,120})/i)?.[1] ?? "";
  const ogTitle = html.match(/property=["']og:title["'][^>]*content=["']([^"']{0,160})/i)?.[1] ?? "";
  const h1 = html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1] ?? "";
  const identity = `${title} ${ogSite} ${ogTitle} ${h1}`
    .replace(/<[^>]+>/g, " ")
    .toLowerCase();

  return words.some((w) => identity.includes(w));
}

async function alive(host: string): Promise<{ url: string; status: number } | null> {
  for (const scheme of ["https://"]) {
    try {
      const res = await request(`${scheme}${host}`, { timeoutMs: 8000, retries: 0 });
      return { url: res.url || `${scheme}${host}`, status: res.status };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = Number(msg.match(/HTTP (\d{3})/)?.[1]);
      // A 401/403/429 still proves the domain exists.
      if ([401, 403, 429].includes(code)) return { url: `${scheme}${host}`, status: code };
    }
  }
  return null;
}

async function main(): Promise<void> {
  const { results } = JSON.parse(readFileSync("data/link-rescue.json", "utf8")) as {
    results: RescueResult[];
  };
  const deadNames = new Set(results.filter((r) => r.outcome === "dead").map((r) => r.company));
  const targets = COMPANIES.filter((c) => deadNames.has(c.name));

  console.log(`Probing domains for ${targets.length} employers with no resolving host...\n`);

  const found: Array<{ company: string; current: string; candidate: string; status: number }> = [];
  let done = 0;

  await mapLimit(targets, 6, async (seed) => {
    let host: string;
    try {
      host = new URL(seed.careersUrl).hostname;
    } catch {
      return;
    }
    const bare = host.replace(/^www\./, "");
    const stem = bare.split(".")[0];

    const candidates = new Set<string>();
    // www toggle on the seeded host
    candidates.add(bare);
    candidates.add(`www.${bare}`);
    // the seeded stem across other TLDs
    for (const tld of TLDS) {
      candidates.add(`${stem}${tld}`);
      candidates.add(`www.${stem}${tld}`);
    }
    // slugs derived from the company name
    for (const slug of nameSlugs(seed.name)) {
      for (const tld of TLDS) candidates.add(`www.${slug}${tld}`);
    }

    for (const candidate of [...candidates].slice(0, 40)) {
      const hit = await alive(candidate);
      if (!hit) continue;
      // Resolving is not the same as being the right company. A candidate has
      // to carry the employer's own name before it is reported as a find.
      if (!(await belongsTo(hit.url, seed.name))) continue;
      found.push({ company: seed.name, current: seed.careersUrl, candidate: hit.url, status: hit.status });
      break;
    }
    done++;
    console.log(`[${String(done).padStart(2)}/${targets.length}] ${seed.name.slice(0, 34).padEnd(34)} ${found.at(-1)?.company === seed.name ? `-> ${found.at(-1)?.candidate}` : "no domain resolves"}`);
  });

  writeFileSync("data/domain-probe.json", JSON.stringify({ probedAt: new Date().toISOString(), found }, null, 2));

  console.log(`\n--- domain probe ---`);
  console.log(`resolved : ${found.length} / ${targets.length}`);
  if (found.length) {
    console.log(`\nlive domains found (confirm these are the right company, then re-run links:check):`);
    for (const f of found) console.log(`  ${f.company.slice(0, 34).padEnd(34)} ${f.candidate}  [${f.status}]`);
  }
  console.log(`\nwrote data/domain-probe.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
