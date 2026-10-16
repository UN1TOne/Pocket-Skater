import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5181";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error") errors.push(`[console.error] ${m.text()}`);
  });

  await context.addInitScript(() => {
    try { localStorage.setItem("pst-tour-builder", "1"); } catch {}
  });

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5500);

  // Skip Builder entirely — go straight to Skate Now.
  await page.getByRole("button", { name: /Skate now/i }).click();
  await page.waitForSelector("text=Pick a park", { timeout: 10000 });
  await page.getByRole("button", { name: /Next/i }).click();
  await page.waitForSelector("text=Choose your skater", { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Next/i }).click();
  await page.waitForSelector("text=Pick a ride", { timeout: 10000 });
  await page.waitForTimeout(1500);

  const aiBtn = page.getByRole("button", { name: /AI auto-drive/i }).first();
  if (await aiBtn.count()) await aiBtn.click();
  await page.getByRole("button", { name: /Drop in|Next/i }).click();

  // Wait for scene boot + AI to settle.
  await page.waitForTimeout(10000);

  // Sample the AI debug every 3s for 45s.
  const samples = [];
  for (let i = 0; i < 15; i++) {
    const snapshot = await page.evaluate(() => {
      const d = (window).__aiDebug;
      const skate = (window).__skate;
      const player = skate?.player;
      return {
        debug: d ? { ...d } : null,
        state: player?.state ?? null,
        speed: player ? Math.round(player.speed * 100) / 100 : null,
        pos: player ? [Math.round(player.position.x * 10) / 10, Math.round(player.position.y * 10) / 10, Math.round(player.position.z * 10) / 10] : null,
        score: skate?.["score"] ?? null,
      };
    });
    samples.push(snapshot);
    await page.waitForTimeout(3000);
  }

  console.log(JSON.stringify(samples, null, 2));
  if (errors.length) {
    console.log("\n--- ERRORS ---");
    for (const e of errors) console.log(e);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
