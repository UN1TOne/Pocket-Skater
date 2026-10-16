import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { createToonMaterial } from "../materials/ToonMaterial";

export interface GridGroundOptions {
  /** Grid cells per side. */
  size: number;
  /** Builder shows white cell outlines; skate shows only the faint checker. */
  showGridLines: boolean;
}

export interface GridGround {
  slab: Mesh;
  apron: Mesh;
  curb: Mesh;
  setGridLines(show: boolean): void;
  dispose(): void;
}

/** Procedural checkerboard + optional grid overlay as a single crisp texture for the slab. */
function makeSlabTexture(scene: Scene, size: number, lines: boolean, light: string, dark: string, lineAlpha: number) {
  const px = 96;
  const res = Math.min(4096, size * px);
  const tex = new DynamicTexture(`slab-tex-${lines}`, { width: res, height: res }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const cell = res / size;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? light : dark;
      ctx.fillRect(i * cell, j * cell, cell + 1, cell + 1);
    }
  }
  if (lines) {
    ctx.strokeStyle = `rgba(255,255,255,${lineAlpha})`;
    ctx.lineWidth = Math.max(2, cell * 0.03);
    ctx.setLineDash([cell * 0.14, cell * 0.1]);
    for (let i = 0; i <= size; i++) {
      const p = Math.round(i * cell) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, res);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(res, p);
      ctx.stroke();
    }
  }
  tex.update(false);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

function makeApronTexture(scene: Scene) {
  const res = 256;
  const tex = new DynamicTexture("apron-tex", { width: res, height: res }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const half = res / 2;
  ctx.fillStyle = "#4b445f";
  ctx.fillRect(0, 0, res, res);
  ctx.fillStyle = "#524b68";
  ctx.fillRect(0, 0, half, half);
  ctx.fillRect(half, half, half, half);
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 130;
  tex.vScale = 130;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

export function createGridGround(scene: Scene, opts: GridGroundOptions): GridGround {
  const { size } = opts;

  const slab = CreateGround("park-slab", { width: size, height: size, subdivisions: 1 }, scene);
  slab.position.y = 0.002;
  slab.receiveShadows = true;
  slab.isPickable = true;
  slab.metadata = { kind: "ground" };

  const slabMatLines = createToonMaterial("slab-mat-lines", scene, {
    texture: makeSlabTexture(scene, size, true, "#8f88a9", "#857ea0", 0.55),
    bands: 3,
    rim: 0,
  });
  const slabMatPlain = createToonMaterial("slab-mat-plain", scene, {
    texture: makeSlabTexture(scene, size, true, "#8f88a9", "#857ea0", 0.14),
    bands: 3,
    rim: 0,
  });
  slab.material = opts.showGridLines ? slabMatLines : slabMatPlain;

  const apron = CreateGround("apron", { width: 260, height: 260, subdivisions: 1 }, scene);
  apron.receiveShadows = true;
  apron.isPickable = false;
  apron.material = createToonMaterial("apron-mat", scene, { texture: makeApronTexture(scene), bands: 3, rim: 0 });

  // Four thin boxes parented under one node form the visual curb.
  const curbH = 0.12;
  const curbW = 0.22;
  const curb = CreateBox("curb-root", { size: 0.001 }, scene);
  curb.isVisible = false;
  curb.isPickable = false;
  const curbMat = createToonMaterial("curb-mat", scene, { color: new Color3(0.93, 0.85, 0.78), bands: 3, rim: 0.1 });
  const sides: Array<[number, number, number, number]> = [
    [0, -size / 2 - curbW / 2, size + curbW * 2, curbW],
    [0, size / 2 + curbW / 2, size + curbW * 2, curbW],
    [-size / 2 - curbW / 2, 0, curbW, size],
    [size / 2 + curbW / 2, 0, curbW, size],
  ];
  sides.forEach(([x, z, w, d], i) => {
    const b = CreateBox(`curb-${i}`, { width: w, height: curbH, depth: d }, scene);
    b.position.set(x, curbH / 2, z);
    b.material = curbMat;
    b.receiveShadows = true;
    b.isPickable = false;
    b.parent = curb;
    b.metadata = { kind: "curb" };
  });

  return {
    slab,
    apron,
    curb,
    setGridLines(show) {
      slab.material = show ? slabMatLines : slabMatPlain;
    },
    dispose() {
      slab.dispose(false, true);
      apron.dispose(false, true);
      curb.dispose(false, true);
    },
  };
}
