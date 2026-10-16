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

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

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

/**
 * Street Studio — the demo setup from the Kenney reference image: a hero quarter-pipe
 * wall running along the north edge, a long low rail on the west side, a 2x2
 * obstacle/ledge cluster in the middle, a curve-rail → high-rail → slope on the east,
 * and props (vehicle, pallets, benches, fences) framing the center. Designed as a
 * "showcase" park with every piece category represented.
 */
const streetStudio: PlacedItem[] = [
  // North wall: big quarter-pipe row, bowl corners cap the ends.
  p("bowl-corner-outer", 5, 0, 0),
  p("half-pipe", 6, 0, 0), p("half-pipe", 7, 0, 0),
  p("half-pipe", 8, 0, 0), p("half-pipe", 9, 0, 0),
  p("bowl-corner-outer", 10, 0, 3),

  // Northwest: wood platform with a step up (the "stage" where a skater stands in the ref).
  p("structure-wood-platform", 1, 1),
  p("structure-wood", 2, 1),
  p("steps", 1, 3, 0),

  // Bleacher row below the quarter-pipes.
  p("benches", 4, 2, 0), p("benches", 7, 2, 0),

  // Long low rail chain running down the west side.
  p("rail-low-end", 4, 4, 0),
  p("rail-low", 4, 5, 0), p("rail-low", 4, 6, 0), p("rail-low", 4, 7, 0),
  p("rail-low-end", 4, 8, 2),

  // Center ledge + grind-box cluster (the orange/beige boxes in the ref).
  p("obstacle-box", 6, 6),       p("obstacle-box-grind", 7, 6),
  p("obstacle-middle-rail", 6, 7, 1), p("obstacle-middle", 7, 7, 1),
  p("obstacle-end", 8, 6, 3),

  // East side: ramp with rail → curved rail → high rail → slope rail down.
  p("ramp-rail", 11, 3, 2),
  p("rail-curve", 10, 5, 0),
  p("rail-high", 11, 6, 1),
  p("rail-slope-smooth", 11, 8, 0),

  // Southeast: steps-with-rail, kicker.
  p("steps-rail", 11, 10, 2),
  p("ramp", 10, 12, 0), p("ramp", 11, 12, 0),

  // Southwest: another kicker + a flat-rail curve for exits.
  p("ramp", 2, 12, 2),
  p("rail-high-curve", 3, 11, 0),

  // The hero vehicle in the center-south, with props scattered around it.
  p("vehicle", 6, 11, 0),         // 2x1 — occupies (6,11) and (7,11)
  p("pallet", 5, 12),
  p("plank", 8, 11, 1),
  p("pallet", 9, 12),

  // Framing props: benches, fences at the edges.
  p("bench", 0, 6, 1), p("bench", 0, 9, 1),
  p("bench", 13, 6, 3), p("bench", 13, 9, 3),
  p("fence", 13, 1, 1), p("fence", 13, 2, 1),
  p("fence", 0, 12, 3), p("fence", 0, 13, 3),

  // Southwest bowl corner for a tiny roll-off at the edge.
  p("bowl-corner-outer", 0, 11, 2),
  p("bowl-side-low", 1, 11, 1),
];

export const PRESET_MAPS: MapData[] = [
  {
    id: "preset-sunset-plaza",
    name: "Sunset Plaza",
    blurb: "Two big quarter-pipe walls, a fun-box and a long rail.",
    size: 14,
    items: sunsetPlaza,
    preset: true,
  },
  {
    id: "preset-mini-bowl",
    name: "Mini Bowl",
    blurb: "A deep ring bowl, a kiddie bowl and a wooden bridge.",
    size: 14,
    items: miniBowl,
    preset: true,
  },
  {
    id: "preset-street-studio",
    name: "Street Studio",
    blurb: "Big quarter-pipe wall, long rail, grind-box cluster and a parked taxi.",
    size: 14,
    items: streetStudio,
    preset: true,
  },
];

export const DEFAULT_GRID_SIZE = 14;
