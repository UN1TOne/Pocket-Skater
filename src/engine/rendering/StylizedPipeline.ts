import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { InkOutlinePostProcess } from "./InkOutlinePostProcess";

export interface StylizedPipelineOptions {
  /** World-units distance the camera focuses at — usually the orbit radius. */
  focusDistance: number;
  /** Tilt-shift blur strength (0 = off, 1 = heavy diorama). */
  tiltShift?: number;
  quality?: "high" | "medium" | "low";
}

export interface StylizedPipeline {
  ssao: SSAO2RenderingPipeline | null;
  ink: InkOutlinePostProcess | null;
  main: DefaultRenderingPipeline;
  setFocusDistance(d: number): void;
  dispose(): void;
}

/** Builds the toy-box post chain: SSAO → ink outlines → tilt-shift DOF + bloom + grading + FXAA. */
export function createStylizedPipeline(scene: Scene, camera: Camera, opts: StylizedPipelineOptions): StylizedPipeline {
  const quality = opts.quality ?? "high";
  const tilt = opts.tiltShift ?? 1;

  const gbuffer = scene.enableGeometryBufferRenderer(quality === "low" ? 0.5 : 1);

  let ssao: SSAO2RenderingPipeline | null = null;
  if (gbuffer && quality !== "low") {
    ssao = new SSAO2RenderingPipeline("pk-ssao", scene, { ssaoRatio: quality === "high" ? 0.75 : 0.5, blurRatio: 1 }, [camera], gbuffer);
    ssao.radius = 0.55;
    ssao.totalStrength = 1.15;
    ssao.base = 0.15;
    ssao.samples = quality === "high" ? 16 : 8;
    ssao.maxZ = 250;
    ssao.minZAspect = 0.4;
    ssao.expensiveBlur = quality === "high";
    ssao.bypassBlur = false;
    ssao.bilateralSoften = 0.5;
    ssao.bilateralTolerance = 0.03;
  }

  let ink: InkOutlinePostProcess | null = null;
  if (gbuffer) {
    ink = new InkOutlinePostProcess("pk-ink", camera, gbuffer, {
      thickness: quality === "high" ? 1.25 : 1,
      strength: 0.8,
      depthThreshold: 0.014,
      normalThreshold: 0.6,
    });
  }

  const main = new DefaultRenderingPipeline("pk-main", true, scene, [camera]);
  main.samples = 1;
  main.fxaaEnabled = true;

  // Tilt-shift via a low-FOV camera with a wide aperture → tiny diorama look.
  main.depthOfFieldEnabled = tilt > 0;
  main.depthOfFieldBlurLevel = quality === "high" ? 2 : 1;
  main.depthOfField.fStop = 1.4;
  main.depthOfField.lensSize = 50;
  // Keep focal length proportional to focus distance so blur fall-off stays stable while orbiting.
  const applyFocus = (d: number) => {
    main.depthOfField.focusDistance = d * 1000;
    main.depthOfField.focalLength = d * 1000 * 0.06 * tilt;
  };
  applyFocus(opts.focusDistance);

  main.bloomEnabled = true;
  main.bloomThreshold = 0.78;
  main.bloomWeight = 0.32;
  main.bloomKernel = 48;
  main.bloomScale = 0.5;

  // Golden-hour grading emulated with curves.
  main.imageProcessingEnabled = true;
  const ip = main.imageProcessing;
  ip.toneMappingEnabled = false;
  ip.exposure = 1.0;
  ip.contrast = 1.1;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.2;
  ip.vignetteStretch = 0.4;
  ip.vignetteColor = new Color4(0.26, 0.14, 0.32, 0);
  ip.vignetteCameraFov = 0.9;
  const curves = new ColorCurves();
  curves.globalSaturation = 8;
  curves.highlightsHue = 40;
  curves.highlightsSaturation = 8;
  curves.highlightsExposure = 5;
  curves.shadowsHue = 265;
  curves.shadowsSaturation = 20;
  curves.shadowsExposure = -2;
  ip.colorCurvesEnabled = true;
  ip.colorCurves = curves;

  main.chromaticAberrationEnabled = quality === "high";
  main.chromaticAberration.aberrationAmount = 6;
  main.chromaticAberration.radialIntensity = 0.8;
  main.grainEnabled = false;

  return {
    ssao,
    ink,
    main,
    setFocusDistance(d: number) {
      applyFocus(d);
    },
    dispose() {
      main.dispose();
      ssao?.dispose();
      ink?.dispose();
      scene.disableGeometryBufferRenderer();
    },
  };
}
