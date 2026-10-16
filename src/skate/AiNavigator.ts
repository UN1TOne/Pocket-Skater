import { RecastJSPlugin } from "@babylonjs/core/Navigation/Plugins/recastJSPlugin";
import type { ICrowd, INavMeshParameters } from "@babylonjs/core/Navigation/INavigationEngine";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { PlayerController } from "./PlayerController";

export interface PointOfInterest {
  position: Vector3;
  kind: "ramp" | "grind" | "open";
  /** World-space long axis for grind pieces, so the AI can target an end instead of the middle. */
  axis?: Vector3;
}

let recastModule: unknown | null = null;
async function loadRecast(): Promise<unknown> {
  if (recastModule) return recastModule;
  const mod = await import("recast-detour");
  const factory = mod.default as unknown as (this: object, arg?: Record<string, unknown>) => Promise<unknown>;
  recastModule = await factory.call({}, {});
  return recastModule;
}

/** Auto-drive AI tuned for a TAS-like show reel: long lines, corner cuts, rare bails. */
export class AiNavigator {
  private plugin: RecastJSPlugin | null = null;
  crowd: ICrowd | null = null;
  agent = -1;
  private agentNode: TransformNode | null = null;
  target: Vector3 | null = null;
  private targetTimer = 0;
  private stuckTimer = 0;
  private jumpCooldown = 0;
  private ray = new PhysicsRaycastResult();
  private whisker = new PhysicsRaycastResult();
  private physics: PhysicsEngine;
  private lastPos = new Vector3();
  private lastProgressCheck = 0;
  private smoothSteer = new Vector3(0, 0, 1);
  private throttle = 1;
  ready = false;
  usingNavMesh = false;

  debugMesh: Mesh | null = null;

  constructor(
    private scene: Scene,
    private pois: PointOfInterest[],
    private halfExtent: number,
  ) {
    this.physics = scene.getPhysicsEngine() as PhysicsEngine;
  }

  async bake(staticMeshes: Mesh[]) {
    try {
      const recast = await loadRecast();
      const plugin = new RecastJSPlugin(recast as never);
      const params: INavMeshParameters = {
        cs: 0.1,
        ch: 0.04,
        walkableSlopeAngle: 68,
        walkableHeight: 8,
        walkableClimb: 7,
        walkableRadius: 3,
        maxEdgeLen: 12,
        maxSimplificationError: 1.1,
        minRegionArea: 4,
        mergeRegionArea: 20,
        maxVertsPerPoly: 6,
        detailSampleDist: 6,
        detailSampleMaxError: 1,
      };
      plugin.createNavMesh(staticMeshes, params);
      plugin.setDefaultQueryExtent(new Vector3(1.5, 2, 1.5));
      this.plugin = plugin;
      this.crowd = plugin.createCrowd(2, 0.3, this.scene);
      this.usingNavMesh = true;
    } catch (err) {
      console.warn("[AiNavigator] Recast unavailable, using fallback steering.", err);
      this.usingNavMesh = false;
    }
    this.ready = true;
  }

  attach(ctrl: PlayerController) {
    if (this.crowd && this.plugin) {
      this.agentNode = new TransformNode("ai-agent", this.scene);
      const start = this.plugin.getClosestPoint(ctrl.position);
      this.agent = this.crowd.addAgent(
        start,
        {
          radius: 0.26,
          height: 0.6,
          maxAcceleration: 12,
          maxSpeed: 4.6,
          collisionQueryRange: 1.6,
          pathOptimizationRange: 6,
          separationWeight: 0,
        },
        this.agentNode,
      );
    }
    this.lastPos.copyFrom(ctrl.position);
    this.pickTarget(ctrl.position);
  }

  private pickTarget(from: Vector3) {
    let useful = this.pois.filter((p) => p.kind !== "open" && Vector3.Distance(p.position, from) > 1.8);
    if (useful.length === 0) useful = this.pois.filter((p) => p.kind !== "open");
    let dest: Vector3;
    if (useful.length > 0 && Math.random() < 0.97) {
      // Strongly bias toward grind pieces — that's where the points come from.
      const grinds = useful.filter((p) => p.kind === "grind");
      const pool = grinds.length > 0 && Math.random() < 0.72 ? grinds : useful;
      const scored = pool.map((p) => ({ p, w: Vector3.Distance(p.position, from) }));
      scored.sort((a, b) => b.w - a.w);
      const top = scored.slice(0, Math.max(2, Math.ceil(scored.length * 0.6)));
      const poi = top[Math.floor(Math.random() * top.length)].p;
      if (poi.kind === "grind" && poi.axis) {
        // Aim at the far end of the rail so the path crosses the whole piece.
        const halfLen = 0.45;
        const end1 = poi.position.add(poi.axis.scale(halfLen));
        const end2 = poi.position.subtract(poi.axis.scale(halfLen));
        dest = Vector3.Distance(from, end1) > Vector3.Distance(from, end2) ? end1 : end2;
      } else {
        dest = poi.position.clone();
      }
    } else {
      dest = new Vector3(
        (Math.random() * 2 - 1) * (this.halfExtent - 1.2),
        0,
        (Math.random() * 2 - 1) * (this.halfExtent - 1.2),
      );
    }
    if (this.plugin) {
      const snapped = this.plugin.getClosestPoint(dest);
      if (snapped.lengthSquared() > 0) dest = snapped;
    }
    this.target = dest;
    this.targetTimer = 0;
    this.stuckTimer = 0;
    if (this.crowd && this.agent >= 0) this.crowd.agentGoto(this.agent, dest);
  }

  /** Writes moveDir / jump requests into the controller. */
  update(ctrl: PlayerController, dt: number) {
    if (!this.ready || ctrl.state === "bailed") return;
    this.targetTimer += dt;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    const pos = ctrl.position;

    if (!this.target || this.targetTimer > 15 || Vector3.Distance(pos, this.target) < 0.9) this.pickTarget(pos);

    // Teleport the nav agent back to the rider when stuck instead of grinding on geometry.
    this.lastProgressCheck += dt;
    if (this.lastProgressCheck > 0.8) {
      const moved = Vector3.Distance(pos, this.lastPos);
      this.lastPos.copyFrom(pos);
      this.lastProgressCheck = 0;
      if (moved < 0.2) {
        this.stuckTimer += 1;
        if (this.stuckTimer >= 2) {
          this.stuckTimer = 0;
          if (this.crowd && this.agent >= 0 && this.plugin) {
            this.crowd.agentTeleport(this.agent, this.plugin.getClosestPoint(pos));
          }
          this.pickTarget(pos);
        }
      } else this.stuckTimer = 0;
    }

    let steer: Vector3;
    let distToGoal = 10;
    if (this.crowd && this.agent >= 0 && this.plugin) {
      const agentPos = this.crowd.getAgentPosition(this.agent);
      const lag = Vector3.Distance(agentPos, pos);
      if (lag > 2.4) {
        this.crowd.agentTeleport(this.agent, this.plugin.getClosestPoint(pos));
        if (this.target) this.crowd.agentGoto(this.agent, this.target);
      }
      // Blend "chase the agent" with "aim at the next corner" to cut corners smoothly.
      const next = this.crowd.getAgentNextTargetPath(this.agent);
      const corner = next ?? agentPos;
      const aim = Vector3.Lerp(agentPos, corner, 0.65);
      steer = aim.subtract(pos);
      distToGoal = this.target ? Vector3.Distance(pos, this.target) : 10;
    } else {
      steer = (this.target ?? pos).subtract(pos);
      distToGoal = steer.length();
    }
    steer.y = 0;
    const steerLen = steer.length();
    if (steerLen > 1e-3) steer.scaleInPlace(1 / steerLen);
    else steer.copyFrom(this.smoothSteer);

    // Wall whisker: if a near-vertical surface is just ahead, slide along it + peel off.
    const probeFrom = pos.add(new Vector3(0, 0.08, 0));
    const probeTo = probeFrom.add(steer.scale(0.9));
    this.physics.raycastToRef(probeFrom, probeTo, this.whisker);
    if (this.whisker.hasHit && this.whisker.body !== ctrl.body) {
      const n = this.whisker.hitNormalWorld;
      if (Math.abs(n.y) < 0.55) {
        const into = Vector3.Dot(steer, n);
        if (into < 0) {
          steer.subtractInPlace(n.scale(into));
          const tangent = new Vector3(-n.z, 0, n.x);
          if (Vector3.Dot(tangent, steer) < 0) tangent.scaleInPlace(-1);
          steer.addInPlace(tangent.scale(0.4));
          const l = steer.length();
          if (l > 1e-3) steer.scaleInPlace(1 / l);
        }
      }
    }

    this.smoothSteer.x += (steer.x - this.smoothSteer.x) * Math.min(1, 10 * dt);
    this.smoothSteer.z += (steer.z - this.smoothSteer.z) * Math.min(1, 10 * dt);
    const smL = Math.hypot(this.smoothSteer.x, this.smoothSteer.z);
    if (smL > 1e-3) {
      this.smoothSteer.x /= smL;
      this.smoothSteer.z /= smL;
    }

    // Slow into tight turns and near the goal; otherwise cruise at full throttle.
    const turnAlignment = Math.max(0, this.smoothSteer.x * steer.x + this.smoothSteer.z * steer.z);
    const turnThrottle = 0.6 + 0.4 * turnAlignment;
    const goalThrottle = Math.min(1, 0.4 + distToGoal * 0.35);
    const targetThrottle = Math.min(turnThrottle, goalThrottle);
    this.throttle += (targetThrottle - this.throttle) * Math.min(1, 6 * dt);
    ctrl.moveDir.set(this.smoothSteer.x * this.throttle, 0, this.smoothSteer.z * this.throttle);

    // Jump logic: probe scaled by current speed so fast approaches ollie earlier onto rails.
    if (this.jumpCooldown <= 0 && ctrl.grounded && ctrl.speed > 1.8) {
      const probeDist = Math.max(1.1, ctrl.speed * 0.4);
      const from = pos.add(new Vector3(0, 0.05, 0));
      const ahead = from.add(this.smoothSteer.scale(probeDist));
      this.physics.raycastToRef(from, ahead, this.ray);
      const meta = this.ray.hasHit ? (this.ray.body?.transformNode?.metadata as { tags?: string[] } | undefined) : undefined;
      const tags = meta?.tags ?? [];
      if (this.ray.hasHit && this.ray.body !== ctrl.body && (tags.includes("grind") || tags.includes("rail"))) {
        ctrl.requestJump();
        this.jumpCooldown = 0.9;
      } else if (ctrl.groundNormal.y < 0.85 && ctrl.speed > 2.6) {
        ctrl.requestJump();
        this.jumpCooldown = 1.4;
      } else if (ctrl.state === "riding" && ctrl.speed > 2.4 && Math.random() < dt * 0.6) {
        ctrl.requestJump();
        this.jumpCooldown = 2.0;
      }
    }
  }

  dispose() {
    if (this.crowd) {
      if (this.agent >= 0) this.crowd.removeAgent(this.agent);
      this.crowd.dispose();
    }
    this.agentNode?.dispose();
    this.plugin?.dispose();
    this.debugMesh?.dispose();
  }
}
