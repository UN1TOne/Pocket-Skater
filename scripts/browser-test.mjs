import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:5181";
const OUT = "scripts/test-output";

const log = (...a) => console.log("[test]", ...a);

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const page = await context.newPage();

  const errors = [];
  const warnings = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error") errors.push(`[console.error] ${m.text()}`);
    else if (t === "warning") warnings.push(`[console.warn] ${m.text()}`);
  });

  // Skip the Builder onboarding tour so the auto-driven clicks aren't intercepted.
  await context.addInitScript(() => {
    try { localStorage.setItem("pst-tour-builder", "1"); } catch {}
  });

  log("Opening landing…");
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });

  // Splash is ~4.6s + fade; wait for landing CTAs.
  await page.waitForTimeout(5500);
  await page.screenshot({ path: join(OUT, "01-landing.png") });

  // ========== Builder ==========
  log("Entering builder…");
  await page.getByRole("button", { name: /Build a park/i }).click();
  await page.waitForSelector("text=Ramps", { timeout: 20000 });
  // Give the ThumbnailService time to render all tiles for ramps.
  await page.waitForTimeout(8000);
  await page.screenshot({ path: join(OUT, "02-builder-ramps.png") });

  const tiles = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button[aria-label]")).filter(
      (b) => b.querySelector("img") && b.querySelector("span"),
    );
    return btns.map((b) => {
      const img = b.querySelector("img");
      const span = b.querySelector("span");
      return {
        label: span?.textContent ?? "",
        isDataUrl: img?.src.startsWith("data:") ?? false,
        srcLen: img?.src.length ?? 0,
        naturalWidth: img?.naturalWidth ?? 0,
        complete: img?.complete ?? false,
      };
    });
  });
  log("Builder tiles:", tiles);
  const dataUrl = tiles.filter((t) => t.isDataUrl);
  const fallback = tiles.filter((t) => !t.isDataUrl);
  log(`Thumbs — rendered (data URL): ${dataUrl.length}, fallback (PNG): ${fallback.length}`);

  // Cycle every category to ensure every tile renders.
  const categories = ["Rails", "Bowls", "Ledges", "Props", "Floors"];
  for (const cat of categories) {
    log(`→ ${cat}`);
    const tab = page.getByRole("button", { name: new RegExp(`${cat}`, "i") }).first();
    if (await tab.count()) {
      await tab.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: join(OUT, `03-builder-${cat.toLowerCase()}.png`) });
    }
  }

  // Toggle sheet hide/show.
  log("Toggling sheet…");
  const handle = page.locator('button[aria-label="Hide pieces"], button[aria-label="Show pieces"]').first();
  await handle.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, "04-builder-sheet-hidden.png") });
  await handle.click();
  await page.waitForTimeout(600);

  // Back to landing.
  const back = page.locator('button[aria-label="Back"]').first();
  await back.click();
  await page.waitForTimeout(1500);

  // ========== Setup flow ==========
  log("Entering skate setup…");
  await page.getByRole("button", { name: /Skate now/i }).click();
  await page.waitForSelector("text=Pick a park", { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "05-pick-park.png") });

  await page.getByRole("button", { name: /Next/i }).click();
  await page.waitForSelector("text=Choose your skater", { timeout: 10000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(OUT, "06-pick-skater.png") });

  const skaters = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("h3"));
    return cards.map((h) => {
      const card = h.closest("div");
      const img = card?.querySelector("img");
      return {
        label: h.textContent,
        srcHead: img?.src.slice(0, 40) ?? "",
        srcLen: img?.src.length ?? 0,
        isDataUrl: img?.src.startsWith("data:") ?? false,
      };
    });
  });
  log("Skater cards:", skaters);

  await page.getByRole("button", { name: /Next/i }).click();
  await page.waitForSelector("text=Pick a ride", { timeout: 10000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(OUT, "07-pick-ride.png") });

  const rides = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("h3"));
    return cards.map((h) => {
      const card = h.closest("div");
      const img = card?.querySelector("img");
      return {
        label: h.textContent,
        srcHead: img?.src.slice(0, 40) ?? "",
        srcLen: img?.src.length ?? 0,
        isDataUrl: img?.src.startsWith("data:") ?? false,
      };
    });
  });
  log("Ride cards:", rides);

  // AI mode so the test is self-driving.
  log("Switching to AI mode and entering gameplay…");
  const aiBtn = page.getByRole("button", { name: /AI auto-drive/i }).first();
  if (await aiBtn.count()) await aiBtn.click();

  await page.getByRole("button", { name: /Drop in|Next/i }).click();

  // Wait for scene to boot.
  await page.waitForTimeout(15000);
  await page.screenshot({ path: join(OUT, "08-gameplay-init.png") });

  // Grab the score element.
  const scoreAt = async () => {
    return page.evaluate(() => {
      const strong = document.querySelector("strong");
      return strong ? Number(strong.textContent) || 0 : -1;
    });
  };
  const grindingObserved = { count: 0 };

  const start = await scoreAt();
  const t0 = Date.now();
  log(`Initial score: ${start}`);

  // Observe for 30 seconds, poll every 2s.
  const samples = [];
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const s = await scoreAt();
    const grinding = await page.evaluate(() => {
      return !!document.querySelector('[class*="Toast"]')?.textContent?.includes("GRIND");
    });
    if (grinding) grindingObserved.count++;
    samples.push({ t: ((Date.now() - t0) / 1000).toFixed(1) + "s", score: s, grinding });
  }
  const end = await scoreAt();
  await page.screenshot({ path: join(OUT, "09-gameplay-30s.png") });

  log("Score timeline:", samples);
  log(`Delta over 30s: ${end - start} points (grinding frames observed: ${grindingObserved.count})`);

  if (errors.length) {
    log("---- PAGE ERRORS ----");
    for (const e of errors) log(e);
  }
  if (warnings.length) {
    log(`${warnings.length} warnings suppressed (first 5):`);
    for (const w of warnings.slice(0, 5)) log(w);
  }

  await browser.close();

  const summary = {
    builder: { dataUrlThumbs: dataUrl.length, fallbackThumbs: fallback.length, totalTiles: tiles.length },
    skaters,
    rides,
    scoreStart: start,
    scoreEnd: end,
    scoreDelta: end - start,
    grindingFrames: grindingObserved.count,
    errors: errors.length,
    warnings: warnings.length,
  };
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
