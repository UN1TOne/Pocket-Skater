/**
 * Headless AI eval: one (map, seed) run of the real PlayerController + AiNavigator on
 * Havok + Recast under NullEngine, with a fixed 1/60 s step. Prints one JSON result line.
 *
 * Bundled + launched by scripts/ai-sim/run.mjs — don't run directly.
 * Mirrors SkateScene.init/tick; anything that only affects rendering is skipped.
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import HavokPhysics from "@babylonjs/havok";
import * as fs from "node:fs";
import * as path from "node:path";
import { PRESET_MAPS } from "@/data/presets";
import { CATALOG_BY_ID } from "@/data/catalog";
import { gridToWorld, rotationY } from "@/engine/world/park";
import type { Instance } from "@/engine/assets/AssetLoader";
import { PlayerController } from "@/skate/PlayerController";
import { AiNavigator } from "@/skate/AiNavigator";
import { buildPointsOfInterest, findSpawn, RespawnPlanner, type RawPiece } from "@/skate/parkLayout";
import { BAIL_PENALTY, GRIND_POINTS_PER_SEC, airScore, grindBonus } from "@/skate/scoring";

const DT = 1 / 60;
/** Matches Bail.trigger's ragdoll timer: respawn fires this long after a bail. */
const BAIL_RAGDOLL_SEC = 1.15;

export interface RunResult {
  map: string;
  seed: number;
  seconds: number;
  score: number;
  scorePerMin: number;
  grindSec: number;
  grinds: number;
  longestGrind: number;
  airs: number;
  bails: number;
  unsticks: number;
  /** Seconds spent below 0.5 m/s while not bailed — wandering/pinned proxy. */
  slowSec: number;
  /** Skateable pieces (rail/grind/ramp) actually ground or launched from, / total. */
  spotsUsed: number;
  spotsTotal: number;
  /** Fraction of time spent in the single busiest 3×3 cell window (revisit proxy). */
  hotspotShare: number;
  /** Distinct grid cells visited / all cells. */
  coverage: number;
  ai: Record<string, number | string>;
  wallMs: number;
}

const [, , ROOT, MAP_ID, SEED_S, SECONDS_S] = process.argv;

async function main() {
  const t0 = Date.now();
  const seed = Number(SEED_S);
  const seconds = Number(SECONDS_S);
  Math.random = mulberry32(seed);
  const map = PRESET_MAPS.find((m) => m.id === MAP_ID);
  if (!map) throw new Error(`unknown map ${MAP_ID}`);

  const hk = await HavokPhysics({ wasmBinary: fs.readFileSync(path.join(ROOT, "node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm")) } as never);
  const engine = new NullEngine();
  // Recast's crowd and Havok both read the engine delta — pin it to the fixed step.
  engine.getDeltaTime = () => DT * 1000;
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true; // same as createWorld — GLBs load without a handedness flip
  new FreeCamera("cam", new Vector3(0, 10, -10), scene);
  scene.enablePhysics(new Vector3(0, -9.81 * 1.6, 0), new HavokPlugin(false, hk)); // gravity = enableHavok default
  (scene.getPhysicsEngine() as PhysicsEngine).setTimeStep(DT);

  // --- World: mirrors SkateScene.init ---
  const slab = CreateGround("park-slab", { width: map.size, height: map.size, subdivisions: 1 }, scene);
  slab.position.y = 0.002;
  slab.metadata = { kind: "ground" };
  const apron = CreateGround("apron", { width: 260, height: 260, subdivisions: 1 }, scene);
  new PhysicsAggregate(slab, PhysicsShapeType.BOX, { mass: 0, friction: 0.3, restitution: 0 }, scene);
  new PhysicsAggregate(apron, PhysicsShapeType.BOX, { mass: 0, friction: 0.3, restitution: 0 }, scene);
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
    wall.metadata = { kind: "wall", tags: ["wall"] };
    new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.1, restitution: 0.1 }, scene);
  });

  const staticMeshes: Mesh[] = [slab];
  const rawPieces: RawPiece[] = [];
  const skateable = new Set<string>();
  for (const placed of map.items) {
    const def = CATALOG_BY_ID[placed.itemId];
    if (!def || def.category === "floors" || def.category === "exteriors") continue;
    const root = new TransformNode(`piece:${placed.uid}`, scene);
    const pos = gridToWorld(placed.itemId, placed.x, placed.z, placed.rot, map.size);
    if (placed.y) pos.y += placed.y;
    root.position = pos;
    root.rotation.y = rotationY(placed.rot);
    let maxY = 0;
    for (const m of loadGlbMeshes(scene, placed.itemId)) {
      m.parent = root;
      m.metadata = { itemId: placed.itemId, uid: placed.uid, tags: def.tags, kind: def.tags.includes("wall") ? "wall" : "piece" };
      m.computeWorldMatrix(true);
      new PhysicsAggregate(m, PhysicsShapeType.MESH, { mass: 0, friction: 0.25, restitution: 0 }, scene);
      staticMeshes.push(m);
      m.refreshBoundingInfo();
      const by = m.getBoundingInfo().boundingBox.maximumWorld.y;
      if (by > maxY) maxY = by;
    }
    rawPieces.push({ x: placed.x, z: placed.z, rot: placed.rot, def, pos: gridToWorld(def.id, placed.x, placed.z, placed.rot, map.size), topY: maxY });
    if (def.tags.some((t) => t === "rail" || t === "grind" || t === "ramp")) skateable.add(placed.uid);
  }
  const pois = buildPointsOfInterest(rawPieces);

  // --- Rider + AI ---
  let simTime = 0;
  let score = 0;
  let grindStartT = -1;
  let bailTimer = 0;
  const m = { grindSec: 0, grinds: 0, longestGrind: 0, airs: 0, bails: 0, unsticks: 0, slowSec: 0 };
  const stub = (): Instance => ({ root: new TransformNode("stub", scene), meshes: [], animationGroups: [], dispose() {} });
  const player = new PlayerController(scene, stub(), stub(), "skateboard", findSpawn(map), {
    onLand: (_fall, airtime) => {
      const air = airScore(airtime);
      if (air > 0) {
        score += air;
        m.airs += 1;
        if (launchUid && skateable.has(launchUid)) used.add(launchUid);
      }
    },
    onBail: () => {
      score = Math.max(0, score - BAIL_PENALTY);
      m.bails += 1;
      bailTimer = BAIL_RAGDOLL_SEC;
    },
    onGrindChange: (g) => {
      if (g) grindStartT = simTime;
      else if (grindStartT >= 0) {
        const dur = simTime - grindStartT;
        grindStartT = -1;
        score += grindBonus(dur);
        m.grinds += 1;
        m.longestGrind = Math.max(m.longestGrind, dur);
      }
    },
  });
  const unstick = player.unstick.bind(player);
  player.unstick = () => {
    m.unsticks += 1;
    unstick();
  };
  const ai = new AiNavigator(scene, pois, half);
  await ai.bake(staticMeshes);
  if (!ai.usingNavMesh) throw new Error("navmesh bake failed — results would not match the game");
  ai.attach(player);
  player.driver = "ai";
  const respawns = new RespawnPlanner();

  // --- Metrics probes ---
  const used = new Set<string>();
  const under = new PhysicsRaycastResult();
  const physics = scene.getPhysicsEngine() as PhysicsEngine;
  let groundUid: string | null = null;
  let launchUid: string | null = null;
  let wasGrounded = false;
  const cellTime = new Float64Array(map.size * map.size);

  // Same order as SkateScene.tick in AI mode, hooked where the game hooks it.
  scene.onBeforeRenderObservable.add(() => {
    ai.update(player, DT);
    player.update(DT);
    if (player.state === "grinding") score += DT * GRIND_POINTS_PER_SEC;
    if (bailTimer > 0) {
      bailTimer -= DT;
      if (bailTimer <= 0) {
        const safe = player["lastSafePos"] as Vector3;
        const dest = respawns.pick(safe, simTime * 1000, map);
        player.respawn();
        if (dest !== safe) player.teleport(dest);
      }
    }
  });

  const frames = Math.round(seconds / DT);
  for (let f = 0; f < frames; f++) {
    scene.render();
    simTime += DT;

    const p = player.position;
    if (player.state !== "bailed") {
      if (player.speed < 0.5) m.slowSec += DT;
      const cx = Math.floor(p.x + half);
      const cz = Math.floor(p.z + half);
      if (cx >= 0 && cz >= 0 && cx < map.size && cz < map.size) cellTime[cz * map.size + cx] += DT;
    }
    if (player.grounded) {
      physics.raycastToRef(p, p.add(new Vector3(0, -0.7, 0)), under);
      groundUid = under.hasHit && under.body !== player.body ? ((under.body?.transformNode?.metadata as { uid?: string } | undefined)?.uid ?? null) : null;
    }
    if (wasGrounded && !player.grounded) launchUid = groundUid;
    wasGrounded = player.grounded;
    if (player.state === "grinding") {
      m.grindSec += DT;
      if (groundUid && skateable.has(groundUid)) used.add(groundUid);
    }
  }

  const totalCellTime = cellTime.reduce((a, b) => a + b, 0) || 1;
  let hot = 0;
  for (let z = 0; z < map.size - 2; z++) {
    for (let x = 0; x < map.size - 2; x++) {
      let s = 0;
      for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) s += cellTime[(z + dz) * map.size + x + dx];
      hot = Math.max(hot, s);
    }
  }
  const result: RunResult = {
    map: map.name,
    seed,
    seconds,
    score: Math.floor(score),
    scorePerMin: (score / seconds) * 60,
    ...m,
    spotsUsed: used.size,
    spotsTotal: skateable.size,
    hotspotShare: hot / totalCellTime,
    coverage: cellTime.filter((t) => t > 0).length / cellTime.length,
    ai: { ...ai.debug },
    wallMs: Date.now() - t0,
  };
  process.stdout.write("RESULT " + JSON.stringify(result) + "\n");
  process.exit(0);
}

/** Minimal GLB → meshes (positions + indices only; physics doesn't need the rest). */
function loadGlbMeshes(scene: Scene, id: string): Mesh[] {
  const b = fs.readFileSync(path.join(ROOT, `public/assets/models/${id}.glb`));
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  const bin = 20 + jl + 8;
  const read = (ai: number): number[] => {
    const a = j.accessors[ai];
    const bv = j.bufferViews[a.bufferView];
    const comps = ({ SCALAR: 1, VEC3: 3 } as Record<string, number>)[a.type];
    const ct = a.componentType;
    const size = ct === 5126 || ct === 5125 ? 4 : ct === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? size * comps;
    const off = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out: number[] = [];
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < comps; c++) {
        const o = off + i * stride + c * size;
        out.push(ct === 5126 ? b.readFloatLE(o) : ct === 5125 ? b.readUInt32LE(o) : ct === 5123 ? b.readUInt16LE(o) : b.readUInt8(o));
      }
    }
    return out;
  };
  // Every skate-park GLB is flat: root-level mesh nodes, optionally with TRS (vehicle.glb).
  const sceneDef = j.scenes[j.scene ?? 0];
  return sceneDef.nodes.map((ni: number) => {
    const node = j.nodes[ni];
    if (node.mesh === undefined || node.children || node.matrix) throw new Error(`${id}: unsupported GLB node layout`);
    const mesh = new Mesh(node.name ?? `${id}-${ni}`, scene);
    if (node.translation) mesh.position.fromArray(node.translation);
    if (node.rotation) mesh.rotationQuaternion = Quaternion.FromArray(node.rotation);
    if (node.scale) mesh.scaling.fromArray(node.scale);
    const pos: number[] = [];
    const idx: number[] = [];
    for (const prim of j.meshes[node.mesh].primitives) {
      const base = pos.length / 3;
      pos.push(...read(prim.attributes.POSITION));
      idx.push(...read(prim.indices).map((i) => i + base));
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(mesh);
    return mesh;
  });
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
