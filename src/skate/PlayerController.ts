import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType, PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Instance } from "@/engine/assets/AssetLoader";
import type { RideId } from "@/types/game";
import { SkateFX } from "@/engine/effects/Particles";

export type RiderState = "idle" | "riding" | "air" | "grinding" | "bailed";

export interface ControllerTuning {
  radius: number;
  maxSpeed: number;
  /** 1/s blend toward target velocity when grounded. */
  accel: number;
  airControl: number;
  jumpSpeed: number;
  rollingDrag: number;
  /** Min horizontal speed into a wall to bail. */
  bailSpeed: number;
}

export const DEFAULT_TUNING: ControllerTuning = {
  radius: 0.24,
  maxSpeed: 5.2,
  accel: 5.5,
  airControl: 1.2,
  jumpSpeed: 4.5,
  rollingDrag: 0.9,
  bailSpeed: 3.4,
};

export interface ControllerEvents {
  onJump?: () => void;
  onLand?: (fallSpeed: number, airtime: number) => void;
  onBail?: (velocity: Vector3, point: Vector3) => void;
  onGrindChange?: (grinding: boolean) => void;
}

/** Havok rolling-sphere character controller: velocity is projected onto the surface it stands on. */
export class PlayerController {
  readonly collider: Mesh;
  readonly body: PhysicsBody;
  readonly visual: TransformNode;
  readonly fx: SkateFX;
  state: RiderState = "idle";
  tuning: ControllerTuning;

  /** World-space move intent (camera-relative x,z), length 0..1. */
  moveDir = new Vector3(0, 0, 0);
  jumpRequested = false;

  grounded = false;
  groundNormal = new Vector3(0, 1, 0);
  groundTags: string[] = [];
  speed = 0;
  airtime = 0;
  /** Manual vs AI driving — AI gets more forgiving bail thresholds. */
  driver: "manual" | "ai" = "manual";
  private railDir: Vector3 | null = null;
  private railCenter = new Vector3();
  private railIsThin = false;
  private rayFwd = new PhysicsRaycastResult();
  private rayBwd = new PhysicsRaycastResult();
  private lastVel = new Vector3();
  private lastGrounded = false;
  /** Yaw in radians; publicly writable so manual-mode input can turn the rider directly. */
  facing = 0;
  private tilt = 0;
  private animCurrent: AnimationGroup | null = null;
  private anims = new Map<string, AnimationGroup>();
  private ray = new PhysicsRaycastResult();
  private physics: PhysicsEngine;
  private bailCooldown = 0;
  private up = new Vector3(0, 1, 0);
  private lastSafePos = new Vector3();
  private safeTimer = 0;

  constructor(
    readonly scene: Scene,
    readonly character: Instance,
    readonly ride: Instance,
    readonly rideId: RideId,
    spawn: Vector3,
    public events: ControllerEvents = {},
    tuning: Partial<ControllerTuning> = {},
  ) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
    this.physics = scene.getPhysicsEngine() as PhysicsEngine;

    const r = this.tuning.radius;
    this.collider = CreateSphere("rider-collider", { diameter: r * 2, segments: 8 }, scene);
    this.collider.isVisible = false;
    this.collider.isPickable = false;
    this.collider.position.copyFrom(spawn).addInPlace(new Vector3(0, r + 0.1, 0));
    this.collider.metadata = { kind: "player" };

    const agg = new PhysicsAggregate(this.collider, PhysicsShapeType.SPHERE, { mass: 1.2, friction: 0.05, restitution: 0 }, scene);
    this.body = agg.body;
    this.body.setMassProperties({ mass: 1.2, inertia: Vector3.Zero() });
    this.body.setLinearDamping(0.05);
    this.body.setAngularDamping(1);
    this.body.setCollisionCallbackEnabled(true);
    this.body.getCollisionObservable().add((ev) => this.onCollision(ev.normal ?? undefined, ev.point ?? undefined, ev.collidedAgainst?.transformNode?.metadata));

    this.visual = new TransformNode("rider-visual", scene);
    this.ride.root.parent = this.visual;
    this.character.root.parent = this.visual;
    this.character.root.position.y = rideId === "scooter" ? 0.1 : 0.08;
    this.character.root.scaling.setAll(0.85);

    for (const ag of character.animationGroups) {
      const key = ag.name.split(":").pop() ?? ag.name;
      this.anims.set(key, ag);
      ag.stop();
    }
    this.play("skate-stand");

    this.fx = new SkateFX(scene, this.collider);
    this.lastSafePos.copyFrom(this.collider.position);
  }

  play(name: string, loop = true, speed = 1) {
    const ag = this.anims.get(name) ?? this.anims.get("idle");
    if (!ag || ag === this.animCurrent) return;
    this.animCurrent?.stop();
    ag.start(loop, speed);
    this.animCurrent = ag;
  }

  get position(): Vector3 {
    return this.collider.position;
  }

  teleport(pos: Vector3) {
    this.body.disablePreStep = false;
    this.collider.position.copyFrom(pos).addInPlace(new Vector3(0, this.tuning.radius + 0.05, 0));
    this.body.setLinearVelocity(Vector3.Zero());
    this.body.setAngularVelocity(Vector3.Zero());
    this.scene.onAfterPhysicsObservable.addOnce(() => {
      this.body.disablePreStep = true;
    });
  }

  requestJump() {
    this.jumpRequested = true;
  }

  /** Call once per frame — only touches velocities, so before/after physics is fine. */
  update(dt: number) {
    if (this.state === "bailed") {
      this.visual.setEnabled(false);
      this.bailCooldown -= dt;
      return;
    }
    this.visual.setEnabled(true);
    this.bailCooldown = Math.max(0, this.bailCooldown - dt);

    const t = this.tuning;
    const vel = this.body.getLinearVelocity();
    this.probeGround();

    // Kill gravity while on a thin rail so the sphere can't be dragged off the top.
    const onThinRail = this.grounded && this.railIsThin && this.railDir !== null && this.groundTags.includes("rail");
    this.body.setGravityFactor(onThinRail ? 0 : 1);

    // Air-to-rail magnet: while airborne, if a rail is just below us, nudge our x/z toward
    // the rail center and bias velocity downward so we actually land on it instead of
    // sailing past. Makes AI jumps onto rails viable and manual approaches more forgiving.
    if (!this.grounded && vel.y < 2) {
      const sniff = new PhysicsRaycastResult();
      this.physics.raycastToRef(
        this.collider.position,
        this.collider.position.add(new Vector3(0, -1.2, 0)),
        sniff,
      );
      if (sniff.hasHit && sniff.body !== this.body) {
        const meta = sniff.body?.transformNode?.metadata as { tags?: string[] } | undefined;
        const tags = meta?.tags ?? [];
        if (tags.includes("rail")) {
          const target = sniff.hitPointWorld;
          const dx = target.x - this.collider.position.x;
          const dz = target.z - this.collider.position.z;
          vel.x += dx * 14 * dt;
          vel.z += dz * 14 * dt;
          if (vel.y > -3) vel.y -= 18 * dt;
          this.body.setLinearVelocity(vel);
        }
      }
    }

    const intent = this.moveDir.length();
    const target = new Vector3(0, 0, 0);
    if (intent > 0.02) {
      target.copyFrom(this.moveDir).scaleInPlace(t.maxSpeed);
      if (this.grounded) {
        // Project onto the surface so we ride along ramps instead of into them.
        const n = this.groundNormal;
        const d = Vector3.Dot(target, n);
        target.subtractInPlace(n.scale(d));
        if (target.lengthSquared() > 1e-4) target.normalize().scaleInPlace(t.maxSpeed * Math.min(1, intent));
      }
    }

    const newVel = vel.clone();
    if (this.grounded) {
      if (intent > 0.02) {
        const k = 1 - Math.exp(-t.accel * dt);
        newVel.x = Scalar.Lerp(vel.x, target.x, k);
        newVel.z = Scalar.Lerp(vel.z, target.z, k);
        if (Math.abs(this.groundNormal.y) < 0.98) newVel.y = Scalar.Lerp(vel.y, target.y, k * 0.8);
      } else {
        const k = Math.exp(-t.rollingDrag * dt);
        newVel.x *= k;
        newVel.z *= k;
      }
      // Glue the ball to slopes so it doesn't skip when crossing facets.
      if (this.groundNormal.y < 0.95 && vel.y > -0.5 && intent > 0.02) newVel.addInPlace(this.groundNormal.scale(-0.6));
    } else if (intent > 0.02) {
      const k = 1 - Math.exp(-t.airControl * dt);
      newVel.x = Scalar.Lerp(vel.x, target.x, k);
      newVel.z = Scalar.Lerp(vel.z, target.z, k);
    }

    if (this.jumpRequested) {
      this.jumpRequested = false;
      if (this.grounded) {
        newVel.y = Math.max(newVel.y, 0) + t.jumpSpeed;
        newVel.addInPlace(this.groundNormal.scale(0.7));
        this.grounded = false;
        this.fx.burstPoof(6);
        this.events.onJump?.();
      }
    }

    this.body.setLinearVelocity(newVel);
    this.lastVel.copyFrom(newVel);

    // Rail assist: decompose velocity into along/perpendicular, drive along forward with a
    // minimum speed, kill perpendicular motion, and (for thin rails) lock the rider's Y to
    // the rail height so gravity can't drag them off the top.
    if (this.grounded && this.railDir && (this.groundTags.includes("rail") || this.groundTags.includes("grind"))) {
      const dir = this.railDir;
      const perpX = -dir.z;
      const perpZ = dir.x;
      const along = newVel.x * dir.x + newVel.z * dir.z;
      const perp = newVel.x * perpX + newVel.z * perpZ;
      const minRailSpeed = this.railIsThin ? 3.2 : 0;

      let sign: number;
      if (Math.abs(along) > 0.4) sign = along >= 0 ? 1 : -1;
      else {
        const faceDot = Math.sin(this.facing) * dir.x + Math.cos(this.facing) * dir.z;
        sign = faceDot >= 0 ? 1 : -1;
      }
      const alongTarget = Math.max(Math.abs(along), minRailSpeed) * sign;
      const alongK = 1 - Math.exp(-24 * dt);
      const perpK = 1 - Math.exp(-40 * dt);
      const newAlong = Scalar.Lerp(along, alongTarget, alongK);
      const newPerp = Scalar.Lerp(perp, 0, perpK);
      newVel.x = dir.x * newAlong + perpX * newPerp;
      newVel.z = dir.z * newAlong + perpZ * newPerp;

      if (this.railIsThin) {
        // Lateral spring back to centerline (very stiff).
        const dx = this.collider.position.x - this.railCenter.x;
        const dz = this.collider.position.z - this.railCenter.z;
        const latOff = dx * perpX + dz * perpZ;
        const latAccel = -latOff * 160;
        newVel.x += perpX * latAccel * dt;
        newVel.z += perpZ * latAccel * dt;

        // Y lock: pin the collider to railCenter.y + sphere radius so gravity can't bleed
        // the rider off the rail. Velocity goes toward the correction, with no downward
        // escape allowed while on the rail.
        const yTarget = this.railCenter.y + this.tuning.radius;
        const yOff = this.collider.position.y - yTarget;
        const yAccel = -yOff * 50 - newVel.y * 10;
        newVel.y += yAccel * dt;
        if (newVel.y < 0 && yOff < 0.08) newVel.y = Math.max(newVel.y, 0);
      }
    }

    const hSpeed = Math.hypot(newVel.x, newVel.z);
    this.speed = hSpeed;
    const grinding = this.grounded && hSpeed > 0.6 && (this.groundTags.includes("rail") || this.groundTags.includes("grind"));

    let next: RiderState;
    if (!this.grounded) next = "air";
    else if (grinding) next = "grinding";
    else if (hSpeed > 0.4) next = "riding";
    else next = "idle";

    if (next === "air") this.airtime += dt;
    if (this.grounded && !this.lastGrounded) {
      const fall = -Math.min(0, vel.y);
      if (fall > 2.2 || this.airtime > 0.35) this.fx.burstPoof(fall > 5 ? 12 : 6);
      this.events.onLand?.(fall, this.airtime);
      this.airtime = 0;
    }
    if (next !== this.state) {
      if ((next === "grinding") !== (this.state === "grinding")) this.events.onGrindChange?.(next === "grinding");
      this.state = next;
      if (next === "air") this.play(this.airtime > 0.5 ? "skate-grab" : "skate-air", true);
      else if (next === "grinding") this.play("skate-grab", true);
      else if (next === "riding") this.play(this.rideId === "scooter" ? "skate-stand" : "skate", true);
      else this.play("skate-stand", true);
    }
    this.fx.setGrinding(next === "grinding");
    this.fx.setSpeed(hSpeed);
    this.lastGrounded = this.grounded;

    if (this.grounded && this.groundNormal.y > 0.9) {
      this.safeTimer += dt;
      if (this.safeTimer > 0.5) {
        this.lastSafePos.copyFrom(this.collider.position);
        this.safeTimer = 0;
      }
    }

    const p = this.collider.position;
    this.visual.position.set(p.x, p.y - t.radius + 0.02, p.z);
    if (hSpeed > 0.3) {
      const yaw = Math.atan2(newVel.x, newVel.z);
      this.facing = lerpAngle(this.facing, yaw, 1 - Math.exp(-10 * dt));
    }
    const targetTilt = this.grounded ? Math.asin(Scalar.Clamp(-this.groundNormal.x * Math.cos(this.facing) + this.groundNormal.z * Math.sin(this.facing), -1, 1)) : 0;
    this.tilt = Scalar.Lerp(this.tilt, targetTilt, 1 - Math.exp(-8 * dt));
    const pitch = this.grounded ? Math.asin(Scalar.Clamp(this.groundNormal.z * Math.cos(this.facing) + this.groundNormal.x * Math.sin(this.facing), -1, 1)) : (this.state === "air" ? -newVel.y * 0.06 : 0);
    Quaternion.RotationYawPitchRollToRef(this.facing, pitch, this.tilt * 0.6, (this.visual.rotationQuaternion ??= Quaternion.Identity()));
  }

  private probeGround() {
    const r = this.tuning.radius;
    const from = this.collider.position;
    const to = from.add(new Vector3(0, -(r + 0.12), 0));
    this.physics.raycastToRef(from, to, this.ray, { collideWith: ~0 });
    let hit = this.ray.hasHit && this.ray.body !== this.body;
    if (!hit) {
      // Fall back to 4 slanted probes for curved surfaces (bowls).
      for (let i = 0; i < 4 && !hit; i++) {
        const a = (i / 4) * Math.PI * 2;
        const dir = new Vector3(Math.cos(a) * 0.6, -0.8, Math.sin(a) * 0.6).normalize().scaleInPlace(r + 0.1);
        this.physics.raycastToRef(from, from.add(dir), this.ray, { collideWith: ~0 });
        hit = this.ray.hasHit && this.ray.body !== this.body;
      }
    }
    this.grounded = hit;
    if (hit) {
      this.groundNormal.copyFrom(this.ray.hitNormalWorld);
      if (this.groundNormal.y < 0) this.groundNormal.scaleInPlace(-1);
      const meta = this.ray.body?.transformNode?.metadata;
      this.groundTags = (meta?.tags as string[]) ?? [];
      this.updateRailFromHit();
    } else {
      this.groundNormal.copyFrom(this.up);
      this.groundTags = [];
      this.railDir = null;
    }
  }

  /**
   * Reads the rail/grind piece's world-space tangent at the hit point.
   * Samples the same piece slightly ahead and behind so curved rails return
   * the actual tangent, not the chord between endpoints.
   */
  private updateRailFromHit() {
    const isRailish = this.groundTags.includes("rail") || this.groundTags.includes("grind");
    if (!isRailish) {
      this.railDir = null;
      return;
    }
    this.railIsThin = this.groundTags.includes("rail");
    const node = this.ray.body?.transformNode;
    if (!node) {
      this.railDir = null;
      return;
    }
    const uid = (node.metadata as { uid?: string } | undefined)?.uid;
    const hit = this.ray.hitPointWorld;

    const roughFwd = Vector3.TransformNormal(new Vector3(0, 0, 1), node.getWorldMatrix());
    roughFwd.y = 0;
    const roughLen = roughFwd.length();
    if (roughLen < 1e-3) {
      this.railDir = null;
      return;
    }
    roughFwd.scaleInPlace(1 / roughLen);

    const sample = (sign: number, result: PhysicsRaycastResult): Vector3 | null => {
      const off = 0.22;
      const from = new Vector3(hit.x + roughFwd.x * off * sign, hit.y + 0.25, hit.z + roughFwd.z * off * sign);
      const to = new Vector3(from.x, hit.y - 0.3, from.z);
      this.physics.raycastToRef(from, to, result);
      if (!result.hasHit) return null;
      const hitMeta = result.body?.transformNode?.metadata as { uid?: string } | undefined;
      if (uid && hitMeta?.uid !== uid) return null;
      return result.hitPointWorld;
    };
    const fp = sample(1, this.rayFwd);
    const bp = sample(-1, this.rayBwd);

    let tangent: Vector3;
    if (fp && bp) tangent = fp.subtract(bp);
    else if (fp) tangent = fp.subtract(hit);
    else if (bp) tangent = hit.subtract(bp);
    else tangent = roughFwd;
    tangent.y = 0;
    const tl = tangent.length();
    this.railDir = tl > 0.05 ? tangent.scaleInPlace(1 / tl) : roughFwd;
    this.railCenter.copyFrom(hit);
  }

  private onCollision(normal: Vector3 | undefined, point: Vector3 | undefined, meta?: { kind?: string; tags?: string[] }) {
    if (!normal || this.state === "bailed" || this.bailCooldown > 0) return;
    const n = normal;
    const tags = meta?.tags ?? [];
    const isWall = meta?.kind === "wall" || tags.includes("wall");
    // Ramps/bowls are meant to be steep — only their vertical backs count as walls.
    const steepLimit = tags.includes("ramp") ? 0.12 : isWall ? 0.5 : 0.35;
    if (Math.abs(n.y) > steepLimit) return;
    const v = this.lastVel;
    const hSpeed = Math.hypot(v.x, v.z);
    // AI gets a higher bail threshold so cornering grazes don't wipe the show-reel.
    const bailFloor = this.driver === "ai" ? Math.max(this.tuning.bailSpeed + 1.4, 4.6) : this.tuning.bailSpeed;
    if (hSpeed < bailFloor) return;
    const into = Math.abs(v.x * n.x + v.z * n.z) / Math.max(hSpeed, 1e-3);
    const intoFloor = this.driver === "ai" ? 0.78 : 0.6;
    if (into < intoFloor) return;
    this.bail(v.clone(), point ?? this.collider.position.clone());
  }

  bail(velocity: Vector3, point: Vector3) {
    if (this.state === "bailed") return;
    this.state = "bailed";
    this.bailCooldown = 1.1;
    this.fx.setGrinding(false);
    this.fx.setSpeed(0);
    this.fx.burstPoof(14);
    this.body.setLinearVelocity(Vector3.Zero());
    this.body.setMotionType(PhysicsMotionType.STATIC);
    this.events.onBail?.(velocity, point);
  }

  respawn() {
    this.body.setMotionType(PhysicsMotionType.DYNAMIC);
    this.body.setMassProperties({ mass: 1.2, inertia: Vector3.Zero() });
    this.teleport(this.lastSafePos.add(new Vector3(0, 0, 0)));
    this.state = "idle";
    this.airtime = 0;
    this.play("skate-stand");
    this.visual.setEnabled(true);
    this.fx.burstPoof(8);
  }

  dispose() {
    this.fx.dispose();
    this.body.dispose();
    this.collider.dispose();
    this.character.dispose();
    this.ride.dispose();
    this.visual.dispose();
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
