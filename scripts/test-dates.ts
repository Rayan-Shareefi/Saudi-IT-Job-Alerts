/**
 * Relative posting dates, as JSearch and others give them.
 *
 *   npx tsx scripts/test-dates.ts
 *
 * The first cases are the real values JSearch returned on 2026-10-20.
 */
import { byPostTime } from "../src/lib/post-time";
import { relativeToIso } from "../src/lib/relative-date";

let total = 0;
let failures = 0;
const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 86_400_000;

function days(text: string, want: number | null): void {
  total++;
  const iso = relativeToIso(text, NOW);
  const got = iso === null ? null : Math.round((NOW - Date.parse(iso)) / DAY * 10) / 10;
  if (got !== want) {
    failures++;
    console.log(`FAIL "${text}": wanted ${want} days, got ${got}`);
  }
}

// Real JSearch values (Arabic, Arabic-Indic digits).
days("قبل ١٥ يومًا", 15);
days("قبل ٢٤ يومًا", 24);
// English, as JSearch gives with language=en.
days("4 days ago", 4);
days("2 days ago", 2);
days("30+ days ago", 30);
days("a day ago", 1);
days("1 week ago", 7);
days("2 weeks ago", 14);
days("1 month ago", 30);
days("Today", 0);
days("Just now", 0);
days("yesterday", 1);
days("5 hours ago", 0.2);
// Arabic forms: singular, dual, plural.
days("قبل يوم", 1);
days("قبل يومين", 2);
days("قبل ٣ أيام", 3);
days("منذ أسبوع", 7);
days("قبل أسبوعين", 14);
days("قبل شهر", 30);
days("قبل شهرين", 60);
days("قبل ساعتين", 0.1);
days("اليوم", 0);
days("أمس", 1);
// Not dates: unknown, never guessed.
days("", null);
days("Full-time", null);
days("Riyadh, Saudi Arabia", null);
days("الرياض", null);

// Ordering by time of post (post-time.ts). The user's case, 2026-10-20: two
// co-op jobs must be ordered by when they were posted, not when we found them.
{
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
  const job = (name: string, posted: number | null, found: number, reposted: number | null = null) => ({
    name,
    postedAt: posted === null ? null : iso(posted),
    lastRefreshedAt: reposted === null ? null : iso(reposted),
    firstSeenAt: iso(found),
  });
  const order = (...jobs: ReturnType<typeof job>[]) => [...jobs].sort(byPostTime).map((j) => j.name).join(",");
  const check = (name: string, got: string, want: string) => {
    total++;
    if (got !== want) {
      failures++;
      console.log(`FAIL ${name}: wanted ${want}, got ${got}`);
    }
  };
  // Found in the opposite order to the one they were posted in.
  check("posted 1 day ago beats posted 5 days ago, whenever found", order(job("old", 5, 0), job("new", 1, 4)), "new,old");
  check("a repost counts as posted then", order(job("plain", 3, 3), job("reposted", 20, 20, 1)), "reposted,plain");
  check("an undated job never passes a dated one", order(job("undated-found-today", null, 0), job("dated-25-days", 25, 25)), "dated-25-days,undated-found-today");
  check("undated jobs among themselves: newest found first", order(job("u-old", null, 9), job("u-new", null, 2)), "u-new,u-old");
  check("a date in the future is not trusted", order(job("future", -5, 1), job("today", 0, 1)), "today,future");
}

console.log(`dates: ${total - failures}/${total} correct`);
if (failures > 0) process.exit(1);
