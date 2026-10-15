/**
 * Turns a CV file into plain text, in the browser.
 *
 * Browser-only on purpose. A CV carries your name, phone number, address and
 * full history; there is no reason for this app to hold a copy on a server to
 * tell you which postings look relevant. Nothing here touches the network - the
 * file is read with FileReader, parsed in the tab, and only the derived profile
 * (skills, a seniority band) is kept, in localStorage.
 *
 * Both parsers are dynamically imported so their weight is only downloaded when
 * someone actually uploads a CV.
 */

export type ResumeFileKind = "pdf" | "docx" | "text";

export function kindOf(file: File): ResumeFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) return "text";
  // .doc is the old binary Word format. Saying so plainly beats returning
  // mojibake and letting the matcher score against gibberish.
  if (name.endsWith(".doc")) return null;
  return null;
}

async function readPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Webpack/Turbopack resolve this to a bundled asset URL; without it pdf.js
  // tries to fetch a worker from a path that does not exist in the build.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  const pages: string[] = [];
  // A CV longer than 12 pages is a portfolio; reading the rest adds nothing to
  // the skill match and makes a slow file slower.
  const limit = Math.min(doc.numPages, 12);
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  await doc.cleanup();
  return pages.join("\n");
}

async function readDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value;
}

export async function extractResumeText(file: File): Promise<string> {
  const kind = kindOf(file);
  if (!kind) {
    throw new Error(
      "Unsupported file. Save your CV as PDF or .docx — the old binary .doc format cannot be read reliably.",
    );
  }
  if (kind === "pdf") return readPdf(file);
  if (kind === "docx") return readDocx(file);
  return file.text();
}
