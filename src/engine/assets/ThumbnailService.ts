import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/loaders/glTF";
import { AssetLoader } from "./AssetLoader";

const SIZE = 256;

/**
 * Offscreen Babylon engine that renders each GLB to a data-URL thumbnail.
 * Canvas is attached to the DOM invisibly so Babylon's resize keeps a real
 * drawing buffer; camera is fixed to a safe framing that works for every
 * 1-unit grid piece without per-model bounds math.
 */
export class ThumbnailService {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private loader: AssetLoader;
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private canvas: HTMLCanvasElement;
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
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    this.scene.ambientColor = new Color3(0.4, 0.4, 0.5);

    // 3π/4 looks AT the model from the +Z side so glTF characters/rides face the camera.
    this.camera = new ArcRotateCamera("thumb-cam", Math.PI * 0.75, 1.0, 2.4, Vector3.Zero(), this.scene);
    this.camera.fov = 0.75;
    this.camera.minZ = 0.05;
    this.camera.maxZ = 50;
    this.camera.target.set(0, 0.45, 0);

    const sun = new DirectionalLight("thumb-sun", new Vector3(0.5, -0.62, 0.55).normalize(), this.scene);
    sun.diffuse = new Color3(1, 0.95, 0.86);
    sun.intensity = 1.25;

    const hemi = new HemisphericLight("thumb-hemi", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.diffuse = new Color3(0.78, 0.84, 1);
    hemi.groundColor = new Color3(0.62, 0.48, 0.72);
    hemi.intensity = 0.75;

    this.loader = new AssetLoader(this.scene);
  }

  getThumbnail(id: string): Promise<string> {
    if (this.cache.has(id)) return Promise.resolve(this.cache.get(id)!);
    const inFlight = this.pending.get(id);
    if (inFlight) return inFlight;
    const task = this.enqueue(id);
    this.pending.set(id, task);
    task.finally(() => this.pending.delete(id));
    return task;
  }

  private enqueue(id: string): Promise<string> {
    const next = this.queue.then(() => this.render(id));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async render(id: string): Promise<string> {
    const inst = await this.loader.instantiate(id, `thumb-${id}`);
    try {
      inst.root.position.setAll(0);
      inst.root.rotation.setAll(0);
      inst.root.computeWorldMatrix(true);

      // Characters & rides: 45° front-iso angle (not dead-on, feels more alive).
      // Park pieces: standard iso.
      const isPortrait = id.startsWith("character-") || id === "skateboard" || id === "scooter";
      if (isPortrait) {
        this.camera.alpha = Math.PI * 0.75;
        this.camera.beta = 1.1;
        this.camera.radius = 2.0;
        this.camera.target.set(0, 0.35, 0);
      } else {
        this.camera.alpha = Math.PI * 0.75;
        this.camera.beta = 1.0;
        this.camera.radius = 2.4;
        this.camera.target.set(0, 0.45, 0);
      }

      // whenReadyAsync waits for all shaders/materials. One extra frame makes sure
      // the capture isn't shader-cold. Previously 5 passes made each tile ~500ms,
      // which starved later tiles and left the user staring at fallback PNGs.
      await this.scene.whenReadyAsync();
      this.scene.render();
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      this.scene.render();

      const url = this.canvas.toDataURL("image/png");
      this.cache.set(id, url);
      return url;
    } finally {
      inst.dispose();
    }
  }

  dispose() {
    this.loader.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
}

let singleton: ThumbnailService | null = null;
export function getThumbnailService(): ThumbnailService {
  if (!singleton) singleton = new ThumbnailService();
  return singleton;
}
