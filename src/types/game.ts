export type Page = "landing" | "builder" | "skate";

export type CharacterId = "character-skate-boy" | "character-skate-girl";
export type RideId = "skateboard" | "scooter";
export type PlayMode = "manual" | "ai";

export type ItemCategory = "ramps" | "rails" | "bowls" | "obstacles" | "props" | "floors";

/** One entry of the item catalog (maps 1:1 to a GLB in /assets/models). */
export interface CatalogItem {
  id: string;
  label: string;
  category: ItemCategory;
  /** Footprint in grid cells (x = width, z = depth) at rotation 0. */
  footprint: { w: number; d: number };
  /** Gameplay semantics used by the skate scene & AI. */
  tags: Array<"ramp" | "rail" | "grind" | "flat" | "wall" | "decor" | "floor">;
}

/** Grid rotation in quarter turns (0, 90, 180, 270 degrees). */
export type Rotation = 0 | 1 | 2 | 3;

export interface PlacedItem {
  uid: string;
  itemId: string;
  /** Grid cell coordinates (integers). */
  x: number;
  z: number;
  rot: Rotation;
}

export interface MapData {
  id: string;
  name: string;
  /** Number of cells along each axis (square grid). */
  size: number;
  items: PlacedItem[];
  /** Optional: a description shown on the map card. */
  blurb?: string;
  preset?: boolean;
  /**
   * Data-URL PNG thumbnail of this map. For custom maps this is captured by the
   * Builder on exit; for presets it is generated at runtime by MapThumbnailService
   * and cached in memory only (so we don't bloat the bundle).
   */
  thumbnail?: string;
}
