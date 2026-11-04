/**
 * A deadline given as a date means the whole of that day, in Riyadh.
 *
 * "Closes 4 November" used to be stored as 4 November 00:00 UTC (parsed on
 * GitHub or Vercel) or as Riyadh midnight, 21:00 UTC on 3 November (parsed on
 * the laptop), so a posting left the board at the very start of its last day:
 * an Elm co-op announcement on Telegram did on 2026-11-04. A date with no
 * time - which parses to one of those two midnights - and an explicit midnight
 * now end at 23:59:59 Riyadh time on that date. Any other time is kept.
 */
const RIYADH_OFFSET_MS = 3 * 3_600_000; // UTC+3 all year: no daylight saving

export function deadlineEnd(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const onTheHour = d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (!onTheHour || (d.getUTCHours() !== 0 && d.getUTCHours() !== 21)) return iso;
  // The calendar date in Riyadh: UTC midnight is 03:00 there, 21:00 UTC is 00:00.
  const day = new Date(t + RIYADH_OFFSET_MS);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59) - RIYADH_OFFSET_MS).toISOString();
}
