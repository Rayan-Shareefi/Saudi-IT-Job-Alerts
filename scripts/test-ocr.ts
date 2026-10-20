/**
 * Reading the text in a hiring-post picture.
 *
 *   npm run test:ocr
 *
 * Draws a typical announcement graphic (English and Arabic) in a headless
 * browser, then reads it back with the same OCR the LinkedIn posts reader
 * uses. Needs the OCR language data, downloaded once (~15 MB) on first run.
 */
import { imageText, stopOcr } from "../src/lib/ocr";

let total = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  total++;
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    await page.setContent(`
      <html><body style="margin:0;background:#0b3d91;color:#fff;font-family:Arial,sans-serif">
        <div style="padding:50px">
          <div style="font-size:54px;font-weight:700">WE ARE HIRING</div>
          <div style="font-size:40px;margin-top:20px">Cybersecurity Co-op Program</div>
          <div style="font-size:30px;margin-top:16px">SOC Analyst Trainee - Riyadh</div>
          <div dir="rtl" style="font-size:44px;margin-top:30px;font-weight:700">برنامج التدريب التعاوني</div>
        </div>
      </body></html>`);
    const picture = await page.screenshot();
    const text = await imageText(picture);
    check("text found in the picture", text !== null);
    const t = (text ?? "").toLowerCase();
    check("English announcement read", /hiring/.test(t) && /co-?op/.test(t), JSON.stringify(text?.slice(0, 200)));
    check("role and city read", /soc/.test(t) && /riyadh/.test(t), JSON.stringify(text?.slice(0, 200)));
    // Tesseract splits joined Arabic letters at times ("التعاوا ني" for
    // "التعاوني", 2026-10-20): the words it reads reliably are checked.
    check("Arabic announcement read", /برنامج/.test(text ?? "") && /التدريب/.test(text ?? ""), JSON.stringify(text?.slice(0, 200)));
    check("no direction marks left in the text", !/[‎‏]/.test(text ?? ""));

    // A photo with no words: nothing invented.
    await page.setContent(`<html><body style="margin:0;background:linear-gradient(135deg,#888,#ccc,#555)"></body></html>`);
    check("a picture without words -> no text", (await imageText(await page.screenshot())) === null);
  } finally {
    await browser.close();
    await stopOcr();
  }
  console.log(`ocr: ${total - failures}/${total} correct`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
