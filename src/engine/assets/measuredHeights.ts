import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/**
 * Lives outside any scene so measurements made while loading a GLB for one scene
 * (ThumbnailService, Park, MapThumbnailService) are reused by every other scene +
 * by the store's placeItem logic. Catalog ships a `stackTop` guess for the picker
 * before any load has happened; once a piece has been measured, that number wins.
 */
export const MEASURED_TOPS = new Map<string, number>();

/** Pull the Y of the highest world-space bounding-box max across a mesh list. */
export function measureMeshesTop(meshes: AbstractMesh[]): number {
  let maxY = 0;
  for (const m of meshes) {
    if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
    m.computeWorldMatrix(true);
    const by = m.getBoundingInfo().boundingBox.maximumWorld.y;
    if (by > maxY) maxY = by;
  }
  return maxY;
}

/** Record a measurement for an itemId (max-wins so a taller instance updates the cache). */
export function recordMeasuredTop(id: string, top: number) {
  if (top <= 0) return;
  const prev = MEASURED_TOPS.get(id);
  if (prev === undefined || top > prev) MEASURED_TOPS.set(id, top);
}
