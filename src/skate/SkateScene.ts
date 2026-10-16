import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { createEngine, enableHavok } from "@/engine/createEngine";
import { createWorld, type World } from "@/engine/world/createWorld";
import { Park } from "@/engine/world/park";
import { gameInput } from "@/engine/input";
import { Sfx } from "@/engine/audio/Sfx";
import { CATALOG_BY_ID } from "@/data/catalog";
import type { GameHud } from "@/store/useGameStore";
import { BAIL_PENALTY, GRIND_POINTS_PER_SEC, airScore, grindBonus, grindLabel } from "./scoring";
import { findSpawn, RespawnPlanner, type RawPiece } from "./parkLayout";
import { buildSpots } from "./spots";
import type { CharacterId, MapData, PlayMode, RideId } from "@/types/game";
import { PlayerController } from "./PlayerController";
import { AiNavigator } from "./AiNavigator";
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
  readonly sfx = new Sfx();
  mode: PlayMode;
  paused = false;
  private score = 0;
  private hudTimer = 0;
  private disposed = false;
  private camTarget = new Vector3();
  private respawns = new RespawnPlanner();
  private grindStart = 0;

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
    // Phase 1: register physics on every placed piece and collect raw per-piece info.
    const rawPieces: RawPiece[] = [];
    for (const piece of this.park.pieces.values()) {
      const def = CATALOG_BY_ID[piece.placed.itemId];
      // Floors have no collider (walked-on only); exteriors are pure decoration (trees, rocks,
      // grass) outside the skate zone and never get a physics body.
      if (!def || def.category === "floors" || def.category === "exteriors") continue;
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
      rawPieces.push({ uid: piece.placed.uid, x: piece.placed.x, z: piece.placed.z, rot: piece.placed.rot, def, pos: piece.instance.root.position.clone(), topY: maxY });
    }

    const spots = buildSpots(rawPieces, scene.getPhysicsEngine() as PhysicsEngine, map.size);

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
      onJump: () => this.sfx.jump(),
      onLand: (fall, airtime) => {
        const air = airScore(airtime);
        if (air > 0) this.addScore(air);
        // Rail landings get the grind clank instead of a ground thud.
        if (fall > 1.5 && !this.player.groundTags.includes("rail")) this.sfx.impact(fall / 7);
      },
      onImpact: (speed, metal) => this.sfx.impact(speed / 5, metal),
      onBail: (vel) => {
        this.sfx.bail();
        this.score = Math.max(0, this.score - BAIL_PENALTY);
        this.opts.onHud({ bailed: true, score: Math.floor(this.score) });
        void this.bail.trigger(this.player, vel, this.opts.character, this.opts.ride);
      },
      onGrindChange: (g) => {
        if (g) this.sfx.grindStart();
        else this.sfx.grindStop();
        this.opts.onHud({ grinding: g });
        if (g) {
          this.grindStart = performance.now();
        } else if (this.grindStart > 0) {
          const dur = (performance.now() - this.grindStart) / 1000;
          this.grindStart = 0;
          const bonus = grindBonus(dur);
          if (bonus > 0) {
            this.score += bonus;
            this.opts.onHud({ score: Math.floor(this.score), toast: { text: grindLabel(dur), bonus, t: performance.now() } });
          }
        }
        if (import.meta.env.DEV) {
          const log = ((window as unknown as { __grindLog?: Array<{ t: number; on: boolean; pos: [number, number, number]; speed: number; tags: string[] }> }).__grindLog ??= []);
          const pp = this.player.position;
          log.push({ t: performance.now(), on: g, pos: [pp.x, pp.y, pp.z], speed: this.player.speed, tags: this.player.groundTags.slice() });
          if (log.length > 1000) log.splice(0, 200);
        }
      },
    });

    onProgress?.("Teaching the AI to skate…");
    this.ai = new AiNavigator(scene, spots, half);
    await this.ai.bake(staticMeshes);
    if (this.disposed) return;
    this.ai.attach(this.player);
    this.player.driver = this.mode === "ai" ? "ai" : "manual";
    if (import.meta.env.DEV) Object.assign(window, { __aiDebug: this.ai.debug, __spots: spots });

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
    const dest = this.respawns.pick(safe, performance.now(), this.opts.map);
    this.player.respawn();
    if (dest !== safe) this.player.teleport(dest);
  }

  private tick() {
    if (!this.player) return;
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    this.sfx.setPaused(this.paused);
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
    if (this.player.state === "grinding") {
      this.score += dt * GRIND_POINTS_PER_SEC;
      this.sfx.setGrindSpeed(this.player.speed);
    }

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
    this.sfx.dispose();
    this.ai?.dispose();
    this.bail?.dispose();
    this.player?.dispose();
    this.park?.dispose();
    this.world?.dispose();
    this.engine.dispose();
  }
}

function pickQuality(): "high" | "medium" | "low" {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile && cores <= 4) return "low";
  if (mobile) return "medium";
  return "high";
}
