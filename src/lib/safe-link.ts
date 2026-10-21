/**
 * A link a visitor may open: http(s) or mailto only.
 *
 * Links come from hundreds of scraped pages, and the board opens them on its
 * own site - a "javascript:" link would run with the board's storage, where
 * the write key lives (security review, 2026-10-22). Used where links are
 * stored (classify.ts) and again where they are opened (Board.tsx), so an old
 * row or a new adapter cannot slip one through. No imports: browser code
 * uses it.
 */
export function safeLink(url: string | null | undefined): string | null {
  const u = url?.trim();
  return u && /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}
