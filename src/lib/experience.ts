import { normalize } from "./text";
import type { ExperienceBand } from "./types";

/**
 * Years of experience a posting asks for, with the sentence that says so.
 *
 * Replaces the first-match-wins regexes in classify.ts, which measured badly
 * against the live board on 2026-10-13:
 *
 *  - "at least two (2) years", "3 years of professional experience",
 *    "3 years' experience", "Years of Experience: 3", "between 2 and 3 years",
 *    Arabic-Indic digits and "سنتين" never matched at all;
 *  - every Arabic alternative containing ى was dead, because normalize() turns
 *    ى into ي before the pattern ever sees the text;
 *  - the first number anywhere won, so "serving clients for over 25 years"
 *    in the company blurb outranked "2+ years of experience" further down;
 *  - "Senior" / "Manager" in the title were stored as min 6 / min 10 exactly
 *    as if the posting had said so.
 *
 * Now every candidate in the text is collected, the ones that are not about
 * the applicant (company history, age, contract or programme length, degree
 * length) are thrown away, required beats preferred, and the largest required
 * minimum wins. Seniority words only ever produce a hint, never a number.
 */

export type ExperienceSource = "programme" | "stated" | "none";
export type SeniorityHint = "junior" | "senior" | null;

export interface ExperienceResult {
  band: ExperienceBand;
  minYears: number | null;
  maxYears: number | null;
  source: ExperienceSource;
  /** The sentence the answer came from, verbatim from the posting. */
  evidence: string | null;
  /** True when the only stated years were "preferred" / "a plus". */
  preferredOnly: boolean;
  seniorityHint: SeniorityHint;
}

/* -------------------------------------------------------------------------- */
/* programmes                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Co-op (التدريب التعاوني) and internships are formal, separate intakes in
 * Saudi Arabia, so they are their own bands and outrank any number.
 *
 * In the title they are decisive. In the body they are only trusted in phrases
 * that describe *this* posting ("this internship", "co-op students") - a
 * normal job whose benefits section mentions "our summer internship program"
 * used to be filed as an internship.
 */
const COOP_TITLE = /\b(co-?op|co op|cooperative (training|education|program))\b|تدريب تعاوني|التدريب التعاوني|متدرب تعاوني/;
const INTERN_TITLE = /\b(intern|interns|internship|trainee|traineeship|apprentice|apprenticeship|summer training|tamheer)\b|تدريب صيفي|التدريب الصيفي|متدرب|متدربه|تمهير/;
const COOP_BODY = /\b(this co-?op|co-?op (students?|trainees?|placement|opportunity)|cooperative training (program|opportunity|students?)|employment type: ?co-?op)\b|طلاب التدريب التعاوني|فرصه تدريب تعاوني/;
const INTERN_BODY = /\b(this internship|internship (opportunity|position|role)|we are looking for (an? )?interns?|employment type: ?internship|seniority level: ?internship)\b|فرصه تدريب صيفي/;

/** "Graduate programme", "fresh graduates" - entry level, but a real job. */
const ENTRY_PHRASE = /\b(fresh graduates?|new grads?|recent graduates?|graduate (development )?program(me)?|entry[- ]level|no (prior |previous )?experience (is )?required|0 ?yrs)\b|حديثي التخرج|خريجين جدد|بدون خبره/;

/* -------------------------------------------------------------------------- */
/* seniority                                                                   */
/* -------------------------------------------------------------------------- */

const SENIOR_TITLE = /\b(senior|sr\.?|lead|principal|manager|head of|director|chief|vp|vice president|expert|architect)\b|مدير|رئيس قسم|(^|\s)اول($|\s)/;
const JUNIOR_TITLE = /\b(junior|jr\.?|graduate|entry[- ]level|trainee)\b|مبتدئ|خريج/;
// "Associate" alone is junior; "Senior Associate" and "Associate Director" are not.
const ASSOCIATE_JUNIOR = /\bassociate\b(?! (director|partner|vice|manager))/;

export function seniorityOf(title: string): SeniorityHint {
  const t = normalize(title);
  if (SENIOR_TITLE.test(t)) return "senior";
  if (JUNIOR_TITLE.test(t) || ASSOCIATE_JUNIOR.test(t)) return "junior";
  return null;
}

/* -------------------------------------------------------------------------- */
/* text preparation                                                            */
/* -------------------------------------------------------------------------- */

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};

// Arabic number words as normalize() leaves them (ة -> ه, أ -> ا).
const ARABIC_NUMBERS: Array<[RegExp, string]> = [
  [/(^|\s)(ثلاث|ثلاثه)(?=\s)/g, "$13"],
  [/(^|\s)(اربع|اربعه)(?=\s)/g, "$14"],
  [/(^|\s)(خمس|خمسه)(?=\s)/g, "$15"],
  [/(^|\s)(ست|سته)(?=\s)/g, "$16"],
  [/(^|\s)(سبع|سبعه)(?=\s)/g, "$17"],
  [/(^|\s)(ثمان|ثماني|ثمانيه)(?=\s)/g, "$18"],
  [/(^|\s)(تسع|تسعه)(?=\s)/g, "$19"],
  [/(^|\s)(عشر|عشره)(?=\s)/g, "$110"],
];

/**
 * Lower-case, Arabic-normalised text with every "year" spelled `yrs` and every
 * number written as digits, so one set of patterns covers both languages.
 */
export function prepare(text: string): string {
  let s = normalize(text)
    // Arabic-Indic and Persian digits
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[’'`]/g, "'")
    // "years' experience", "year's experience"
    .replace(/\b(years?|yrs?)'s?/g, "$1");

  // Arabic duals and "one year" before the generic year word is rewritten.
  s = s
    .replace(/سنتين|سنتان|عامين|عامان/g, " 2 yrs ")
    .replace(/(سنه|عام) واحد(ه)?/g, " 1 yrs ");
  s = s.replace(/\b(years?|yrs?)'?s?\b|(^|\s)(سنوات|سنه|سنين|اعوام|عام)(?=\s|$|[.,،:;)])/g, (m, en, pre) =>
    en ? " yrs " : `${pre ?? ""} yrs `,
  );
  for (const [re, rep] of ARABIC_NUMBERS) s = s.replace(re, rep);
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b/g,
    (w) => String(WORD_NUMBERS[w]),
  );
  return (
    s
      // "two (2)" -> "2 (2)" -> "2"
      .replace(/\b(\d{1,2})\s*\(\s*\1\s*\)/g, "$1")
      // "(2-3) years", "(3+) years"
      .replace(/\(\s*(\d{1,2}(?:\s*[-–—~]\s*\d{1,2})?\s*\+?)\s*\)/g, " $1 ")
      // "3-years", "3-yrs"
      .replace(/\b(\d{1,2})\s*-\s*yrs\b/g, "$1 yrs")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/* -------------------------------------------------------------------------- */
/* candidates                                                                  */
/* -------------------------------------------------------------------------- */

interface Candidate {
  min: number;
  max: number | null;
  index: number;
  length: number;
  preferred: boolean;
  /** Within an "X with a bachelor's OR Y with a master's" sentence. */
  sentence: number;
}

// Each pattern yields [min] or [min, max]. Written as literals per pattern so
// a shell heredoc can never strip the escapes (HANDOVER §5.4).
const PATTERNS: Array<{ re: RegExp; kind: "range" | "min" }> = [
  // 2-3 yrs, 2 to 3 yrs, 2~3 yrs, من 2 الي 3 yrs (normalize() writes إلى as الي)
  { re: /(?:من\s*)?(\d{1,2})\s*(?:-|–|—|~|to|الي|او)\s*(\d{1,2})\s*\+?\s*yrs/g, kind: "range" },
  // between 2 and 3 yrs, بين 2 و 3 yrs
  { re: /(?:between|بين)\s*(\d{1,2})\s*(?:and|&|و)\s*(\d{1,2})\s*yrs/g, kind: "range" },
  // yrs of experience: 2-3 / experience: 2 - 3 yrs
  { re: /(?:yrs of experience|experience(?: required)?|خبره)\s*[:\-–]?\s*(\d{1,2})\s*(?:-|–|—|~|to|الي)\s*(\d{1,2})/g, kind: "range" },
  // at least 3 yrs, minimum (of) 3, no/not less than 3, more than 3, لا تقل عن 3, على الاقل 3
  {
    re: /(?:at least|at minimum|minimum(?: of)?|min\.?|no less than|not less than|more than|over|لا تقل عن|لا يقل عن|علي الاقل|اكثر من)\s*(\d{1,2})\s*\+?\s*yrs/g,
    kind: "min",
  },
  // 3+ yrs, 3 + yrs
  { re: /(\d{1,2})\s*\+\s*yrs/g, kind: "min" },
  // 3 yrs or more / and above / فاكثر / plus
  { re: /(\d{1,2})\s*yrs\s*(?:or more|or above|and above|and more|plus|فاكثر|فما فوق|او اكثر)/g, kind: "min" },
  // 3 or more yrs
  { re: /(\d{1,2})\s*(?:or more|او اكثر)\s*yrs/g, kind: "min" },
  // Years of experience: 3 / experience (required): 3 yrs / خبره 3 yrs
  { re: /(?:yrs of (?:relevant |professional |work |working )?experience|experience(?: required| level)?|خبره)\s*[:\-–]?\s*(?:of\s*)?(\d{1,2})\b(?!\s*(?:-|–|to|~)\s*\d)/g, kind: "min" },
  // 3 yrs (of) [up to four words] experience / exp / خبره
  {
    re: /(\d{1,2})\s*yrs\s*(?:of\s*)?(?:[a-z؀-ۿ/&+-]+\s+){0,4}?(?:experience|exp\b|خبره|الخبره)/g,
    kind: "min",
  },
  // 3 yrs in/working in/as a [role] - accepted only with an anchor nearby
  { re: /(\d{1,2})\s*yrs\s*(?:working\s*)?(?:in|as|with|within|of)\s/g, kind: "min" },
];

/** Words that tie a number to the applicant's career. */
const ANCHOR = /experience|\bexp\b|work|working|professional|industry|background|role|position|hands-on|track record|خبره|الخبره|العمل|مجال/;

/**
 * Numbers that are about something other than the applicant.
 *
 * Checked in narrow places, not across the sentence: flattened bullet lists
 * put "founded in 1990", "Bachelor's degree" and "3+ years of experience" in
 * one run-on "sentence", and a sentence-wide test threw away real requirements.
 *
 *  - right after the number: "4-year degree", "2-year contract", "25 years old"
 *  - just before it, with nothing addressing the applicant: "a leading provider
 *    with over 25 years of experience", "founded 30 years ago", "aged 25-35"
 */
const AFTER_NOT_APPLICANT =
  /^\s*(old|of age|contract|degree|bachelor|program|programme|course|study|studies|of study|warranty|guarantee|lease|ago|من العمر|عقد|دراسه)/;
const BEFORE_NOT_APPLICANT =
  /\b(founded|established|since|history|heritage|legacy|serving|decades|anniversary|we|our|company|firm|leading|leader|provider|pioneer|boasts?|aged?|age|within|every|per|vision)\b|تاسست|منذ|العمر|عمر|شركتنا|نحن/;
const ADDRESSES_APPLICANT =
  /\b(you|your|candidate|applicant|must|require|required|requires|requirements?|minimum|qualifications?|need|needs|should|ideal|looking for|seeking|someone|hire)\b|يجب|المتقدم|المرشح|متطلبات|المؤهلات|نبحث/;

const PREFERRED = /\b(preferred|preferably|is a plus|a plus|nice to have|desirable|desired|an advantage|advantageous|ideally|bonus)\b|يفضل|ميزه/;
const ALTERNATIVES = /\bor\b|او/;
const DEGREE = /\b(bachelor|master|phd|doctorate|diploma|degree)\b|بكالوريوس|ماجستير|دبلوم|دكتوراه/;

function windowAround(s: string, index: number, length: number, radius: number): string {
  return s.slice(Math.max(0, index - radius), Math.min(s.length, index + length + radius));
}

function sentenceIndexAt(bounds: number[], index: number): number {
  let i = 0;
  while (i + 1 < bounds.length && bounds[i + 1] <= index) i++;
  return i;
}

function candidates(prepared: string): Candidate[] {
  // Sentence starts, for the "or" rule and for evidence.
  const bounds = [0];
  for (const m of prepared.matchAll(/[.!?؟;•·|]\s+|\s[-–]\s(?=[a-z؀-ۿ])/g)) {
    bounds.push((m.index ?? 0) + m[0].length);
  }

  const out: Candidate[] = [];
  const taken: Array<[number, number]> = [];
  for (const { re, kind } of PATTERNS) {
    for (const m of prepared.matchAll(re)) {
      const index = m.index ?? 0;
      const length = m[0].length;
      // A later, looser pattern must not re-read the digits a range already took.
      if (taken.some(([a, b]) => index < b && index + length > a)) continue;

      const near = windowAround(prepared, index, length, 70);
      // Context stops at the sentence edge: "aged 22-30. 1-2 years experience"
      // and "2+ years required. 5 years preferred." are two statements each.
      const si = sentenceIndexAt(bounds, index);
      const sentenceStart = bounds[si];
      const sentenceEnd = bounds[si + 1] ?? prepared.length;
      const before = prepared.slice(Math.max(sentenceStart, index - 40), index);
      const after = prepared.slice(index + length, index + length + 25);
      if (AFTER_NOT_APPLICANT.test(after)) continue;
      if (BEFORE_NOT_APPLICANT.test(before) && !ADDRESSES_APPLICANT.test(before)) continue;
      const looseInOf = re === PATTERNS[PATTERNS.length - 1].re;
      if (looseInOf && !ANCHOR.test(near)) continue;

      const lo = Number(m[1]);
      const hi = kind === "range" ? Number(m[2]) : null;
      if (!Number.isFinite(lo) || lo > 30) continue;
      if (hi !== null && (hi < lo || hi > 40)) continue;
      // A very large number is far more often company history than a
      // requirement; accept it only when the text plainly addresses the
      // applicant, since it would hide the job.
      if (lo >= 16 && !ADDRESSES_APPLICANT.test(windowAround(prepared, index, length, 80))) continue;
      // "over 2 years" / "more than 2 years" asks for more than two - but the
      // posting means "2+", and treating it as 3 would hide 2-year roles.
      out.push({
        min: lo,
        max: hi,
        index,
        length,
        preferred: PREFERRED.test(
          prepared.slice(Math.max(sentenceStart, index - 60), Math.min(sentenceEnd, index + length + 60)),
        ),
        sentence: si,
      });
      taken.push([index, index + length]);
    }
  }
  return out;
}

/** Collapse "5 yrs with a bachelor's or 3 with a master's" to the easier path. */
function resolve(cands: Candidate[], prepared: string): Candidate | null {
  if (cands.length === 0) return null;
  const bySentence = new Map<number, Candidate[]>();
  for (const c of cands) bySentence.set(c.sentence, [...(bySentence.get(c.sentence) ?? []), c]);

  const perSentence: Candidate[] = [];
  for (const group of bySentence.values()) {
    if (group.length > 1) {
      const first = Math.min(...group.map((g) => g.index));
      const last = Math.max(...group.map((g) => g.index + g.length));
      const span = prepared.slice(first, last + 60);
      if (ALTERNATIVES.test(span) && DEGREE.test(span)) {
        perSentence.push(group.reduce((a, b) => (b.min < a.min ? b : a)));
        continue;
      }
    }
    perSentence.push(...group);
  }

  const required = perSentence.filter((c) => !c.preferred);
  const pool = required.length > 0 ? required : perSentence;
  // The largest required minimum: "5+ years, including 2 in cloud" asks for 5.
  return pool.reduce((a, b) => (b.min > a.min ? b : a));
}

/* -------------------------------------------------------------------------- */
/* evidence                                                                    */
/* -------------------------------------------------------------------------- */

/** Original-text chunks: sentences, bullets, lines. */
function chunks(original: string): string[] {
  return original
    .split(/(?<=[.!?؟;])\s+|\n+|\s*[•·|]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** The number as a posting might write it: 3, ٣, ۳, three, ثلاث. */
function numberForms(n: number): RegExp {
  const arabicIndic = String(n).replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
  const persian = String(n).replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
  const word = Object.entries(WORD_NUMBERS).find(([, v]) => v === n)?.[0];
  const parts = [`(?<![0-9])${n}(?![0-9])`, arabicIndic, persian];
  if (word) parts.push(`\\b${word}\\b`);
  if (n === 2) parts.push("سنتين", "سنتان", "عامين");
  return new RegExp(parts.join("|"), "i");
}

/** A window of `text` centred on `index`, cut at word boundaries. */
function excerpt(text: string, index: number, radius = 110): string {
  if (text.length <= radius * 2) return text;
  let start = Math.max(0, index - radius);
  let end = Math.min(text.length, index + radius);
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return `${start > 0 ? "..." : ""}${text.slice(start, end).trim()}${end < text.length ? "..." : ""}`;
}

/**
 * The words of the posting that state the requirement, verbatim.
 *
 * Found by re-running the extractor on each original chunk and keeping the one
 * that yields the same answer - not by searching for the digit, which matched
 * "بشكل عام" ("in general", where عام also means "year") in a run-on Arabic
 * page and quoted a sentence that said nothing about experience. Long chunks
 * (flattened pages) are cut to a window around the number. Null rather than a
 * quote the posting did not say.
 */
function evidenceFor(original: string, c: Candidate): string | null {
  for (const chunk of chunks(original)) {
    const p = prepare(chunk);
    const found = candidates(p).some((x) => x.min === c.min && x.max === c.max);
    if (!found) continue;
    const at = chunk.search(numberForms(c.min));
    return excerpt(chunk, at >= 0 ? at : 0);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* entry point                                                                 */
/* -------------------------------------------------------------------------- */

export function bandFor(min: number): ExperienceBand {
  if (min <= 0) return "0";
  if (min <= 2) return "1-2";
  if (min <= 5) return "3-5";
  if (min <= 9) return "6-9";
  return "10+";
}

function firstSentenceMatching(original: string, re: RegExp): string | null {
  const s = original
    .split(/(?<=[.!?؟;])\s+|\n+|\s*[•·|]\s*/)
    .map((x) => x.trim())
    .find((x) => re.test(normalize(x)));
  if (!s) return null;
  return s.length <= 220 ? s : `${s.slice(0, 217)}...`;
}

export function detectExperience(title: string, body: string): ExperienceResult {
  const t = normalize(title);
  const prepared = prepare(body);
  const hint = seniorityOf(title);
  const stated = resolve(candidates(prepared), prepared);
  const statedRequired = stated && !stated.preferred ? stated : null;

  // Programmes first: an internship asking for "0-1 years" is still an
  // internship, and that is the filter that matters to a student.
  if (COOP_TITLE.test(t)) {
    return { band: "coop", minYears: 0, maxYears: 0, source: "programme", evidence: title, preferredOnly: false, seniorityHint: hint };
  }
  if (INTERN_TITLE.test(t)) {
    return { band: "internship", minYears: 0, maxYears: 1, source: "programme", evidence: title, preferredOnly: false, seniorityHint: hint };
  }
  // Body-only programme wording counts only when no real requirement says
  // otherwise - a 3-year role that mentions "co-op students" is not a co-op.
  if (!statedRequired || statedRequired.min === 0) {
    if (COOP_BODY.test(normalize(body))) {
      return { band: "coop", minYears: 0, maxYears: 0, source: "programme", evidence: firstSentenceMatching(body, COOP_BODY), preferredOnly: false, seniorityHint: hint };
    }
    if (INTERN_BODY.test(normalize(body))) {
      return { band: "internship", minYears: 0, maxYears: 1, source: "programme", evidence: firstSentenceMatching(body, INTERN_BODY), preferredOnly: false, seniorityHint: hint };
    }
  }

  if (stated) {
    return {
      band: bandFor(stated.min),
      minYears: stated.min,
      maxYears: stated.max,
      source: "stated",
      evidence: evidenceFor(body, stated),
      preferredOnly: stated.preferred,
      seniorityHint: hint,
    };
  }

  // No number anywhere. Entry wording is a statement too ("fresh graduates
  // welcome"); seniority words are not, and stay a hint.
  const entry = ENTRY_PHRASE.test(normalize(`${title} ${body}`));
  if (entry && hint !== "senior") {
    return {
      band: "0",
      minYears: 0,
      maxYears: null,
      source: "stated",
      evidence: firstSentenceMatching(`${title}. ${body}`, ENTRY_PHRASE),
      preferredOnly: false,
      seniorityHint: hint,
    };
  }

  return { band: "unknown", minYears: null, maxYears: null, source: "none", evidence: null, preferredOnly: false, seniorityHint: hint };
}
