/**
 * Writes a small text-based PDF, so the CV upload path can be exercised end to
 * end against the real pdf.js parser rather than a stub.
 *
 *   node scripts/make-sample-cv.mjs [outfile]
 */
import { writeFileSync } from "node:fs";

const LINES = [
  "Sample Student - Final-year Computer Science student, Riyadh",
  "Expected graduation 2026. Seeking a co-op training placement.",
  "SKILLS: Cybersecurity, SIEM, Splunk, incident response, vulnerability assessment,",
  "Nessus, Wireshark, Python, Linux, AWS, Docker, SQL, threat hunting.",
  "CERTIFICATIONS: CompTIA Security+, AWS Certified Cloud Practitioner",
];

const escape = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

let content = "BT /F1 11 Tf 40 780 Td 14 TL\n";
for (const line of LINES) content += `(${escape(line)}) Tj T*\n`;
content += "ET";

const contentBytes = Buffer.from(content, "latin1");
const objects = [
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
  Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
  Buffer.from(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  ),
  Buffer.concat([
    Buffer.from(`<< /Length ${contentBytes.length} >>\nstream\n`),
    contentBytes,
    Buffer.from("\nendstream"),
  ]),
  Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
];

const chunks = [Buffer.from("%PDF-1.4\n")];
let offset = chunks[0].length;
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(offset);
  const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
  chunks.push(obj);
  offset += obj.length;
});

const xrefAt = offset;
let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
chunks.push(Buffer.from(xref));

const out = process.argv[2] ?? "public/__cv.pdf";
writeFileSync(out, Buffer.concat(chunks));
console.log(`wrote ${out}`);
