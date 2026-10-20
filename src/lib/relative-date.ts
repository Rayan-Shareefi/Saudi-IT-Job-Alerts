/**
 * "4 days ago", "قبل ١٥ يومًا", "منذ ساعتين", "Today" -> an ISO time, or null.
 *
 * JSearch gives a posting's date only this way for many results: asked in
 * Arabic (Saudi results), job_posted_at was "قبل ١٥ يومًا" with no exact
 * date at all (2026-10-20), so every JSearch posting was stored undated and
 * sorted by when it was found instead of when it was posted.
 *
 * A month is counted as 30 days; "30+ days ago" as 30. Anything not
 * recognised is null - an unknown date, never a guessed one.
 */

const UNIT_MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
} as const;
type Unit = keyof typeof UNIT_MS;

/** Arabic-Indic and Persian digits as ASCII. */
function asciiDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

const ENGLISH_UNIT: Record<string, Unit> = { minute: "minute", min: "minute", hour: "hour", hr: "hour", day: "day", week: "week", month: "month" };

/*
 * Arabic units: singular, dual and plural forms. The dual ("ساعتين", two
 * hours) carries its own number; a bare singular ("قبل يوم") means one.
 */
const ARABIC: Array<{ re: RegExp; unit: Unit; dual: boolean }> = [
  { re: /دقيقتين|دقيقتان/, unit: "minute", dual: true },
  { re: /دقيقة|دقائق/, unit: "minute", dual: false },
  { re: /ساعتين|ساعتان/, unit: "hour", dual: true },
  { re: /ساعة|ساعات/, unit: "hour", dual: false },
  { re: /يومين|يومان/, unit: "day", dual: true },
  { re: /يوم|أيام|ايام/, unit: "day", dual: false },
  { re: /أسبوعين|اسبوعين|أسبوعان/, unit: "week", dual: true },
  { re: /أسبوع|اسبوع|أسابيع|اسابيع/, unit: "week", dual: false },
  { re: /شهرين|شهران/, unit: "month", dual: true },
  { re: /شهر|أشهر|اشهر|شهور/, unit: "month", dual: false },
];

export function relativeToIso(text: string | null | undefined, now = Date.now()): string | null {
  if (!text) return null;
  const s = asciiDigits(String(text)).trim().toLowerCase();
  if (!s) return null;
  const at = (ms: number) => new Date(now - ms).toISOString();

  if (/^(just now|today|now)\b|اليوم|الآن|للتو/.test(s)) return at(0);
  if (/^yesterday\b|أمس|البارحة/.test(s)) return at(UNIT_MS.day);

  const en = s.match(/(\d+|an?|one)\+?\s*(minute|min|hour|hr|day|week|month)s?\s+ago/);
  if (en) {
    const n = /^\d+$/.test(en[1]) ? Number(en[1]) : 1;
    return at(n * UNIT_MS[ENGLISH_UNIT[en[2]]]);
  }

  if (/قبل|منذ/.test(s)) {
    for (const { re, unit, dual } of ARABIC) {
      if (!re.test(s)) continue;
      const n = dual ? 2 : Number(s.match(/(\d+)/)?.[1] ?? 1);
      return at(n * UNIT_MS[unit]);
    }
  }
  return null;
}
