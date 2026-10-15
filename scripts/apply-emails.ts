/**
 * Writes harvested application addresses into companies.ts.
 *
 * The first address becomes `careersEmail` when the employer has none;
 * everything else goes into `careersEmails` with the purpose the mailbox name
 * implies, so a co-op inbox is labelled as one in the UI.
 *
 *   npx tsx scripts/apply-emails.ts --dry
 *   npx tsx scripts/apply-emails.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isApplicationAddress } from "../src/lib/sources/companies";
import type { EmailFinding } from "./harvest-emails";

const DRY = process.argv.includes("--dry");
const FILE = "src/lib/sources/companies.ts";

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function main(): void {
  if (!existsSync("data/email-harvest.json")) {
    console.error("data/email-harvest.json not found - run npm run emails:harvest first.");
    process.exit(1);
  }
  const { findings } = JSON.parse(readFileSync("data/email-harvest.json", "utf8")) as {
    findings: EmailFinding[];
  };

  const byCompany = new Map(
    findings.filter((f) => f.status === "new-addresses").map((f) => [f.company, f]),
  );
  if (byCompany.size === 0) {
    console.log("no new addresses to apply");
    return;
  }

  const lines = readFileSync(FILE, "utf8").split("\n");
  let changed = 0;

  const out = lines.map((line) => {
    // Matches a seed entry and captures everything after the priority, so an
    // existing careersEmail / altUrls tail is preserved rather than clobbered.
    const m = line.match(
      /^(\s*)\{ name: "([^"]+)", careersUrl: "([^"]+)", sector: "([^"]+)", priority: (\d)(.*?) \},\s*$/,
    );
    if (!m) return line;

    const [, indent, name, url, sector, priority, tail] = m;
    const finding = byCompany.get(name);
    if (!finding) return line;
    // Re-checked here as well as at harvest time: a harvest file written before
    // the fraud-inbox rule existed would otherwise write recruiting-scams@ into
    // the company list as an apply-here address.
    const usable = finding.discovered.filter((d) => isApplicationAddress(d.address));
    if (usable.length === 0) return line;

    // Already carries a careersEmails list - leave it alone rather than trying
    // to merge into a structure this line-based rewrite cannot parse safely.
    if (/careersEmails:/.test(tail)) {
      console.log(`  skip  ${name} (already has a careersEmails list)`);
      return line;
    }

    const hasPrimary = /careersEmail:/.test(tail);
    const extras = [...usable];

    let newTail = tail;
    if (!hasPrimary) {
      // Prefer a general applications inbox as the primary; a co-op address is
      // an addition, not the main route in.
      const idx = extras.findIndex((e) => !/co-?op|train|intern|student|graduate/i.test(e.address));
      const primary = extras.splice(idx >= 0 ? idx : 0, 1)[0];
      newTail = `${newTail}, careersEmail: "${esc(primary.address)}"`;
    }

    if (extras.length > 0) {
      const rendered = extras
        .map((e) =>
          e.purpose
            ? `{ address: "${esc(e.address)}", purpose: "${esc(e.purpose)}" }`
            : `{ address: "${esc(e.address)}" }`,
        )
        .join(", ");
      newTail = `${newTail}, careersEmails: [${rendered}]`;
    }

    if (newTail === tail) return line;
    changed++;
    console.log(`  ${name.slice(0, 34).padEnd(34)} ${usable.map((d) => d.address).join(", ").slice(0, 56)}`);
    return `${indent}{ name: "${name}", careersUrl: "${url}", sector: "${sector}", priority: ${priority}${newTail} },`;
  });

  console.log(`\n${changed} employer(s) updated`);
  if (DRY) {
    console.log("--dry given; nothing written");
    return;
  }
  if (changed > 0) {
    writeFileSync(FILE, out.join("\n"));
    console.log(`wrote ${FILE}`);
  }
}

main();
