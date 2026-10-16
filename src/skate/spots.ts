import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import { rotationY } from "@/engine/world/park";
import type { Rotation } from "@/types/game";
import type { RawPiece } from "./parkLayout";

/**
 * Park analysis for the AI: turns placed pieces into "spots" (grind lines and ramps), each
 * with run-up entries that have been checked for clearance against the real physics world.
 * Works on any layout (presets and builder maps) because it only reads the catalog geometry.
 */

/** One way into a spot: run up from `start` along `dir`, then jump onto / ride up at `end`. */
export interface SpotEntry {
  /** Run-up start on the floor — the navmesh goal. */
  start: Vector3;
  /** Grind: the line's end point (top of the rail). Ramp: the ramp foot on the floor. */
  end: Vector3;
  /** Grind: landing point a little inside the line, at its top. Ramp: same as `end`. */
  target: Vector3;
  /** Unit XZ heading for the run-up and the first stretch of the ride. */
  dir: Vector3;
  /** Grind: the line's far end. Ramp: the lip (take-off edge) at the top. */
  exit: Vector3;
  /** Unit XZ heading when the ride reaches `exit`. */
  exitDir: Vector3;
  /** Surface height at `target`. */
  topY: number;
}

export interface Spot {
  id: string;
  kind: "grind" | "ramp";
  /** What sort of spot this is ("grind-rail", "grind-ledge" or the ramp's catalog id) — the AI pools what it learns per model. */
  model: string;
  /** Thin rail (rail-* physics: Y-lock + speed floor) vs flat ledge / box. */
  thin: boolean;
  /** Grind: ridable length along the line (m). Ramp: 0. */
  length: number;
  /** Highest surface point above the floor (m). */
  height: number;
  /** Steep ramps (quarter-pipes, bowl walls): world Y of the coping, where the AI pops. */
  copingY?: number;
  center: Vector3;
  /** Placed-item uids that make up the spot. */
  pieces: string[];
  /** World polyline along the top of the grind (empty for ramps). */
  path: Vector3[];
  entries: SpotEntry[];
  /** Every generated entry before the clearance checks (diagnostics / self-test). */
  allEntries: SpotEntry[];
  /** Spot ends with no usable run-up (blocked / off the floor) — diagnostics. */
  rejected: number;
}

type P3 = [number, number, number];

/**
 * Grindable top lines per model in mesh-local space, measured from the Kenney GLBs.
 * Straight pieces run along local Z; heights are the top of the rail / ledge.
 */
const GRIND_LINES: Record<string, P3[][]> = {
  "rail-low": [[[0, 0.25, -0.5], [0, 0.25, 0.5]]],
  // The +Z end bends down into the ground at ~0.37.
  "rail-low-end": [[[0, 0.25, -0.5], [0, 0.25, 0.37]]],
  "rail-high": [[[0, 0.45, -0.5], [0, 0.45, 0.5]]],
  "rail-slope": [[[0, 0.45, -0.5], [0, 0.25, 0.5]]],
  "rail-slope-smooth": [[[0, 0.45, -0.5], [0, 0.43, -0.25], [0, 0.37, 0], [0, 0.28, 0.25], [0, 0.25, 0.5]]],
  // Quarter circle of radius 0.5 centred on the tile corner (0.5, 0.5).
  "rail-curve": [arc(0.25)],
  "rail-high-curve": [arc(0.45)],
  "obstacle-middle-rail": [[[0, 0.55, -0.5], [0, 0.55, 0.5]]],
  "steps-rail": [[[0, 0.55, -0.5], [0, 0.55, 0], [0, 0.38, 0.25], [0, 0.25, 0.5]]],
  "ramp-rail": [[[0, 0.55, -0.5], [0, 0.55, 0], [0, 0.37, 0.25], [0, 0.25, 0.5]]],
  "obstacle-middle": [[[0, 0.3, -0.5], [0, 0.3, 0.5]]],
  "obstacle-box-grind": [[[0, 0.21, -0.5], [0, 0.21, 0.5]]],
  "obstacle-end": [[[0, 0.3, -0.5], [0, 0.3, -0.32]]],
  "obstacle-corner": [[[0, 0.3, 0.5], [0, 0.3, 0], [0.5, 0.3, 0]]],
  "obstacle-box": [[[0, 0.21, -0.25], [0, 0.21, 0.25]]],
};

/**
 * Ramps: where the transition starts (local, on the floor), which way is uphill, lip height,
 * and how far uphill (m, horizontal) the lip — the take-off edge — is from the foot.
 */
const RAMPS: Record<string, { foot: P3; up: P3; lip: number; depth: number; steep?: boolean }> = {
  // Kicker: transition up to z = 0, flat deck to the back edge at z = -0.5.
  ramp: { foot: [0, 0, 0.5], up: [0, 0, -1], lip: 0.3, depth: 1.0 },
  // Quarter-pipes / bowl walls go near-vertical at the coping, so the rider's centre stops
  // advancing well short of `depth`; the AI pops these by height instead (steep).
  "half-pipe": { foot: [0, 0, 0.5], up: [0, 0, -1], lip: 0.8, depth: 0.95, steep: true },
  "half-pipe-low": { foot: [0, 0, 0.5], up: [0, 0, -1], lip: 0.4, depth: 0.95, steep: true },
  "bowl-side": { foot: [0, 0, 0.5], up: [0, 0, -1], lip: 0.8, depth: 0.95, steep: true },
  "bowl-side-low": { foot: [0, 0, 0.5], up: [0, 0, -1], lip: 0.4, depth: 0.95, steep: true },
  "slope-smooth": { foot: [0, 0, 1], up: [0, 0, -1], lip: 0.8, depth: 1.76 },
};

/** Run-up lengths to try, longest first (more speed into the trick). */
const RUN_UPS = [2.4, 1.8, 1.3];
/** Landing point distance inside a grind line's end — past end caps, onto the rail proper. */
const LAND_INSET = 0.3;
/**
 * Ends this close join into one line. Loose enough to bridge a rail-low-end's capped end (0.37)
 * to a neighbour's edge (0.5): the rail assist carries the rider across that dip (checked in sim).
 */
const JOIN_XZ = 0.15;
const JOIN_Y = 0.12;

export function buildSpots(pieces: RawPiece[], physics: PhysicsEngine, mapSize: number): Spot[] {
  const spots: Spot[] = [...buildGrindSpots(pieces), ...buildRampSpots(pieces)];
  const clear = new ClearanceProbe(physics, mapSize / 2);
  for (const spot of spots) {
    // Entries come longest run-up first per end; keep the first one that clears.
    const ends = new Map<string, boolean>();
    const kept: SpotEntry[] = [];
    for (const e of spot.entries) {
      const k = `${e.end.x.toFixed(2)},${e.end.z.toFixed(2)}`;
      if (ends.get(k)) continue;
      const ok = clear.entryOk(spot, e);
      ends.set(k, ok);
      if (ok) kept.push(e);
    }
    spot.allEntries = spot.entries;
    spot.entries = kept;
    spot.rejected = [...ends.values()].filter((ok) => !ok).length;
  }
  return spots;
}

/**
 * Self-test for the GRIND_LINES table: every path point should sit on its own piece's top
 * surface. Returns the points that don't (empty = table matches the meshes).
 */
export function verifySpotGeometry(spots: Spot[], physics: PhysicsEngine): Array<{ spot: string; point: Vector3; hitY: number | null }> {
  const res = new PhysicsRaycastResult();
  const bad: Array<{ spot: string; point: Vector3; hitY: number | null }> = [];
  for (const s of spots) {
    // Sample the interior every 0.25 m; exact end points sit on tile seams where a ray can
    // graze the mesh edge or hit the neighbouring piece instead.
    const samples: Vector3[] = [];
    for (let d = 0.1; d <= s.length - 0.1; d += 0.25) samples.push(pointAlong(s.path, d));
    for (const p of samples) {
      physics.raycastToRef(new Vector3(p.x, p.y + 0.3, p.z), new Vector3(p.x, p.y - 0.3, p.z), res);
      const uid = (res.body?.transformNode?.metadata as { uid?: string } | undefined)?.uid;
      const ok = res.hasHit && uid !== undefined && s.pieces.includes(uid) && Math.abs(res.hitPointWorld.y - p.y) < 0.06;
      if (!ok) bad.push({ spot: s.id, point: p.clone(), hitY: res.hasHit ? res.hitPointWorld.y : null });
    }
    // Ramps: floor just before the foot, rising surface of the ramp just past it.
    if (s.kind === "ramp") {
      const e = s.entries[0] ?? s.allEntries[0];
      const probe = (d: number) => {
        const p = e.end.add(e.dir.scale(d));
        physics.raycastToRef(new Vector3(p.x, 3, p.z), new Vector3(p.x, -0.5, p.z), res);
        const uid = (res.body?.transformNode?.metadata as { uid?: string } | undefined)?.uid;
        return { p, y: res.hasHit ? res.hitPointWorld.y : null, own: uid !== undefined && s.pieces.includes(uid) };
      };
      const before = probe(-0.15);
      const after = probe(0.35);
      if (before.own && (before.y ?? 0) > 0.03) bad.push({ spot: s.id + " (foot)", point: before.p, hitY: before.y });
      if (!after.own || (after.y ?? 0) < 0.03) bad.push({ spot: s.id + " (uphill)", point: after.p, hitY: after.y });
    }
  }
  return bad;
}

/** Every model id the analysis knows about (used by the harness's catalog self-test). */
export const SPOT_MODEL_IDS = [...Object.keys(GRIND_LINES), ...Object.keys(RAMPS)];

// --- Grind lines -----------------------------------------------------------------------------

interface Segment {
  uid: string;
  thin: boolean;
  pts: Vector3[];
}

function buildGrindSpots(pieces: RawPiece[]): Spot[] {
  const segs: Segment[] = [];
  for (const p of pieces) {
    const lines = GRIND_LINES[p.def.id];
    if (!lines) continue;
    const m = pieceMatrix(p);
    for (const line of lines) segs.push({ uid: p.uid, thin: p.def.tags.includes("rail"), pts: line.map((l) => Vector3.TransformCoordinates(new Vector3(...l), m)) });
  }

  // Link segment ends that meet in world space (same physics family). Junctions with more than
  // one partner stay unlinked so every line is a simple chain.
  const key = (s: number, e: 0 | 1) => s * 2 + e;
  const endPt = (s: number, e: 0 | 1) => (e === 0 ? segs[s].pts[0] : segs[s].pts[segs[s].pts.length - 1]);
  const partners = new Map<number, number[]>();
  for (let a = 0; a < segs.length; a++) {
    for (let b = a + 1; b < segs.length; b++) {
      if (segs[a].thin !== segs[b].thin) continue;
      for (const ea of [0, 1] as const) {
        for (const eb of [0, 1] as const) {
          const pa = endPt(a, ea);
          const pb = endPt(b, eb);
          if (Math.hypot(pa.x - pb.x, pa.z - pb.z) < JOIN_XZ && Math.abs(pa.y - pb.y) < JOIN_Y) {
            (partners.get(key(a, ea)) ?? partners.set(key(a, ea), []).get(key(a, ea))!).push(key(b, eb));
            (partners.get(key(b, eb)) ?? partners.set(key(b, eb), []).get(key(b, eb))!).push(key(a, ea));
          }
        }
      }
    }
  }
  const link = (k: number) => {
    const ps = partners.get(k);
    return ps && ps.length === 1 && partners.get(ps[0])?.length === 1 ? ps[0] : null;
  };

  const used = new Set<number>();
  const spots: Spot[] = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used.has(s0)) continue;
    // Walk back to a chain end (or detect a loop), then walk forward collecting points.
    let s = s0;
    let e: 0 | 1 = 0;
    for (let guard = 0; guard < segs.length; guard++) {
      const k = link(key(s, e));
      if (k === null) break;
      s = k >> 1;
      e = (1 - (k & 1)) as 0 | 1;
      if (s === s0) break;
    }
    const path: Vector3[] = [];
    const uids: string[] = [];
    let thin = true;
    for (let guard = 0; guard <= segs.length; guard++) {
      if (used.has(s)) break;
      used.add(s);
      const pts = e === 0 ? segs[s].pts : [...segs[s].pts].reverse();
      for (const p of pts) if (!path.length || Vector3.Distance(path[path.length - 1], p) > JOIN_XZ) path.push(p);
      uids.push(segs[s].uid);
      thin &&= segs[s].thin;
      const k = link(key(s, (1 - e) as 0 | 1));
      if (k === null) break;
      s = k >> 1;
      e = (k & 1) as 0 | 1;
    }
    const loop = path.length > 2 && Vector3.Distance(path[0], path[path.length - 1]) < JOIN_XZ;
    const length = pathLength(path);
    const spot: Spot = {
      id: `grind:${uids[0]}`,
      kind: "grind",
      model: thin ? "grind-rail" : "grind-ledge",
      thin,
      length,
      height: Math.max(...path.map((p) => p.y)),
      center: pointAlong(path, length / 2),
      pieces: [...new Set(uids)],
      path,
      entries: [],
      allEntries: [],
      rejected: 0,
    };
    // Loops have no end to jump onto — skip entries rather than guess.
    if (!loop && length > 0.2) {
      for (const fwd of [path, [...path].reverse()]) {
        const end = fwd[0];
        const target = pointAlong(fwd, Math.min(LAND_INSET, length / 2));
        const dir = flatDir(target.subtract(end));
        const exitDir = flatDir(fwd[fwd.length - 1].subtract(pointAlong(fwd, Math.max(0, length - LAND_INSET))));
        if (!dir || !exitDir) continue;
        for (const runUp of RUN_UPS) {
          const start = new Vector3(end.x - dir.x * runUp, 0, end.z - dir.z * runUp);
          spot.entries.push({ start, end: end.clone(), target, dir, exit: fwd[fwd.length - 1].clone(), exitDir, topY: target.y });
        }
      }
    }
    spots.push(spot);
  }
  return spots;
}

// --- Ramps -----------------------------------------------------------------------------------

function buildRampSpots(pieces: RawPiece[]): Spot[] {
  const spots: Spot[] = [];
  for (const p of pieces) {
    const r = RAMPS[p.def.id];
    if (!r) continue;
    const m = pieceMatrix(p);
    const foot = Vector3.TransformCoordinates(new Vector3(...r.foot), m);
    const dir = flatDir(Vector3.TransformNormal(new Vector3(...r.up), m))!;
    const top = foot.add(dir.scale(r.depth));
    top.y = p.pos.y + r.lip;
    const spot: Spot = {
      id: `ramp:${p.uid}`,
      kind: "ramp",
      model: p.def.id,
      copingY: r.steep ? p.pos.y + r.lip : undefined,
      thin: false,
      length: 0,
      height: r.lip,
      center: p.pos.clone(),
      pieces: [p.uid],
      path: [],
      entries: [],
      allEntries: [],
      rejected: 0,
    };
    for (const runUp of RUN_UPS) {
      const start = new Vector3(foot.x - dir.x * runUp, 0, foot.z - dir.z * runUp);
      spot.entries.push({ start, end: foot.clone(), target: foot.clone(), dir, exit: top, exitDir: dir, topY: top.y });
    }
    spots.push(spot);
  }
  return spots;
}

// --- Clearance -------------------------------------------------------------------------------

/**
 * Physics-backed checks that an entry is actually usable: the run-up starts on open floor
 * inside the park, the run-up corridor is free of other pieces, and (for grinds) the jump
 * from the end of the run-up onto the line doesn't pass through anything.
 */
class ClearanceProbe {
  private res = new PhysicsRaycastResult();

  constructor(
    private physics: PhysicsEngine,
    private half: number,
  ) {}

  entryOk(spot: Spot, e: SpotEntry): boolean {
    return this.onOpenFloor(e.start) && this.corridorClear(spot, e) && (spot.kind === "ramp" || (this.jumpClear(spot, e) && this.exitClear(spot, e)));
  }

  /**
   * Riding off the far end must not run into something: a line that dead-ends into a wall
   * slams the rider into it at grind speed.
   */
  private exitClear(spot: Spot, e: SpotEntry): boolean {
    for (const h of [0.1, 0.3]) {
      const a = new Vector3(e.exit.x, e.exit.y + h, e.exit.z);
      const b = a.add(e.exitDir.scale(0.6));
      this.physics.raycastToRef(a, b, this.res);
      if (!this.res.hasHit) continue;
      const uid = (this.res.body?.transformNode?.metadata as { uid?: string } | undefined)?.uid;
      if (!uid || !spot.pieces.includes(uid)) return false;
    }
    return true;
  }

  private onOpenFloor(p: Vector3): boolean {
    const margin = 0.35;
    if (Math.abs(p.x) > this.half - margin || Math.abs(p.z) > this.half - margin) return false;
    this.physics.raycastToRef(new Vector3(p.x, 3, p.z), new Vector3(p.x, -0.5, p.z), this.res);
    const kind = (this.res.body?.transformNode?.metadata as { kind?: string } | undefined)?.kind;
    return this.res.hasHit && kind === "ground" && this.res.hitPointWorld.y < 0.06;
  }

  /** Rider-width corridor at board and body height from the run-up start to just before `end`. */
  private corridorClear(spot: Spot, e: SpotEntry): boolean {
    const stop = e.end.subtract(e.dir.scale(spot.kind === "ramp" ? 0.1 : 0.25));
    return this.sweep(spot, e.start, stop, e.dir, [0.15, 0.4]);
  }

  /** The jump: from the take-off zone onto the landing point, at the rider's centre height. */
  private jumpClear(spot: Spot, e: SpotEntry): boolean {
    const from = e.end.subtract(e.dir.scale(0.8));
    const h = e.topY + 0.3;
    return this.sweep(spot, new Vector3(from.x, 0, from.z), new Vector3(e.target.x, 0, e.target.z), e.dir, [h]);
  }

  private sweep(spot: Spot, from: Vector3, to: Vector3, dir: Vector3, heights: number[]): boolean {
    const perp = new Vector3(-dir.z, 0, dir.x);
    for (const h of heights) {
      for (const off of [-0.2, 0, 0.2]) {
        const a = new Vector3(from.x + perp.x * off, h, from.z + perp.z * off);
        const b = new Vector3(to.x + perp.x * off, h, to.z + perp.z * off);
        this.physics.raycastToRef(a, b, this.res);
        if (!this.res.hasHit) continue;
        const uid = (this.res.body?.transformNode?.metadata as { uid?: string } | undefined)?.uid;
        if (!uid || !spot.pieces.includes(uid)) return false;
      }
    }
    return true;
  }
}

// --- Geometry helpers ------------------------------------------------------------------------

function pieceMatrix(p: RawPiece): Matrix {
  return Matrix.Compose(Vector3.One(), Quaternion.RotationYawPitchRoll(rotationY(p.rot as Rotation), 0, 0), p.pos);
}

function arc(y: number, steps = 6): P3[] {
  const pts: P3[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI + (i / steps) * (Math.PI / 2); // from (0, 0.5) to (0.5, 0) around (0.5, 0.5)
    pts.push([0.5 + 0.5 * Math.cos(a), y, 0.5 + 0.5 * Math.sin(a)]);
  }
  return pts;
}

function flatDir(v: Vector3): Vector3 | null {
  const l = Math.hypot(v.x, v.z);
  return l > 1e-4 ? new Vector3(v.x / l, 0, v.z / l) : null;
}

function pathLength(path: Vector3[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += Vector3.Distance(path[i - 1], path[i]);
  return l;
}

/** Point at arc length `d` along `path` (clamped). */
function pointAlong(path: Vector3[], d: number): Vector3 {
  for (let i = 1; i < path.length; i++) {
    const seg = Vector3.Distance(path[i - 1], path[i]);
    if (d <= seg) return Vector3.Lerp(path[i - 1], path[i], seg > 0 ? d / seg : 0);
    d -= seg;
  }
  return path[path.length - 1].clone();
}
