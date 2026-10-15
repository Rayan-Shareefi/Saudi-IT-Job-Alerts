import type { JobRecord } from "./types";

/**
 * The digest email, every 3 days.
 *
 * Only verified vacancies (review_state "show", one per vacancy), in the same
 * order as the board: time-sensitive, then recommended for the CV, then co-op,
 * then internships, then everything else newest first. Every experience claim
 * is the posting's own sentence.
 *
 * Written as inline-styled tables on purpose: Gmail, Outlook and iOS Mail strip
 * <style> blocks and ignore flexbox.
 */

const BRAND = "#0f766e";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const BG = "#f8fafc";

export interface DigestInput {
  jobs: JobRecord[];
  windowStart: Date;
  windowEnd: Date;
  appUrl?: string;
  /** Ids the CV matcher recommends, when a CV profile is stored. */
  recommended?: Set<string>;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function freshness(job: JobRecord): number {
  const t = [job.postedAt, job.lastRefreshedAt]
    .map((d) => (d ? new Date(d).getTime() : NaN))
    .filter((n) => Number.isFinite(n) && n <= Date.now() + 3_600_000);
  return t.length ? Math.max(...t) : new Date(job.firstSeenAt).getTime();
}

function timeSensitive(job: JobRecord): boolean {
  if (job.applyKind === "form") return true;
  if (!job.closesAt) return false;
  const days = (new Date(job.closesAt).getTime() - Date.now()) / 86_400_000;
  return days >= 0 && days <= 7;
}

/** The board's default order, so the email and the site agree. */
export function digestOrder(jobs: JobRecord[], recommended = new Set<string>()): JobRecord[] {
  const rank = (j: JobRecord) =>
    timeSensitive(j) ? 0 : recommended.has(j.id) ? 1 : j.experienceBand === "coop" ? 2 : j.experienceBand === "internship" ? 3 : 4;
  return [...jobs].sort((a, b) => rank(a) - rank(b) || freshness(b) - freshness(a));
}

function experienceText(j: JobRecord): string {
  if (j.experienceBand === "coop") return "Co-op training";
  if (j.experienceBand === "internship") return "Internship";
  if (j.minYears !== null && j.maxYears !== null && j.minYears !== j.maxYears) return `${j.minYears}-${j.maxYears} years`;
  if (j.minYears !== null) return j.minYears === 0 ? "No experience required" : `${j.minYears}+ years`;
  return "Experience not stated";
}

function pill(text: string, bg: string, color: string): string {
  return `<span style="display:inline-block;background:${bg};color:${color};font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;margin-right:6px;">${esc(text)}</span>`;
}

function jobRow(job: JobRecord, recommended: Set<string>): string {
  const badges: string[] = [];
  if (timeSensitive(job)) badges.push(pill(job.applyKind === "form" ? "APPLY BY FORM" : "CLOSES SOON", "#fee2e2", "#991b1b"));
  if (recommended.has(job.id)) badges.push(pill("RECOMMENDED", "#dcfce7", "#166534"));
  if (job.experienceBand === "coop") badges.push(pill("CO-OP", "#fef3c7", "#92400e"));
  if (job.experienceBand === "internship") badges.push(pill("INTERNSHIP", "#fef3c7", "#92400e"));
  for (const f of job.focus.slice(0, 3)) badges.push(pill(f, "#f1f5f9", "#334155"));

  const also = job.alsoOn.length ? ` &middot; also on ${esc([...new Set(job.alsoOn.map((a) => a.label))].join(", "))}` : "";
  const quote =
    job.experienceEvidence && job.experienceSource === "stated"
      ? `<div style="color:${MUTED};font-size:12px;font-style:italic;margin-top:3px;">&ldquo;${esc(job.experienceEvidence.slice(0, 160))}&rdquo;</div>`
      : "";
  return `
  <tr>
    <td style="padding:14px 0;border-bottom:1px solid ${LINE};">
      ${badges.length ? `<div style="margin-bottom:6px;">${badges.join("")}</div>` : ""}
      <a href="${esc(job.applyUrl ?? job.url)}" style="color:${INK};font-size:16px;font-weight:600;text-decoration:none;line-height:1.35;">${esc(job.title)}</a>
      <div style="color:${MUTED};font-size:13px;margin-top:5px;line-height:1.5;">${esc(job.company)} &middot; ${esc(experienceText(job))}${also}</div>
      ${quote}
    </td>
  </tr>`;
}

export function renderDigest(input: DigestInput): { subject: string; html: string; text: string } {
  const { jobs, windowStart, windowEnd, appUrl } = input;
  const recommended = input.recommended ?? new Set<string>();
  const ordered = digestOrder(jobs, recommended);
  const urgent = ordered.filter(timeSensitive).length;
  const student = ordered.filter((j) => j.experienceBand === "coop" || j.experienceBand === "internship").length;

  const range = `${windowStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} - ${windowEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  const subject =
    jobs.length === 0
      ? "Saudi Job Alert - no new cyber / cloud roles"
      : `Saudi Job Alert - ${jobs.length} new cyber / cloud role${jobs.length === 1 ? "" : "s"}${urgent ? `, ${urgent} time-sensitive` : ""}${student ? `, ${student} co-op / intern` : ""}`;

  const statCell = (value: number | string, label: string, accent = INK) => `
    <td style="padding:0 6px;" width="33%">
      <div style="background:${BG};border:1px solid ${LINE};border-radius:10px;padding:12px 8px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:${accent};line-height:1.1;">${value}</div>
        <div style="font-size:11px;color:${MUTED};margin-top:3px;text-transform:uppercase;letter-spacing:.4px;">${label}</div>
      </div>
    </td>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;padding:28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td style="padding-bottom:4px;">
      <div style="font-size:12px;font-weight:700;color:${BRAND};letter-spacing:1px;text-transform:uppercase;">Saudi Job Alert</div>
      <div style="font-size:24px;font-weight:700;color:${INK};margin-top:6px;line-height:1.25;">New cyber &amp; cloud roles in Riyadh</div>
      <div style="font-size:13px;color:${MUTED};margin-top:4px;">${range}</div>
    </td></tr>
    <tr><td style="padding:20px 0 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${statCell(jobs.length, "new roles")}
        ${statCell(urgent, "time-sensitive", urgent ? "#991b1b" : INK)}
        ${statCell(student, "co-op / intern", student ? BRAND : INK)}
      </tr></table>
    </td></tr>
    ${
      ordered.length === 0
        ? `<tr><td style="padding:28px 0;color:${MUTED};font-size:15px;line-height:1.6;">No new verified cyber or cloud roles since the last digest. Unclassified postings are on the board for you to check.</td></tr>`
        : ordered.slice(0, 40).map((j) => jobRow(j, recommended)).join("")
    }
    ${ordered.length > 40 ? `<tr><td style="padding:10px 0;color:${MUTED};font-size:13px;">+ ${ordered.length - 40} more on the board</td></tr>` : ""}
    ${
      appUrl
        ? `<tr><td style="padding:28px 0 6px;" align="center">
             <a href="${esc(appUrl)}" style="display:inline-block;background:${BRAND};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 26px;border-radius:9px;">Open the board</a>
           </td></tr>`
        : ""
    }
    <tr><td style="padding-top:22px;border-top:1px solid ${LINE};color:#94a3b8;font-size:12px;line-height:1.6;">
      Riyadh only, cybersecurity and cloud only, under 5 years of experience, posted within 30 days, one entry per vacancy.
      Anything that could not be verified is on the board under Unclassified, never here.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    subject,
    range,
    "",
    ...ordered.slice(0, 60).map((j) => `- ${j.title} | ${j.company} | ${experienceText(j)}\n  ${j.applyUrl ?? j.url}`),
  ].join("\n");

  return { subject, html, text };
}
