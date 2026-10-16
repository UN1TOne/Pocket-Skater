import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/loaders/glTF";
import type { MapData } from "@/types/game";
import { CATALOG_BY_ID } from "@/data/catalog";
import { AssetLoader, type Instance } from "./AssetLoader";
import { gridToWorld, rotationY } from "../world/park";

const SIZE = 320;

/**
 * Offscreen renderer that produces an iso-angle PNG thumbnail of an entire MapData.
 * One engine + scene are shared across calls; each render disposes the previous park
 * (so the scene doesn't accumulate meshes). Results are cached by key.
 *
 * Preset maps call this with their stable id. Custom maps live in-store with their own
 * captured thumbnail (from the Builder scene canvas) and don't go through this service.
 */
export class MapThumbnailService {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private loader: AssetLoader;
  private canvas: HTMLCanvasElement;
  private ground: ReturnType<typeof CreateGround>;
  private groundMat: StandardMaterial;
  private currentPark: Instance[] = [];
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

    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new Color4(0.98, 0.78, 0.6, 1);
    this.scene.ambientColor = new Color3(0.6, 0.6, 0.7);

    // Iso camera looking at origin. Radius adjusted per-render based on map size.
    this.camera = new ArcRotateCamera("mapthumb-cam", -Math.PI / 4, 0.9, 12, Vector3.Zero(), this.scene);
    this.camera.fov = 0.5;
    this.camera.minZ = 1;
    this.camera.maxZ = 200;

    const sun = new DirectionalLight("mapthumb-sun", new Vector3(0.5, -0.62, 0.55).normalize(), this.scene);
    sun.diffuse = new Color3(1, 0.95, 0.86);
    sun.intensity = 1.3;

    const hemi = new HemisphericLight("mapthumb-hemi", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.diffuse = new Color3(0.78, 0.84, 1);
    hemi.groundColor = new Color3(0.62, 0.48, 0.72);
    hemi.intensity = 0.75;

    this.ground = CreateGround("mapthumb-ground", { width: 20, height: 20 }, this.scene);
    this.groundMat = new StandardMaterial("mapthumb-ground-mat", this.scene);
    this.groundMat.diffuseColor = new Color3(0.85, 0.77, 0.68);
    this.groundMat.specularColor = Color3.Black();
    this.ground.material = this.groundMat;

    this.loader = new AssetLoader(this.scene);
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
    // Clear previous park.
    for (const inst of this.currentPark) inst.dispose();
    this.currentPark = [];

    // Resize ground to fit map.
    this.ground.scaling.set(map.size / 20, 1, map.size / 20);

    // Preload all unique item ids, then instantiate.
    const uniqueIds = [...new Set(map.items.map((i) => i.itemId))];
    await this.loader.preload(uniqueIds);
    const instances = await Promise.all(
      map.items.map(async (it) => {
        if (!CATALOG_BY_ID[it.itemId]) return null;
        const inst = await this.loader.instantiate(it.itemId, `mapthumb:${key}:${it.uid}`);
        inst.root.position = gridToWorld(it.itemId, it.x, it.z, it.rot, map.size);
        inst.root.rotation.y = rotationY(it.rot);
        return inst;
      }),
    );
    this.currentPark = instances.filter((i): i is Instance => i !== null);

    // Frame the whole map with a bit of margin.
    this.camera.alpha = -Math.PI / 4;
    this.camera.beta = 0.9;
    this.camera.radius = map.size * 1.75;
    this.camera.target.set(0, 0, 0);

    await this.scene.whenReadyAsync();
    this.scene.render();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    this.scene.render();

    const url = this.canvas.toDataURL("image/png");
    this.cache.set(key, url);
    return url;
  }

  dispose() {
    for (const inst of this.currentPark) inst.dispose();
    this.loader.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}

let singleton: MapThumbnailService | null = null;
export function getMapThumbnailService(): MapThumbnailService {
  if (!singleton) singleton = new MapThumbnailService();
  return singleton;
}
