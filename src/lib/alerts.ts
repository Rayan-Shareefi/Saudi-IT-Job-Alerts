import { Resend } from "resend";
import { reserve } from "./budget";
import { fetchAllRows, supabaseAdmin } from "./db";
import { resolveSender } from "./digest";
import { envStr } from "./env";

/**
 * Instant emails, for what cannot wait for the 3-day digest.
 *
 *  - Time-sensitive vacancies: an application form (Google Forms and the
 *    like - one-off intakes that close without notice) or a deadline within
 *    7 days.
 *  - Co-op watch hits: a company opened a new co-op page or intake.
 *  - System alerts: LinkedIn needs a manual sign-in, the laptop went quiet.
 *
 * Free-quota maths (Resend free: 100/day, 3,000/month, pauses rather than
 * bills at the limit): alerts are batched into at most one email per worker
 * cycle and hard-capped at 20 a day; system alerts at 2 a day. Worst case
 * 22 + 1 digest = 23/day and ~700/month - well inside the free plan.
 */

function recipient(): { apiKey: string; to: string[] } | null {
  const apiKey = envStr("RESEND_API_KEY");
  const to = envStr("DIGEST_TO");
  if (!apiKey || !to) return null;
  return { apiKey, to: to.split(",").map((s) => s.trim()).filter(Boolean) };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function send(subject: string, html: string, text: string): Promise<boolean> {
  const r = recipient();
  if (!r) return false;
  const { from } = resolveSender();
  const { error } = await new Resend(r.apiKey).emails.send({ from, to: r.to, subject, html, text });
  if (error) {
    console.warn(`[alerts] Resend refused: ${error.message}`);
    return false;
  }
  return true;
}

/** "LinkedIn needs you" and similar. At most 2 a day, and never the same message twice in a day. */
export async function sendSystemAlert(key: string, subject: string, body: string): Promise<boolean> {
  const db = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db.from("audit_log").select("id").eq("action", `system-alert:${key}`).gte("at", `${today}T00:00:00Z`).limit(1);
  if ((data ?? []).length > 0) return false;
  if (!(await reserve("resend-system"))) return false;
  const ok = await send(`Saudi Job Alert: ${subject}`, `<p style="font-family:sans-serif;font-size:14px">${esc(body)}</p>`, body);
  if (ok) await db.from("audit_log").insert({ actor: "system", action: `system-alert:${key}`, detail: { subject } });
  return ok;
}

interface AlertRow {
  id: string;
  title: string;
  company: string;
  url: string;
  apply_url: string | null;
  apply_kind: string | null;
  closes_at: string | null;
}

/**
 * One email listing every verified, time-sensitive vacancy not yet alerted.
 * Returns how many jobs it covered.
 */
export async function sendTimeSensitiveAlerts(): Promise<number> {
  if (!recipient()) return 0;
  const db = supabaseAdmin();
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const rows = await fetchAllRows<AlertRow>(
    (from, to) =>
      db
        .from("jobs")
        .select("id,title,company,url,apply_url,apply_kind,closes_at")
        .eq("is_active", true)
        .is("removed_at", null)
        .is("duplicate_of", null)
        .eq("review_state", "show")
        .is("alerted_at", null)
        .or(`apply_kind.eq.form,closes_at.lte.${soon}`)
        .range(from, to),
    "alert rows",
  );
  const signals = await db.from("coop_signals").select("id,company,kind,url,detail").is("alerted_at", null).limit(50);
  const coop = signals.data ?? [];
  if (rows.length === 0 && coop.length === 0) return 0;
  if (!(await reserve("resend-alert"))) return 0;

  const app = envStr("APP_URL");
  const jobLine = (r: AlertRow) => {
    const why = r.apply_kind === "form" ? "applies through a form - often a short intake" : `closes ${r.closes_at?.slice(0, 10)}`;
    return { html: `<li style="margin:0 0 10px"><a href="${esc(r.apply_url ?? r.url)}"><b>${esc(r.title)}</b></a> - ${esc(r.company)}<br><span style="color:#64748b">${esc(why)}</span></li>`, text: `- ${r.title} (${r.company}): ${why}\n  ${r.apply_url ?? r.url}` };
  };
  const coopLine = (s: { company: string; kind: string; url: string; detail: string | null }) => ({
    html: `<li style="margin:0 0 10px"><b>${esc(s.company)}</b>: ${esc(s.detail ?? s.kind)}<br><a href="${esc(s.url)}">${esc(s.url)}</a></li>`,
    text: `- ${s.company}: ${s.detail ?? s.kind}\n  ${s.url}`,
  });
  const jobs = rows.map(jobLine);
  const hits = coop.map(coopLine);
  const subject =
    rows.length > 0
      ? `Time-sensitive: ${rows.length} job${rows.length === 1 ? "" : "s"} to apply for soon${hits.length ? ` + ${hits.length} co-op update(s)` : ""}`
      : `Co-op update: ${hits.length} new intake page(s)`;
  const html = `<div style="font-family:sans-serif;font-size:14px;color:#0f172a;max-width:600px">
${rows.length ? `<h2 style="font-size:16px">Apply soon</h2><ul style="padding-left:18px">${jobs.map((j) => j.html).join("")}</ul>` : ""}
${hits.length ? `<h2 style="font-size:16px">Co-op watch</h2><ul style="padding-left:18px">${hits.map((h) => h.html).join("")}</ul>` : ""}
${app ? `<p><a href="${esc(app)}">Open the board</a></p>` : ""}</div>`;
  const text = [rows.length ? `Apply soon:\n${jobs.map((j) => j.text).join("\n")}` : "", hits.length ? `Co-op watch:\n${hits.map((h) => h.text).join("\n")}` : ""].filter(Boolean).join("\n\n");

  if (!(await send(subject, html, text))) return 0;
  const now = new Date().toISOString();
  if (rows.length) await db.from("jobs").update({ alerted_at: now }).in("id", rows.map((r) => r.id));
  if (coop.length) await db.from("coop_signals").update({ alerted_at: now }).in("id", coop.map((c) => c.id));
  return rows.length + coop.length;
}
