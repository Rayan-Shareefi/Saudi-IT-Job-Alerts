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
import { EXTRACT, STRUCTURE, postTitle } from "../src/lib/adapters/linkedin-posts";

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

/*
 * The hiring-posts extractor in a real browser, on three layouts. The first
 * version knew only the older data-urn markup and found 0 posts on the
 * laptop (2026-10-17). Names and texts below are made up.
 */
async function domTests(): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const run = async (html: string) => {
      await page.setContent(`<html><body><main>${html}</main></body></html>`);
      return (await page.evaluate(EXTRACT)) as Array<{ urn: string; text: string; companyName: string | null; links: string[] }>;
    };
    const body = "We are hiring a SOC Analyst in Riyadh. Apply here: ";

    // 1. The older markup: data-urn on the post, actor block with a company link.
    const older = await run(`
      <div data-urn="urn:li:activity:7200000000000000001">
        <div class="update-components-actor"><a class="update-components-actor__meta-link" href="https://www.linkedin.com/company/acme/">
          <span class="update-components-actor__title"><span aria-hidden="true">Acme Security</span></span></a></div>
        <div class="update-components-text">${body}<a href="https://forms.gle/abc123">form</a></div>
      </div>`);
    check("older layout: one post found", older.length === 1, JSON.stringify(older));
    check("older layout: company author kept", older[0]?.companyName === "Acme Security", String(older[0]?.companyName));
    check("older layout: the apply form link kept", older[0]?.links.includes("https://forms.gle/abc123") === true, JSON.stringify(older[0]?.links));

    // 2. A newer markup: no data-urn, the id only in a link; a list wraps both posts.
    const newer = await run(`
      <ul data-view-name="search-results">
        <li><div role="article">
          <a href="https://www.linkedin.com/company/beta-cloud/">Beta Cloud</a>
          <p>${body}cloud engineers too, join our team in Riyadh!</p>
          <a href="https://www.linkedin.com/feed/update/urn:li:activity:7200000000000000002/">2h</a>
        </div></li>
        <li><div role="article">
          <a href="https://www.linkedin.com/in/some-person/">Some Person</a>
          <p>Proud of my team today. Our new cybersecurity programme starts next month in Riyadh.</p>
          <a href="https://www.linkedin.com/feed/update/urn:li:activity:7200000000000000003/">1d</a>
        </div></li>
      </ul>`);
    check("newer layout: both posts found, the list itself is not a post", newer.length === 2, JSON.stringify(newer.map((p) => p.urn)));
    check("newer layout: ids read from the links", newer.map((p) => p.urn).join(",") === "urn:li:activity:7200000000000000002,urn:li:activity:7200000000000000003");
    check("newer layout: company author kept", newer[0]?.companyName === "Beta Cloud", String(newer[0]?.companyName));
    check("newer layout: a person's name is never kept", newer[1]?.companyName === null, String(newer[1]?.companyName));

    // 3. A page with no posts at all: nothing invented, and the structure report has no text.
    const none = await run(`<div><h2>No results found</h2><p>Try different keywords, like cybersecurity jobs in Riyadh.</p></div>`);
    check("no posts on the page -> nothing found", none.length === 0, JSON.stringify(none));
    const structure = (await page.evaluate(STRUCTURE)) as Record<string, unknown>;
    check("structure report: counts only", structure.noResults === true && !JSON.stringify(structure).includes("Try different"), JSON.stringify(structure));
  } finally {
    await browser.close();
  }
}

domTests()
  .catch((err) => check("browser tests ran", false, err instanceof Error ? err.message : String(err)))
  .then(() => {
    console.log(`linkedin: ${total - failures}/${total} correct`);
    if (failures > 0) process.exit(1);
  });

