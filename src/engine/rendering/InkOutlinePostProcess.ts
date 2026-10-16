import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { GeometryBufferRenderer } from "@babylonjs/core/Rendering/geometryBufferRenderer";

/** Screen-space ink outlines from the GeometryBufferRenderer depth + normal buffers. */
Effect.ShadersStore["inkOutlineFragmentShader"] = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform sampler2D normalSampler;
uniform vec2 texelSize;
uniform float thickness;
uniform float depthThreshold;
uniform float normalThreshold;
uniform float strength;
uniform vec3 inkColor;

float readDepth(vec2 uv) { return abs(texture2D(depthSampler, uv).r); }
vec3 readNormal(vec2 uv) { return texture2D(normalSampler, uv).xyz * 2.0 - 1.0; }

void main(void) {
  vec4 col = texture2D(textureSampler, vUV);
  vec2 o = texelSize * thickness;

  float d0 = readDepth(vUV);
  float dl = readDepth(vUV - vec2(o.x, 0.0));
  float dr = readDepth(vUV + vec2(o.x, 0.0));
  float du = readDepth(vUV - vec2(0.0, o.y));
  float dd = readDepth(vUV + vec2(0.0, o.y));

  // Depth edge normalized by local depth so far objects don't get thicker lines.
  float depthEdge = (abs(dl - dr) + abs(du - dd)) / max(d0, 1e-4);

  vec3 n0 = readNormal(vUV);
  vec3 nl = readNormal(vUV - vec2(o.x, 0.0));
  vec3 nr = readNormal(vUV + vec2(o.x, 0.0));
  vec3 nu = readNormal(vUV - vec2(0.0, o.y));
  vec3 nd = readNormal(vUV + vec2(0.0, o.y));
  float normalEdge = (1.0 - dot(n0, nl)) + (1.0 - dot(n0, nr)) + (1.0 - dot(n0, nu)) + (1.0 - dot(n0, nd));

  float e = smoothstep(depthThreshold, depthThreshold * 2.0, depthEdge)
          + smoothstep(normalThreshold, normalThreshold * 1.6, normalEdge);
  e = clamp(e, 0.0, 1.0) * strength;

  if (d0 <= 1e-5 && dl <= 1e-5 && dr <= 1e-5 && du <= 1e-5 && dd <= 1e-5) e = 0.0;

  gl_FragColor = vec4(mix(col.rgb, inkColor, e), col.a);
}
`;

export interface InkOptions {
  thickness?: number;
  depthThreshold?: number;
  normalThreshold?: number;
  strength?: number;
  color?: Color3;
}

export class InkOutlinePostProcess extends PostProcess {
  public thickness: number;
  public depthThreshold: number;
  public normalThreshold: number;
  public strength: number;
  public inkColor: Color3;
  private _texel = new Vector2();

  constructor(name: string, camera: Camera, gbuffer: GeometryBufferRenderer, opts: InkOptions = {}) {
    super(
      name,
      "inkOutline",
      ["texelSize", "thickness", "depthThreshold", "normalThreshold", "strength", "inkColor"],
      ["depthSampler", "normalSampler"],
      1.0,
      camera,
      Texture.BILINEAR_SAMPLINGMODE,
      undefined,
      false,
    );
    this.thickness = opts.thickness ?? 1.2;
    this.depthThreshold = opts.depthThreshold ?? 0.012;
    this.normalThreshold = opts.normalThreshold ?? 0.55;
    this.strength = opts.strength ?? 0.85;
    this.inkColor = opts.color ?? new Color3(0.13, 0.08, 0.2);

    const depthIndex = gbuffer.getTextureIndex(GeometryBufferRenderer.DEPTH_TEXTURE_TYPE);
    const normalIndex = gbuffer.getTextureIndex(GeometryBufferRenderer.NORMAL_TEXTURE_TYPE);

    this.onApplyObservable.add((effect) => {
      const rt = gbuffer.getGBuffer();
      const textures = rt.textures;
      effect.setTexture("depthSampler", textures[depthIndex]);
      effect.setTexture("normalSampler", textures[normalIndex]);
      this._texel.set(1 / this.width, 1 / this.height);
      effect.setVector2("texelSize", this._texel);
      effect.setFloat("thickness", this.thickness);
      effect.setFloat("depthThreshold", this.depthThreshold);
      effect.setFloat("normalThreshold", this.normalThreshold);
      effect.setFloat("strength", this.strength);
      effect.setColor3("inkColor", this.inkColor);
    });
  }
}
