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

/** The configured key, or null when neither variable carries a real value. */
export function writeSecret(): string | null {
  return firstNonEmpty(process.env.REMOVAL_SECRET, process.env.CRON_SECRET);
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
  return req.headers.get("x-removal-secret")?.trim() === secret;
}
