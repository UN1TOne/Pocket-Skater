import { RecastJSPlugin } from "@babylonjs/core/Navigation/Plugins/recastJSPlugin";
import type { ICrowd, INavMeshParameters } from "@babylonjs/core/Navigation/INavigationEngine";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { PlayerController } from "./PlayerController";
import type { Spot, SpotEntry } from "./spots";

/**
 * Plan for hitting a spot through one of its checked entries. The AI walks the state machine:
 *   nav → lineup → air → grind   (grind spots: jump onto the line)
 *   nav → lineup → air           (ramps: ride up the transition, no jump)
 * Each phase has a hard timeout so a failed attempt eventually picks a new target.
 */
interface RailPlan {
  spot: Spot;
  entry: SpotEntry;
  /** Rail endpoint the AI will jump ONTO (world space, NOT navmesh-snapped). */
  endNear: Vector3;
  /** Far end of the line (grind) / top of the ramp. */
  endFar: Vector3;
  /** Run-up start on the floor. AI navigates here first. */
  approach: Vector3;
  /** Unit XZ run-up heading, from approach toward endNear. */
  axisInward: Vector3;
  /** Unit XZ heading at the start of the ride. */
  axisAlong: Vector3;
  /** Landing point the AI aims for while airborne (XZ + rail-top Y). */
  airAim: Vector3;
  phase: "nav" | "lineup" | "air" | "grind";
  phaseTimer: number;
  totalTimer: number;
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
  private rail: RailPlan | null = null;
  private targetTimer = 0;
  private stuckTimer = 0;
  private jumpCooldown = 0;
  private whisker = new PhysicsRaycastResult();
  private physics: PhysicsEngine;
  private lastPos = new Vector3();
  private lastProgressCheck = 0;
  private smoothSteer = new Vector3(0, 0, 1);
  private throttle = 1;
  ready = false;
  usingNavMesh = false;

  debugMesh: Mesh | null = null;
  /** Per-spot outcomes (jumps tried / landed). Diagnostics now; success-rate input later. */
  readonly spotStats = new Map<string, { jumps: number; lands: number }>();
  private stat(spot: Spot) {
    let st = this.spotStats.get(spot.id);
    if (!st) this.spotStats.set(spot.id, (st = { jumps: 0, lands: 0 }));
    return st;
  }
  /** DEV-mode counters for diagnosing the rail-approach pipeline. */
  readonly debug = {
    plans: 0,
    reachedApproach: 0,
    jumpsFired: 0,
    airSuccess: 0,
    airMiss: 0,
    airTimeout: 0,
    lineupTimeout: 0,
    rampPlans: 0,
    rampAirs: 0,
    bailed: 0,
    lastPhase: "idle" as "idle" | "nav" | "lineup" | "air" | "grind",
    lastEndNearDist: 0,
    lastJumpSpeed: 0,
    lastRailTopY: 0,
  };

  constructor(
    private scene: Scene,
    private spots: Spot[],
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

  /**
   * Plan for `spot` through its nearest entry the AI can actually drive to from here — a run-up
   * inside a walled bowl is unreachable from outside it (and vice versa).
   */
  private buildRailPlan(spot: Spot, from: Vector3): RailPlan | null {
    const byDistance = [...spot.entries].sort((a, b) => Vector3.Distance(from, a.start) - Vector3.Distance(from, b.start));
    const entry = byDistance.find((e) => this.reachable(from, e.start));
    if (!entry) return null;
    const approach = entry.start.clone();
    approach.y = Math.max(0.1, from.y);
    const airAim = entry.target.clone();
    airAim.y = entry.topY;
    return {
      spot,
      entry,
      endNear: entry.end.clone(),
      endFar: entry.exit.clone(),
      approach,
      axisInward: entry.dir.clone(),
      axisAlong: entry.dir.clone(),
      airAim,
      phase: "nav",
      phaseTimer: 0,
      totalTimer: 0,
    };
  }

  /** Navmesh path from `from` really ends at `to` (not just at the closest reachable point). */
  private reachable(from: Vector3, to: Vector3): boolean {
    if (!this.plugin) return true;
    const goal = this.plugin.getClosestPoint(to);
    if (Math.hypot(goal.x - to.x, goal.z - to.z) > 0.4) return false;
    const path = this.plugin.computePath(this.plugin.getClosestPoint(from), goal);
    if (path.length === 0) return false;
    const last = path[path.length - 1];
    return Math.hypot(last.x - goal.x, last.z - goal.z) < 0.3;
  }

  private pickTarget(from: Vector3) {
    // Discard any in-flight rail plan when picking a fresh target.
    this.rail = null;
    const grinds = this.spots.filter((s) => s.kind === "grind" && s.entries.length > 0);
    const ramps = this.spots.filter((s) => s.kind === "ramp" && s.entries.length > 0);
    // Strongly bias toward grind pieces so we actually attempt scoring runs.
    const wantGrind = grinds.length > 0 && Math.random() < 0.85;
    const pool = wantGrind ? grinds : Math.random() < 0.95 ? ramps : [];
    // A few tries: the picked spot may have no entry reachable from where we are.
    const tried = new Set<Spot>();
    for (let attempt = 0; attempt < 4 && tried.size < pool.length; attempt++) {
      const spot = this.pickWeighted(pool.filter((p) => !tried.has(p)), from);
      if (!spot) break;
      tried.add(spot);
      const plan = this.buildRailPlan(spot, from);
      if (!plan) continue;
      this.rail = plan;
      if (spot.kind === "ramp") this.debug.rampPlans += 1;
      else this.debug.plans += 1;
      this.target = plan.approach.clone();
      this.targetTimer = 0;
      this.stuckTimer = 0;
      if (this.crowd && this.agent >= 0 && this.plugin) {
        // The approach point is on the floor beside the rail — safe to snap to navmesh.
        const snapped = this.plugin.getClosestPoint(plan.approach);
        if (snapped.lengthSquared() > 0) this.crowd.agentGoto(this.agent, snapped);
        else this.crowd.agentGoto(this.agent, plan.approach);
      }
      return;
    }
    // Fallback: roam.
    let dest = new Vector3(
      (Math.random() * 2 - 1) * (this.halfExtent - 1.2),
      0,
      (Math.random() * 2 - 1) * (this.halfExtent - 1.2),
    );
    if (this.plugin) {
      const snapped = this.plugin.getClosestPoint(dest);
      if (snapped.lengthSquared() > 0) dest = snapped;
    }
    this.target = dest;
    this.targetTimer = 0;
    this.stuckTimer = 0;
    if (this.crowd && this.agent >= 0) this.crowd.agentGoto(this.agent, dest);
  }

  private pickWeighted(pool: Spot[], from: Vector3): Spot | null {
    if (pool.length === 0) return null;
    // Prefer long thin-rail chains strongly — those are the ones with real sustained grinds.
    // Distance sweet-spot is wider now; being too picky caused the AI to burn plans on
    // whatever happened to be 4m away.
    const scored = pool
      .map((p) => {
        const d = Vector3.Distance(p.center, from);
        const sweet = Math.max(0.2, 1 - Math.abs(d - 4) / 7);
        const thinBonus = p.thin ? 3.5 : 1;
        const lengthBonus = 1 + Math.max(0, p.length - 1) * 1.2;
        return { p, w: sweet * thinBonus * lengthBonus };
      })
      .sort((a, b) => b.w - a.w);
    // Pick from the top 25% — mostly the best, with a little variety so stuck targets don't
    // deadlock us.
    const top = scored.slice(0, Math.max(1, Math.ceil(scored.length * 0.25)));
    return top[Math.floor(Math.random() * top.length)].p;
  }

  /** Writes moveDir / jump requests into the controller. */
  update(ctrl: PlayerController, dt: number) {
    if (!this.ready || ctrl.state === "bailed") {
      ctrl.airRailTarget = null;
      return;
    }
    this.targetTimer += dt;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    const pos = ctrl.position;

    if (this.rail) {
      this.rail.phaseTimer += dt;
      this.rail.totalTimer += dt;
      // Hard timeout — if a plan takes too long overall, abandon it.
      if (this.rail.totalTimer > 11) {
        this.pickTarget(pos);
        if (!this.rail) return this.cruise(ctrl, dt);
      }
      this.updateRailPhase(ctrl, dt);
      // The phase handler may call pickTarget which clears rail; fall through to cruise if so.
      if (!this.rail) return this.cruise(ctrl, dt);
      return this.steerForRail(ctrl, dt);
    }

    // Non-rail target: cruise, pick a new one when we arrive, timeout, or get stuck.
    if (!this.target || this.targetTimer > 15 || Vector3.Distance(pos, this.target) < 0.9) {
      this.pickTarget(pos);
      if (this.rail) return this.steerForRail(ctrl, dt);
    }
    this.cruise(ctrl, dt);
  }

  /** Advances the rail state machine, choosing phase transitions + jump requests. */
  private updateRailPhase(ctrl: PlayerController, _dt: number) {
    const plan = this.rail;
    if (!plan) return;
    const pos = ctrl.position;
    const state = ctrl.state;

    if (plan.phase === "nav") {
      const dist = Vector3.Distance(pos, plan.approach);
      if (dist < 1.0) {
        plan.phase = "lineup";
        plan.phaseTimer = 0;
        this.debug.reachedApproach += 1;
        this.debug.lastPhase = "lineup";
      } else if (plan.phaseTimer > 4) {
        // Nav timeout — can't reach the approach point. Usually the body is pinned against
        // some geometry. Hard-unstick and pick a different POI entirely.
        ctrl.unstick();
        this.pickTarget(ctrl.position);
      }
      return;
    }

    if (plan.phase === "lineup" && plan.spot.kind === "ramp") {
      // Ride straight up the transition; the ramp does the launching.
      if (!ctrl.grounded && plan.phaseTimer > 0.1) {
        plan.phase = "air";
        plan.phaseTimer = 0;
        this.debug.lastPhase = "air";
      } else if (plan.phaseTimer > 3 || (plan.phaseTimer > 0.7 && ctrl.speed < 0.6)) {
        this.debug.lineupTimeout += 1;
        this.pickTarget(pos);
      }
      return;
    }

    if (plan.phase === "air" && plan.spot.kind === "ramp") {
      if (state === "bailed") {
        this.debug.bailed += 1;
        return;
      }
      if (ctrl.grounded && plan.phaseTimer > 0.15) {
        this.debug.rampAirs += 1;
        this.stat(plan.spot).lands += 1;
        this.pickTarget(pos);
      } else if (plan.phaseTimer > 3) {
        this.pickTarget(pos);
      }
      return;
    }

    if (plan.phase === "lineup") {
      const g = 10;
      const topY = plan.entry.topY;
      const rise = Math.max(0.25, topY - 0.24 + 0.18);
      const jumpSpeed = Math.min(5.0, Math.sqrt(2 * g * rise));
      const timeToApex = jumpSpeed / g;
      // Jump slightly before apex-distance so the apex-descent hits the rail entry; the
      // magnet then pulls the player down onto the rail top during descent.
      const apexHorizontalDist = ctrl.speed * timeToApex;
      const jumpAhead = Math.max(0.6, apexHorizontalDist);

      const toEnd = plan.endNear.subtract(pos);
      toEnd.y = 0;
      const distAlong = toEnd.x * plan.axisInward.x + toEnd.z * plan.axisInward.z;
      // Gate on where we're actually going, not on input: arriving at the run-up from the wrong
      // side means a U-turn, and jumping mid-turn sends the rider diagonally past the rail.
      const v = ctrl.body.getLinearVelocity();
      const vh = Math.max(1e-3, Math.hypot(v.x, v.z));
      const align = (v.x * plan.axisInward.x + v.z * plan.axisInward.z) / vh;
      const lateral = Math.abs(toEnd.x * plan.axisInward.z - toEnd.z * plan.axisInward.x);
      const canJump =
        ctrl.grounded &&
        this.jumpCooldown <= 0 &&
        ctrl.speed > 1.6 &&
        distAlong > 0 &&
        distAlong < jumpAhead &&
        align > 0.85 &&
        lateral < 0.3;
      this.debug.lastEndNearDist = distAlong;
      if (canJump) {
        ctrl.requestJump(jumpSpeed);
        ctrl.airRailTarget = {
          x: plan.airAim.x,
          y: plan.airAim.y,
          z: plan.airAim.z,
          ax: plan.axisAlong.x,
          az: plan.axisAlong.z,
        };
        this.jumpCooldown = 0.9;
        plan.phase = "air";
        plan.phaseTimer = 0;
        this.debug.jumpsFired += 1;
        this.stat(plan.spot).jumps += 1;
        this.debug.lastPhase = "air";
        this.debug.lastJumpSpeed = jumpSpeed;
        this.debug.lastRailTopY = topY;
      } else if (distAlong < -0.4) {
        this.pickTarget(pos);
      } else if (plan.phaseTimer > 2.5) {
        // Lineup should finish fast: 2.4m at > 2m/s is barely over a second. Anything
        // past 2.5s means something's wedged — abandon the plan.
        this.debug.lineupTimeout += 1;
        this.pickTarget(pos);
      } else if (plan.phaseTimer > 0.7 && ctrl.speed < 0.6) {
        // Hard wedge: can't even build speed on approach. Give up early.
        this.debug.lineupTimeout += 1;
        this.pickTarget(pos);
      }
      return;
    }

    if (plan.phase === "air") {
      if (state === "bailed") {
        ctrl.airRailTarget = null;
        this.debug.bailed += 1;
        return;
      }
      if (state === "grinding") {
        plan.phase = "grind";
        plan.phaseTimer = 0;
        // Keep airRailTarget set during grinding too — the controller's Y lock prefers this
        // over raycast-sampled railCenter.y which can oscillate on chamfered rail edges.
        this.debug.airSuccess += 1;
        this.stat(plan.spot).lands += 1;
        this.debug.lastPhase = "grind";
        return;
      }
      // If we landed back on the ground without grinding, give up on this rail.
      if (ctrl.grounded && plan.phaseTimer > 0.2) {
        ctrl.airRailTarget = null;
        this.debug.airMiss += 1;
        this.pickTarget(pos);
        return;
      }
      // Max airtime safety.
      if (plan.phaseTimer > 1.8) {
        ctrl.airRailTarget = null;
        this.debug.airTimeout += 1;
        this.pickTarget(pos);
      }
      return;
    }

    if (plan.phase === "grind") {
      // Grinding — AI mostly just lets physics ride it along the rail. When grinding ends
      // (fell off, reached rail end), clear the air aim and pick a new target.
      if (state !== "grinding") {
        ctrl.airRailTarget = null;
        this.pickTarget(pos);
      }
      return;
    }
  }

  /** Writes `moveDir` + runs wall whisker for the current rail plan phase. */
  private steerForRail(ctrl: PlayerController, dt: number) {
    const plan = this.rail;
    if (!plan) return;
    const pos = ctrl.position;
    let steer: Vector3;
    let distToGoal = 10;
    let targetThrottle = 1;

    if (plan.phase === "nav") {
      if (this.crowd && this.agent >= 0 && this.plugin) {
        const agentPos = this.crowd.getAgentPosition(this.agent);
        const lag = Vector3.Distance(agentPos, pos);
        if (lag > 2.4) {
          this.crowd.agentTeleport(this.agent, this.plugin.getClosestPoint(pos));
          this.crowd.agentGoto(this.agent, this.plugin.getClosestPoint(plan.approach));
        }
        const next = this.crowd.getAgentNextTargetPath(this.agent);
        const corner = next ?? agentPos;
        const aim = Vector3.Lerp(agentPos, corner, 0.65);
        steer = aim.subtract(pos);
      } else {
        steer = plan.approach.subtract(pos);
      }
      distToGoal = Vector3.Distance(pos, plan.approach);
    } else if (plan.phase === "lineup") {
      // Hard override: run straight along axisInward toward the rail end.
      steer = new Vector3(plan.axisInward.x, 0, plan.axisInward.z);
      distToGoal = Vector3.Distance(pos, plan.endNear);
      targetThrottle = 1; // full gas into the rail
    } else if (plan.phase === "air" && plan.spot.kind === "ramp") {
      // Off a ramp: don't fight the trajectory — keep pushing the way we're already going.
      steer = new Vector3(this.smoothSteer.x, 0, this.smoothSteer.z);
      distToGoal = 2;
      targetThrottle = 0.9;
    } else if (plan.phase === "air") {
      // Carry momentum toward the rail center in XZ.
      steer = new Vector3(plan.airAim.x - pos.x, 0, plan.airAim.z - pos.z);
      distToGoal = 2;
      targetThrottle = 0.9;
    } else {
      // phase === "grind": push along our actual travel direction so curved / bent lines don't
      // get steered back toward the entry heading; physics clamps us to the rail.
      const v = ctrl.body.getLinearVelocity();
      const vh = Math.hypot(v.x, v.z);
      steer = vh > 0.5 ? new Vector3(v.x / vh, 0, v.z / vh) : new Vector3(plan.axisAlong.x, 0, plan.axisAlong.z);
      distToGoal = Vector3.Distance(pos, plan.endFar);
      targetThrottle = 1;
    }

    steer.y = 0;
    const steerLen = Math.hypot(steer.x, steer.z);
    if (steerLen > 1e-3) steer.scaleInPlace(1 / steerLen);
    else {
      steer.x = this.smoothSteer.x;
      steer.z = this.smoothSteer.z;
    }

    // Wall whisker — only during nav. In lineup/air/grind we trust the plan.
    if (plan.phase === "nav") {
      this.applyWhisker(ctrl, pos, steer);
    }

    this.smoothSteer.x += (steer.x - this.smoothSteer.x) * Math.min(1, 14 * dt);
    this.smoothSteer.z += (steer.z - this.smoothSteer.z) * Math.min(1, 14 * dt);
    const smL = Math.hypot(this.smoothSteer.x, this.smoothSteer.z);
    if (smL > 1e-3) {
      this.smoothSteer.x /= smL;
      this.smoothSteer.z /= smL;
    }

    // In lineup phase, keep throttle at 1 so we commit to the attack.
    if (plan.phase !== "lineup") {
      const turnAlignment = Math.max(0, this.smoothSteer.x * steer.x + this.smoothSteer.z * steer.z);
      const turnThrottle = 0.6 + 0.4 * turnAlignment;
      const goalThrottle = Math.min(1, 0.4 + distToGoal * 0.35);
      targetThrottle = Math.min(turnThrottle, goalThrottle);
    }
    this.throttle += (targetThrottle - this.throttle) * Math.min(1, 6 * dt);
    ctrl.moveDir.set(this.smoothSteer.x * this.throttle, 0, this.smoothSteer.z * this.throttle);

    // Keep stuck tracking active in every phase except pure air (parabolic motion looks like
    // being stuck when sampled). Lineup can wedge the player against the rail side — the
    // escalated check will unstick them.
    if (plan.phase === "air") {
      this.lastPos.copyFrom(pos);
      this.lastProgressCheck = 0;
      this.stuckTimer = 0;
    } else {
      this.tickStuckCheck(ctrl, pos, dt);
    }
  }

  /** Non-rail cruise mode: standard navmesh chase + roam, with wall whisker. */
  private cruise(ctrl: PlayerController, dt: number) {
    ctrl.airRailTarget = null;
    const pos = ctrl.position;
    this.tickStuckCheck(ctrl, pos, dt);

    let steer: Vector3;
    let distToGoal = 10;
    if (this.crowd && this.agent >= 0 && this.plugin) {
      const agentPos = this.crowd.getAgentPosition(this.agent);
      const lag = Vector3.Distance(agentPos, pos);
      if (lag > 2.4) {
        this.crowd.agentTeleport(this.agent, this.plugin.getClosestPoint(pos));
        if (this.target) this.crowd.agentGoto(this.agent, this.target);
      }
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

    this.applyWhisker(ctrl, pos, steer);

    this.smoothSteer.x += (steer.x - this.smoothSteer.x) * Math.min(1, 10 * dt);
    this.smoothSteer.z += (steer.z - this.smoothSteer.z) * Math.min(1, 10 * dt);
    const smL = Math.hypot(this.smoothSteer.x, this.smoothSteer.z);
    if (smL > 1e-3) {
      this.smoothSteer.x /= smL;
      this.smoothSteer.z /= smL;
    }

    const turnAlignment = Math.max(0, this.smoothSteer.x * steer.x + this.smoothSteer.z * steer.z);
    const turnThrottle = 0.6 + 0.4 * turnAlignment;
    const goalThrottle = Math.min(1, 0.4 + distToGoal * 0.35);
    const targetThrottle = Math.min(turnThrottle, goalThrottle);
    this.throttle += (targetThrottle - this.throttle) * Math.min(1, 6 * dt);
    ctrl.moveDir.set(this.smoothSteer.x * this.throttle, 0, this.smoothSteer.z * this.throttle);

    // Occasional ollie flavor — rare in cruise, so AI isn't jumping into walls.
    if (this.jumpCooldown <= 0 && ctrl.grounded && ctrl.state === "riding" && ctrl.speed > 2.4 && Math.random() < dt * 0.4) {
      ctrl.requestJump();
      this.jumpCooldown = 2.4;
    }
  }

  /** Peels the steer vector away from near-vertical surfaces so we don't grind on walls. */
  private applyWhisker(ctrl: PlayerController, pos: Vector3, steer: Vector3) {
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
  }

  /**
   * Fires if the player's net displacement is small over the last ~1s. "Pinned against rail"
   * cases show up as drifting back-and-forth so just checking frame-to-frame moved underreports
   * them — we track position at the start of each check window.
   */
  private tickStuckCheck(ctrl: PlayerController, pos: Vector3, dt: number) {
    this.lastProgressCheck += dt;
    if (this.lastProgressCheck > 0.8) {
      const moved = Vector3.Distance(pos, this.lastPos);
      this.lastPos.copyFrom(pos);
      this.lastProgressCheck = 0;
      // Threshold raised to 0.5 — a sphere pinned against a rail still drifts ~0.3m per sec.
      if (moved < 0.5) {
        this.stuckTimer += 1;
        if (this.stuckTimer === 2) {
          // First escalation: teleport the nav agent + repick, in case we're just mis-pathed.
          if (this.crowd && this.agent >= 0 && this.plugin) {
            this.crowd.agentTeleport(this.agent, this.plugin.getClosestPoint(pos));
          }
          this.pickTarget(pos);
        } else if (this.stuckTimer >= 3) {
          // Second escalation: physical body is pinned. Teleport to last safe pos and reset.
          this.stuckTimer = 0;
          ctrl.unstick();
          this.pickTarget(ctrl.position);
        }
      } else this.stuckTimer = 0;
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
