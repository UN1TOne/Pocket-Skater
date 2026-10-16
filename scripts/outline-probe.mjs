import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:5181";
const OUT = "scripts/test-output";

const log = (...a) => console.log("[outline]", ...a);

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 420, height: 820 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await context.addInitScript(() => {
    try { localStorage.setItem("pst-tour-builder", "1"); } catch {}
  });

  log("Opening landing…");
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5500);
  log("→ Build a park");
  await page.getByRole("button", { name: /Build a park/i }).click();
  await page.waitForSelector("text=Ramps", { timeout: 20000 });
  await page.waitForTimeout(3000);

  log("Loading Sunset Plaza preset…");
  await page.evaluate(() => {
    const store = window.__pocketSkater?.store;
    if (!store) return;
    store.getState().loadPresetIntoBuilder("preset-sunset-plaza");
  });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: join(OUT, "outline-00-loaded.png") });

  log("Probing scene meshes for closed-surface and bbox info…");
  const meshInfo = await page.evaluate(() => {
    const scene = window.__scene;
    if (!scene) return { error: "no __scene exposed" };
    const result = [];
    const bySpecific = ["rail-low", "ramp", "half-pipe", "obstacle-box", "steps"];
    for (const mesh of scene.meshes) {
      const uid = mesh.metadata?.uid;
      if (!uid) continue;
      const itemId = mesh.metadata?.itemId ?? mesh.parent?.metadata?.itemId ?? "?";
      if (!bySpecific.some((k) => itemId?.includes(k))) continue;
      const bi = mesh.getBoundingInfo?.();
      const bb = bi?.boundingBox;
      const indicesCount = mesh.getTotalIndices?.() ?? -1;
      const vertCount = mesh.getTotalVertices?.() ?? -1;
      result.push({
        name: mesh.name,
        itemId,
        uid,
        verts: vertCount,
        tris: indicesCount / 3,
        min: bb ? [bb.minimumWorld.x.toFixed(2), bb.minimumWorld.y.toFixed(2), bb.minimumWorld.z.toFixed(2)] : null,
        max: bb ? [bb.maximumWorld.x.toFixed(2), bb.maximumWorld.y.toFixed(2), bb.maximumWorld.z.toFixed(2)] : null,
        hasOutline: !!mesh.renderOutline,
        renderingGroup: mesh.renderingGroupId,
        materialName: mesh.material?.name,
      });
      if (result.length >= 6) break;
    }
    return { count: scene.meshes.length, sample: result };
  });
  log("Mesh info:", JSON.stringify(meshInfo, null, 2));

  log("Opening dial on first placed piece…");
  const pieceInfo = await page.evaluate(() => {
    const store = window.__pocketSkater?.store;
    if (!store) return null;
    const items = store.getState().customMap.items;
    const target = items.find((it) => it.itemId.startsWith("rail")) ?? items[0];
    if (!target) return null;
    store.getState().setActiveDial({ uid: target.uid, x: 220, y: 380 });
    return { uid: target.uid, itemId: target.itemId, x: target.x, z: target.z };
  });
  log("Dial target:", pieceInfo);
  // Pan camera onto the selected piece so the outline is in-frame for the screenshot.
  await page.evaluate((uid) => {
    const scene = window.__scene;
    if (!scene) return;
    const piece = scene.meshes.find((m) => m.metadata?.uid === uid && m.getTotalVertices() > 0);
    if (!piece) return;
    const pos = piece.getAbsolutePosition();
    const cam = scene.activeCamera;
    if (cam && cam.target) cam.target.set(pos.x, 0, pos.z);
  }, pieceInfo?.uid);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, "outline-01-dial.png") });

  // Also zoom in close for a crisp outline capture.
  await page.evaluate(() => {
    const cam = window.__scene?.activeCamera;
    if (cam) cam.radius = 6;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "outline-02-zoomed.png") });

  log("After dial — mesh state for the highlighted piece:");
  const highlighted = await page.evaluate((uid) => {
    const scene = window.__scene;
    if (!scene || !uid) return null;
    return scene.meshes
      .filter((m) => (m.metadata?.uid === uid) || m.name.startsWith("outline-"))
      .map((m) => ({
        name: m.name,
        uid: m.metadata?.uid ?? null,
        verts: m.getTotalVertices?.() ?? -1,
        tris: (m.getTotalIndices?.() ?? 0) / 3,
        renderOutline: !!m.renderOutline,
        outlineWidth: m.outlineWidth,
        outlineColor: m.outlineColor ? [m.outlineColor.r, m.outlineColor.g, m.outlineColor.b] : null,
        renderingGroupId: m.renderingGroupId,
        materialName: m.material?.name,
        backFaceCulling: m.material?.backFaceCulling,
        sideOrientation: m.material?.sideOrientation,
        disabled: !m.isEnabled(),
        scaling: [m.scaling.x.toFixed(2), m.scaling.y.toFixed(2), m.scaling.z.toFixed(2)],
      }));
  }, pieceInfo?.uid);
  log("Highlight state:", JSON.stringify(highlighted, null, 2));

  log("Errors:", errors.length);
  if (errors.length) log(errors.slice(0, 3));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
