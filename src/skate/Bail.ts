import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { BallAndSocketConstraint } from "@babylonjs/core/Physics/v2/physicsConstraint";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Instance } from "@/engine/assets/AssetLoader";
import type { PlayerController } from "./PlayerController";

/** Temporary ragdoll: vehicle + hips + torso joined by a ball-socket; disposed after the timer. */
export class Bail {
  private cleanup: Array<() => void> = [];
  private timer = 0;
  active = false;

  constructor(
    private scene: Scene,
    private loaderClone: (id: string) => Promise<Instance>,
  ) {}

  async trigger(ctrl: PlayerController, velocity: Vector3, characterId: string, rideId: string) {
    if (this.active) return;
    this.active = true;
    this.timer = 1.15;
    const origin = ctrl.position.clone();
    const fling = velocity.scale(0.55);
    fling.y = Math.max(fling.y, 0) + 2.6;
    const spin = () => new Vector3(rnd(-8, 8), rnd(-6, 6), rnd(-8, 8));

    const ride = await this.loaderClone(rideId);
    const rideBox = CreateBox("bail-ride", { width: 0.32, height: 0.12, depth: 0.7 }, this.scene);
    rideBox.isVisible = false;
    rideBox.position = origin.add(new Vector3(0, -0.05, 0));
    rideBox.rotationQuaternion = ctrl.visual.rotationQuaternion?.clone() ?? Quaternion.Identity();
    ride.root.parent = rideBox;
    ride.root.position.y = -0.06;
    const rideAgg = new PhysicsAggregate(rideBox, PhysicsShapeType.BOX, { mass: 0.6, friction: 0.6, restitution: 0.35 }, this.scene);
    rideAgg.body.setLinearVelocity(fling.scale(1.3).add(new Vector3(rnd(-1, 1), 1.5, rnd(-1, 1))));
    rideAgg.body.setAngularVelocity(spin());

    const char = await this.loaderClone(characterId);
    const hips = CreateBox("bail-hips", { width: 0.34, height: 0.3, depth: 0.22 }, this.scene);
    hips.isVisible = false;
    hips.position = origin.add(new Vector3(0, 0.1, 0));
    hips.rotationQuaternion = rideBox.rotationQuaternion.clone();
    const torso = CreateBox("bail-torso", { width: 0.36, height: 0.34, depth: 0.24 }, this.scene);
    torso.isVisible = false;
    torso.position = origin.add(new Vector3(0, 0.42, 0));
    torso.rotationQuaternion = rideBox.rotationQuaternion.clone();

    char.root.parent = hips;
    char.root.position.set(0, -0.15, 0);
    char.root.scaling.setAll(0.85);
    for (const ag of char.animationGroups) ag.stop();
    const fall = char.animationGroups.find((a) => a.name.endsWith(":fall") || a.name.endsWith(":die"));
    fall?.start(false, 1.6);

    const hipsAgg = new PhysicsAggregate(hips, PhysicsShapeType.BOX, { mass: 1, friction: 0.8, restitution: 0.2 }, this.scene);
    const torsoAgg = new PhysicsAggregate(torso, PhysicsShapeType.BOX, { mass: 0.8, friction: 0.8, restitution: 0.2 }, this.scene);
    hipsAgg.body.setLinearDamping(0.6);
    torsoAgg.body.setLinearDamping(0.6);
    hipsAgg.body.setAngularDamping(1.5);
    torsoAgg.body.setAngularDamping(1.5);
    const joint = new BallAndSocketConstraint(new Vector3(0, 0.16, 0), new Vector3(0, -0.17, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0), this.scene);
    hipsAgg.body.addConstraint(torsoAgg.body, joint);
    hipsAgg.body.setLinearVelocity(fling.add(new Vector3(0, 1.0, 0)));
    torsoAgg.body.setLinearVelocity(fling.add(new Vector3(0, 2.2, 0)));
    hipsAgg.body.setAngularVelocity(spin().scale(0.6));
    torsoAgg.body.setAngularVelocity(spin().scale(0.4));

    this.cleanup.push(() => {
      joint.dispose();
      rideAgg.dispose();
      hipsAgg.dispose();
      torsoAgg.dispose();
      ride.dispose();
      char.dispose();
      rideBox.dispose();
      hips.dispose();
      torso.dispose();
    });
  }

  /** @returns true on the frame the ragdoll finished. */
  update(dt: number): boolean {
    if (!this.active) return false;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.end();
      return true;
    }
    return false;
  }

  end() {
    for (const c of this.cleanup) c();
    this.cleanup = [];
    this.active = false;
  }

  dispose() {
    this.end();
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
