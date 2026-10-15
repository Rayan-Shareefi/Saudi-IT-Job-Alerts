/**
 * LinkedIn parsing, against pages captured from the public endpoints on
 * 2026-10-10 and 2026-10-14. Zero network.
 *
 *   npm run test:linkedin
 *
 * LinkedIn changes its markup without notice; when this fails on fresh
 * fixtures, the selectors in src/lib/adapters/linkedin.ts need updating.
 */
import { readFileSync } from "node:fs";
import { parseDetail, parseSearch } from "../src/lib/adapters/linkedin";
import { postTitle } from "../src/lib/adapters/linkedin-posts";

let total = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  total++;
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

const search = parseSearch(readFileSync("scripts/fixtures/linkedin-search.html", "utf8"));
check("search page yields cards", search.length >= 5, `(${search.length})`);
check("every card has a numeric id", search.every((c) => /^\d{6,}$/.test(c.id)));
check("every card has a title", search.every((c) => c.title.length > 3));
check("every card has a company", search.every((c) => c.company.length > 0 && c.company !== "Unknown"));
check("cards carry a Riyadh location", search.some((c) => /riyadh/i.test(c.location)));
check("cards carry a posting date", search.every((c) => c.postedAt !== null));

const detail = parseDetail(readFileSync("scripts/fixtures/linkedin-job.html", "utf8"));
check("detail page parses", detail !== null);
check("full description, not a snippet", (detail?.description.length ?? 0) > 1500, `(${detail?.description.length})`);
check("criteria read", detail?.criteria["Employment type"] === "Full-time", JSON.stringify(detail?.criteria));
check("open posting is not marked closed", detail?.closed === false);
check("a page without a description is refused, not read as empty", parseDetail("<html><body>Sign in to see this job</body></html>") === null);

// Hiring posts: the title is the line that names a role; a post naming none is not a vacancy.
check(
  "post title is the sentence that names a role",
  postTitle("🚀 We're hiring!\nJoin our team as a SOC Analyst in Riyadh. Apply via the form below.") === "Join our team as a SOC Analyst in Riyadh.",
  JSON.stringify(postTitle("🚀 We're hiring!\nJoin our team as a SOC Analyst in Riyadh.")),
);
check("a post that names no role gets no title", postTitle("Great day at the conference! #cybersecurity #Riyadh") === null);
check("Arabic role line", postTitle("نعلن عن فرصة تدريب تعاوني\nمطلوب متدرب في الأمن السيبراني") !== null);

console.log(`linkedin: ${total - failures}/${total} correct`);
if (failures > 0) process.exit(1);
