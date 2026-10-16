import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { MapData, PlacedItem, Rotation } from "@/types/game";
import { CATALOG_BY_ID } from "@/data/catalog";
import { footprintCells } from "@/store/useGameStore";
import { AssetLoader, type Instance } from "../assets/AssetLoader";
import type { World } from "./createWorld";

/** World-space center of a placed item's footprint (grid cell → world unit). */
export function gridToWorld(itemId: string, x: number, z: number, rot: Rotation, gridSize: number): Vector3 {
  const cells = footprintCells(itemId, x, z, rot);
  let sx = 0;
  let sz = 0;
  for (const [cx, cz] of cells) {
    sx += cx;
    sz += cz;
  }
  const cx = sx / cells.length;
  const cz = sz / cells.length;
  return new Vector3(cx - gridSize / 2 + 0.5, 0, cz - gridSize / 2 + 0.5);
}

/** Inverse: world position → grid cell (floored). */
export function worldToGrid(p: Vector3, gridSize: number): { x: number; z: number } {
  return { x: Math.floor(p.x + gridSize / 2), z: Math.floor(p.z + gridSize / 2) };
}

export const rotationY = (rot: Rotation) => (rot * Math.PI) / 2;

export interface ParkPiece {
  placed: PlacedItem;
  instance: Instance;
}

const samePlacement = (a: PlacedItem, b: PlacedItem) =>
  a.itemId === b.itemId && a.x === b.x && a.z === b.z && a.rot === b.rot;

/** Instantiates a MapData into the world; the Builder uses it live, the Skate scene builds it once. */
export class Park {
  readonly pieces = new Map<string, ParkPiece>();
  readonly loader: AssetLoader;

  constructor(
    readonly world: World,
    readonly gridSize: number,
  ) {
    this.loader = new AssetLoader(world.scene);
  }

  get scene(): Scene {
    return this.world.scene;
  }

  async build(map: MapData) {
    await this.loader.preload([...new Set(map.items.map((i) => i.itemId))]);
    await Promise.all(map.items.map((it) => this.add(it)));
  }

  async add(placed: PlacedItem): Promise<ParkPiece | null> {
    if (!CATALOG_BY_ID[placed.itemId]) return null;
    const inst = await this.loader.instantiate(placed.itemId, `piece:${placed.uid}`);
    if (this.pieces.has(placed.uid)) {
      inst.dispose();
      return this.pieces.get(placed.uid)!;
    }
    inst.root.position = gridToWorld(placed.itemId, placed.x, placed.z, placed.rot, this.gridSize);
    inst.root.rotation.y = rotationY(placed.rot);
    inst.root.metadata = { ...inst.root.metadata, uid: placed.uid, tags: CATALOG_BY_ID[placed.itemId].tags };
    for (const m of inst.meshes) m.metadata = { ...m.metadata, uid: placed.uid, tags: CATALOG_BY_ID[placed.itemId].tags };
    this.world.addShadowCaster(inst.root, true);
    const piece = { placed, instance: inst };
    this.pieces.set(placed.uid, piece);
    return piece;
  }

  remove(uid: string) {
    const piece = this.pieces.get(uid);
    if (!piece) return;
    for (const m of piece.instance.meshes) this.world.shadows.removeShadowCaster(m);
    piece.instance.dispose();
    this.pieces.delete(uid);
  }

  /** Diff-sync against a new item list; also updates in-place rotation/position for same-uid pieces. */
  async sync(items: PlacedItem[]) {
    const wanted = new Map(items.map((i) => [i.uid, i]));
    for (const uid of [...this.pieces.keys()]) if (!wanted.has(uid)) this.remove(uid);
    for (const item of items) {
      const existing = this.pieces.get(item.uid);
      if (!existing) continue;
      if (samePlacement(existing.placed, item)) continue;
      existing.instance.root.position = gridToWorld(item.itemId, item.x, item.z, item.rot, this.gridSize);
      existing.instance.root.rotation.y = rotationY(item.rot);
      existing.placed = item;
    }
    const toAdd = items.filter((i) => !this.pieces.has(i.uid));
    await Promise.all(toAdd.map((i) => this.add(i)));
  }

  dispose() {
    for (const uid of [...this.pieces.keys()]) this.remove(uid);
    this.loader.dispose();
  }
}
