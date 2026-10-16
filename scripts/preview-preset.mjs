import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const PRESET_NAME = process.env.PRESET ?? "Street Studio";
const OUT = process.env.OUT ?? "scripts/preset-preview.png";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[console.error] ${m.text()}`); });

  await context.addInitScript(() => { try { localStorage.setItem("pst-tour-builder", "1"); } catch {} });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5500);
  await page.getByRole("button", { name: /Skate now/i }).click();
  await page.waitForSelector("text=Pick a park", { timeout: 10000 });

  // Click the named preset
  await page.waitForTimeout(1000);
  const target = page.getByText(new RegExp(PRESET_NAME, "i")).first();
  if (await target.count()) {
    await target.click();
    await page.waitForTimeout(1500);
  } else {
    console.warn("Preset not found by name — the first visible preset will be used.");
  }
  await page.getByRole("button", { name: /Next/i }).click();
  await page.waitForSelector("text=Choose your skater", { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Next/i }).click();
  await page.waitForSelector("text=Pick a ride", { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Drop in|Next/i }).click();
  // Pause the game right after drop in so the screenshot captures the whole park
  await page.waitForTimeout(5000);
  await page.evaluate(() => { if (window.__skate) window.__skate.paused = true; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT, fullPage: false });
  console.log("Saved:", OUT);
  if (errors.length) {
    console.log("--- ERRORS ---");
    for (const e of errors) console.log(e);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
