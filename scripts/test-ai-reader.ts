/**
 * The AI page reader's grounding (src/lib/ai-reader.ts). Offline: the model's
 * answers are written here, true and invented.
 *
 *   npm run test:ai-reader
 */
import { groundedJobs, listLinkIn } from "../src/lib/ai-reader";
import type { SourceDefinition } from "../src/lib/types";

let total = 0;
let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`FAIL  ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  }
}

const source: SourceDefinition = { id: "browser-test", label: "Test Co", company: "Test Co", kind: "career-page", adapter: "browser", handle: "https://careers.test.sa/" };
const page = {
  pageUrl: "https://careers.test.sa/",
  text: "Join Test Co\nExperienced Professionals\nFresh Graduates\nOpen positions\nSOC Analyst - Riyadh\nCloud Security Engineer\nApply now",
  links: [
    { text: "SOC Analyst - Riyadh", href: "https://careers.test.sa/jobs/101" },
    { text: "Cloud Security Engineer", href: "https://careers.test.sa/jobs/102" },
  ],
};

const got = groundedJobs(
  [
    { title: "SOC Analyst", location: "Riyadh", url: "https://careers.test.sa/jobs/101" },
    { title: "Cloud Security Engineer", url: "/jobs/102" },
    { title: "Senior Penetration Tester", url: "https://careers.test.sa/jobs/999" },
    { title: "Experienced Professionals" },
    { title: "Fresh Graduates" },
    { title: "SOC Analyst", url: "https://evil.example/phish" },
  ],
  page,
  source,
);
check("titles on the page are kept, others are not", got.map((j) => j.title), ["SOC Analyst", "Cloud Security Engineer"]);
check("a link from the page is used; a relative one is resolved against the page", got.map((j) => j.url), ["https://careers.test.sa/jobs/101", "https://careers.test.sa/jobs/102"]);
check("a location found on the page is kept", got[0]?.locationText, "Riyadh");
check("an invented title is refused (never a posting the page does not show)", got.some((j) => /penetration/i.test(j.title)), false);
check("entry tiles are not vacancies", got.some((j) => /graduates|professionals/i.test(j.title)), false);

const offPage = groundedJobs([{ title: "Cloud Security Engineer", url: "https://elsewhere.example/apply" }], page, source);
check("a link not on the page falls back to the page itself", offPage[0]?.url, "https://careers.test.sa/");

const script = groundedJobs([{ title: "Cloud Security Engineer", url: "javascript:alert(1)" }], { ...page, links: [...page.links, { text: "x", href: "javascript:alert(1)" }] }, source);
check("a javascript: link is never used, even when the page has it", script[0]?.url, "https://careers.test.sa/");

const arabic = groundedJobs([{ title: "محلل أمن سيبراني" }], { ...page, text: `${page.text}\nمحلل أمن سيبراني - الرياض` }, source);
check("an Arabic title on the page is kept", arabic.map((j) => j.title), ["محلل أمن سيبراني"]);

const invented = groundedJobs([{ title: "Senior Cloud Security Engineer" }], page, source);
check("words borrowed from the page do not make a title (contiguous match)", invented.length, 0);

// Another employer's job on the page (AlUla's careers page shows Jadarat postings, 2026-11-04).
{
  const jadarat = { ...page, text: `${page.text}\nمهندس مدني لدى شركة مقياس واحد للمقاولات` };
  const named = groundedJobs([{ title: "مهندس مدني", employer: "شركة مقياس واحد للمقاولات" }], jadarat, source);
  check("an employer named on the page is kept", named[0]?.company, "شركة مقياس واحد للمقاولات");
  const madeUp = groundedJobs([{ title: "SOC Analyst", employer: "Acme Cyber" }], page, source);
  check("an employer not on the page falls back to the source's company", madeUp[0]?.company, "Test Co");
}

// The link from a landing page to its list (KAFD, 2026-11-04).
check(
  "KAFD: 'Explore Opportunities' leads to careers.kafd.sa",
  listLinkIn([{ text: "Career", href: "https://www.kafd.sa/en/careers" }, { text: "Explore Opportunitie", href: "https://careers.kafd.sa/" }], "https://www.kafd.sa/en/careers"),
  "https://careers.kafd.sa/",
);
check("by its words", listLinkIn([{ text: "About", href: "https://x.sa/about" }, { text: "View all jobs", href: "https://x.sa/jobs/list" }], "https://x.sa/careers"), "https://x.sa/jobs/list");
check("Arabic words", listLinkIn([{ text: "الوظائف الشاغرة", href: "https://x.sa/ar/vacancies" }], "https://x.sa/ar/careers"), "https://x.sa/ar/vacancies");
check("a job system the employer runs on", listLinkIn([{ text: "Apply here", href: "https://jobs.lever.co/xco" }], "https://x.sa/careers"), "https://jobs.lever.co/xco");
check("another company's careers site is not ours", listLinkIn([{ text: "Partner", href: "https://careers.other.com/" }], "https://x.sa/careers"), null);
check("nothing that says so: no link", listLinkIn([{ text: "Contact us", href: "https://x.sa/contact" }], "https://x.sa/careers"), null);
check("never a script link", listLinkIn([{ text: "View all jobs", href: "javascript:void(0)" }], "https://x.sa/careers"), null);

console.log(`ai-reader: ${total - failures}/${total} correct`);
if (failures > 0) process.exit(1);
