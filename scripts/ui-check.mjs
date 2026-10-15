// Headless UI check for the board: tab arrows, badge filter, detail view.
// Usage: node scripts/tmp/ui-check.mjs <outdir>
import { chromium } from "playwright";

const out = process.argv[2] ?? ".";
const browser = await chromium.launch();
const results = {};

async function board(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector("[role=tablist]", { state: "visible", timeout: 120000 });
  return page;
}

// 1. Tab arrows at a width where the tabs overflow.
{
  const page = await board(820);
  const list = page.locator("[role=tablist]");
  const right = page.getByRole("button", { name: "Scroll Board sections right" });
  const left = page.getByRole("button", { name: "Scroll Board sections left" });
  const r = {};
  r.overflow = await list.evaluate((el) => el.scrollWidth - el.clientWidth);
  r.rightShownAtStart = await right.evaluate((b) => getComputedStyle(b).opacity);
  r.leftShownAtStart = await left.evaluate((b) => getComputedStyle(b).opacity);
  for (let i = 0; i < 4; i++) {
    await right.click({ force: true });
    await page.waitForTimeout(600);
  }
  r.scrolledTo = await list.evaluate((el) => el.scrollLeft);
  r.lastTabVisible = await list.evaluate((el) => {
    const last = [...el.querySelectorAll("a")].pop().getBoundingClientRect();
    return last.right <= el.getBoundingClientRect().right + 1;
  });
  r.leftShownAfter = await left.evaluate((b) => getComputedStyle(b).opacity);
  r.rightHiddenAtEnd = await right.evaluate((b) => getComputedStyle(b).opacity);
  r.pageScrollsSideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.screenshot({ path: `${out}/tabs-820-end.png`, clip: { x: 0, y: 0, width: 820, height: 700 } });
  await left.click({ force: true });
  await page.waitForTimeout(600);
  r.afterLeft = await list.evaluate((el) => el.scrollLeft);
  results.tabs = r;
  await page.close();
}

// 2. Badge filter: include, then exclude, then off.
{
  const page = await board(1280);
  const count = async () => Number(await page.locator("[data-testid=job-count] strong").innerText());
  const r = { before: await count() };
  const chip = page.locator("[data-badge=\"focus:Cloud\"]");
  await chip.click();
  await page.waitForTimeout(300);
  r.include = await count();
  r.includeLabel = await chip.innerText();
  await chip.click();
  await page.waitForTimeout(300);
  r.exclude = await count();
  await chip.click();
  await page.waitForTimeout(300);
  r.off = await count();
  // Ranking: with Cloud and New both included, cards with both come first.
  await page.locator("[data-badge=\"new\"]").click();
  await chip.click();
  await page.waitForTimeout(300);
  r.twoIncluded = await count();
  r.firstCardsBadges = await page.locator("article").evaluateAll((a) => a.slice(0, 4).map((x) => x.innerText.split(/\n/).slice(0, 6).join(" | ")));
  await page.locator("text=Clear badge filter").click();
  results.badges = r;
  await page.screenshot({ path: `${out}/board-1280.png`, fullPage: false });

  // 3. Details view loads the posting and its evidence.
  await page.getByRole("button", { name: "Details" }).first().click();
  await page.waitForSelector("[role=dialog]");
  await page.waitForFunction(() => !document.querySelector("[role=dialog]")?.textContent?.includes("Loading the posting"), null, { timeout: 30000 });
  const dialog = page.locator("[role=dialog]");
  results.details = {
    hasWhy: (await dialog.innerText()).includes("Why this is here"),
    textChars: (await dialog.innerText()).length,
  };
  await page.screenshot({ path: `${out}/details.png` });
  await page.close();
}

// 4. Phone width.
{
  const page = await board(390);
  results.phone = { pageScrollsSideways: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) };
  await page.screenshot({ path: `${out}/phone.png`, fullPage: false });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
