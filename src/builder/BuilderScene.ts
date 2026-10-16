import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { createEngine } from "@/engine/createEngine";
import { createWorld, type World } from "@/engine/world/createWorld";
import { Park, gridToWorld, rotationY, worldToGrid } from "@/engine/world/park";
import type { Instance } from "@/engine/assets/AssetLoader";
import { CATALOG_BY_ID } from "@/data/catalog";
import { footprintCells, useGameStore } from "@/store/useGameStore";
import type { PlacedItem, Rotation } from "@/types/game";

/** Grid-based park builder: tap to place/erase, drag to orbit, long-press for dial. */
export class BuilderScene {
  readonly engine: Engine;
  world!: World;
  park!: Park;
  private ghost: Instance | null = null;
  private ghostItemId: string | null = null;
  private ghostRot: Rotation = 0;
  private cursor!: Mesh;
  private cursorOk!: StandardMaterial;
  private cursorBad!: StandardMaterial;
  private cursorErase!: StandardMaterial;
  private puff!: ParticleSystem;
  private highlightedUid: string | null = null;
  private unsub: Array<() => void> = [];
  private disposed = false;
  private hoverCell: { x: number; z: number } | null = null;
  private lastItemUids = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.engine = createEngine(canvas);
  }

  async init() {
    const map = useGameStore.getState().customMap;
    this.world = createWorld(this.engine, { gridSize: map.size, showGridLines: true, orbitControls: true, quality: "high", visibleUnits: 7.5 });
    const { scene } = this.world;
    this.park = new Park(this.world, map.size);

    this.cursor = CreateGround("cursor", { width: 1, height: 1 }, scene);
    this.cursor.position.y = 0.012;
    this.cursor.isPickable = false;
    const mk = (name: string, c: Color3) => {
      const m = new StandardMaterial(name, scene);
      m.emissiveColor = c;
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.alpha = 0.45;
      m.disableLighting = true;
      return m;
    };
    this.cursorOk = mk("cursor-ok", new Color3(0.4, 1, 0.55));
    this.cursorBad = mk("cursor-bad", new Color3(1, 0.3, 0.35));
    this.cursorErase = mk("cursor-erase", new Color3(1, 0.75, 0.2));
    this.cursor.material = this.cursorOk;
    this.cursor.setEnabled(false);

    this.puff = buildPuffSystem(scene);

    // Rendering group 1 gets its own depth buffer, so when we promote the selected piece
    // to group 1, Babylon's built-in OutlineRenderer draws the inverted-hull back-face
    // outline without being occluded by neighbouring pieces in group 0.
    scene.setRenderingAutoClearDepthStencil(1, true, true);

    await this.park.build(map);
    this.lastItemUids = new Set(map.items.map((i) => i.uid));

    this.unsub.push(
      useGameStore.subscribe((s, prev) => {
        if (s.customMap.items !== prev.customMap.items || s.customMap.outerItems !== prev.customMap.outerItems) {
          this.emitPuffsForNewItems(s.customMap.items, map.size);
          void this.park.sync(s.customMap.items, s.customMap.outerItems ?? []).then(() => {
            this.applyMovingVisibility(s.movingPieceUid);
            this.applyDialHighlight(s.activeDial?.uid ?? null);
            if (s.activeDial) this.repositionDialFor(s.activeDial.uid);
          });
        }
        if (
          s.selectedItemId !== prev.selectedItemId ||
          s.builderRotation !== prev.builderRotation ||
          s.builderTool !== prev.builderTool ||
          s.movingPieceUid !== prev.movingPieceUid
        ) {
          void this.refreshGhost();
          if (s.movingPieceUid !== prev.movingPieceUid) {
            this.applyMovingVisibility(s.movingPieceUid, prev.movingPieceUid);
          }
        }
        if (s.activeDial !== prev.activeDial) {
          this.applyDialHighlight(s.activeDial?.uid ?? null);
        }
      }),
    );
    void this.refreshGhost();

    // Long-press on a placed piece opens the radial dial; short taps place/erase; dragging a
    // floor-category item paints a continuous row of floor tiles (camera orbit locks while
    // brushing so the gesture isn't eaten by the camera).
    let downAt = 0;
    let downX = 0;
    let downY = 0;
    let longPressTimer: number | null = null;
    let longPressFired = false;
    let brushing = false;
    let lastBrushKey = "";
    let brushStartedAt = 0;
    let brushFillPromptFired = false;
    const canvas = this.engine.getRenderingCanvas()!;
    const clearLongPress = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };
    const isFloorSelection = () => {
      const s = useGameStore.getState();
      if (s.builderTool !== "place" || !s.selectedItemId) return false;
      return CATALOG_BY_ID[s.selectedItemId]?.category === "floors";
    };
    const paintBrush = () => {
      const cell = this.pickCell();
      if (!cell) return;
      const key = `${cell.x},${cell.z}`;
      if (key === lastBrushKey) return;
      lastBrushKey = key;
      useGameStore.getState().placeItem(cell.x, cell.z);
      if (brushing && !brushFillPromptFired && performance.now() - brushStartedAt > 2000) {
        brushFillPromptFired = true;
        const sel = useGameStore.getState().selectedItemId;
        if (sel) useGameStore.getState().setFloorFillPrompt(sel);
      }
    };
    const endBrush = () => {
      if (!brushing) return;
      brushing = false;
      lastBrushKey = "";
      brushFillPromptFired = false;
      this.world.camera.attachControl(canvas, true);
    };
    scene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERMOVE) {
        this.onHover();
        if (brushing) paintBrush();
        if (longPressTimer != null && (Math.abs(scene.pointerX - downX) > 6 || Math.abs(scene.pointerY - downY) > 6)) {
          clearLongPress();
        }
      } else if (info.type === PointerEventTypes.POINTERDOWN) {
        downAt = performance.now();
        downX = scene.pointerX;
        downY = scene.pointerY;
        longPressFired = false;
        // Any 3D interaction closes an open preset/clear menu.
        window.dispatchEvent(new CustomEvent("builder:3d-interaction"));
        if (isFloorSelection() && this.pickCell()) {
          brushing = true;
          lastBrushKey = "";
          brushStartedAt = performance.now();
          brushFillPromptFired = false;
          this.world.camera.detachControl();
          paintBrush();
          return;
        }
        const pickedUid = this.pickPieceUid();
        if (pickedUid) {
          longPressTimer = window.setTimeout(() => {
            longPressFired = true;
            longPressTimer = null;
            void this.openDialOnPiece(pickedUid);
          }, 420);
        }
      } else if (info.type === PointerEventTypes.POINTERUP) {
        clearLongPress();
        endBrush();
      } else if (info.type === PointerEventTypes.POINTERTAP) {
        clearLongPress();
        if (longPressFired) {
          longPressFired = false;
          return;
        }
        if (brushing) return;
        if (performance.now() - downAt > 500) return;
        this.onTap();
      }
    });

    this.engine.runRenderLoop(() => {
      if (!this.disposed) scene.render();
    });
    window.addEventListener("resize", this.onResize);
  }

  private onResize = () => this.engine.resize();

  private pickCell(): { x: number; z: number } | null {
    const { scene } = this.world;
    const size = this.park.gridSize;
    const pick = scene.pick(scene.pointerX, scene.pointerY, (m: AbstractMesh) => m === this.world.ground.slab || m.metadata?.uid !== undefined);
    if (!pick?.hit || !pick.pickedPoint) return null;
    const p = pick.pickedPoint;
    const cell = worldToGrid(new Vector3(p.x, 0, p.z), size);
    if (cell.x < 0 || cell.z < 0 || cell.x >= size || cell.z >= size) return null;
    return cell;
  }

  private onHover() {
    const cell = this.pickCell();
    this.hoverCell = cell;
    this.updateCursor();
  }

  private onTap() {
    const cell = this.pickCell();
    if (!cell) return;
    const store = useGameStore.getState();
    if (store.movingPieceUid) {
      store.movePieceTo(store.movingPieceUid, cell.x, cell.z);
    } else if (store.builderTool === "erase") {
      store.removeItemAt(cell.x, cell.z);
    } else if (store.selectedItemId) {
      store.placeItem(cell.x, cell.z);
    }
    this.hoverCell = cell;
    this.updateCursor();
  }

  private pickPieceUid(): string | null {
    const { scene } = this.world;
    const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => Boolean(m.metadata?.uid));
    if (!pick?.hit) return null;
    const uid = pick.pickedMesh?.metadata?.uid ?? pick.pickedMesh?.parent?.metadata?.uid;
    return typeof uid === "string" ? uid : null;
  }

  private isValid(cell: { x: number; z: number }, itemId: string, rot: Rotation): boolean {
    const size = this.park.gridSize;
    return footprintCells(itemId, cell.x, cell.z, rot).every(([x, z]) => x >= 0 && z >= 0 && x < size && z < size);
  }

  private updateCursor() {
    const store = useGameStore.getState();
    const cell = this.hoverCell;
    if (!cell) {
      this.cursor.setEnabled(false);
      this.ghost?.root.setEnabled(false);
      return;
    }
    const size = this.park.gridSize;
    const movingUid = store.movingPieceUid;
    const movingPiece = movingUid ? store.customMap.items.find((it) => it.uid === movingUid) : null;
    const effectiveItemId = movingPiece?.itemId ?? store.selectedItemId;
    const effectiveRot = movingPiece?.rot ?? store.builderRotation;
    if (store.builderTool === "erase" || !effectiveItemId) {
      this.cursor.setEnabled(true);
      this.cursor.scaling.set(1, 1, 1);
      this.cursor.position.x = cell.x - size / 2 + 0.5;
      this.cursor.position.z = cell.z - size / 2 + 0.5;
      this.cursor.material = this.cursorErase;
      this.ghost?.root.setEnabled(false);
      return;
    }
    const itemId = effectiveItemId;
    const rot = effectiveRot;
    const valid = this.isValid(cell, itemId, rot);
    const cells = footprintCells(itemId, cell.x, cell.z, rot);
    const xs = cells.map((c) => c[0]);
    const zs = cells.map((c) => c[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const d = Math.max(...zs) - Math.min(...zs) + 1;
    const center = gridToWorld(itemId, cell.x, cell.z, rot, size);
    this.cursor.setEnabled(true);
    this.cursor.scaling.set(w, 1, d);
    this.cursor.position.x = center.x;
    this.cursor.position.z = center.z;
    this.cursor.material = valid ? this.cursorOk : this.cursorBad;
    if (this.ghost) {
      this.ghost.root.setEnabled(true);
      this.ghost.root.position.copyFrom(center);
      this.ghost.root.position.y = 0.02;
      this.ghost.root.rotation.y = rotationY(rot);
    }
  }

  /**
   * Pans the camera so the picked piece sits roughly screen-center, then opens
   * the dial at the piece's projected screen coords so the right-side fan
   * always fits in-viewport (no edge clipping).
   */
  private async openDialOnPiece(uid: string) {
    const piece = this.park.pieces.get(uid);
    if (!piece) return;
    const worldPos = piece.instance.root.position.clone();
    await this.panCameraTo(new Vector3(worldPos.x, 0, worldPos.z), 260);
    if (this.disposed) return;
    const { scene } = this.world;
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screen = Vector3.Project(
      worldPos,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      new Viewport(0, 0, rect.width, rect.height),
    );
    useGameStore.getState().setActiveDial({ uid, x: screen.x, y: screen.y });
  }

  /** Projects a piece's current world position to screen coords and updates the dial anchor. */
  private repositionDialFor(uid: string) {
    const piece = this.park.pieces.get(uid);
    if (!piece) {
      useGameStore.getState().setActiveDial(null);
      return;
    }
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screen = Vector3.Project(
      piece.instance.root.position,
      Matrix.Identity(),
      this.world.scene.getTransformMatrix(),
      new Viewport(0, 0, rect.width, rect.height),
    );
    useGameStore.getState().setActiveDial({ uid, x: screen.x, y: screen.y });
  }

  /** Smooth camera.target lerp for the dial-open framing. */
  private panCameraTo(target: Vector3, durationMs: number): Promise<void> {
    const cam = this.world.camera;
    const start = cam.target.clone();
    const startTime = performance.now();
    return new Promise<void>((resolve) => {
      const tick = () => {
        if (this.disposed) return resolve();
        const t = Math.min(1, (performance.now() - startTime) / durationMs);
        const ease = 1 - Math.pow(1 - t, 3);
        cam.target.set(
          start.x + (target.x - start.x) * ease,
          start.y + (target.y - start.y) * ease,
          start.z + (target.z - start.z) * ease,
        );
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
  }

  /** Black inverted-hull outline via Babylon's OutlineRenderer; promoted to group 1 so neighbouring pieces can't occlude the stroke. */
  private applyDialHighlight(uid: string | null) {
    if (this.highlightedUid === uid) return;
    if (this.highlightedUid) {
      const prev = this.park.pieces.get(this.highlightedUid);
      if (prev) {
        for (const m of prev.instance.meshes) {
          if (!(m instanceof Mesh)) continue;
          m.renderOutline = false;
          m.renderingGroupId = 0;
        }
      }
    }
    this.highlightedUid = uid;
    if (!uid) return;
    const next = this.park.pieces.get(uid);
    if (!next) return;
    const black = new Color3(0, 0, 0);
    for (const m of next.instance.meshes) {
      if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
      m.renderOutline = true;
      m.outlineColor = black;
      m.outlineWidth = 0.035;
      m.renderingGroupId = 1;
    }
  }

  /** Dim the piece currently being moved so Move reads differently from Copy. */
  private applyMovingVisibility(nextUid: string | null, prevUid?: string | null) {
    const restore = (uid: string | null | undefined) => {
      if (!uid) return;
      const piece = this.park.pieces.get(uid);
      if (!piece) return;
      for (const m of piece.instance.meshes) m.visibility = 1;
    };
    restore(prevUid);
    if (nextUid && nextUid !== prevUid) restore(nextUid === prevUid ? null : nextUid);
    if (nextUid) {
      const piece = this.park.pieces.get(nextUid);
      if (piece) for (const m of piece.instance.meshes) m.visibility = 0.3;
    }
  }

  private emitPuffsForNewItems(items: PlacedItem[], gridSize: number) {
    const next = new Set(items.map((i) => i.uid));
    for (const it of items) {
      if (this.lastItemUids.has(it.uid)) continue;
      const p = gridToWorld(it.itemId, it.x, it.z, it.rot, gridSize);
      this.puff.emitter = new Vector3(p.x, 0.85, p.z);
      this.puff.manualEmitCount = 14;
    }
    this.lastItemUids = next;
  }

  private async refreshGhost() {
    const store = useGameStore.getState();
    const movingUid = store.movingPieceUid;
    const movingPiece = movingUid ? store.customMap.items.find((it) => it.uid === movingUid) : null;
    const id = store.builderTool === "place" ? (movingPiece?.itemId ?? store.selectedItemId) : null;
    const rot = movingPiece?.rot ?? store.builderRotation;
    if (id === this.ghostItemId && rot === this.ghostRot) {
      this.updateCursor();
      return;
    }
    this.ghostItemId = id;
    this.ghostRot = rot;
    this.ghost?.dispose();
    this.ghost = null;
    if (id) {
      const inst = await this.park.loader.instantiate(id, "ghost");
      if (this.disposed || this.ghostItemId !== id) {
        inst.dispose();
        return;
      }
      for (const m of inst.meshes) {
        m.isPickable = false;
        m.visibility = 0.55;
        m.receiveShadows = false;
      }
      inst.root.setEnabled(false);
      this.ghost = inst;
    }
    this.updateCursor();
  }

  setGridLines(show: boolean) {
    this.world.ground.setGridLines(show);
  }

  /**
   * Captures a clean PNG snapshot of the current park: hides the cursor + ghost + grid lines,
   * reframes the camera to a top-down iso angle that fits the whole park, renders two frames
   * (so the first renders without the hidden elements), toDataURL, then restores everything.
   * Used by the Builder when the user leaves so the Pick-a-park screen can show their creation.
   */
  async captureSnapshot(): Promise<string | null> {
    if (this.disposed) return null;
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return null;
    const cam = this.world.camera;
    const prev = { alpha: cam.alpha, beta: cam.beta, radius: cam.radius, target: cam.target.clone() };
    const cursorWasOn = this.cursor.isEnabled();
    const ghostWasOn = this.ghost?.root.isEnabled() ?? false;

    this.cursor.setEnabled(false);
    this.ghost?.root.setEnabled(false);
    this.world.ground.setGridLines(false);
    cam.alpha = -Math.PI / 4;
    cam.beta = 0.9;
    cam.radius = this.park.gridSize * 1.75;
    cam.target.set(0, 0, 0);

    try {
      await this.world.scene.whenReadyAsync();
      this.world.scene.render();
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      this.world.scene.render();
      return canvas.toDataURL("image/png");
    } finally {
      cam.alpha = prev.alpha;
      cam.beta = prev.beta;
      cam.radius = prev.radius;
      cam.target.copyFrom(prev.target);
      this.cursor.setEnabled(cursorWasOn);
      this.ghost?.root.setEnabled(ghostWasOn);
      this.world.ground.setGridLines(true);
    }
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    this.unsub.forEach((u) => u());
    this.engine.stopRenderLoop();
    this.ghost?.dispose();
    this.puff?.dispose();
    this.park?.dispose();
    this.world?.dispose();
    this.engine.dispose();
  }
}

/** Shared soft-poof system; emitter is retargeted per placement. */
function buildPuffSystem(scene: import("@babylonjs/core/scene").Scene): ParticleSystem {
  const tex = new DynamicTexture("builder-puff", { width: 64, height: 64 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 64, 64);
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.6, "rgba(255,245,235,0.65)");
  grad.addColorStop(1, "rgba(255,230,210,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  tex.update();
  tex.hasAlpha = true;

  const sys = new ParticleSystem("builder-place-puff", 120, scene);
  sys.particleTexture = tex;
  sys.emitter = new Vector3(0, 0, 0);
  sys.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  sys.renderingGroupId = 1;
  sys.minEmitBox = new Vector3(-0.3, 0, -0.3);
  sys.maxEmitBox = new Vector3(0.3, 0.08, 0.3);
  sys.addColorGradient(0, new Color4(1, 0.98, 0.94, 1));
  sys.addColorGradient(0.5, new Color4(0.95, 0.9, 0.85, 0.85));
  sys.addColorGradient(1, new Color4(0.85, 0.78, 0.75, 0));
  sys.addSizeGradient(0, 0.15);
  sys.addSizeGradient(0.4, 0.5);
  sys.addSizeGradient(1, 0.1);
  sys.minLifeTime = 0.45;
  sys.maxLifeTime = 0.85;
  sys.emitRate = 0;
  sys.direction1 = new Vector3(-1, 0.9, -1);
  sys.direction2 = new Vector3(1, 1.6, 1);
  sys.minEmitPower = 0.6;
  sys.maxEmitPower = 1.4;
  sys.gravity = new Vector3(0, -0.6, 0);
  sys.minAngularSpeed = -2;
  sys.maxAngularSpeed = 2;
  sys.updateSpeed = 0.016;
  sys.start();
  return sys;
}

export type { PlacedItem };
