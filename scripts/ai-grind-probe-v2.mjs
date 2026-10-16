import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const MODE = process.env.MODE ?? "ai"; // "ai" or "manual"
const DURATION = Number(process.env.DURATION ?? 30); // seconds of gameplay to observe

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 480, height: 820 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
  });

  await context.addInitScript(() => {
    try { localStorage.setItem("pst-tour-builder", "1"); } catch {}
  });

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

  if (MODE === "ai") {
    const aiBtn = page.getByRole("button", { name: /AI auto-drive/i }).first();
    if (await aiBtn.count()) await aiBtn.click();
  }
  await page.getByRole("button", { name: /Drop in|Next/i }).click();

  // Wait for scene boot.
  await page.waitForTimeout(10000);

  // Start high-frequency sampling INSIDE the page so we capture frame-level transitions.
  await page.evaluate(() => {
    const samples = [];
    const transitions = [];
    let lastState = null;
    const probe = () => {
      const skate = window.__skate;
      const ai = window.__aiDebug;
      if (!skate?.player) return;
      const p = skate.player;
      const pos = p.position;
      const vel = p.body.getLinearVelocity();
      const s = {
        t: performance.now(),
        state: p.state,
        pos: { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, z: Math.round(pos.z * 100) / 100 },
        v: { x: Math.round(vel.x * 10) / 10, y: Math.round(vel.y * 10) / 10, z: Math.round(vel.z * 10) / 10 },
        spd: Math.round(p.speed * 100) / 100,
        gl: p._grindLockTimer ?? 0, // may not be accessible
        airRail: !!p.airRailTarget,
        tags: p.groundTags.slice(0),
        aiPhase: ai?.lastPhase ?? "",
        aiSuccess: ai?.airSuccess ?? 0,
        aiMiss: ai?.airMiss ?? 0,
        aiJumps: ai?.jumpsFired ?? 0,
        score: skate.score ?? 0,
      };
      samples.push(s);
      if (p.state !== lastState) {
        transitions.push({ t: s.t, from: lastState, to: p.state, pos: s.pos, tags: s.tags });
        lastState = p.state;
      }
      if (samples.length > 2500) samples.splice(0, 500); // keep ring buffer
    };
    window.__samples = samples;
    window.__transitions = transitions;
    window.__probeInterval = setInterval(probe, 50); // 20Hz
  });

  const t0 = Date.now();
  await page.waitForTimeout(DURATION * 1000);

  const data = await page.evaluate(() => {
    clearInterval(window.__probeInterval);
    return { samples: window.__samples, transitions: window.__transitions, grindLog: window.__grindLog ?? [] };
  });

  // Compute grind durations from the EVENT log (onGrindChange) which fires on every
  // state transition in/out of grinding, not just at 20Hz samples.
  const grindRuns = [];
  let openGrind = null;
  for (const e of data.grindLog) {
    if (e.on) openGrind = e;
    else if (openGrind) {
      grindRuns.push({
        dur: ((e.t - openGrind.t) / 1000).toFixed(3),
        startPos: openGrind.pos,
        endPos: e.pos,
        startTags: openGrind.tags,
      });
      openGrind = null;
    }
  }
  const grindEvents = data.grindLog.length;
  const finalDebug = await page.evaluate(() => ({ ...window.__aiDebug, score: window.__skate.score }));

  // Pick samples that fell inside the longest grind run so we can see velocity/state detail.
  let samplesInGrind = [];
  if (grindRuns.length > 0 && data.grindLog.length >= 2) {
    const longest = data.grindLog.reduce((best, _e, i, arr) => {
      if (i + 1 >= arr.length) return best;
      if (arr[i].on && !arr[i + 1].on) {
        const d = arr[i + 1].t - arr[i].t;
        if (d > best.d) return { d, start: arr[i].t, end: arr[i + 1].t };
      }
      return best;
    }, { d: 0, start: 0, end: 0 });
    samplesInGrind = data.samples
      .filter((s) => s.t >= longest.start && s.t <= longest.end)
      .map((s) => ({ dt: ((s.t - longest.start) / 1000).toFixed(2), state: s.state, spd: s.spd, v: s.v, tags: s.tags }));
  }

  const summary = {
    mode: MODE,
    duration_s: DURATION,
    finalDebug,
    grindEvents,
    grindRuns: grindRuns.map((g) => ({ dur: g.dur, startPos: g.startPos, endPos: g.endPos })),
    totalGrindTime: grindRuns.reduce((a, g) => a + Number(g.dur), 0).toFixed(3),
    sampleCount: data.samples.length,
    sampleRateHz: data.samples.length > 1 ? (data.samples.length / ((data.samples[data.samples.length - 1].t - data.samples[0].t) / 1000)).toFixed(1) : 0,
    samplesInLongestGrind: samplesInGrind,
    transitions: data.transitions.map((t) => ({
      t: ((t.t - data.transitions[0].t) / 1000).toFixed(2),
      from: t.from,
      to: t.to,
      pos: t.pos,
      tags: t.tags,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
  writeFileSync("scripts/last-probe-v2.json", JSON.stringify(summary, null, 2));
  if (errors.length) console.log("--- ERRORS ---\n" + errors.join("\n"));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
