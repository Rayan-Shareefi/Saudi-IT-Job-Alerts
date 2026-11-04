/**
 * Relative posting dates, as JSearch and others give them.
 *
 *   npx tsx scripts/test-dates.ts
 *
 * The first cases are the real values JSearch returned on 2026-10-20.
 */
import { byPostTime } from "../src/lib/post-time";
import { relativeToIso } from "../src/lib/relative-date";
import { deadlineEnd } from "../src/lib/deadline";
import { detectClosingDate } from "../src/lib/classify";

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

/*
 * A deadline given as a date lasts the whole of that day in Riyadh. "Closes 4
 * November" was stored as its first minute, and an Elm co-op announcement
 * left the board at the start of its last day (2026-11-04).
 */
{
  const same = (name: string, got: string | null, want: string | null) => {
    total++;
    if (got !== want) {
      failures++;
      console.log(`FAIL ${name}: wanted ${want}, got ${got}`);
    }
  };
  const END_4_NOV = "2026-11-04T20:59:59.000Z"; // 23:59:59 in Riyadh
  same("a date parsed on GitHub (UTC midnight) ends with the day in Riyadh", deadlineEnd("2026-11-04T00:00:00.000Z"), END_4_NOV);
  same("a date parsed on the laptop (Riyadh midnight) ends with the same day", deadlineEnd("2026-11-03T21:00:00.000Z"), END_4_NOV);
  same("a deadline with a time keeps its time", deadlineEnd("2026-11-04T14:30:00.000Z"), "2026-11-04T14:30:00.000Z");
  same("already the end of the day: unchanged", deadlineEnd(END_4_NOV), END_4_NOV);
  same("the last day of a month rolls over correctly", deadlineEnd("2026-11-30T00:00:00.000Z"), "2026-11-30T20:59:59.000Z");
  same("not a date: unchanged", deadlineEnd("soon"), "soon");
  // Through the detector, as every adapter's dates go. Written relative to
  // today so the believable window (6 months back, 18 ahead) always holds.
  const soon = new Date(Date.now() + 10 * DAY);
  const ymd = soon.toISOString().slice(0, 10);
  same("an ISO date in the text lasts its whole day", detectClosingDate(`Application deadline: ${ymd}`), `${ymd}T20:59:59.000Z`);
  same("an explicit date-only deadline lasts its whole day", detectClosingDate("", ymd), `${ymd}T20:59:59.000Z`);
}

console.log(`dates: ${total - failures}/${total} correct`);
if (failures > 0) process.exit(1);
