import type { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createEngine } from "@/engine/createEngine";
import { createWorld, type World } from "@/engine/world/createWorld";
import { Park } from "@/engine/world/park";
import type { MapData } from "@/types/game";

/** Non-physics park preview with a gentle idle orbit; used as the blurred setup backdrop. */
export class MapPreviewScene {
  readonly engine: Engine;
  world!: World;
  park!: Park;
  private disposed = false;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = createEngine(canvas);
  }

  async init(map: MapData) {
    this.world = createWorld(this.engine, {
      gridSize: map.size,
      showGridLines: false,
      orbitControls: false,
      quality: "medium",
      visibleUnits: 7,
    });
    const { scene, camera } = this.world;
    camera.setTarget(Vector3.Zero());

    this.park = new Park(this.world, map.size);
    await this.park.build(map);
    if (this.disposed) return;

    scene.onBeforeRenderObservable.add(() => {
      this.time += this.engine.getDeltaTime() / 1000;
      camera.alpha = -Math.PI / 4 + Math.sin(this.time * 0.15) * 0.25;
    });

    this.engine.runRenderLoop(() => {
      if (!this.disposed) scene.render();
    });
    window.addEventListener("resize", this.onResize);
  }

  private onResize = () => this.engine.resize();

  dispose() {
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    this.engine.stopRenderLoop();
    this.park?.dispose();
    this.world?.dispose();
    this.engine.dispose();
  }
}
