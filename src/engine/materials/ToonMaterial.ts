import { CustomMaterial } from "@babylonjs/materials/custom/customMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * Cel-shaded CustomMaterial: keeps Babylon's lighting pipeline and only
 * replaces the composition step, quantising accumulated light into N bands.
 */
export interface ToonOptions {
  /** Number of illumination bands (2–4). */
  bands?: number;
  /** Cool tint added inside the shadow band. */
  shadowTint?: Color3;
  /** Flat color used when no texture is supplied. */
  color?: Color3;
  texture?: BaseTexture | null;
  /** Rim-light strength (0 = off). */
  rim?: number;
  /** Re-encode glTF sRGB textures to gamma space (StandardMaterial expects gamma). */
  srgbFix?: boolean;
}

const TOON_FRAGMENT_BEFORE_FOG = /* glsl */ `
  float toonLum = dot(diffuseBase, vec3(0.299, 0.587, 0.114));
  float toonScaled = toonLum * toonBands;
  float toonBand = floor(toonScaled);
  float toonFrac = toonScaled - toonBand;
  float toonQ = (toonBand + smoothstep(0.42, 0.58, toonFrac)) / toonBands;
  toonQ = clamp(toonQ, 0.0, 1.0);
  vec3 toonLit = diffuseBase * (toonQ / max(toonLum, 0.0001));
  toonLit = max(toonLit, toonShadowTint);

  float toonRimDot = 1.0 - clamp(dot(normalize(viewDirectionW), normalW), 0.0, 1.0);
  float toonRim = smoothstep(0.62, 0.95, toonRimDot) * toonRimStrength * toonQ;

  vec3 toonDiffuse = clamp(toonLit * diffuseColor + emissiveColor + vAmbientColor, 0.0, 1.0) * baseColor.rgb;
  toonDiffuse += toonRim * vec3(1.0, 0.86, 0.7);
  color = vec4(toonDiffuse * baseAmbientColor, alpha);
`;

export function createToonMaterial(name: string, scene: Scene, opts: ToonOptions = {}): CustomMaterial {
  const mat = new CustomMaterial(name, scene);
  const bands = opts.bands ?? 3;
  const tint = opts.shadowTint ?? new Color3(0.34, 0.3, 0.46);

  mat.AddUniform("toonBands", "float", bands);
  mat.AddUniform("toonShadowTint", "vec3", tint);
  mat.AddUniform("toonRimStrength", "float", opts.rim ?? 0.18);
  mat.AddUniform("toonSrgbFix", "float", opts.srgbFix ? 1 : 0);
  mat.Fragment_Custom_Diffuse("baseColor.rgb = mix(baseColor.rgb, toGammaSpace(baseColor.rgb), toonSrgbFix);");
  mat.Fragment_Before_Fog(TOON_FRAGMENT_BEFORE_FOG);

  mat.specularColor = Color3.Black();
  mat.specularPower = 1;
  // scene.ambientColor is white, so this becomes the shadow floor.
  mat.ambientColor = new Color3(0.16, 0.13, 0.24);
  mat.diffuseColor = opts.color ?? Color3.White();
  mat.backFaceCulling = true;
  if (opts.texture) {
    mat.diffuseTexture = opts.texture;
    // Kenney colormaps are palette atlases — nearest sampling keeps colors crisp.
    if (opts.texture instanceof Texture) {
      opts.texture.updateSamplingMode(Texture.NEAREST_NEAREST_MIPLINEAR);
    }
  }
  return mat;
}

/** Swap glTF PBR/standard materials for shared toon materials (one per source texture). */
const cache = new WeakMap<Scene, Map<string, CustomMaterial>>();

export function toonifyMeshes(meshes: AbstractMesh[], scene: Scene, opts: Omit<ToonOptions, "texture" | "color"> = {}) {
  let map = cache.get(scene);
  if (!map) {
    map = new Map();
    cache.set(scene, map);
  }
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || !mesh.material) continue;
    const src = mesh.material;
    let tex: BaseTexture | null = null;
    let color = Color3.White();
    if (src instanceof PBRMaterial) {
      tex = src.albedoTexture ?? null;
      color = src.albedoColor ?? color;
    } else if (src instanceof StandardMaterial) {
      tex = src.diffuseTexture ?? null;
      color = src.diffuseColor ?? color;
    } else if (src instanceof CustomMaterial) {
      continue;
    }
    const key = tex ? `tex:${tex.name}:${tex.uid}` : `col:${color.toHexString()}`;
    let toon = map.get(key);
    if (!toon) {
      const srgbFix = !!tex?.getInternalTexture()?._useSRGBBuffer;
      toon = createToonMaterial(`toon-${map.size}`, scene, { ...opts, texture: tex, color: tex ? Color3.White() : color, srgbFix });
      map.set(key, toon);
    }
    mesh.material = toon;
  }
}
