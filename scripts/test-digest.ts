/**
 * Digest sender handling. Zero network, zero database.
 *
 *   npx tsx scripts/test-digest.ts
 *
 * Exists because a blank GitHub secret (`DIGEST_FROM=""`) reached Resend as
 * `from: ""` and failed every scheduled digest from 2026-09-04 to 2026-10-10.
 */
import { DEFAULT_SENDER, resolveSender, validSender } from "../src/lib/digest";
import { envStr } from "../src/lib/env";

let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const SENDERS: Array<[string, boolean]> = [
  ["Saudi Job Alert <onboarding@resend.dev>", true],
  ["onboarding@resend.dev", true],
  ["<alerts@example.com>", true],
  ["", false],
  ["   ", false],
  ["Saudi Job Alert", false],
  ["Name <a@b.c", false],
  ["a@b", false],
];
for (const [v, want] of SENDERS) check(`validSender(${JSON.stringify(v)})`, validSender(v), want);

const saved = process.env.DIGEST_FROM;
process.env.DIGEST_FROM = "";
check("blank DIGEST_FROM falls back", resolveSender(), { from: DEFAULT_SENDER, problem: null });
check("blank env var reads as unset", envStr("DIGEST_FROM"), undefined);
process.env.DIGEST_FROM = "  Alerts <alerts@example.com>  ";
check("configured sender is trimmed", resolveSender().from, "Alerts <alerts@example.com>");
process.env.DIGEST_FROM = "not an address";
check("invalid sender falls back", resolveSender().from, DEFAULT_SENDER);
check("invalid sender is reported", resolveSender().problem !== null, true);
if (saved === undefined) delete process.env.DIGEST_FROM;
else process.env.DIGEST_FROM = saved;

const total = SENDERS.length + 5;
console.log(`digest: ${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
