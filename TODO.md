# TODO

## Known issues

_None currently tracked._

## Resolved

### Rail corner bounce
Grinding from a straight rail into a `rail-curve` / `rail-high-curve` piece launched the
rider off the arc. Root cause: `PlayerController.updateRailFromHit` used the mesh origin
(tile centre) as the arc centre, but the Kenney curve meshes are a quarter circle of
radius 0.5 centred on the tile **corner** (local `(0.5, 0, 0.5)`). From the tile centre
the "tangent" at the arc ends pointed straight across the rail, so the rail assist shoved
the rider sideways on entry. Fixed by deriving the arc centre/radius from the mesh world
matrix, picking the tangent sign from momentum (arc-step probe only when velocity is ~⊥),
and pinning to the arc centreline. Verified in a headless Havok sim of Kenny Park's mid
chain: both directions now carry the grind through the bend onto the connecting rail.
