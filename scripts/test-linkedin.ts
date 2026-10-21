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
import { byUsefulness, parseDetail, parseSearch } from "../src/lib/adapters/linkedin";
import { EXTRACT, STRUCTURE, postTitle } from "../src/lib/adapters/linkedin-posts";
import { parseCompanyPage } from "../src/lib/adapters/linkedin-companies";

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
check("a results page is 10 cards - the paging step (it was 25, skipping 15 a page)", search.length === 10, `(${search.length})`);
check("cards name their company page", search.some((c) => !!c.companySlug), JSON.stringify(search.map((c) => c.companySlug)));

// A pass opens at most 25 postings: programmes and juniors first, seniors last.
{
  const card = (title: string, postedAt: string) => ({ id: title, title, company: "X", location: "Riyadh", postedAt });
  const order = byUsefulness([
    card("Senior SOC Analyst", "2026-10-21"),
    card("SOC Analyst", "2026-10-19"),
    card("Cybersecurity Co-op Trainee", "2026-10-01"),
    card("Cloud Engineer", "2026-10-20"),
    card("Lead Cloud Architect", "2026-10-21"),
  ]).map((c) => c.title);
  check("opening order: programme, then newest non-senior, then senior", order.join(" | ") === "Cybersecurity Co-op Trainee | Cloud Engineer | SOC Analyst | Senior SOC Analyst | Lead Cloud Architect", order.join(" | "));
}

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

// The company behind each card, so its page joins the list to read (2026-10-21).
check("a card names its company's page", search.some((c) => c.companySlug === "deloitte"), JSON.stringify(search.slice(0, 2).map((c) => c.companySlug)));

/*
 * A public company page (no login), trimmed from linkedin.com/company/elm
 * (2026-10-21): posts as schema.org records, the post card with its picture,
 * and the company's id. Texts are made up.
 */
{
  const PAGE = `<html><head>
<script type="application/ld+json">{"@context":"http://schema.org","@graph":[
 {"@type":"SocialMediaPosting","author":{"@type":"Organization","name":"Elm Company"},"datePublished":"2026-10-20T09:00:00.000Z","text":"We are hiring! Elm opens its co-op training program for students in cybersecurity and computer science in Riyadh. Apply now.","url":"https://www.linkedin.com/posts/elm_hiring-activity-7518576421343076352-AbCd"},
 {"@type":"SocialMediaPosting","author":{"@type":"Organization","name":"Elm Company"},"datePublished":"2026-10-18T09:00:00.000Z","text":"Visit our booth at the exhibition.","url":"https://www.linkedin.com/posts/elm_expo-activity-7518000000000000001-EfGh"},
 {"@type":"Organization","name":"Elm Company","url":"https://sa.linkedin.com/company/elm","sameAs":"https://www.elm.sa/"}]}</script>
</head><body>
<article class="main-feed-activity-card" data-activity-urn="urn:li:activity:7518576421343076352">
  <img data-delayed-url="https://media.licdn.com/dms/image/v2/X/company-logo_100_100/elm_logo">
  <p>We are hiring!</p>
  <img data-delayed-url="https://media.licdn.com/dms/image/v2/Y/feedshare-shrink_800/coop.jpg">
</article>
<a href="https://www.linkedin.com/jobs/elm-company-jobs-worldwide?f_C=42185&amp;trk=x">Jobs</a>
<code>urn:li:organization:42185</code>
</body></html>`;
  const page = parseCompanyPage(PAGE);
  check("company page: its name", page.name === "Elm Company", String(page.name));
  check("company page: its id, for its job listings", page.orgId === "42185", String(page.orgId));
  check("company page: its own website", page.website === "https://www.elm.sa/", String(page.website));
  check("company page: both posts read", page.posts.length === 2, JSON.stringify(page.posts.map((p) => p.id)));
  check("company page: post id from its link", page.posts[0]?.id === "7518576421343076352", String(page.posts[0]?.id));
  check("company page: the post's time", page.posts[0]?.at === "2026-10-20T09:00:00.000Z", String(page.posts[0]?.at));
  check("company page: the post's picture, not the logo", JSON.stringify(page.posts[0]?.images) === JSON.stringify(["https://media.licdn.com/dms/image/v2/Y/feedshare-shrink_800/coop.jpg"]), JSON.stringify(page.posts[0]?.images));
  check("company page: a post without a picture has none", page.posts[1]?.images.length === 0, JSON.stringify(page.posts[1]?.images));
  check("company page: nothing on a page without records", parseCompanyPage("<html><body>Sign in</body></html>").posts.length === 0);
}

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
          <img width="400" height="400" src="https://media.licdn.com/dms/image/acme-logo.jpg">
          <span class="update-components-actor__title"><span aria-hidden="true">Acme Security</span></span></a></div>
        <div class="update-components-text">${body}<a href="https://forms.gle/abc123">form</a></div>
        <img width="800" height="600" src="https://media.licdn.com/dms/image/coop-announcement.jpg">
        <img width="40" height="40" src="https://media.licdn.com/dms/image/reaction-icon.png">
      </div>`);
    check("older layout: one post found", older.length === 1, JSON.stringify(older));
    check("older layout: company author kept", older[0]?.companyName === "Acme Security", String(older[0]?.companyName));
    check("older layout: the apply form link kept", older[0]?.links.includes("https://forms.gle/abc123") === true, JSON.stringify(older[0]?.links));
    // For OCR: the post's picture, never the author's photo or a tiny icon.
    const images = (older[0] as unknown as { images?: string[] })?.images ?? [];
    check("the post's picture is picked for reading", images.length === 1 && images[0].endsWith("coop-announcement.jpg"), JSON.stringify(images));

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

