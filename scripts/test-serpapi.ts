/**
 * The SerpApi (Google Jobs) source, against a local mock. Zero real searches:
 * the free plan is 250 a month.
 *
 *   npm run test:serpapi
 */
import { createServer, type Server } from "node:http";
import { bestApplyLink, searchGoogleJobs, toRawJob } from "../src/lib/adapters/serpapi";
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

const source: SourceDefinition = { id: "serpapi-companies", label: "Google Jobs (SerpApi)", kind: "jsearch", adapter: "serpapi", handle: "Riyadh" };

const tahakom = {
  title: "Cyber Security Analyst",
  company_name: "Tahakom",
  location: "Riyadh Saudi Arabia",
  via: "via LinkedIn",
  description: "Monitor SIEM alerts and respond to incidents.",
  share_link: "https://www.google.com/search?ibp=htl;jobs&q=x",
  detected_extensions: { posted_at: "3 days ago", schedule_type: "Full-time" },
  apply_options: [
    { title: "LinkedIn", link: "https://www.linkedin.com/jobs/view/4012345678" },
    { title: "Tahakom Careers", link: "https://careers.tahakom.com/job/Cyber-Security-Analyst/1234/" },
  ],
};

/* ---- converting a result ---- */
const job = toRawJob(tahakom, source);
check("the employer's own apply link is preferred over LinkedIn", job?.applyUrl, "https://careers.tahakom.com/job/Cyber-Security-Analyst/1234/");
check("the platform is the site Google found it on", job?.publisher, "LinkedIn");
check("every site that carries it is listed", job?.listedOn, ["LinkedIn", "Tahakom Careers"]);
check("a relative date becomes a date", typeof job?.postedAt === "string" && job.postedAt.length >= 10, true);
check("the id is stable across runs (content, not Google's id)", toRawJob({ ...tahakom, job_id: "changes-every-call" }, source)?.externalId, job?.externalId);
check("only LinkedIn listed: the LinkedIn link, and its job number as id", toRawJob({ ...tahakom, apply_options: [tahakom.apply_options[0]] }, source)?.externalId, "li:4012345678");
check("a javascript: apply link is never used", bestApplyLink({ apply_options: [{ link: "javascript:alert(1)" }], share_link: "https://www.google.com/x" }), "https://www.google.com/x");
check("no title: not a posting", toRawJob({ ...tahakom, title: "" }, source), null);

/* ---- the search itself, against a mock ---- */
const KEY = "test-key-should-never-appear";
let mode = "ok";
const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("content-type", "application/json");
  if (mode === "ok") return res.end(JSON.stringify({ jobs_results: [tahakom], echo: url.searchParams.get("engine") }));
  if (mode === "empty") return res.end(JSON.stringify({ error: "Google hasn't returned any results for this query." }));
  if (mode === "quota") return res.end(JSON.stringify({ error: "Your account has run out of searches." }));
  if (mode === "badkey") {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: "Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key" }));
  }
  res.statusCode = 500;
  res.end(JSON.stringify({ error: "Internal error" }));
});

server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env.SERPAPI_BASE_URL = `http://127.0.0.1:${port}`;
  const outcome = async (): Promise<string> => {
    try {
      const r = await searchGoogleJobs(KEY, "Tahakom jobs");
      return `ok:${r.length}`;
    } catch (err) {
      return `${(err as Error).name}:${(err as Error).message}`;
    }
  };
  mode = "ok";
  check("a search returns its jobs", await outcome(), "ok:1");
  mode = "empty";
  check("'no results' is an answer, not a fault", await outcome(), "ok:0");
  mode = "quota";
  check("a spent plan is QuotaExceeded", (await outcome()).startsWith("QuotaExceeded:"), true);
  mode = "badkey";
  check("a wrong key names the setting", (await outcome()).startsWith("MissingCredential:"), true);
  mode = "fail";
  const failed = await outcome();
  check("a server error is an error", failed.startsWith("Error:"), true);
  check("no error message ever contains the key", [failed].some((m) => m.includes(KEY)), false);
  server.close();
  console.log(`serpapi: ${total - failures}/${total} correct`);
  if (failures > 0) process.exit(1);
});
