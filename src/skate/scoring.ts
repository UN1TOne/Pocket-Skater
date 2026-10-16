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

export function grindLabel(duration: number): string {
  return duration > 2.5 ? "SICK GRIND" : duration > 1.2 ? "LONG GRIND" : "GRIND";
}
