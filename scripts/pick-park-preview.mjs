import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "scripts/pick-park.png";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 480, height: 820 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[console.error] ${m.text()}`); });

  await context.addInitScript(() => { try { localStorage.setItem("pst-tour-builder", "1"); } catch {} });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5500);
  await page.getByRole("button", { name: /Skate now/i }).click();
  await page.waitForSelector("text=Pick a park", { timeout: 10000 });
  // Give the MapThumbnailService time to render all presets (each ~1-2s because of GLB loads).
  await page.waitForTimeout(15000);
  await page.screenshot({ path: OUT });
  console.log("Saved:", OUT);
  if (errors.length) {
    console.log("--- ERRORS ---");
    for (const e of errors) console.log(e);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
