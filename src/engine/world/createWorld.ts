import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Layer } from "@babylonjs/core/Layers/layer";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { createStylizedPipeline, type StylizedPipeline } from "../rendering/StylizedPipeline";
import { createGridGround, type GridGround } from "./GridGround";
import { bgUrl } from "@/data/catalog";

export interface WorldOptions {
  gridSize: number;
  showGridLines: boolean;
  quality?: "high" | "medium" | "low";
  /** Allow orbit / zoom with pointer (builder). */
  orbitControls?: boolean;
  /** How many world units should span the narrow screen axis at the default zoom. */
  visibleUnits?: number;
}

export interface World {
  scene: Scene;
  camera: ArcRotateCamera;
  sun: DirectionalLight;
  shadows: ShadowGenerator;
  ground: GridGround;
  pipeline: StylizedPipeline;
  /** Register a mesh hierarchy as shadow caster + receiver. */
  addShadowCaster(node: TransformNode, includeDescendants?: boolean): void;
  dispose(): void;
}

/** Fixed isometric framing: ~35° elevation, 45° yaw, low FOV. */
export const ISO_ALPHA = -Math.PI / 4;
export const ISO_BETA = 0.9;
export const ISO_FOV = 0.4;

/** Camera distance so `visibleUnits` world units span the narrow screen axis. */
export function fitRadius(aspect: number, visibleUnits: number): number {
  const tanHalf = Math.tan(ISO_FOV / 2);
  const limiting = aspect < 1 ? tanHalf * aspect : tanHalf;
  return visibleUnits / 2 / limiting;
}

export function createWorld(engine: Engine, opts: WorldOptions): World {
  const scene = new Scene(engine);
  if (import.meta.env.DEV) (window as unknown as { __scene: Scene }).__scene = scene;
  // Right-handed keeps glTF coordinates intact (ramps rise toward -Z).
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.98, 0.78, 0.6, 1);
  scene.ambientColor = Color3.White();

  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.97, 0.74, 0.62);

  const bg = new Layer("sky-bg", bgUrl("sky"), scene, true);
  bg.isBackground = true;

  // Low-FOV iso cam, framed so ~75% of the park's diagonal fits the narrow (portrait) axis.
  const radius = fitRadius(engine.getScreenAspectRatio() || 0.5, opts.visibleUnits ?? 9);
  const camera = new ArcRotateCamera("iso-cam", ISO_ALPHA, ISO_BETA, radius, Vector3.Zero(), scene);
  camera.fov = ISO_FOV;
  camera.minZ = 2;
  camera.maxZ = 400;
  camera.lowerBetaLimit = 0.55;
  camera.upperBetaLimit = 1.2;
  camera.lowerRadiusLimit = radius * 0.5;
  camera.upperRadiusLimit = radius * 2.4;
  camera.panningSensibility = opts.orbitControls ? 220 : 0;
  camera.panningInertia = 0.82;
  camera.panningDistanceLimit = (opts.gridSize ?? 8) * 0.8;
  camera.wheelDeltaPercentage = 0.02;
  camera.pinchDeltaPercentage = 0.004;
  camera.angularSensibilityX = 1400;
  camera.angularSensibilityY = 1400;
  camera.inertia = 0.82;
  camera.useNaturalPinchZoom = true;
  if (opts.orbitControls) {
    camera.attachControl(engine.getRenderingCanvas()!, true);
  }

  // Golden-hour key from the camera's left-rear so shadows stretch toward the viewer.
  const sun = new DirectionalLight("sun", new Vector3(0.5, -0.62, 0.55).normalize(), scene);
  sun.position = sun.direction.scale(-40);
  sun.diffuse = new Color3(1.0, 0.95, 0.86);
  sun.specular = Color3.Black();
  sun.intensity = 1.45;
  // Lock shadow frustum to the whole park so shadows don't pop as the camera orbits.
  const shadowExtent = (opts.gridSize + 6) / 2;
  sun.autoUpdateExtends = false;
  sun.autoCalcShadowZBounds = false;
  sun.orthoLeft = -shadowExtent;
  sun.orthoRight = shadowExtent;
  sun.orthoTop = shadowExtent;
  sun.orthoBottom = -shadowExtent;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 120;

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
  hemi.diffuse = new Color3(0.72, 0.78, 1.0);
  hemi.groundColor = new Color3(0.62, 0.48, 0.72);
  hemi.specular = Color3.Black();
  hemi.intensity = 0.75;

  const shadows = new ShadowGenerator(opts.quality === "low" ? 1024 : 2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = opts.quality === "high" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
  shadows.bias = 0.0012;
  shadows.normalBias = 0.02;
  shadows.darkness = 0.15;
  shadows.transparencyShadow = false;

  const ground = createGridGround(scene, { size: opts.gridSize, showGridLines: opts.showGridLines });

  const pipeline = createStylizedPipeline(scene, camera, { focusDistance: radius, tiltShift: 1, quality: opts.quality ?? "high" });
  const applyDistance = () => {
    pipeline.setFocusDistance(camera.radius);
    scene.fogStart = camera.radius + 4;
    scene.fogEnd = camera.radius + 26;
  };
  applyDistance();
  scene.onBeforeRenderObservable.add(applyDistance);

  const addShadowCaster = (node: TransformNode, includeDescendants = true) => {
    const list: AbstractMesh[] = [];
    if ((node as AbstractMesh).getTotalVertices) list.push(node as AbstractMesh);
    if (includeDescendants) list.push(...node.getChildMeshes(false));
    for (const m of list) {
      shadows.addShadowCaster(m, false);
      m.receiveShadows = true;
    }
  };

  return {
    scene,
    camera,
    sun,
    shadows,
    ground,
    pipeline,
    addShadowCaster,
    dispose() {
      pipeline.dispose();
      scene.dispose();
    },
  };
}
