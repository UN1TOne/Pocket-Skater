import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { createEngine, enableHavok } from "@/engine/createEngine";
import { createWorld, type World } from "@/engine/world/createWorld";
import { Park, gridToWorld, rotationY } from "@/engine/world/park";
import { gameInput } from "@/engine/input";
import { CATALOG_BY_ID } from "@/data/catalog";
import { footprintCells, type GameHud } from "@/store/useGameStore";
import type { CharacterId, MapData, PlayMode, RideId } from "@/types/game";
import { PlayerController } from "./PlayerController";
import { AiNavigator, type PointOfInterest } from "./AiNavigator";
import { Bail } from "./Bail";

export interface SkateSceneOptions {
  canvas: HTMLCanvasElement;
  map: MapData;
  character: CharacterId;
  ride: RideId;
  mode: PlayMode;
  onHud: (patch: Partial<GameHud>) => void;
  onProgress?: (label: string) => void;
}

/** Gameplay orchestration: world + physics + park + rider + AI. */
export class SkateScene {
  readonly engine: Engine;
  world!: World;
  park!: Park;
  player!: PlayerController;
  ai!: AiNavigator;
  bail!: Bail;
  mode: PlayMode;
  paused = false;
  private score = 0;
  private hudTimer = 0;
  private disposed = false;
  private camTarget = new Vector3();
  private respawnHistory: Array<{ pos: Vector3; t: number }> = [];

  constructor(private opts: SkateSceneOptions) {
    this.engine = createEngine(opts.canvas);
    this.mode = opts.mode;
    if (import.meta.env.DEV) (window as unknown as { __skate: SkateScene }).__skate = this;
  }

  async init() {
    const { map, onProgress } = this.opts;
    onProgress?.("Setting up the diorama…");
    this.world = createWorld(this.engine, { gridSize: map.size, showGridLines: false, orbitControls: false, quality: pickQuality(), visibleUnits: 6 });
    const { scene } = this.world;

    onProgress?.("Warming up Havok…");
    await enableHavok(scene);
    if (this.disposed) return;

    new PhysicsAggregate(this.world.ground.slab, PhysicsShapeType.BOX, { mass: 0, friction: 0.3, restitution: 0 }, scene);
    new PhysicsAggregate(this.world.ground.apron, PhysicsShapeType.BOX, { mass: 0, friction: 0.3, restitution: 0 }, scene);
    const half = map.size / 2;
    const wallH = 3;
    const wallDefs: Array<[number, number, number, number]> = [
      [0, -half - 0.6, map.size + 2, 0.8],
      [0, half + 0.6, map.size + 2, 0.8],
      [-half - 0.6, 0, 0.8, map.size + 2],
      [half + 0.6, 0, 0.8, map.size + 2],
    ];
    wallDefs.forEach(([x, z, w, d], i) => {
      const wall = CreateBox(`bound-${i}`, { width: w, height: wallH, depth: d }, scene);
      wall.position.set(x, wallH / 2, z);
      wall.isVisible = false;
      wall.isPickable = false;
      wall.metadata = { kind: "wall", tags: ["wall"] };
      new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.1, restitution: 0.1 }, scene);
    });

    onProgress?.("Building the park…");
    this.park = new Park(this.world, map.size);
    await this.park.build(map);
    if (this.disposed) return;

    const staticMeshes: Mesh[] = [this.world.ground.slab];
    const pois: PointOfInterest[] = [];
    for (const piece of this.park.pieces.values()) {
      const def = CATALOG_BY_ID[piece.placed.itemId];
      if (!def || def.category === "floors") continue;
      // Sample the piece's world-space top Y so the AI can target the ridable surface.
      let maxY = 0;
      for (const m of piece.instance.meshes) {
        if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
        m.metadata = { ...m.metadata, kind: def.tags.includes("wall") ? "wall" : "piece", tags: def.tags };
        new PhysicsAggregate(m, PhysicsShapeType.MESH, { mass: 0, friction: 0.25, restitution: 0 }, scene);
        staticMeshes.push(m);
        m.computeWorldMatrix(true);
        const by = m.getBoundingInfo().boundingBox.maximumWorld.y;
        if (by > maxY) maxY = by;
      }
      const p = gridToWorld(def.id, piece.placed.x, piece.placed.z, piece.placed.rot, map.size);
      const yaw = rotationY(piece.placed.rot);
      // Rotated axis depends on which footprint dimension is the long side.
      // At rot 0/2 the long side runs along z; at rot 1/3 it runs along x.
      const rotAxis0 = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const length = Math.max(def.footprint.w, def.footprint.d) * 1.0;
      if (def.tags.includes("ramp") && !def.tags.includes("grind")) {
        pois.push({ position: p, kind: "ramp", axis: rotAxis0 });
      } else if (def.tags.includes("grind") || def.tags.includes("rail")) {
        pois.push({
          position: p,
          kind: "grind",
          axis: rotAxis0,
          length,
          topY: maxY,
          thin: def.tags.includes("rail"),
        });
      }
    }

    onProgress?.("Lacing up…");
    const spawn = findSpawn(map);
    const [charInst, rideInst] = await Promise.all([
      this.park.loader.instantiate(this.opts.character, "rider-char"),
      this.park.loader.instantiate(this.opts.ride, "rider-ride"),
    ]);
    if (this.disposed) return;
    this.world.addShadowCaster(charInst.root, true);
    this.world.addShadowCaster(rideInst.root, true);
    for (const m of [...charInst.meshes, ...rideInst.meshes]) m.isPickable = false;

    this.bail = new Bail(scene, (id) => this.park.loader.instantiate(id, `bail-${id}`));
    this.player = new PlayerController(scene, charInst, rideInst, this.opts.ride, spawn, {
      onLand: (_fall, airtime) => {
        if (airtime > 0.3) this.addScore(Math.round(airtime * 40));
      },
      onBail: (vel) => {
        this.score = Math.max(0, this.score - 50);
        this.opts.onHud({ bailed: true, score: Math.floor(this.score) });
        void this.bail.trigger(this.player, vel, this.opts.character, this.opts.ride);
      },
      onGrindChange: (g) => this.opts.onHud({ grinding: g }),
    });

    onProgress?.("Teaching the AI to skate…");
    this.ai = new AiNavigator(scene, pois, half);
    await this.ai.bake(staticMeshes);
    if (this.disposed) return;
    this.ai.attach(this.player);
    this.player.driver = this.mode === "ai" ? "ai" : "manual";
    if (import.meta.env.DEV) (window as unknown as { __aiDebug: AiNavigator["debug"] }).__aiDebug = this.ai.debug;

    this.camTarget.copyFrom(this.player.position);
    this.world.camera.setTarget(this.camTarget);

    scene.onBeforeRenderObservable.add(() => this.tick());
    this.engine.runRenderLoop(() => {
      if (!this.disposed) scene.render();
    });
    window.addEventListener("resize", this.onResize);
    onProgress?.("");
  }

  private onResize = () => this.engine.resize();

  setMode(mode: PlayMode) {
    this.mode = mode;
    if (this.player) {
      this.player.driver = mode === "ai" ? "ai" : "manual";
      if (mode === "manual") this.player.moveDir.setAll(0);
    }
  }

  private addScore(n: number) {
    this.score += n;
    this.opts.onHud({ score: Math.floor(this.score) });
  }

  /**
   * Respawn safely. If the rider has been dying in the same spot repeatedly, teleport
   * to a different nearby empty cell so they don't get stuck in a geometry pocket.
   */
  private doRespawn() {
    const safe = this.player["lastSafePos"] as Vector3;
    const now = performance.now();
    this.respawnHistory = this.respawnHistory.filter((r) => now - r.t < 6000);
    const stuckCount = this.respawnHistory.filter((r) => Vector3.Distance(r.pos, safe) < 0.6).length;
    let dest: Vector3 = safe;
    if (stuckCount >= 2) {
      const alt = this.findEmptyNearby(safe);
      if (alt) dest = alt;
    }
    this.respawnHistory.push({ pos: dest.clone(), t: now });
    this.player.respawn();
    if (dest !== safe) this.player.teleport(dest);
  }

  /** Spiral out from a world position to find an empty, obstacle-free grid cell. */
  private findEmptyNearby(worldPos: Vector3): Vector3 | null {
    const map = this.opts.map;
    const size = map.size;
    const occupied = new Set<string>();
    for (const it of map.items) {
      if (CATALOG_BY_ID[it.itemId]?.category === "floors") continue;
      for (const [x, z] of footprintCells(it.itemId, it.x, it.z, it.rot)) occupied.add(`${x},${z}`);
    }
    const cx = Math.floor(worldPos.x + size / 2);
    const cz = Math.floor(worldPos.z + size / 2);
    for (let r = 1; r <= size; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= size || z >= size) continue;
          let clear = true;
          for (let i = -1; i <= 1 && clear; i++) for (let j = -1; j <= 1 && clear; j++) if (occupied.has(`${x + i},${z + j}`)) clear = false;
          if (clear) return new Vector3(x - size / 2 + 0.5, 0.1, z - size / 2 + 0.5);
        }
      }
    }
    return null;
  }

  private tick() {
    if (!this.player) return;
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    if (this.paused) return;

    if (this.mode === "manual") {
      // Camera-relative WASD: w = up on screen, a/d = left/right on screen. On a rail
      // the controller re-projects velocity onto the rail axis, so iso-diagonal input
      // still rides straight along the pole.
      const cam = this.world.camera;
      const fwd = cam.target.subtract(cam.position);
      fwd.y = 0;
      fwd.normalize();
      const right = Vector3.Cross(fwd, Vector3.Up()).normalize();
      const dir = fwd.scale(gameInput.moveY).add(right.scale(gameInput.moveX));
      const len = dir.length();
      if (len > 1) dir.scaleInPlace(1 / len);
      this.player.moveDir.copyFrom(dir);
      if (gameInput.jumpPressed) {
        gameInput.jumpPressed = false;
        this.player.requestJump();
      }
    } else {
      gameInput.jumpPressed = false;
      this.ai.update(this.player, dt);
    }

    this.player.update(dt);
    if (this.player.state === "grinding") this.score += dt * 12;

    if (this.bail.update(dt)) {
      this.doRespawn();
      this.opts.onHud({ bailed: false });
    }

    const p = this.player.position;
    this.camTarget.x += (p.x - this.camTarget.x) * (1 - Math.exp(-4 * dt));
    this.camTarget.z += (p.z - this.camTarget.z) * (1 - Math.exp(-4 * dt));
    this.camTarget.y += (p.y * 0.4 - this.camTarget.y) * (1 - Math.exp(-3 * dt));
    this.world.camera.target.copyFrom(this.camTarget);

    this.hudTimer += dt;
    if (this.hudTimer > 0.08) {
      this.hudTimer = 0;
      this.opts.onHud({ speed: this.player.speed, airtime: this.player.airtime, score: Math.floor(this.score) });
    }
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    this.engine.stopRenderLoop();
    this.ai?.dispose();
    this.bail?.dispose();
    this.player?.dispose();
    this.park?.dispose();
    this.world?.dispose();
    this.engine.dispose();
  }
}

/** Nearest empty cell to the map center (spiral search). */
function findSpawn(map: MapData): Vector3 {
  const occupied = new Set<string>();
  for (const it of map.items) {
    if (CATALOG_BY_ID[it.itemId]?.category === "floors") continue;
    for (const [x, z] of footprintCells(it.itemId, it.x, it.z, it.rot)) occupied.add(`${x},${z}`);
  }
  const c = Math.floor(map.size / 2);
  for (let r = 0; r < map.size; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = c + dx;
        const z = c + dz;
        if (x < 0 || z < 0 || x >= map.size || z >= map.size) continue;
        // Require a 3x3 clear area so we don't spawn inside a ramp.
        let clear = true;
        for (let i = -1; i <= 1 && clear; i++) for (let j = -1; j <= 1 && clear; j++) if (occupied.has(`${x + i},${z + j}`)) clear = false;
        if (clear) return new Vector3(x - map.size / 2 + 0.5, 0.1, z - map.size / 2 + 0.5);
      }
    }
  }
  return new Vector3(0, 0.1, 0);
}

function pickQuality(): "high" | "medium" | "low" {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile && cores <= 4) return "low";
  if (mobile) return "medium";
  return "high";
}
