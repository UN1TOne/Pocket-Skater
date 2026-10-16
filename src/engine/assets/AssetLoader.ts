import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Scene } from "@babylonjs/core/scene";
import { modelUrl } from "@/data/catalog";
import { toonifyMeshes } from "../materials/ToonMaterial";

export interface Instance {
  root: TransformNode;
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  dispose(): void;
}

/** Loads each GLB once per scene as an AssetContainer and hands out clones. */
export class AssetLoader {
  private containers = new Map<string, Promise<AssetContainer>>();

  constructor(private scene: Scene) {}

  preload(ids: string[]) {
    return Promise.all(ids.map((id) => this.container(id)));
  }

  container(id: string): Promise<AssetContainer> {
    let p = this.containers.get(id);
    if (!p) {
      p = LoadAssetContainerAsync(modelUrl(id), this.scene).then((c) => {
        toonifyMeshes(c.meshes, this.scene);
        for (const m of c.meshes) {
          m.isPickable = false;
          m.receiveShadows = true;
        }
        return c;
      });
      this.containers.set(id, p);
    }
    return p;
  }

  async instantiate(id: string, name = id): Promise<Instance> {
    const c = await this.container(id);
    const entries = c.instantiateModelsToScene((n) => `${name}:${n}`, false, { doNotInstantiate: true });
    const root = new TransformNode(name, this.scene);
    root.metadata = { itemId: id };
    for (const n of entries.rootNodes) n.parent = root;
    const meshes: AbstractMesh[] = [];
    for (const n of entries.rootNodes) {
      if ((n as AbstractMesh).getTotalVertices) meshes.push(n as AbstractMesh);
      meshes.push(...n.getChildMeshes(false));
    }
    for (const m of meshes) {
      m.isPickable = true;
      m.receiveShadows = true;
      m.metadata = { ...(m.metadata ?? {}), itemId: id };
    }
    return {
      root,
      meshes,
      animationGroups: entries.animationGroups,
      dispose() {
        for (const ag of entries.animationGroups) ag.dispose();
        root.dispose(false, false);
      },
    };
  }

  dispose() {
    this.containers.forEach((p) => p.then((c) => c.dispose()).catch(() => {}));
    this.containers.clear();
  }
}
