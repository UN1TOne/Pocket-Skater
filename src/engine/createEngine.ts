import { Engine } from "@babylonjs/core/Engines/engine";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import HavokPhysics from "@babylonjs/havok";

// Side-effect imports: register loaders and components Babylon resolves lazily.
import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Materials/Textures/Loaders/envTextureLoader";
import "@babylonjs/core/Physics/physicsEngineComponent";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Particles/particleSystemComponent";
import "@babylonjs/core/Layers/layerSceneComponent";
import "@babylonjs/core/Collisions/collisionCoordinator";
import "@babylonjs/core/Animations/animatable";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Rendering/outlineRenderer";

/** WebGL engine tuned for mobile: AA on, DPR capped at 2 so post-fx stays cheap on high-DPI. */
export function createEngine(canvas: HTMLCanvasElement): Engine {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: true,
    antialias: true,
    powerPreference: "high-performance",
    adaptToDeviceRatio: false,
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  engine.setHardwareScalingLevel(1 / dpr);
  return engine;
}

// Havok WASM is heavy — load once, share across scenes.
let havokPromise: Promise<unknown> | null = null;

export function loadHavok(): Promise<unknown> {
  if (!havokPromise) {
    havokPromise = HavokPhysics().catch((err: unknown) => {
      havokPromise = null;
      throw err;
    });
  }
  return havokPromise;
}

/** Enables Havok on a scene. Resolves to the plugin. */
export async function enableHavok(scene: Scene, gravity = new Vector3(0, -9.81 * 1.6, 0)): Promise<HavokPlugin> {
  const havok = await loadHavok();
  const plugin = new HavokPlugin(true, havok);
  scene.enablePhysics(gravity, plugin);
  return plugin;
}
