/**
 * Text normalisation shared by every judgement module.
 *
 * Lives on its own so experience.ts, scope.ts and classify.ts can all use it
 * without importing each other.
 */

/** Arabic diacritics + tatweel, stripped so keyword matching survives styling. */
const ARABIC_NOISE = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalize(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(ARABIC_NOISE, "")
    .replace(/[آأإٱ]/g, "ا") // alef variants -> alef
    .replace(/ة/g, "ه") // teh marbuta -> heh
    .replace(/ى/g, "ي") // alef maksura -> yeh
    .replace(/[​-‏‪-‮]/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** Word-boundary aware match that also works for Arabic (no \b support there). */
export function hasTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  if (/[؀-ۿ]/.test(term)) return haystack.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, "i").test(haystack);
}

