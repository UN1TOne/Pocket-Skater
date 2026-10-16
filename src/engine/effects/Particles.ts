import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/** Flat-shaded comic "poof" blob (hard edged circle with a lighter core). */
function makeBlobTexture(scene: Scene): Texture {
  const size = 64;
  const tex = new DynamicTexture("poof-tex", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.beginPath();
  ctx.arc(size / 2 + 3, size / 2 + 4, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/** Tiny square — reads as a cartoon spark / confetti. */
function makeSquareTexture(scene: Scene): Texture {
  const size = 16;
  const tex = new DynamicTexture("spark-tex", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(2, 2, size - 4, size - 4);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

export class SkateFX {
  readonly poof: ParticleSystem;
  readonly sparks: ParticleSystem;
  readonly trail: ParticleSystem;

  constructor(scene: Scene, emitter: AbstractMesh | Vector3) {
    const blob = makeBlobTexture(scene);
    const square = makeSquareTexture(scene);

    const poof = new ParticleSystem("fx-poof", 60, scene);
    poof.particleTexture = blob;
    poof.emitter = emitter;
    poof.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    poof.minEmitBox = new Vector3(-0.15, 0, -0.15);
    poof.maxEmitBox = new Vector3(0.15, 0.05, 0.15);
    poof.addColorGradient(0, new Color4(1, 0.97, 0.92, 1));
    poof.addColorGradient(0.6, new Color4(0.95, 0.88, 0.85, 0.9));
    poof.addColorGradient(1, new Color4(0.85, 0.75, 0.8, 0));
    poof.addSizeGradient(0, 0.12);
    poof.addSizeGradient(0.35, 0.34);
    poof.addSizeGradient(1, 0.05);
    poof.minLifeTime = 0.35;
    poof.maxLifeTime = 0.6;
    poof.emitRate = 0;
    poof.manualEmitCount = 0;
    poof.direction1 = new Vector3(-1, 0.6, -1);
    poof.direction2 = new Vector3(1, 1.2, 1);
    poof.minEmitPower = 0.8;
    poof.maxEmitPower = 1.8;
    poof.gravity = new Vector3(0, -1.5, 0);
    poof.minAngularSpeed = -2;
    poof.maxAngularSpeed = 2;
    poof.updateSpeed = 0.016;
    poof.start();

    const sparks = new ParticleSystem("fx-sparks", 200, scene);
    sparks.particleTexture = square;
    sparks.emitter = emitter;
    sparks.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    sparks.minEmitBox = new Vector3(-0.05, -0.02, -0.05);
    sparks.maxEmitBox = new Vector3(0.05, 0.02, 0.05);
    sparks.color1 = new Color4(1, 0.9, 0.4, 1);
    sparks.color2 = new Color4(1, 0.6, 0.2, 1);
    sparks.colorDead = new Color4(1, 0.3, 0.1, 0);
    sparks.minSize = 0.025;
    sparks.maxSize = 0.06;
    sparks.minLifeTime = 0.18;
    sparks.maxLifeTime = 0.45;
    sparks.emitRate = 0;
    sparks.direction1 = new Vector3(-1.5, 0.8, -1.5);
    sparks.direction2 = new Vector3(1.5, 2.5, 1.5);
    sparks.minEmitPower = 1.5;
    sparks.maxEmitPower = 3.5;
    sparks.gravity = new Vector3(0, -12, 0);
    sparks.updateSpeed = 0.016;
    sparks.start();

    const trail = new ParticleSystem("fx-trail", 300, scene);
    trail.particleTexture = square;
    trail.emitter = emitter;
    trail.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    trail.minEmitBox = new Vector3(-0.12, 0.02, -0.12);
    trail.maxEmitBox = new Vector3(0.12, 0.12, 0.12);
    trail.addColorGradient(0, new Color4(1, 0.62, 0.25, 1));
    trail.addColorGradient(0.5, new Color4(0.35, 0.6, 1, 0.9));
    trail.addColorGradient(1, new Color4(1, 0.9, 0.3, 0));
    trail.minSize = 0.03;
    trail.maxSize = 0.07;
    trail.minLifeTime = 0.3;
    trail.maxLifeTime = 0.6;
    trail.emitRate = 0;
    trail.direction1 = new Vector3(-0.3, 0.4, -0.3);
    trail.direction2 = new Vector3(0.3, 1.0, 0.3);
    trail.minEmitPower = 0.3;
    trail.maxEmitPower = 0.8;
    trail.gravity = new Vector3(0, -2, 0);
    trail.minAngularSpeed = -4;
    trail.maxAngularSpeed = 4;
    trail.updateSpeed = 0.016;
    trail.start();

    this.poof = poof;
    this.sparks = sparks;
    this.trail = trail;
  }

  /** One-shot cloud burst. */
  burstPoof(count = 10) {
    this.poof.manualEmitCount = count;
  }
  setGrinding(on: boolean) {
    this.sparks.emitRate = on ? 160 : 0;
  }
  /** Rider horizontal speed (u/s) → trail density. */
  setSpeed(speed: number) {
    this.trail.emitRate = speed > 2.5 ? Math.min(90, (speed - 2.5) * 20) : 0;
  }
  dispose() {
    this.poof.dispose();
    this.sparks.dispose();
    this.trail.dispose();
  }
}
