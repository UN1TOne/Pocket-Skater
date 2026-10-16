import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CATALOG_BY_ID } from "@/data/catalog";
import { footprintCells } from "@/store/useGameStore";
import type { MapData } from "@/types/game";

/**
 * Pure park-layout analysis shared by SkateScene and the headless AI eval harness
 * (scripts/ai-sim): piece records, spawn search and respawn choice.
 */

/** Per-piece info collected after physics registration. */
export interface RawPiece {
  uid: string;
  x: number;
  z: number;
  rot: number;
  def: (typeof CATALOG_BY_ID)[string];
  /** World position of the piece root, including any stacking height. */
  pos: Vector3;
  topY: number;
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
