import type { MapData, PlacedItem, Rotation } from "@/types/game";

/**
 * Model-space, right-handed, Y up. Rot = quarter turns around +Y; at rot 0
 * ramps' high side faces -Z, rails run along Z, bowl-corner-inner opens
 * toward (+X,+Z) and bowl-corner-outer wraps the (-X,-Z) corner.
 */

let uidCounter = 0;
const p = (itemId: string, x: number, z: number, rot: Rotation = 0): PlacedItem => ({
  uid: `p${++uidCounter}`,
  itemId,
  x,
  z,
  rot,
});

/** Same shape as p() but attaches a stacking Y so the piece sits on top of a base. */
const pStack = (itemId: string, x: number, z: number, y: number, rot: Rotation = 0): PlacedItem => ({
  uid: `p${++uidCounter}`,
  itemId,
  x,
  z,
  rot,
  y,
});

/** Shorthand for exterior pieces — same shape as p() but makes the preset data read as "outer". */
const o = p;

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * Each preset gets a matching `outer*` array of decorative pieces placed OUTSIDE the main
 * grid (negative coords or >= size). These are purely visual — never get physics bodies in
 * the skate scene — but they frame the park so it reads as a world instead of a floating tile.
 */

/** Sunset Plaza — two facing quarter-pipe walls + street section. */
const sunsetPlaza: PlacedItem[] = [
  ...range(3, 10).map((x) => p("half-pipe", x, 0, 0)),
  p("bowl-corner-outer", 2, 0, 0),
  p("bowl-corner-outer", 11, 0, 3),
  ...range(3, 10).map((x) => p("half-pipe", x, 13, 2)),
  p("bowl-corner-outer", 2, 13, 1),
  p("bowl-corner-outer", 11, 13, 2),

  p("obstacle-box", 6, 6), p("obstacle-box", 7, 6), p("obstacle-box", 6, 7), p("obstacle-box", 7, 7),
  p("ramp", 6, 5, 2), p("ramp", 7, 5, 2),
  p("ramp", 6, 8, 0), p("ramp", 7, 8, 0),

  p("rail-low-end", 3, 4, 0),
  p("rail-low", 3, 5, 0), p("rail-low", 3, 6, 0), p("rail-low", 3, 7, 0),
  p("rail-low-end", 3, 8, 2),

  p("steps-rail", 10, 5, 2),
  p("slope-smooth", 10, 8, 0),
  p("obstacle-middle-rail", 10, 10, 1),
  p("obstacle-end", 11, 10, 3),

  p("rail-curve", 4, 10, 0),
  p("rail-high", 5, 11, 1),

  p("benches", 0, 4, 3), p("benches", 0, 9, 3),
  p("bench", 13, 6, 1), p("bench", 13, 7, 1),
  p("fence", 13, 2, 1), p("fence", 13, 3, 1), p("fence", 13, 10, 1), p("fence", 13, 11, 1),
  p("vehicle", 0, 12, 0),
  p("pallet", 12, 12), p("plank", 2, 11, 1),
];

/** Sunset Plaza decoration: tree line behind the QP wall, flag + tent to the south, scattered rocks. */
const sunsetPlazaOuter: PlacedItem[] = [
  // North forest behind the quarter-pipe wall
  o("exterior-tree", 1, -1), o("exterior-tree-high", 3, -1), o("exterior-tree", 5, -1),
  o("exterior-tree-high", 7, -1), o("exterior-tree", 9, -1), o("exterior-tree-high", 11, -1),
  o("exterior-tree", 13, -1),
  o("exterior-tree-high", 2, -2), o("exterior-tree", 6, -2), o("exterior-tree-high", 10, -2),
  o("exterior-rocks-high", 0, -1), o("exterior-rocks-low", 12, -2),
  // West: patches + mixed plants
  o("exterior-tree", -1, 1), o("exterior-plant", -1, 3), o("exterior-rocks-low", -1, 6),
  o("exterior-tree-high", -1, 8), o("exterior-stones", -2, 10), o("exterior-tree", -1, 12),
  o("exterior-patch-grass", -2, 2), o("exterior-patch-dirt", -2, 7),
  // East: flag + tree row + target
  o("exterior-tree-high", 14, 1), o("exterior-flag", 14, 4), o("exterior-tree", 14, 6),
  o("exterior-target", 15, 7), o("exterior-tree-high", 14, 9), o("exterior-plant", 14, 12),
  o("exterior-patch-grass", 15, 2),
  // South: campsite feel
  o("exterior-tent", 4, 14), o("exterior-rocks-ramp", 6, 14), o("exterior-plant", 8, 14),
  o("exterior-tree", 1, 14), o("exterior-tree-high", 10, 14), o("exterior-tree", 12, 14),
  o("exterior-patch-grass", 7, 15), o("exterior-stones", 3, 15),
];

/** Mini Bowl — a 4x4 ring bowl and a low-bowl playground. */
const bowlRing = (x0: number, z0: number, lowVersion = false): PlacedItem[] => {
  const side = lowVersion ? "bowl-side-low" : "bowl-side";
  const inner = lowVersion ? "bowl-corner-inner-low" : "bowl-corner-inner";
  const x1 = x0 + 3;
  const z1 = z0 + 3;
  return [
    p(inner, x0, z0, 0), p(inner, x1, z0, 3), p(inner, x1, z1, 2), p(inner, x0, z1, 1),
    p(side, x0 + 1, z0, 0), p(side, x0 + 2, z0, 0),
    p(side, x0 + 1, z1, 2), p(side, x0 + 2, z1, 2),
    p(side, x0, z0 + 1, 1), p(side, x0, z0 + 2, 1),
    p(side, x1, z0 + 1, 3), p(side, x1, z0 + 2, 3),
  ];
};

const miniBowl: PlacedItem[] = [
  ...bowlRing(1, 1),
  ...bowlRing(8, 8, true),
  p("structure-wood-platform", 6, 5), p("structure-wood-platform", 7, 6),
  p("rail-slope-smooth", 6, 6, 2), p("rail-slope-smooth", 7, 5, 0),
  p("ramp-rail", 9, 3, 1), p("ramp-rail", 3, 9, 3),
  p("half-pipe-low", 12, 1, 0), p("half-pipe-low", 12, 12, 2),
  p("obstacle-box-grind", 10, 5, 1), p("obstacle-box-grind", 4, 11, 0),
  p("rail-high-curve", 11, 10, 0),
  p("bench", 0, 12, 1), p("bench", 13, 0, 3), p("benches", 13, 5, 3),
  p("pallet", 1, 11), p("pallet", 12, 7),
];

/** Mini Bowl decoration: a dense ring of trees + rocks all around so the twin bowls read as a forest clearing. */
const miniBowlOuter: PlacedItem[] = [
  // North: alternating tree species + rock accents
  o("exterior-tree", 0, -1), o("exterior-tree-high", 2, -1), o("exterior-tree", 4, -1),
  o("exterior-rocks-low", 6, -1), o("exterior-tree-high", 8, -1), o("exterior-tree", 10, -1),
  o("exterior-tree-high", 12, -1), o("exterior-flag", 7, -2),
  o("exterior-tree-high", 1, -2), o("exterior-rocks-high", 5, -2), o("exterior-tree", 11, -2),
  // South
  o("exterior-tree-high", 0, 14), o("exterior-tree", 2, 14), o("exterior-plant", 4, 14),
  o("exterior-tree-high", 6, 14), o("exterior-tree", 8, 14), o("exterior-rocks-ramp", 10, 14),
  o("exterior-tree-high", 12, 14),
  o("exterior-tent", 3, 15), o("exterior-tree", 7, 15), o("exterior-stones", 11, 15),
  // West
  o("exterior-tree", -1, 0), o("exterior-tree-high", -1, 2), o("exterior-plant", -1, 4),
  o("exterior-rocks-low", -1, 6), o("exterior-tree-high", -1, 8), o("exterior-tree", -1, 10),
  o("exterior-tree-high", -1, 13), o("exterior-patch-grass", -2, 5),
  // East
  o("exterior-tree-high", 14, 0), o("exterior-tree", 14, 2), o("exterior-rocks-high", 14, 4),
  o("exterior-tree-high", 14, 7), o("exterior-plant", 14, 9), o("exterior-tree", 14, 11),
  o("exterior-tree-high", 14, 13), o("exterior-target", 15, 6),
];

/**
 * Street Studio — modeled on the Kenney asset-showcase reference image. Dense, center-
 * concentrated layout: a hero quarter-pipe wall on the north edge, triple bleacher row
 * below it, two parallel rail chains + a packed ledge/grind cluster through the middle,
 * a parked taxi flanked by pallets/planks, and south kickers + a south bowl roll-off.
 * Every piece category represented so the park reads as a showcase, not an empty grid.
 */
const streetStudio: PlacedItem[] = [
  // === NORTH: hero quarter-pipe wall (8 half-pipes + corner caps) ===
  p("bowl-corner-outer", 2, 0, 0),
  p("half-pipe", 3, 0, 0), p("half-pipe", 4, 0, 0), p("half-pipe", 5, 0, 0),
  p("half-pipe", 6, 0, 0), p("half-pipe", 7, 0, 0), p("half-pipe", 8, 0, 0),
  p("half-pipe", 9, 0, 0), p("half-pipe", 10, 0, 0),
  p("bowl-corner-outer", 11, 0, 3),

  // === Row 1: ledge shelves flanking the vert ramp ===
  p("structure-platform", 2, 1), p("structure-platform", 11, 1),
  p("obstacle-middle", 4, 1, 1), p("obstacle-middle", 6, 1, 1),
  p("obstacle-middle", 7, 1, 1), p("obstacle-middle", 9, 1, 1),

  // === Rows 2-3: Bleacher double row (benches + lone bench behind) ===
  p("benches", 3, 2, 0), p("benches", 5, 2, 0), p("benches", 7, 2, 0), p("benches", 9, 2, 0),
  p("bench", 3, 3, 0), p("bench", 5, 3, 0), p("bench", 7, 3, 0), p("bench", 9, 3, 0),

  // === Row 4: approach grind-boxes (left + right pairs) ===
  p("obstacle-box", 2, 4), p("obstacle-box-grind", 3, 4),
  p("obstacle-box", 10, 4), p("obstacle-box-grind", 11, 4),

  // === Rows 5-8: Two parallel low-rail chains PLUS center ledge cluster ===
  // West rail chain
  p("rail-low-end", 1, 5, 0),
  p("rail-low", 1, 6, 0), p("rail-low", 1, 7, 0),
  p("rail-low-end", 1, 8, 2),
  // Center-west chain
  p("rail-low-end", 4, 5, 0),
  p("rail-low", 4, 6, 0), p("rail-low", 4, 7, 0),
  p("rail-low-end", 4, 8, 2),
  // Center-east chain
  p("rail-low-end", 9, 5, 0),
  p("rail-low", 9, 6, 0), p("rail-low", 9, 7, 0),
  p("rail-low-end", 9, 8, 2),
  // East column: high rails + slope
  p("rail-high-curve", 12, 5, 0),
  p("rail-high", 12, 6, 1),
  p("rail-slope-smooth", 12, 7, 0),

  // Center cluster (ledges + grind rails arranged like a fun-box)
  p("obstacle-middle-rail", 6, 5, 1), p("obstacle-middle", 7, 5, 1),
  p("obstacle-corner", 5, 6, 0),
  p("obstacle-middle-rail", 6, 6, 1), p("obstacle-middle", 7, 6, 1),
  p("obstacle-corner", 8, 6, 3),
  p("obstacle-end", 5, 7, 2),
  p("rail-curve", 6, 7, 0), p("rail-curve", 7, 7, 2),
  p("obstacle-end", 8, 7, 0),

  // === Row 9: supplementary high rails ===
  p("rail-high", 6, 9, 0), p("rail-high", 7, 9, 0),

  // === Row 10: VEHICLE + prop clutter (hero taxi in the middle) ===
  p("pallet", 3, 10),
  p("vehicle", 4, 10, 0),              // (4,10) + (5,10)
  p("pallet", 7, 10), p("plank", 8, 10, 1),
  p("plank", 10, 10, 1),
  // Stacking demo: fence on top of a wood deck (Kenney reference image's wood-deck + fence combo).
  pStack("fence", 7, 10, 0.15),        // fence lifted onto the pallet below
  pStack("fence", 10, 10, 0.08, 1),    // fence lifted onto the plank below

  // === Row 11: south kickers + stairs sequence ===
  p("ramp", 2, 11, 2),
  p("steps", 4, 11, 2), p("steps", 5, 11, 2),
  p("steps-rail", 7, 11, 2),
  p("ramp-rail", 9, 11, 2),
  p("ramp", 11, 11, 2),

  // === Rows 12-13: south bowl roll-off ===
  p("bowl-corner-outer", 2, 12, 2),
  p("bowl-side-low", 3, 12, 0), p("bowl-side-low", 10, 12, 0),
  p("bowl-corner-outer", 11, 12, 1),
  p("bowl-side-low", 2, 13, 2), p("bowl-side-low", 11, 13, 2),

  // === Framing props at the perimeter (fences + corner benches) ===
  p("fence", 0, 1, 3), p("fence", 0, 2, 3), p("fence", 0, 3, 3),
  p("fence", 13, 1, 1), p("fence", 13, 2, 1), p("fence", 13, 3, 1),
  p("bench", 0, 6, 1), p("bench", 0, 9, 1),
  p("bench", 13, 7, 3), p("bench", 13, 10, 3),
];

/** Street Studio decoration: urban park ringed by a wood fence with trees and planters outside. */
const streetStudioOuter: PlacedItem[] = [
  // North: dense treeline + lookout silhouette behind the QP wall
  o("exterior-tree-high", 1, -1), o("exterior-tree", 3, -1), o("exterior-tree-high", 5, -1),
  o("exterior-tree", 7, -1), o("exterior-tree-high", 9, -1), o("exterior-tree", 11, -1),
  o("exterior-tree-high", 13, -1),
  o("exterior-building-structure", 6, -2), o("exterior-building-platform", 7, -2),
  o("exterior-building-roof", 7, -3),
  o("exterior-tree", 2, -2), o("exterior-tree-high", 10, -2), o("exterior-flag", 8, -2),
  // West: fence line + grass patches
  o("exterior-fence", -1, 0), o("exterior-fence", -1, 1), o("exterior-fence", -1, 2),
  o("exterior-plant", -1, 4), o("exterior-patch-grass", -1, 6), o("exterior-tree", -1, 8),
  o("exterior-fence", -1, 10), o("exterior-fence", -1, 11), o("exterior-fence", -1, 12),
  o("exterior-rocks-low", -2, 5), o("exterior-stones", -2, 9),
  // East: fence + a treeline for scale
  o("exterior-fence", 14, 0), o("exterior-fence", 14, 1), o("exterior-tree-high", 14, 3),
  o("exterior-tree", 14, 5), o("exterior-patch-dirt", 14, 7), o("exterior-tree-high", 14, 9),
  o("exterior-fence", 14, 11), o("exterior-fence", 14, 12),
  o("exterior-target", 15, 4), o("exterior-rocks-ramp", 15, 10),
  // South: campsite + fence + stones framing the ramps
  o("exterior-fence", 0, 14), o("exterior-fence", 2, 14), o("exterior-tent", 4, 14),
  o("exterior-plant", 6, 14), o("exterior-stones", 8, 14), o("exterior-fence", 10, 14),
  o("exterior-fence", 12, 14), o("exterior-fence", 13, 14),
  o("exterior-tree", 1, 15), o("exterior-tree-high", 7, 15), o("exterior-tree", 12, 15),
];

export const PRESET_MAPS: MapData[] = [
  {
    id: "preset-sunset-plaza",
    name: "Sunset Plaza",
    blurb: "Two big quarter-pipe walls, a fun-box and a long rail.",
    size: 14,
    items: sunsetPlaza,
    outerItems: sunsetPlazaOuter,
    preset: true,
  },
  {
    id: "preset-mini-bowl",
    name: "Mini Bowl",
    blurb: "A deep ring bowl, a kiddie bowl and a wooden bridge.",
    size: 14,
    items: miniBowl,
    outerItems: miniBowlOuter,
    preset: true,
  },
  {
    id: "preset-street-studio",
    name: "Street Studio",
    blurb: "Big quarter-pipe wall, long rail, grind-box cluster and a parked taxi.",
    size: 14,
    items: streetStudio,
    outerItems: streetStudioOuter,
    preset: true,
  },
];

export const DEFAULT_GRID_SIZE = 14;
