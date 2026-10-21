import { timingSafeEqual } from "node:crypto";

/**
 * The key that authorises write actions from the browser.
 *
 * One definition, because the two routes that need it got it subtly wrong in
 * the same way: they read
 *
 *   process.env.REMOVAL_SECRET ?? process.env.CRON_SECRET
 *
 * and `??` only falls back on null or undefined. An empty `REMOVAL_SECRET=`
 * left in place from the example file is a perfectly good string, so it
 * shadowed a valid CRON_SECRET and every request came back "not authorised" -
 * a blank variable silently disabling the feature with a misleading message.
 */
function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * A key shorter than this is treated as not set: the site is public and the
 * key is the only lock on every write, so a short one could be guessed.
 */
const MIN_KEY_LENGTH = 16;

/** The configured key, or null when neither variable carries a real, long-enough value. */
export function writeSecret(): string | null {
  const key = firstNonEmpty(process.env.REMOVAL_SECRET, process.env.CRON_SECRET);
  return key && key.length >= MIN_KEY_LENGTH ? key : null;
}

/** Equal, in time that does not depend on where they differ. */
function sameKey(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The scheduled routes (/api/cron/*): `Authorization: Bearer <CRON_SECRET>`
 * only. They also took `?secret=` in the address, which ends up in server
 * logs and browser history - and that secret is the website's write key too
 * (security review, 2026-10-22).
 */
export function cronAuthorised(req: Request): boolean {
  const secret = firstNonEmpty(process.env.CRON_SECRET);
  if (!secret || secret.length < MIN_KEY_LENGTH) return false;
  const header = req.headers.get("authorization") ?? "";
  return sameKey(header.startsWith("Bearer ") ? header.slice(7).trim() : null, secret);
}

/**
 * Whether a request carries the right key.
 *
 * Returns false when nothing is configured: an app that defaults to open
 * because a variable was missing is worse than one that refuses until it is
 * set. Callers report that case as 503 rather than 401, so the difference
 * between "wrong key" and "not set up" stays visible.
 */
export function isAuthorised(req: Request): boolean {
  const secret = writeSecret();
  if (!secret) return false;
  return sameKey(req.headers.get("x-removal-secret")?.trim(), secret);
}
