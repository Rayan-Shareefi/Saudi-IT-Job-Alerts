/**
 * Regression cases for grounding LLM extraction against the page it read.
 *
 * The model is asked to copy titles verbatim from a careers page. Mostly it
 * does. When it does not, the result is a posting that looks entirely real -
 * plausible title, plausible department, a URL that resolves - and no
 * downstream filter can catch it, because every other check asks whether the
 * posting is in Riyadh or technical, not whether it existed.
 *
 *   npm run test:llm
 */
import { appearsInSource, loose } from "../src/lib/adapters/llm";

const PAGE = loose(`
  Careers at Example Co
  Senior Cloud Engineer   Riyadh   Full time
  محلل أمن سيبراني   الرياض
  Co-op Trainee - Information Security   Riyadh
  Network Operations Specialist   Riyadh
`);

const CASES: Array<[string, string, boolean]> = [
  ["exact title", "Senior Cloud Engineer", true],
  ["different case and spacing", "senior   cloud  engineer", true],
  ["Arabic title as written", "محلل أمن سيبراني", true],
  ["title with punctuation the page renders differently", "Co-op Trainee — Information Security", true],
  ["title followed by other cell text", "Network Operations Specialist", true],

  // The ones that matter: plausible, technical, Riyadh-shaped, and invented.
  ["a role the page never mentions", "Senior DevOps Engineer", false],
  ["a plausible variation the page does not contain", "Principal Cloud Architect", false],
  ["assembled from words of two different postings", "Senior Cloud Security Engineer", false],
  ["empty", "", false],
];

let wrong = 0;
for (const [name, title, expected] of CASES) {
  const got = appearsInSource(title, PAGE);
  const ok = got === expected;
  if (!ok) wrong++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(52)} -> ${got}`);
}
console.log(wrong === 0 ? `\nall ${CASES.length} cases correct` : `\n${wrong} case(s) wrong`);
if (wrong > 0) process.exit(1);
