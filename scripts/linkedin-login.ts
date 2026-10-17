/**
 * Sign the laptop's saved LinkedIn session in - once, by hand.
 *
 *   npm run linkedin:login
 *
 * Opens a visible browser window with the profile the hiring-posts reader
 * uses (.linkedin-profile). Sign in to the SECONDARY account there, complete
 * any verification LinkedIn asks for, and wait until the feed loads; the
 * window closes by itself and the session is kept for later runs.
 *
 * If LINKEDIN_EMAIL / LINKEDIN_PASSWORD are in .env.local they are typed in
 * for you; a verification code or CAPTCHA is always left to you.
 */
import "./load-env";
import { chromium } from "playwright";
import { PROFILE_DIR } from "../src/lib/adapters/linkedin-posts";
import { envStr } from "../src/lib/env";

async function main(): Promise<void> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 1200, height: 900 } });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });

  const email = envStr("LINKEDIN_EMAIL");
  const password = envStr("LINKEDIN_PASSWORD");
  if (email && password && (await page.locator("#username").count()) > 0) {
    await page.fill("#username", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
  }

  console.log("Finish signing in in the browser window (complete any verification). Waiting up to 10 minutes...");
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    if (/linkedin\.com\/feed/.test(page.url())) {
      console.log("Signed in. The session is saved for the hiring-posts reader.");
      await page.waitForTimeout(3000);
      await context.close();
      return;
    }
    await page.waitForTimeout(2000);
  }
  console.log("Timed out waiting for the feed. Run this again when ready.");
  await context.close();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
