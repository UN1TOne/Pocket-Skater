# TODO

## Known issues

### Rail corner bounce (unresolved)
When the skater grinds along a straight rail chain and reaches a `rail-curve` /
`rail-high-curve` piece, the rider is launched off in the direction opposite
to the arc instead of being steered around the bend. The symptom persists in
Kenny Park's mid rail chain (`(3,7)` curve rot=1 connecting the east-west high
rails to the north-south return) and reproduces in any map where a straight
rail-chain meets a curve.

**What we've tried in `PlayerController.updateRailFromHit`:**
- Original: perp-radial tangent with velocity-dot sign flip. Fails at entry
  because velocity is perpendicular to the entry tangent — dot ≈ 0, no flip,
  wrong half-tangent chosen.
- Straight-line ±tangent probe at 0.18 m. Fails because the rail cross-section
  is thin (~0.11) and the arc bends away from the straight probe path, so both
  probes miss and we fall through to the velocity-dot fallback (same bug).
- **Current:** angular-step probe (`dTheta = 0.3`) that walks along the arc
  at a fixed radius. Verified analytically on the Kenny Park case but **the
  rider still bounces off in-game** — needs runtime debugging:
  - Check whether the curve piece's physics body actually carries the
    `metadata.uid` the probe filters on. If the raycast lands on a child mesh
    whose body has no uid, every probe returns true (both sides "hit") and we
    fall into velocity-dot ambiguity.
  - Instrument `probeArc` to log `ccwOn / cwOn` at the moment the rider
    enters a curve and verify the branch taken.
  - Consider whether `this.ray` (the ground-sense cast) is picking up the
    straight-rail piece next to the curve instead of the curve itself for the
    first frame of contact — if so, `node.getAbsolutePosition()` is the wrong
    arc center.
  - Fallback plan: on first-contact with a curve, keep the previous straight
    rail's `railDir` for one frame so the rider carries their inertia into
    the arc, then recompute once they're clearly mid-arc.
