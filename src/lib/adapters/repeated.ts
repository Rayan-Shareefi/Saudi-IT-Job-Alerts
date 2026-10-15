import { isPlausiblePosting } from "../plausible";
/**
 * Finds a job list by its shape, without knowing anything about the site.
 *
 * Career pages render vacancies as a *repeating structure* - N siblings that
 * share a tag and class signature, each holding a title, usually a link, often
 * a location. That is true of a table, a card grid, an accordion and a plain
 * list alike, and it is true whether the labels are English or Arabic.
 *
 * So instead of hunting for known markup (an ATS slug, schema.org data, an
 * anchor pattern), this looks for the largest group of structurally identical
 * siblings and scores each candidate on how much it behaves like a vacancy
 * list. That is the piece every earlier parser was missing: they all needed a
 * structure they already recognised, and these pages share none - only the
 * *property* of being repeated.
 *
 * Free, deterministic, no API and no per-site rules.
 */

/** Runs inside the page. Returns candidate groups with their extracted items. */
export const REPEATED_BLOCK_SCRIPT = `(() => {
  const NOISE = /cookie|newsletter|subscribe|footer|nav|menu|breadcrumb|social|share|language|accessibility/i;
  const JOBBY = /job|career|vacan|position|opening|opportunit|requisition|recruit|wazifa|وظيف|توظيف/i;
  const PLACEY = /riyadh|jeddah|dammam|khobar|dhahran|jubail|yanbu|makkah|mecca|medina|tabuk|neom|saudi|ksa|remote|hybrid|on-?site|الرياض|السعود/i;
  const DATEY  = /\\b(posted|ago|today|yesterday|\\d{1,2}\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\\d{4}-\\d{2}-\\d{2})/i;
  const NAVWORDS = /^(home|about|contact|login|sign in|register|search|apply|more|next|previous|view all|all jobs|english|العربية)$/i;

  // A child's structural fingerprint: tag plus its class list, order-independent.
  // Sites frequently vary one modifier class per card, so the first two classes
  // are enough to group siblings without splitting a real list apart.
  function signature(el) {
    const cls = (el.className && typeof el.className === 'string' ? el.className : '')
      .split(/\\s+/).filter(Boolean).sort().slice(0, 2).join('.');
    return el.tagName + (cls ? '.' + cls : '');
  }

  function textOf(el) {
    return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  const candidates = [];
  const containers = document.querySelectorAll('body *');

  for (const container of containers) {
    const kids = Array.from(container.children);
    if (kids.length < 3 || kids.length > 400) continue;

    const bySig = new Map();
    for (const k of kids) {
      const s = signature(k);
      if (!bySig.has(s)) bySig.set(s, []);
      bySig.get(s).push(k);
    }

    for (const [sig, group] of bySig) {
      if (group.length < 3) continue;

      const items = group.map((el) => {
        const link = el.querySelector('a[href]');
        const heading = el.querySelector('h1,h2,h3,h4,h5,[class*="title" i],[class*="name" i]');
        const full = textOf(el);
        let title = '';
        if (heading) title = textOf(heading);
        if (!title && link) title = textOf(link);
        if (!title) title = full.split('\\n')[0] || full.slice(0, 90);
        return {
          title: title.slice(0, 200),
          url: link ? link.href : null,
          text: full.slice(0, 900),
        };
      });

      const withTitle = items.filter((i) => i.title.length >= 6 && i.title.length <= 160);
      if (withTitle.length < 3) continue;

      // Every item carrying the same words is a nav strip, not a list of jobs.
      const distinct = new Set(withTitle.map((i) => i.title.toLowerCase()));
      if (distinct.size < Math.max(2, withTitle.length * 0.6)) continue;
      if (withTitle.every((i) => NAVWORDS.test(i.title))) continue;

      const ancestry = (container.className || '') + ' ' + (container.id || '') + ' ' + sig;
      let score = 0;
      if (JOBBY.test(ancestry)) score += 4;
      score += withTitle.filter((i) => i.url && JOBBY.test(i.url)).length >= withTitle.length * 0.5 ? 4 : 0;
      score += withTitle.filter((i) => i.url).length >= withTitle.length * 0.7 ? 2 : 0;
      score += withTitle.filter((i) => PLACEY.test(i.text)).length >= 2 ? 3 : 0;
      score += withTitle.filter((i) => DATEY.test(i.text)).length >= 2 ? 2 : 0;
      if (NOISE.test(ancestry)) score -= 6;
      // Prefer richer lists, but do not let a 200-row nav menu win on size alone.
      score += Math.min(3, Math.floor(withTitle.length / 5));

      if (score >= 6) {
        candidates.push({ score, count: withTitle.length, signature: sig, items: withTitle });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.count - a.count);
  return candidates.slice(0, 3);
})()`;

export interface RepeatedItem {
  title: string;
  url: string | null;
  text: string;
}

export interface RepeatedCandidate {
  score: number;
  count: number;
  signature: string;
  items: RepeatedItem[];
}

/** Location token pulled out of a card's own text. */
const LOCATION_RE =
  /\b(riyadh|jeddah|dammam|al khobar|khobar|dhahran|jubail|yanbu|makkah|mecca|medina|madinah|tabuk|neom|abha|qassim|hail|jazan|najran|taif|saudi arabia|ksa|remote)\b|الرياض|جده|الدمام|السعوديه/i;

export function locationFromText(text: string): string {
  return text.match(LOCATION_RE)?.[0] ?? "";
}

/**
 * Titles that survive the in-page filter but are still not vacancies - the
 * taxonomy links that made scraping the Saudi job boards useless.
 */
const NOT_A_VACANCY =
  /\b(jobs|vacancies|careers|opportunities)\s*$|^\s*(jobs?|vacancies|careers)\s+(in|at|by|for)\b|\b(view|see|browse|all)\s+(all\s+)?(jobs|openings|vacancies|positions)\b/i;

/**
 * Whether an extracted block is a vacancy.
 *
 * Delegates to the shared judge rather than keeping its own rules. The local
 * version only rejected titles ending in "jobs"/"careers", so a cookie-consent
 * table scored as a perfectly good vacancy list - and because the walker stops
 * once it finds a scoring group, it settled on the cookie table and never tried
 * the "Search jobs" button that leads to the real listing.
 *
 * Fixing it here rather than only downstream is what lets the walk carry on
 * looking: a group that scores zero is not a board.
 */
export function isPlausibleVacancy(title: string, description?: string | null): boolean {
  const t = title.trim();
  if (t.length > 160) return false;
  if (NOT_A_VACANCY.test(t)) return false;
  return isPlausiblePosting(t, description);
}
