/**
 * The source-repair rules (src/lib/source-fix.ts). Zero network, zero database.
 *
 *   npm run test:fixes
 */
import { blockedBy, learnedChoice, linkedinSlugIn, loginWall, optionsFor, robotsAllows, withOverrides } from "../src/lib/source-fix";
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

/* ---- robots.txt: a page the site asks crawlers to leave alone is left alone ---- */
const ROBOTS = `
User-agent: Googlebot
Disallow:

User-agent: *
Disallow: /careers/search
Allow: /careers/search/public
Disallow: /*.pdf$

User-agent: BadBot
Disallow: /
`;
check("robots: an unlisted path is allowed", robotsAllows(ROBOTS, "/careers"), true);
check("robots: a disallowed path for * is refused", robotsAllows(ROBOTS, "/careers/search?q=soc"), false);
check("robots: the longer Allow wins", robotsAllows(ROBOTS, "/careers/search/public/list"), true);
check("robots: $ anchors the end", robotsAllows(ROBOTS, "/files/jobs.pdf"), false);
check("robots: ...and only the end", robotsAllows(ROBOTS, "/files/jobs.pdf.html"), true);
check("robots: another bot's Disallow: / does not apply", robotsAllows(ROBOTS, "/anything"), true);
check("robots: Disallow: / for everyone", robotsAllows("User-agent: *\nDisallow: /", "/careers"), false);
check("robots: an empty file allows all", robotsAllows("", "/careers"), true);
check("robots: grouped agents share the rules", robotsAllows("User-agent: a\nUser-agent: *\nDisallow: /jobs", "/jobs/1"), false);

/* ---- bot protection is named, never got around ---- */
check("Cloudflare challenge", blockedBy(403, { server: "cloudflare" }, "<title>Just a moment...</title>"), "Cloudflare");
check("Cloudflare header", blockedBy(403, { "cf-mitigated": "challenge" }, ""), "Cloudflare");
check("Akamai access denied", blockedBy(403, {}, "<H1>Access Denied</H1> You don't have permission ... Reference #18.abc"), "Akamai");
check("Imperva", blockedBy(200, {}, "<script src='/_Incapsula_Resource?x'></script>"), "Imperva");
check("an ordinary careers page is not blocked", blockedBy(200, { server: "nginx" }, "<h1>Careers</h1><a href='/jobs/1'>SOC Analyst</a>"), null);
check("a big page that merely mentions recaptcha on a form is not blocked", blockedBy(200, {}, "<div class='g-recaptcha'></div>" + "x".repeat(20000)), null);
check("Nafath sign-in is a login wall", loginWall("https://jadarat.sa/login", "<p>Login with Nafath</p>"), true);
check("a careers page is not a login wall", loginWall("https://example.com/careers", "<p>Join us</p>"), false);
check("center3: a careers page that mentions Nafath and has a Login link is not a wall", loginWall("https://www.center3.com/en/careers", "<a href='/login'>Login</a> <p>Apply with Nafath</p><input type='password'>"), false);
check("a sign-in form on a login path is a wall", loginWall("https://jobs.example.sa/auth/signin", "<input type=\"password\" name=\"p\">"), true);
check("being sent to Nafath is a wall", loginWall("https://www.iam.gov.sa/authservice/login", ""), true);

/* ---- the user's habits ---- */
const h = (verdict: string, decision: string) => ({ verdict, decision });
check("three alike -> repeated", learnedChoice([h("blocked", "linkedin"), h("blocked", "linkedin"), h("blocked", "linkedin")], "blocked"), "linkedin");
check("two alike is not a habit", learnedChoice([h("blocked", "linkedin"), h("blocked", "linkedin")], "blocked"), null);
check("the newest three must agree", learnedChoice([h("blocked", "keep"), h("blocked", "linkedin"), h("blocked", "linkedin"), h("blocked", "linkedin")], "blocked"), null);
check("other verdicts do not count", learnedChoice([h("robots", "delete"), h("blocked", "delete"), h("robots", "delete"), h("robots", "delete")], "robots"), "delete");
check("'replace' is never repeated by itself", learnedChoice([h("not-found", "replace"), h("not-found", "replace"), h("not-found", "replace")], "not-found"), null);
check("undo is ignored", learnedChoice([h("blocked", "undo"), h("blocked", "keep"), h("blocked", "keep"), h("blocked", "keep")], "blocked"), "keep");

/* ---- LinkedIn company pages ---- */
check("slug from a company URL", linkedinSlugIn("https://www.linkedin.com/company/elm/jobs/"), "elm");
check("slug from page markup", linkedinSlugIn(`<a href="https://sa.linkedin.com/company/sirarbystc?trk=x">`), "sirarbystc");
check("not a company page", linkedinSlugIn("https://www.linkedin.com/in/someone"), null);

/* ---- what the user may choose ---- */
check("blocked offers LinkedIn first", optionsFor("blocked")[0], "linkedin");
check("an empty page offers 'use it anyway'", optionsFor("no-postings")[0], "accept");
check("a fixed card offers undo", optionsFor("works"), ["undo"]);

/* ---- the collector's source list after fixes ---- */
const src = (id: string, extra: Partial<SourceDefinition> = {}): SourceDefinition => ({ id, label: id, kind: "ats", adapter: "greenhouse", handle: id, ...extra });
const list = withOverrides([src("a"), src("b"), src("c")], [src("fix-x", { replaces: ["b"] }), src("a")], new Set(["c"]));
check("switched off and replaced sources go; the new board comes in; no duplicate ids", list.map((s) => s.id), ["a", "fix-x"]);

console.log(`fixes: ${total - failures}/${total} correct`);
if (failures > 0) process.exit(1);
