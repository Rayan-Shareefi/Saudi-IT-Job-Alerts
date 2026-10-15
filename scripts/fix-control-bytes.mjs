/**
 * Repairs regex word-boundary escapes that were flattened into control bytes.
 *
 * `\b` written into a file through a shell or heredoc that interprets escapes
 * arrives as a literal backspace (0x08). The file still compiles and still
 * runs; the regex just silently stops matching word boundaries. `npm run
 * verify` detects it, and this puts it back.
 *
 *   node scripts/fix-control-bytes.mjs        # report
 *   node scripts/fix-control-bytes.mjs --fix  # repair
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIX = process.argv.includes("--fix");
const BACKSPACE = String.fromCharCode(8);

/** Codes that legitimately appear in source: tab, newline, carriage return. */
const ALLOWED = new Set([9, 10, 13]);

function offendingLines(text) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const ch of line) {
      const c = ch.charCodeAt(0);
      if (c < 32 && !ALLOWED.has(c)) {
        out.push({ line: i + 1, code: c });
        break;
      }
    }
  });
  return out;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|css|mjs)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

let touched = 0;
for (const file of [...walk("src"), ...walk("scripts")]) {
  const text = readFileSync(file, "utf8");
  const hits = offendingLines(text);
  if (hits.length === 0) continue;

  console.log(`${file}`);
  for (const h of hits) console.log(`  line ${h.line}: control code ${h.code}`);

  if (FIX) {
    // Only the backspace case is repairable without guessing: it is always a
    // word-boundary escape. Anything else is reported for a human to look at.
    const repaired = text.split(BACKSPACE).join("\\b");
    if (repaired !== text) {
      writeFileSync(file, repaired);
      console.log(`  repaired`);
      touched++;
    }
  }
}

console.log(
  touched > 0
    ? `\nrepaired ${touched} file(s)`
    : FIX
      ? "\nnothing to repair"
      : "\nrun with --fix to repair",
);
