/**
 * Is this machine ready to be the 24/7 worker? Checks everything, fixes
 * nothing, prints what to do. Never prints a key's value.
 *
 *   npm run doctor
 *
 * Run it on the laptop after setup, and whenever something seems off.
 */
import "./load-env";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { envStr } from "../src/lib/env";
import { supabaseAdmin } from "../src/lib/db";
import { PROFILE_DIR } from "../src/lib/adapters/linkedin-posts";
import { jurorPrompt } from "../src/lib/judge/prompt";
import { parseAnswer } from "../src/lib/judge/verify";

const ok = (s: string) => console.log(`  ok   ${s}`);
const warn = (s: string) => console.log(`  !!   ${s}`);
const info = (s: string) => console.log(`       ${s}`);

async function main(): Promise<void> {
  console.log("\nSaudi Job Alert - worker doctor\n");

  // Node
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) ok(`Node ${process.versions.node}`);
  else warn(`Node ${process.versions.node} - install Node 22 LTS from nodejs.org`);

  // Keys (presence only)
  console.log("\nKeys (presence only):");
  const need: Array<[string, string, boolean]> = [
    ["NEXT_PUBLIC_SUPABASE_URL", "database", true],
    ["SUPABASE_SERVICE_ROLE_KEY", "database writes", true],
    ["GEMINI_API_KEY", "AI jury (Gemini, Gemma)", true],
    ["GROQ_API_KEY", "AI jury + senior reviewer (free key: console.groq.com)", false],
    ["RESEND_API_KEY", "emails", true],
    ["DIGEST_TO", "who gets the emails", true],
    ["CRON_SECRET", "the website's editing key", true],
    ["LINKEDIN_ENABLED", "LinkedIn job listings on this machine (set to 1)", false],
    ["LINKEDIN_POSTS_ENABLED", "LinkedIn hiring posts on this machine (set to 1)", false],
    ["LINKEDIN_EMAIL", "secondary LinkedIn account, for automatic re-sign-in", false],
    ["LINKEDIN_PASSWORD", "secondary LinkedIn account, for automatic re-sign-in", false],
  ];
  for (const [name, what, required] of need) {
    if (envStr(name)) ok(`${name.padEnd(26)} ${what}`);
    else (required ? warn : info)(`${name.padEnd(26)} not set - ${what}`);
  }

  // Database
  console.log("\nDatabase:");
  try {
    const { count, error } = await supabaseAdmin().from("jobs").select("id", { count: "exact", head: true }).eq("review_state", "show");
    if (error) throw new Error(error.message);
    ok(`Supabase reachable - ${count} verified job(s) on the board`);
  } catch (err) {
    warn(`Supabase not reachable: ${err instanceof Error ? err.message : err}`);
  }

  // Browser
  console.log("\nBrowser:");
  try {
    const { chromium } = await import("playwright");
    if (existsSync(chromium.executablePath())) ok("Playwright Chromium installed");
    else warn("Chromium missing - run: npx playwright install chromium");
  } catch {
    warn("Playwright not installed - run: npm ci");
  }

  // Ollama
  console.log("\nLocal AI (Ollama):");
  const base = envStr("OLLAMA_URL") ?? "http://127.0.0.1:11434";
  try {
    const tags = (await (await fetch(`${base}/api/tags`)).json()) as { models?: Array<{ name: string }> };
    const names = (tags.models ?? []).map((m) => m.name);
    ok(`Ollama running - models: ${names.join(", ") || "none pulled yet"}`);
    const model = envStr("OLLAMA_MODEL") ?? "qwen2.5:7b-instruct";
    if (!names.some((n) => n.startsWith(model))) {
      warn(`${model} not pulled - run: ollama pull ${model}`);
    } else {
      info(`benchmarking ${model} on one posting (CPU inference can take a few minutes)...`);
      const started = Date.now();
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          options: { temperature: 0, num_ctx: 8192 },
          messages: [{ role: "user", content: jurorPrompt({ title: "SOC Analyst", company: "Canary", location: "Riyadh", text: "Responsibilities: Monitor SIEM alerts and triage security incidents. Requirements: 2+ years of experience in a SOC.", textQuality: "full" }) }],
        }),
      });
      const secs = (Date.now() - started) / 1000;
      const reply = ((await res.json()) as { message?: { content?: string } }).message?.content ?? "";
      const parsed = parseAnswer(reply);
      if (!parsed) warn(`${model} answered in ${secs.toFixed(0)}s but not as valid JSON - try qwen2.5:3b-instruct`);
      else if (secs > 240) warn(`${model}: ${secs.toFixed(0)}s per posting - too slow; set OLLAMA_MODEL=qwen2.5:3b-instruct and pull it`);
      else ok(`${model}: ${secs.toFixed(0)}s per posting, answer parsed (scope: ${parsed.scope})`);
    }
  } catch {
    info("Ollama not running on this machine - the jury uses the free cloud models only (fine).");
    info("To add the local juror: install from ollama.com, then: ollama pull qwen2.5:7b-instruct");
  }

  // LinkedIn session
  console.log("\nLinkedIn:");
  if (existsSync(PROFILE_DIR)) ok("saved session folder present (.linkedin-profile)");
  else info("no saved session yet - open \"Saudi Job Alert\" (desktop) and press L");

  // Windows: power and the scheduled task
  if (process.platform === "win32") {
    console.log("\nThis laptop (Windows):");
    const sleepQ = spawnSync("powercfg", ["/query", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"], { encoding: "utf8" }).stdout ?? "";
    const ac = sleepQ.match(/Current AC Power Setting Index:\s*0x([0-9a-f]+)/i)?.[1];
    if (ac !== undefined && Number.parseInt(ac, 16) === 0) ok("never sleeps on AC power");
    else warn("sleeps on AC power - Settings > System > Power & sleep > When plugged in, PC goes to sleep after: Never");
    const lid = spawnSync("powercfg", ["/query", "SCHEME_CURRENT", "SUB_BUTTONS", "LIDACTION"], { encoding: "utf8" }).stdout ?? "";
    const lidAc = lid.match(/Current AC Power Setting Index:\s*0x([0-9a-f]+)/i)?.[1];
    if (lidAc !== undefined && Number.parseInt(lidAc, 16) === 0) ok("closing the lid does nothing on AC power");
    else warn("closing the lid sleeps the laptop - Control Panel > Power Options > Choose what closing the lid does > Plugged in: Do nothing");
    const task = spawnSync("schtasks", ["/Query", "/TN", "SaudiJobAlertWorker"], { encoding: "utf8" });
    if (task.status === 0) ok("worker scheduled task installed (starts at boot)");
    else warn("worker task not installed - run as administrator: powershell -ExecutionPolicy Bypass -File scripts\\laptop\\install-worker.ps1");
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
