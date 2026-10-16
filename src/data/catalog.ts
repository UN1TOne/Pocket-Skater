import type { CatalogItem, ItemCategory } from "@/types/game";

/** Item catalog — each id maps to /assets/models/<id>.glb and /assets/images/preview/<id>.png. */
export const CATALOG: CatalogItem[] = [
  { id: "ramp", label: "Kicker", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "ramp-rail", label: "Kicker + Rail", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp", "grind"] },
  { id: "half-pipe", label: "Quarter Pipe", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "half-pipe-low", label: "Low Quarter", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "slope-smooth", label: "Long Slope", category: "ramps", footprint: { w: 1, d: 2 }, tags: ["ramp"] },
  { id: "steps", label: "Steps", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "steps-rail", label: "Steps + Rail", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["ramp", "grind"] },
  { id: "structure-platform", label: "Platform", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["wall", "flat"] },
  { id: "structure-wood", label: "Wood Tower", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["wall"] },
  { id: "structure-wood-platform", label: "Wood Deck", category: "ramps", footprint: { w: 1, d: 1 }, tags: ["wall", "flat"] },

  // Rails
  { id: "rail-low", label: "Low Rail", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-low-end", label: "Low Rail End", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-high", label: "High Rail", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-curve", label: "Curved Rail", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-high-curve", label: "High Curve", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-slope", label: "Slope Rail", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },
  { id: "rail-slope-smooth", label: "Smooth Slope", category: "rails", footprint: { w: 1, d: 1 }, tags: ["rail", "grind"] },

  // Bowls
  { id: "bowl-side", label: "Bowl Side", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-side-low", label: "Low Side", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-corner-inner", label: "Inner Corner", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-corner-inner-low", label: "Low Inner", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-corner-outer", label: "Outer Corner", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-corner-outer-low", label: "Low Outer", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["ramp"] },
  { id: "bowl-platform", label: "Bowl Deck", category: "bowls", footprint: { w: 1, d: 1 }, tags: ["wall", "flat"] },

  // Obstacles
  { id: "obstacle-box", label: "Box", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["flat", "grind"] },
  { id: "obstacle-box-grind", label: "Grind Box", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["grind"] },
  { id: "obstacle-middle", label: "Ledge", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["flat", "grind"] },
  { id: "obstacle-middle-rail", label: "Ledge + Rail", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["flat", "grind"] },
  { id: "obstacle-end", label: "Ledge End", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["ramp", "grind"] },
  { id: "obstacle-corner", label: "Ledge Corner", category: "obstacles", footprint: { w: 1, d: 1 }, tags: ["flat", "grind"] },

  // Props
  { id: "bench", label: "Bench", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "wall"] },
  { id: "benches", label: "Bleachers", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "wall"] },
  { id: "fence", label: "Fence", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "wall"] },
  { id: "pallet", label: "Pallet", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "flat"] },
  { id: "plank", label: "Plank", category: "props", footprint: { w: 1, d: 1 }, tags: ["decor", "flat"] },
  { id: "vehicle", label: "Taxi", category: "props", footprint: { w: 2, d: 1 }, tags: ["decor", "wall"] },

  // Floors
  { id: "floor-concrete", label: "Concrete", category: "floors", footprint: { w: 1, d: 1 }, tags: ["floor"] },
  { id: "floor-wood", label: "Wood Floor", category: "floors", footprint: { w: 1, d: 1 }, tags: ["floor"] },
];

export const CATALOG_BY_ID: Record<string, CatalogItem> = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

export const CATEGORIES: Array<{ id: ItemCategory; label: string; emoji: string }> = [
  { id: "ramps", label: "Ramps", emoji: "🛹" },
  { id: "rails", label: "Rails", emoji: "➰" },
  { id: "bowls", label: "Bowls", emoji: "🥣" },
  { id: "obstacles", label: "Ledges", emoji: "🧱" },
  { id: "props", label: "Props", emoji: "🪑" },
  { id: "floors", label: "Floors", emoji: "⬜" },
];

export const previewUrl = (id: string) => `/assets/images/preview/${id}.png`;
export const modelUrl = (id: string) => `/assets/models/${id}.glb`;
export const bgUrl = (name: "landing" | "sky" | "dusk") => `/assets/images/bg/${name}.png`;
