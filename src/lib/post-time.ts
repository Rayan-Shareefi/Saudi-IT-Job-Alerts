/**
 * Ordering by when a vacancy was posted - never by when we found it.
 *
 * Shared by the board (Board.tsx) and the digest email (email.ts) so the two
 * always agree. The user's rule (2026-10-20): inside the default order
 * (time-sensitive, recommended, co-op, internship, the rest), "always use
 * time of post"; a job whose site gives no date cannot pass a dated one.
 */

export interface Dated {
  postedAt?: string | null;
  /** A newer posting date of another copy of the same vacancy (a repost). */
  lastRefreshedAt?: string | null;
  firstSeenAt: string;
}

/** When it was posted or reposted; null when no site says. */
export function postTime(j: Dated, now = Date.now()): number | null {
  const candidates: number[] = [];
  for (const d of [j.postedAt, j.lastRefreshedAt]) {
    const t = d ? new Date(d).getTime() : NaN;
    if (Number.isFinite(t) && t <= now + 3_600_000) candidates.push(t);
  }
  return candidates.length ? Math.max(...candidates) : null;
}

/** Newest posting first; undated after every dated one, newest found first among them. */
export function byPostTime(a: Dated, b: Dated): number {
  const pa = postTime(a);
  const pb = postTime(b);
  if (pa !== null && pb !== null) return pb - pa;
  if (pa !== null) return -1;
  if (pb !== null) return 1;
  return new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime();
}
