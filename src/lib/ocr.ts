import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Worker } from "tesseract.js";

/**
 * The text printed inside an image, read by Tesseract - open source, runs on
 * this machine, English and Arabic, free.
 *
 * For LinkedIn hiring posts that are a picture and two sentences: the
 * announcement ("Co-op program", "تدريب تعاوني", the roles, the deadline) is
 * often only in the picture. Plain OCR, not a model: what it returns is what
 * is printed in the image, so the jury's quotes from it are still checked
 * against real text. The language data (~15 MB) downloads once, into
 * data/ocr-cache.
 */

let worker: Promise<Worker> | null = null;

function start(): Promise<Worker> {
  if (!worker) {
    worker = (async () => {
      const cachePath = join(process.cwd(), "data", "ocr-cache");
      mkdirSync(cachePath, { recursive: true });
      const { createWorker } = await import("tesseract.js");
      return createWorker(["eng", "ara"], 1, { cachePath, logger: () => {}, errorHandler: () => {} });
    })();
  }
  return worker;
}

/** The image's text, or null when there is none worth reading (a photo, a logo). */
export async function imageText(image: Buffer): Promise<string | null> {
  try {
    const { data } = await (await start()).recognize(image);
    // Direction marks Tesseract puts around Arabic lines are not text.
    const text = (data.text ?? "")
      .replace(/[‎‏‪-‮]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (data.confidence < 45 || text.replace(/\s/g, "").length < 15) return null;
    return text.slice(0, 3000);
  } catch {
    return null;
  }
}

export async function stopOcr(): Promise<void> {
  if (!worker) return;
  try {
    await (await worker).terminate();
  } catch {
    /* already gone */
  }
  worker = null;
}
