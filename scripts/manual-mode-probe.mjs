import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";

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
  await page.getByRole("button", { name: /Next/i }).click();
  await page.waitForSelector("text=Choose your skater", { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Next/i }).click();
  await page.waitForSelector("text=Pick a ride", { timeout: 10000 });
  await page.waitForTimeout(1500);
  // Manual mode is the default — don't click AI button.
  await page.getByRole("button", { name: /Drop in|Next/i }).click();

  await page.waitForTimeout(10000);

  // Hook up grind log collection.
  await page.evaluate(() => {
    window.__grindLog ??= [];
    window.__grindLog.length = 0;
  });

  // Try to teleport the player near the long rail chain so we can test rail entry.
  const spawn = await page.evaluate(() => {
    const skate = window.__skate;
    if (!skate?.player) return null;
    // Position player NEAR but not on the rail at (world x=-3.5, z=-2.5 to 1.5).
    // Approach lineup position just behind the chain's near end.
    const p = skate.player;
    const spawn = new BABYLON.Vector3(-3.5, 0.1, 3.5); // z=3.5 is behind the chain (which ends at z=1.95)
    p.teleport(spawn);
    return { x: p.position.x, y: p.position.y, z: p.position.z };
  }).catch(() => null);
  console.log("Spawn:", spawn);

  // Focus the canvas so keyboard events reach the game.
  await page.focus("canvas");

  // Press 's' to drive -Z direction (toward lower z, into the rail chain).
  // Camera is iso so direction mapping might differ. Also try 'w' and arrows.
  const scenario = async (keyName, holdMs, label) => {
    console.log(`--- ${label} ---`);
    const start = await page.evaluate(() => ({ score: window.__skate.score, pos: { ...window.__skate.player.position } }));
    await page.keyboard.down(keyName);
    await page.waitForTimeout(holdMs);
    await page.keyboard.up(keyName);
    await page.waitForTimeout(500); // settle
    const end = await page.evaluate(() => ({ score: window.__skate.score, pos: { ...window.__skate.player.position }, state: window.__skate.player.state }));
    console.log(" start:", start, "\n end:", end);
    const grinds = await page.evaluate(() => {
      const log = window.__grindLog ?? [];
      const runs = [];
      let open = null;
      for (const e of log) {
        if (e.on) open = e;
        else if (open) { runs.push({ dur: ((e.t - open.t) / 1000).toFixed(2), startPos: open.pos }); open = null; }
      }
      window.__grindLog.length = 0;
      return runs;
    });
    console.log(" grinds during this scenario:", grinds);
  };

  // Drive forward (toward -Z camera-relative). The camera is isometric, so 'w' should drive forward.
  await scenario("w", 2500, "W (forward) for 2.5s - should run into the rail chain");

  // Try jumping while driving to test ollie onto a rail
  await page.focus("canvas");
  await page.evaluate(() => {
    const p = window.__skate.player;
    p.teleport(new BABYLON.Vector3(-3.5, 0.1, 3.5));
  }).catch(() => {});
  await page.waitForTimeout(1000);
  console.log("--- W + Space (jump) ---");
  await page.keyboard.down("w");
  await page.waitForTimeout(800);
  await page.keyboard.down(" "); // space
  await page.waitForTimeout(100);
  await page.keyboard.up(" ");
  await page.waitForTimeout(1500);
  await page.keyboard.up("w");
  const afterJump = await page.evaluate(() => ({
    score: window.__skate.score,
    pos: window.__skate.player.position,
    state: window.__skate.player.state,
    grinds: window.__grindLog.slice(),
  }));
  console.log("After W+jump:", afterJump);

  // Test turning: press d while moving, see if player turns smoothly
  await scenario("d", 1500, "D (strafe right) for 1.5s - test turn responsiveness");

  if (errors.length) {
    console.log("\n--- ERRORS ---");
    for (const e of errors) console.log(e);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
