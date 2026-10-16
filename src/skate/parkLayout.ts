import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { rotationY } from "@/engine/world/park";
import { CATALOG_BY_ID } from "@/data/catalog";
import { footprintCells } from "@/store/useGameStore";
import type { MapData } from "@/types/game";
import type { PointOfInterest } from "./AiNavigator";

/**
 * Pure park-layout analysis shared by SkateScene and the headless AI eval harness
 * (scripts/ai-sim): spawn search and the AI's points of interest.
 */

/** Per-piece info collected after physics registration. */
export interface RawPiece {
  x: number;
  z: number;
  rot: number;
  def: (typeof CATALOG_BY_ID)[string];
  pos: Vector3;
  topY: number;
}

export function buildPointsOfInterest(rawPieces: RawPiece[]): PointOfInterest[] {
  // Phase 2: group adjacent grind pieces into chains so the AI aims at the full line
  // instead of a 1m fragment. Pieces chain when they share the same major axis (rot 0/2 vs 1/3),
  // the same perpendicular grid coord, and are in consecutive cells along the axis — AND their
  // top heights match within a tolerance (so low/high rails don't merge).
  //
  // We also key chains by whether the group has mixed rail-* vs ledge-* tags, keeping those apart.
  const pois: PointOfInterest[] = [];
  // Only chain thin rail pieces (rail-*). Non-thin grind pieces (ledges, boxes) don't have the
  // Y lock + minRailSpeed physics so the AI can't persistently grind them — leaving them as
  // solo POIs so the weighted picker deprioritizes them.
  const thinRailRaw = rawPieces.filter((r) => r.def.tags.includes("rail"));
  const otherGrindRaw = rawPieces.filter(
    (r) => !r.def.tags.includes("rail") && r.def.tags.includes("grind"),
  );
  const nonGrindRaw = rawPieces.filter(
    (r) => !r.def.tags.includes("rail") && !r.def.tags.includes("grind"),
  );
  const consumed = new Set<RawPiece>();
  for (const seed of thinRailRaw) {
    if (consumed.has(seed)) continue;
    const axisAlongZ = seed.rot % 2 === 0; // rot 0,2 → axis Z; rot 1,3 → axis X
    const perpKey = axisAlongZ ? seed.x : seed.z;
    // Collect every thin rail on the same perpendicular line with matching topY tolerance.
    const candidates = thinRailRaw.filter(
      (r) =>
        !consumed.has(r) &&
        r.rot % 2 === seed.rot % 2 &&
        (axisAlongZ ? r.x === perpKey : r.z === perpKey) &&
        Math.abs(r.topY - seed.topY) < 0.15,
    );
    // Sort along axis.
    candidates.sort((a, b) => (axisAlongZ ? a.z - b.z : a.x - b.x));
    // Walk from the seed outward in both directions, keeping only pieces that are grid-adjacent.
    const seedIdx = candidates.indexOf(seed);
    const chain: RawPiece[] = [seed];
    consumed.add(seed);
    for (let i = seedIdx - 1; i >= 0; i--) {
      const prev = chain[0];
      const cur = candidates[i];
      const gap = axisAlongZ ? prev.z - cur.z : prev.x - cur.x;
      if (gap !== 1) break;
      chain.unshift(cur);
      consumed.add(cur);
    }
    for (let i = seedIdx + 1; i < candidates.length; i++) {
      const prev = chain[chain.length - 1];
      const cur = candidates[i];
      const gap = axisAlongZ ? cur.z - prev.z : cur.x - prev.x;
      if (gap !== 1) break;
      chain.push(cur);
      consumed.add(cur);
    }
    // Build one POI for the whole chain.
    const first = chain[0];
    const last = chain[chain.length - 1];
    const centerX = (first.pos.x + last.pos.x) / 2;
    const centerZ = (first.pos.z + last.pos.z) / 2;
    const length = chain.length; // 1 world unit per cell
    const topY = chain.reduce((m, r) => Math.max(m, r.topY), 0);
    pois.push({
      position: new Vector3(centerX, 0, centerZ),
      kind: "grind",
      axis: new Vector3(axisAlongZ ? 0 : 1, 0, axisAlongZ ? 1 : 0),
      length,
      topY,
      thin: true,
    });
  }
  // Non-thin grind pieces (ledges, boxes) stay as solo POIs — AI can target but weighted lower.
  for (const r of otherGrindRaw) {
    const yaw = rotationY(r.rot as 0 | 1 | 2 | 3);
    pois.push({
      position: r.pos,
      kind: "grind",
      axis: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
      length: 1,
      topY: r.topY,
      thin: false,
    });
  }
  // Keep ramp POIs for occasional variety.
  for (const r of nonGrindRaw) {
    if (r.def.tags.includes("ramp")) {
      const yaw = rotationY(r.rot as 0 | 1 | 2 | 3);
      pois.push({ position: r.pos, kind: "ramp", axis: new Vector3(Math.sin(yaw), 0, Math.cos(yaw)) });
    }
  }
  return pois;
}

/** Nearest empty cell to the map center (spiral search). */
export function findSpawn(map: MapData): Vector3 {
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

/** Spiral out from a world position to find an empty, obstacle-free grid cell. */
export function findEmptyNearby(map: MapData, worldPos: Vector3): Vector3 | null {
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

/**
 * Respawn spot choice. If the rider has been dying in the same spot repeatedly, move them to
 * a different nearby empty cell so they don't get stuck in a geometry pocket.
 */
export class RespawnPlanner {
  private history: Array<{ pos: Vector3; t: number }> = [];

  /** `nowMs` is the caller's clock (performance.now in game, sim time in the harness). */
  pick(safe: Vector3, nowMs: number, map: MapData): Vector3 {
    this.history = this.history.filter((r) => nowMs - r.t < 6000);
    const stuckCount = this.history.filter((r) => Vector3.Distance(r.pos, safe) < 0.6).length;
    let dest: Vector3 = safe;
    if (stuckCount >= 2) {
      const alt = findEmptyNearby(map, safe);
      if (alt) dest = alt;
    }
    this.history.push({ pos: dest.clone(), t: nowMs });
    return dest;
  }
}
