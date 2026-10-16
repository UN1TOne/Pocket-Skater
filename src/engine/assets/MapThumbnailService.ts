import { Engine } from "@babylonjs/core/Engines/engine";
import "@babylonjs/loaders/glTF";
import type { MapData } from "@/types/game";
import { createWorld, type World } from "../world/createWorld";
import { Park } from "../world/park";

const SIZE = 384;

/**
 * Offscreen renderer that produces an iso-angle PNG thumbnail of an entire MapData.
 * Uses the full createWorld + Park pipeline (shadows, toon post-fx, gradient background,
 * fog, grid-free ground) so preset previews look identical to the Builder's captured
 * snapshots instead of a flat shadeless mini-scene.
 *
 * The engine is shared but a fresh scene is built for every render so each park can
 * carry its own shadow extents + sized ground. Results are cached by key.
 */
export class MapThumbnailService {
  private engine: Engine;
  private canvas: HTMLCanvasElement;
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.canvas.style.cssText = `position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;opacity:0;pointer-events:none;z-index:-1;`;
    document.body.appendChild(this.canvas);

    this.engine = new Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      antialias: true,
      powerPreference: "low-power",
    });
  }

  getThumbnail(map: MapData, cacheKey?: string): Promise<string> {
    const key = cacheKey ?? map.id;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key)!);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const task = this.enqueue(map, key);
    this.pending.set(key, task);
    task.finally(() => this.pending.delete(key));
    return task;
  }

  invalidate(key: string) {
    this.cache.delete(key);
  }

  private enqueue(map: MapData, key: string): Promise<string> {
    const next = this.queue.then(() => this.render(map, key));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async render(map: MapData, key: string): Promise<string> {
    let world: World | null = null;
    let park: Park | null = null;
    try {
      // Fresh world per render so shadow extents, pipeline and background all size to the map.
      // visibleUnits sized to include the outer-ring decoration (map + ~2 cells of margin on
      // each side) so trees/rocks/etc. placed on outerItems actually show up in the thumbnail.
      // Too much margin shrinks the skate park too hard; this balance keeps both legible.
      const framedUnits = map.size + 5;
      world = createWorld(this.engine, {
        gridSize: map.size,
        showGridLines: false,
        orbitControls: false,
        quality: "high",
        visibleUnits: framedUnits,
      });

      park = new Park(world, map.size);
      await park.build(map);

      // The camera is already radius'd by createWorld via fitRadius(visibleUnits). We only
      // need to lock the iso angles here (not stretch radius further).
      const cam = world.camera;
      cam.alpha = -Math.PI / 4;
      cam.beta = 0.9;
      cam.target.set(0, 0, 0);

      // Two renders: first primes shaders + shadow map, second captures.
      await world.scene.whenReadyAsync();
      world.scene.render();
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      world.scene.render();

      const url = this.canvas.toDataURL("image/png");
      this.cache.set(key, url);
      return url;
    } finally {
      park?.dispose();
      world?.dispose();
    }
  }

  dispose() {
    this.engine.dispose();
    this.canvas.remove();
  }
}

let singleton: MapThumbnailService | null = null;
export function getMapThumbnailService(): MapThumbnailService {
  if (!singleton) singleton = new MapThumbnailService();
  return singleton;
}
