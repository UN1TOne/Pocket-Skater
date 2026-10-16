import type { CatalogItem, ItemCategory } from "@/types/game";

/** Item catalog — each id maps to /assets/models/<id>.glb and /assets/images/preview/<id>.png. */
export const CATALOG: CatalogItem[] = [
  { id: "ramp", label: "Kicker", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "ramp-rail", label: "Kicker + Rail", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp", "grind"] },
  { id: "half-pipe", label: "Quarter Pipe", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp"], stackTop: 1.0 },
  { id: "half-pipe-low", label: "Low Quarter", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp"], stackTop: 0.5 },
  { id: "slope-smooth", label: "Long Slope", category: "ramps", footprint: { w: 1, d: 2 }, tags: ["ramp"] },
  { id: "steps", label: "Steps", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "steps-rail", label: "Steps + Rail", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp", "grind"] },
  { id: "structure-platform", label: "Platform", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["wall", "flat"], stackTop: 1.0 },
  { id: "structure-wood", label: "Wood Tower", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["wall"], stackTop: 1.0 },
  { id: "structure-wood-platform", label: "Wood Deck", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["wall", "flat"], stackTop: 0.6 },

  // Rails
  { id: "rail-low", label: "Low Rail", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-low-end", label: "Low Rail End", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-high", label: "High Rail", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-curve", label: "Curved Rail", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"], curved: true },
  { id: "rail-high-curve", label: "High Curve", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"], curved: true },
  { id: "rail-slope", label: "Slope Rail", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-slope-smooth", label: "Smooth Slope", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },

  // Bowls
  { id: "bowl-side", label: "Bowl Side", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-side-low", label: "Low Side", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-corner-inner", label: "Inner Corner", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-corner-inner-low", label: "Low Inner", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-corner-outer", label: "Outer Corner", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-corner-outer-low", label: "Low Outer", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-platform", label: "Bowl Deck", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["wall", "flat"], stackTop: 0.5 },

  // Obstacles
  { id: "obstacle-box", label: "Box", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["flat", "grind"], stackTop: 0.5 },
  { id: "obstacle-box-grind", label: "Grind Box", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["grind"], stackTop: 0.5 },
  { id: "obstacle-middle", label: "Ledge", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["flat", "grind"], stackTop: 0.4 },
  { id: "obstacle-middle-rail", label: "Ledge + Rail", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["flat", "grind"] },
  { id: "obstacle-end", label: "Ledge End", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["ramp", "grind"] },
  { id: "obstacle-corner", label: "Ledge Corner", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["flat", "grind"], stackTop: 0.4 },

  // Props
  { id: "bench", label: "Bench", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "wall"] },
  { id: "benches", label: "Bleachers", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "wall"] },
  { id: "fence", label: "Fence", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "wall"] },
  { id: "pallet", label: "Pallet", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "flat"], stackTop: 0.15 },
  { id: "plank", label: "Plank", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "flat"], stackTop: 0.08 },
  { id: "vehicle", label: "Taxi", category: "props", footprint: { w: 2, d: 1 }, tags: ["decor", "wall"] },

  // Floors
  { id: "floor-concrete", label: "Concrete", category: "floors", footprint: { w: 1, d: 1 }, tags: ["floor"] },
  { id: "floor-wood", label: "Wood Floor", category: "floors", footprint: { w: 1, d: 1 }, tags: ["floor"] },

  // Exteriors — Kenney nature pack. IDs are prefixed with `exterior-` so they can't collide
  // with the skate catalog (e.g. the park has its own `fence`). modelUrl() strips the prefix
  // and loads from /assets/models/exteriors/<name>.glb. These never get physics bodies in
  // the skate scene — they live purely for visual framing in the outer ring.
  { id: "exterior-tree", label: "Tree", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-tree-high", label: "Tall Tree", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-plant", label: "Shrub", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-rocks-high", label: "Rocks (Tall)", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-rocks-low", label: "Rocks (Low)", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-rocks-ramp", label: "Rock Ramp", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-stones", label: "Stones", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-patch-grass", label: "Grass Patch", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-patch-dirt", label: "Dirt Patch", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-fence", label: "Wood Fence", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-bridge", label: "Bridge", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-platform", label: "Platform", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"], stackTop: 0.5 },
  { id: "exterior-ladder", label: "Ladder", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-flag", label: "Flag", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-tent", label: "Tent", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-target", label: "Target", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-building-platform", label: "Lookout Deck", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"], stackTop: 1.0 },
  { id: "exterior-building-roof", label: "Lookout Roof", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
  { id: "exterior-building-structure", label: "Lookout Posts", category: "exteriors", footprint: { w: 1, d: 1 }, tags: ["decor", "nature"] },
];

export const CATALOG_BY_ID: Record<string, CatalogItem> = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

export const CATEGORIES: Array<{ id: ItemCategory; label: string; emoji: string }> = [
  { id: "ramps", label: "Ramps", emoji: "🛹" },
  { id: "rails", label: "Rails", emoji: "➰" },
  { id: "bowls", label: "Bowls", emoji: "🥣" },
  { id: "obstacles", label: "Ledges", emoji: "🧱" },
  { id: "props", label: "Props", emoji: "🪑" },
  { id: "floors", label: "Floors", emoji: "⬜" },
  { id: "exteriors", label: "Nature", emoji: "🌲" },
];

export const previewUrl = (id: string) => `/assets/images/preview/${id}.png`;
const EXTERIORS_DIR = "exteriors";
export const modelUrl = (id: string): string => {
  const item = CATALOG_BY_ID[id];
  if (item?.category === "exteriors") {
    // Strip the `exterior-` prefix so the file lookup matches the GLB name on disk.
    const file = id.startsWith("exterior-") ? id.slice("exterior-".length) : id;
    return `/assets/models/${EXTERIORS_DIR}/${file}.glb`;
  }
  return `/assets/models/${id}.glb`;
};
export const bgUrl = (name: "landing" | "sky" | "dusk") => `/assets/images/bg/${name}.png`;
