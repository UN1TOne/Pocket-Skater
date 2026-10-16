/** Score rules, shared by SkateScene and the headless AI eval harness (scripts/ai-sim). */

/** Points per second while grinding (accrued every frame). */
export const GRIND_POINTS_PER_SEC = 12;
export const BAIL_PENALTY = 50;

/** Landing bonus for airtime; short hops don't count. */
export function airScore(airtime: number): number {
  return airtime > 0.3 ? Math.round(airtime * 40) : 0;
}

/**
 * End-of-grind bonus. Quadratic so longer grinds feel dramatically more rewarding:
 * 1s = +10, 2s = +40, 3s = +90, 5s = +250.
 */
export function grindBonus(duration: number): number {
  return duration > 0.3 ? Math.round(10 * duration * duration) : 0;
}

/** Seconds of scoring without leaving a FARM_RADIUS bubble before it counts as an exploit. */
export const FARM_WINDOW = 3;
/** Metres. A real grind at rail speed leaves this in well under a second. */
export const FARM_RADIUS = 0.75;
/** A pause in scoring longer than this means the streak ended. */
const FARM_GAP = 1;

/**
 * Catches score farming: a rider wedged in a rail or wall keeps earning points (grind ticks,
 * repeated tiny landings) without going anywhere. Feed it every scoring event via `gain()`
 * and the rider position every frame; `update` returns true once the rider has scored for
 * FARM_WINDOW seconds without leaving one spot.
 */
export class ScoreFarmGuard {
  private t = 0;
  private lastGain = -Infinity;
  private since = 0;
  private ax = 0;
  private ay = 0;
  private az = 0;

  gain() {
    this.lastGain = this.t;
  }

  update(dt: number, x: number, y: number, z: number): boolean {
    this.t += dt;
    const moved = Math.hypot(x - this.ax, y - this.ay, z - this.az) > FARM_RADIUS;
    if (moved || this.t - this.lastGain > FARM_GAP) {
      this.reset(x, y, z);
      return false;
    }
    return this.t - this.since >= FARM_WINDOW;
  }

  reset(x: number, y: number, z: number) {
    this.ax = x;
    this.ay = y;
    this.az = z;
    this.since = this.t;
  }
}

export function grindLabel(duration: number): string {
  return duration > 2.5 ? "SICK GRIND" : duration > 1.2 ? "LONG GRIND" : "GRIND";
}
