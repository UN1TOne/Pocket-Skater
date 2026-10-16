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
import { footprintCells } from "@/store/useGameStore";
import type { Instance } from "@/engine/assets/AssetLoader";
import { PlayerController } from "@/skate/PlayerController";
import { AI_TUNING, AiNavigator } from "@/skate/AiNavigator";
import { findSpawn, RespawnPlanner, type RawPiece } from "@/skate/parkLayout";
import { buildSpots, SPOT_MODEL_IDS, verifySpotGeometry } from "@/skate/spots";
import type { MapData, Rotation } from "@/types/game";
import { BAIL_PENALTY, GRIND_POINTS_PER_SEC, airScore, grindBonus } from "@/skate/scoring";

const DT = 1 / 60;
/** Synthetic map with every spot model in all four rotations — geometry self-test only. */
const CATALOG_MAP_ID = "__catalog__";
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
  spotStats: Record<string, { attempts: number; points: number; jumps: number; lands: number }>;
  spotInfo: Record<string, string>;
  /** Where bails happened + catalog ids within one cell — for diagnosing bail hotspots. */
  bailSites: Array<{ t: number; x: number; z: number; speed: number; phase: string; near: string[] }>;
  longGrinds: Array<{ t: number; dur: number; items: string[]; path: number; end: number[] }>;
  /** What the park analysis (src/skate/spots.ts) found; geometryMisses should be empty. */
  spots: { grind: number; ramp: number; usable: number; entries: number; blockedEnds: number; longestLine: number; geometryMisses: string[] };
  wallMs: number;
}

const [, , ROOT, MAP_ID, SEED_S, SECONDS_S] = process.argv;

async function main() {
  const t0 = Date.now();
  const seed = Number(SEED_S);
  const seconds = Number(SECONDS_S);
  Math.random = mulberry32(seed);
  // AI_TUNE='{"noveltyDamp":0.7}' overrides target-choice tuning for sweeps.
  if (process.env.AI_TUNE) Object.assign(AI_TUNING, JSON.parse(process.env.AI_TUNE));
  const map = MAP_ID === CATALOG_MAP_ID ? catalogTestMap() : PRESET_MAPS.find((m) => m.id === MAP_ID);
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
    rawPieces.push({ uid: placed.uid, x: placed.x, z: placed.z, rot: placed.rot, def, pos: pos.clone(), topY: maxY });
    if (def.tags.some((t) => t === "rail" || t === "grind" || t === "ramp")) skateable.add(placed.uid);
  }
  const physics = scene.getPhysicsEngine() as PhysicsEngine;
  const spots = buildSpots(rawPieces, physics, map.size);
  const geometryMisses = verifySpotGeometry(spots, physics);

  // --- Rider + AI ---
  let simTime = 0;
  let score = 0;
  let grindStartT = -1;
  let bailTimer = 0;
  /** Grinds over 6 s: what was underfoot and how far the rider actually travelled. */
  const longGrinds: Array<{ t: number; dur: number; items: string[]; path: number; end: number[] }> = [];
  const grindItems = new Set<string>();
  let grindPath = 0;
  const itemOf = new Map(map.items.map((it) => [it.uid, it.itemId]));
  const bailSites: Array<{ t: number; x: number; z: number; speed: number; phase: string; near: string[] }> = [];
  const m = { grindSec: 0, grinds: 0, longestGrind: 0, airs: 0, bails: 0, unsticks: 0, slowSec: 0 };
  const stub = (): Instance => ({ root: new TransformNode("stub", scene), meshes: [], animationGroups: [], dispose() {} });
  const player = new PlayerController(scene, stub(), stub(), "skateboard", findSpawn(map), {
    onLand: (_fall, airtime) => {
      const air = airScore(airtime);
      if (air > 0) {
        score += air;
        ai.notePoints(air);
        m.airs += 1;
        if (launchUid && skateable.has(launchUid)) used.add(launchUid);
      }
    },
    onBail: (vel, point) => {
      score = Math.max(0, score - BAIL_PENALTY);
      ai.notePoints(-BAIL_PENALTY);
      m.bails += 1;
      const cx = Math.floor(point.x + half);
      const cz = Math.floor(point.z + half);
      const near = map.items
        .filter((it) => footprintCells(it.itemId, it.x, it.z, it.rot).some(([x, z]) => Math.abs(x - cx) <= 1 && Math.abs(z - cz) <= 1))
        .map((it) => it.itemId);
      bailSites.push({ t: Math.round(simTime * 10) / 10, x: +point.x.toFixed(2), z: +point.z.toFixed(2), speed: +Math.hypot(vel.x, vel.z).toFixed(2), phase: String(ai.debug.lastPhase), near: [...new Set(near)] });
      bailTimer = BAIL_RAGDOLL_SEC;
    },
    onGrindChange: (g) => {
      if (g) grindStartT = simTime;
      else if (grindStartT >= 0) {
        const dur = simTime - grindStartT;
        const startedAt = grindStartT;
        grindStartT = -1;
        score += grindBonus(dur);
        ai.notePoints(grindBonus(dur));
        m.grinds += 1;
        m.longestGrind = Math.max(m.longestGrind, dur);
        if (dur > 6) {
          const p = player.position;
          longGrinds.push({ t: +startedAt.toFixed(1), dur: +dur.toFixed(1), items: [...grindItems], path: +grindPath.toFixed(1), end: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
        }
        grindItems.clear();
        grindPath = 0;
      }
    },
  });
  const unstick = player.unstick.bind(player);
  player.unstick = () => {
    m.unsticks += 1;
    unstick();
  };
  const ai = new AiNavigator(scene, spots, half);
  await ai.bake(staticMeshes);
  if (!ai.usingNavMesh) throw new Error("navmesh bake failed — results would not match the game");
  ai.attach(player);
  player.driver = "ai";
  const respawns = new RespawnPlanner();

  // --- Metrics probes ---
  const used = new Set<string>();
  const under = new PhysicsRaycastResult();
  let groundUid: string | null = null;
  let launchUid: string | null = null;
  let wasGrounded = false;
  const cellTime = new Float64Array(map.size * map.size);

  // Same order as SkateScene.tick in AI mode, hooked where the game hooks it.
  scene.onBeforeRenderObservable.add(() => {
    ai.update(player, DT);
    player.update(DT);
    if (player.state === "grinding") {
      score += DT * GRIND_POINTS_PER_SEC;
      ai.notePoints(DT * GRIND_POINTS_PER_SEC);
    }
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

  const [traceFrom, traceTo] = (process.env.AI_SIM_TRACE ?? "-1--1").split("-").map(Number);
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
    if (traceFrom >= 0 && simTime >= traceFrom && simTime <= traceTo) {
      const v = player.body.getLinearVelocity();
      const rd = player["railDir"] as Vector3 | null;
      process.stderr.write(`t=${simTime.toFixed(3)} ${player.state.padEnd(8)} g=${player.grounded ? 1 : 0} p=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) v=(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}) tags=${player.groundTags.join("/")} under=${groundUid ? itemOf.get(groundUid) : "-"} rail=${rd ? `(${rd.x.toFixed(2)},${rd.z.toFixed(2)})` : "-"} ai=${ai.debug.lastPhase} mv=(${player.moveDir.x.toFixed(2)},${player.moveDir.z.toFixed(2)}) guard=${player["railTracking"] ? 1 : 0}/${(player["railWindow"] as number).toFixed(2)}/${(player["railExpected"] as number).toFixed(3)}/${(player["railReleaseTimer"] as number).toFixed(2)}/${(player["railLastAlong"] as number).toFixed(2)}\n`);
    }
    if (player.state === "grinding") {
      m.grindSec += DT;
      grindPath += player.speed * DT;
      if (groundUid) grindItems.add(itemOf.get(groundUid) ?? groundUid);
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
    spotStats: Object.fromEntries(ai.spotStats),
    spotInfo: Object.fromEntries(spots.map((s) => [s.id, `${s.pieces.map((u) => itemOf.get(u)).join('+')} len=${s.length.toFixed(1)} h=${s.height.toFixed(2)} entries=${s.entries.map((e) => `(${e.start.x.toFixed(1)},${e.start.z.toFixed(1)})→(${e.end.x.toFixed(1)},${e.end.z.toFixed(1)})`).join(' ')}`])),
    bailSites,
    longGrinds,
    spots: {
      grind: spots.filter((s) => s.kind === "grind").length,
      ramp: spots.filter((s) => s.kind === "ramp").length,
      usable: spots.filter((s) => s.entries.length > 0).length,
      entries: spots.reduce((a, s) => a + s.entries.length, 0),
      blockedEnds: spots.reduce((a, s) => a + s.rejected, 0),
      longestLine: Math.max(0, ...spots.map((s) => s.length)),
      geometryMisses: geometryMisses.map((g) => `${g.spot} @(${g.point.x.toFixed(2)},${g.point.y.toFixed(2)},${g.point.z.toFixed(2)}) hit=${g.hitY?.toFixed(2) ?? "none"}`),
    },
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

function catalogTestMap(): MapData {
  const size = 32;
  const items: MapData["items"] = [];
  let i = 0;
  for (const itemId of SPOT_MODEL_IDS) {
    for (const rot of [0, 1, 2, 3] as Rotation[]) {
      // 3-cell spacing keeps pieces from touching, so every line stays a single piece.
      items.push({ uid: `c${i}`, itemId, x: 1 + (i % 10) * 3, z: 1 + Math.floor(i / 10) * 3, rot });
      i++;
    }
  }
  return { id: CATALOG_MAP_ID, name: "Catalog", size, items };
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
