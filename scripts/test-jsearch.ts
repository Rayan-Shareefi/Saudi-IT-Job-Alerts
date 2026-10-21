/**
 * Exercises the JSearch adapter against a local mock server.
 *
 * The free plan allows ~200 requests a month, so proving the adapter works must
 * not itself consume them. This stands up a throwaway HTTP server, points the
 * adapter at it with JSEARCH_BASE_URL, and drives the paths that actually
 * matter: response parsing in both payload shapes, key rotation on a 429,
 * mid-sweep continuation after a switch, and full exhaustion.
 *
 * Zero real requests. Run it before every real run.
 *
 *   npx tsx scripts/test-jsearch.ts
 */
import { createServer, type Server } from "node:http";
import { JSEARCH_SWEEPS, PROVIDER_BASE, jsearch, jsearchHeadersFor } from "../src/lib/adapters/aggregators";

/** Derived, so adding a sweep does not break four assertions. */
const SWEEPS = JSEARCH_SWEEPS.length;
import type { SourceDefinition } from "../src/lib/types";

// The mock listens on 127.0.0.1, which the fetch helpers refuse by default
// (net-guard.ts); this suite may reach it.
process.env.ALLOW_LOCAL_FETCH = "1";

const SOURCE: SourceDefinition = {
  id: "jsearch-riyadh",
  label: "JSearch",
  kind: "jsearch",
  adapter: "jsearch",
  handle: "Riyadh",
  region: "ksa",
};

function job(id: string, title: string, city = "Riyadh") {
  return {
    job_id: id,
    job_title: title,
    employer_name: "Test Employer",
    job_city: city,
    job_country: "SA",
    job_description: "Requires 3 years of experience with AWS and Kubernetes.",
    job_apply_link: `https://example.com/${id}`,
    job_posted_at_datetime_utc: new Date().toISOString(),
    job_employment_type: "FULLTIME",
  };
}

interface ScenarioResult {
  jobs: number;
  error?: string;
  keysSeen: string[];
  calls: number;
  /** Which auth header each request carried: "rapidapi" or "openwebninja". */
  headersSeen: string[];
}

interface Scenario {
  name: string;
  /** Called per request; returns [status, body]. */
  handler: (keyUsed: string, callIndex: number) => [number, unknown];
  keys: string[];
  /** Set the JSearch variables explicitly, for the platform scenarios. */
  env?: Record<string, string>;
  expect: (result: ScenarioResult) => string | null;
}

const SCENARIOS: Scenario[] = [
  {
    name: "happy path, data as an array",
    keys: ["key1"],
    handler: (_k, i) => [200, { data: [job(`a${i}`, `Cloud Engineer ${i}`)] }],
    expect: (r) => (r.jobs === SWEEPS ? null : `expected ${SWEEPS} jobs, got ${r.jobs}`),
  },
  {
    name: "payload shaped as data.jobs",
    keys: ["key1"],
    handler: (_k, i) => [200, { data: { jobs: [job(`b${i}`, `Data Engineer ${i}`)] } }],
    expect: (r) => (r.jobs === SWEEPS ? null : `expected ${SWEEPS} jobs, got ${r.jobs}`),
  },
  {
    name: "key 1 exhausted -> rolls to key 2 and keeps every sweep",
    keys: ["key1", "key2"],
    handler: (k, i) =>
      k === "key1" ? [429, { message: "quota" }] : [200, { data: [job(`c${i}`, `Role ${i}`)] }],
    expect: (r) => {
      if (r.jobs !== SWEEPS) return `expected all ${SWEEPS} sweeps to land on key2, got ${r.jobs}`;
      if (!r.keysSeen.includes("key2")) return "never switched to key2";
      return null;
    },
  },
  {
    name: "key 1 dies mid-run -> continues on key 2 from that sweep",
    keys: ["key1", "key2"],
    handler: (k, i) => {
      // First two sweeps succeed on key1, then it starts refusing.
      if (k === "key1") return i < 2 ? [200, { data: [job(`d${i}`, `Role ${i}`)] }] : [429, {}];
      return [200, { data: [job(`e${i}`, `Role ${i}`)] }];
    },
    expect: (r) => (r.jobs === SWEEPS ? null : `expected ${SWEEPS} jobs across both keys, got ${r.jobs}`),
  },
  {
    name: "every key exhausted -> QuotaExceeded, not a silent zero",
    keys: ["key1", "key2"],
    handler: () => [429, { message: "quota" }],
    expect: (r) =>
      r.error?.includes("quota") ? null : `expected a quota error, got ${r.error ?? "no error"}`,
  },
  {
    name: "retired endpoint (404) surfaces instead of returning nothing",
    keys: ["key1"],
    handler: () => [404, { message: "Endpoint '/search' does not exist" }],
    expect: (r) =>
      r.error?.toLowerCase().includes("endpoint") ? null : `expected an endpoint error, got ${r.error ?? "none"}`,
  },
  /* ---- platform routing ---------------------------------------------- */
  {
    name: "an OpenWeb Ninja key authenticates with x-api-key",
    keys: ["ninja-1"],
    env: { JSEARCH_OPENWEBNINJA_KEY: "ninja-1" },
    handler: () => [200, { status: "OK", data: [job("n1", "Cloud Security Engineer")] }],
    expect: (r) =>
      r.headersSeen.length === 1 && r.headersSeen[0] === "openwebninja"
        ? null
        : `expected the x-api-key header, saw ${r.headersSeen.join(", ") || "none"}`,
  },
  {
    name: "a RapidAPI key authenticates with X-RapidAPI-Key",
    keys: ["rapid-1"],
    env: { JSEARCH_RAPIDAPI_KEY: "rapid-1" },
    handler: () => [200, { status: "OK", data: [job("r1", "Cloud Security Engineer")] }],
    expect: (r) =>
      r.headersSeen.length === 1 && r.headersSeen[0] === "rapidapi"
        ? null
        : `expected the X-RapidAPI-Key header, saw ${r.headersSeen.join(", ") || "none"}`,
  },
  {
    name: "mixed platforms fail over from OpenWeb Ninja to RapidAPI",
    keys: ["ninja-1", "rapid-2"],
    // Exactly the setup in use: the primary key is from openwebninja.com and
    // the fallback is from the RapidAPI marketplace.
    env: { JSEARCH_OPENWEBNINJA_KEY: "ninja-1", JSEARCH_RAPIDAPI_KEY: "rapid-2" },
    handler: (key) =>
      key === "ninja-1"
        ? [429, { message: "quota exceeded" }]
        : [200, { status: "OK", data: [job("m1", "SOC Analyst")] }],
    expect: (r) => {
      if (r.keysSeen[0] !== "ninja-1") return `expected to start on the OpenWeb Ninja key, saw ${r.keysSeen[0]}`;
      if (!r.keysSeen.includes("rapid-2")) return "expected failover to the RapidAPI key";
      if (r.headersSeen.join(",") !== "openwebninja,rapidapi") {
        return `expected each key to use its own header, saw ${r.headersSeen.join(",")}`;
      }
      return r.jobs > 0 ? null : "expected jobs after failover";
    },
  },
  {
    name: "JSEARCH_PROVIDER relabels the legacy variable",
    keys: ["legacy-1"],
    env: { JSEARCH_RAPIDAPI_KEY: "legacy-1", JSEARCH_PROVIDER: "openwebninja" },
    handler: () => [200, { status: "OK", data: [job("l1", "DevOps Engineer")] }],
    expect: (r) =>
      r.headersSeen[0] === "openwebninja"
        ? null
        : `expected JSEARCH_PROVIDER to switch the header, saw ${r.headersSeen[0] ?? "none"}`,
  },
  {
    name: "a refused key names the variable and the platform",
    keys: ["wrong-1"],
    env: { JSEARCH_OPENWEBNINJA_KEY: "wrong-1" },
    handler: () => [403, { message: "invalid api key" }],
    expect: (r) => {
      if (!r.error) return "expected an error";
      if (!r.error.includes("JSEARCH_OPENWEBNINJA_KEY")) return `error should name the variable: ${r.error}`;
      return r.error.includes("JSEARCH_RAPIDAPI_KEY")
        ? null
        : `error should suggest the other variable: ${r.error}`;
    },
  },
];

async function runScenario(s: Scenario, port: number, server: Server & { impl?: Scenario }): Promise<string | null> {
  server.impl = s;
  process.env.JSEARCH_BASE_URL = `http://127.0.0.1:${port}`;
  // Every JSearch variable is cleared first: these run in one process, and a
  // key left behind by an earlier scenario silently joins the rotation in the
  // next one.
  for (const v of [
    "JSEARCH_RAPIDAPI_KEY",
    "JSEARCH_RAPIDAPI_KEY_2",
    "JSEARCH_RAPIDAPI_KEY_3",
    "JSEARCH_OPENWEBNINJA_KEY",
    "JSEARCH_OPENWEBNINJA_KEY_2",
    "JSEARCH_OPENWEBNINJA_KEY_3",
    "JSEARCH_PROVIDER",
  ]) {
    delete process.env[v];
  }

  if (s.env) {
    for (const [k, v] of Object.entries(s.env)) process.env[k] = v;
  } else {
    process.env.JSEARCH_RAPIDAPI_KEY = s.keys[0];
    if (s.keys[1]) process.env.JSEARCH_RAPIDAPI_KEY_2 = s.keys[1];
  }

  state.calls = 0;
  state.urls = [];
  state.keysSeen = [];
  state.headersSeen = [];

  try {
    const jobs = await jsearch(SOURCE);
    return s.expect({
      jobs: jobs.length,
      keysSeen: state.keysSeen,
      calls: state.calls,
      headersSeen: state.headersSeen,
    });
  } catch (err) {
    return s.expect({
      jobs: 0,
      error: err instanceof Error ? err.message : String(err),
      keysSeen: state.keysSeen,
      calls: state.calls,
      headersSeen: state.headersSeen,
    });
  }
}

const state = { calls: 0, keysSeen: [] as string[], headersSeen: [] as string[], urls: [] as string[] };

async function main(): Promise<void> {
  let current: Scenario | null = null;

  const server = createServer((req, res) => {
    /*
     * Both header styles, because that is the whole point of the platform
     * split: RapidAPI authenticates with X-RapidAPI-Key, OpenWeb Ninja with
     * x-api-key. A mock that only reads one of them would see an empty key for
     * the other and quietly report the adapter as broken.
     */
    const rapid = String(req.headers["x-rapidapi-key"] ?? "");
    const ninja = String(req.headers["x-api-key"] ?? "");
    const key = rapid || ninja;
    state.urls.push(String(req.url ?? ""));
    const via = rapid ? "rapidapi" : ninja ? "openwebninja" : "none";
    if (!state.keysSeen.includes(key)) state.keysSeen.push(key);
    if (!state.headersSeen.includes(via)) state.headersSeen.push(via);
    const [status, body] = current!.handler(key, state.calls);
    state.calls++;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }) as Server & { impl?: Scenario };

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  console.log(`mock JSearch on 127.0.0.1:${port} - no real requests will be made\n`);

  /*
   * The hosts, asserted directly.
   *
   * The mock proves which HEADER each key uses, but not which URL: every
   * scenario points the adapter at the same local server through
   * JSEARCH_BASE_URL. Sending an OpenWeb Ninja key to jsearch.p.rapidapi.com
   * with the right header would still fail, so the mapping is worth checking on
   * its own - and it costs no requests.
   */
  let failures = 0;
  const hostChecks: Array<[string, string, string]> = [
    ["rapidapi", PROVIDER_BASE.rapidapi, "https://jsearch.p.rapidapi.com"],
    ["openwebninja", PROVIDER_BASE.openwebninja, "https://api.openwebninja.com/jsearch"],
  ];
  for (const [provider, actual, expected] of hostChecks) {
    if (actual !== expected) {
      failures++;
      console.log(`FAIL  ${provider} base URL\n        expected ${expected}, got ${actual}`);
    } else {
      console.log(`ok    ${provider} -> ${actual}`);
    }
  }

  const headerChecks: Array<[string, Record<string, string>, string]> = [
    ["rapidapi", jsearchHeadersFor("rapidapi", "K"), "X-RapidAPI-Key"],
    ["openwebninja", jsearchHeadersFor("openwebninja", "K"), "x-api-key"],
  ];
  for (const [provider, headers, expected] of headerChecks) {
    if (headers[expected] !== "K") {
      failures++;
      console.log(
        `FAIL  ${provider} auth header\n        expected ${expected}, got ${Object.keys(headers).join(", ")}`,
      );
    }
  }
  console.log("");

  for (const s of SCENARIOS) {
    current = s;
    const problem = await runScenario(s, port, server);
    if (problem) {
      failures++;
      console.log(`FAIL  ${s.name}\n        ${problem}`);
    } else {
      console.log(`ok    ${s.name}  (${state.calls} mock calls, keys: ${state.keysSeen.join(" -> ")})`);
    }
  }

  server.close();
  const total = SCENARIOS.length + hostChecks.length + headerChecks.length;
  console.log(`\n${total - failures}/${total} passed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
