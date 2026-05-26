import RAPIER from "@dimforge/rapier3d-compat";
import {
  ARENA_HALF,
  BOOST_SPEED_MULTIPLIER,
  GRAVITY,
  GROUND_FRICTION,
  GROUND_Y,
  MAX_ANGULAR_SPEED,
  SLIDE_CONTACT_FRICTION,
  SPHERE_FRICTION,
  SPHERE_RESTITUTION,
  WALL_HEIGHT,
} from "@spherio/shared";
import {
  angularDampingForMass,
  applyDriftLateralGrip,
  applyLockedWheelSlide,
  clampRadius,
  linearDampingForMass,
  massFromRadius,
  maxLinearSpeedForRadius,
  rollingDriveImpulse,
  rollingDriveTorque,
} from "@spherio/shared";
import type { InputMessage } from "@spherio/shared";

export interface PlayerBody {
  id: string;
  /** Владелец сессии (для split-частей совпадает с sessionId игрока) */
  ownerId: string;
  radius: number;
  mass: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  input: InputMessage;
}

export class PhysicsWorld {
  world!: RAPIER.World;
  private players = new Map<string, PlayerBody>();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.createArena();
    this.initialized = true;
  }

  private createArena(): void {
    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, GROUND_Y - 0.5, 0),
    );
    const groundDesc = RAPIER.ColliderDesc.cuboid(ARENA_HALF, 0.5, ARENA_HALF)
      .setFriction(GROUND_FRICTION)
      .setRestitution(0.15);
    this.world.createCollider(groundDesc, groundBody);

    const wallT = 1;
    const h = WALL_HEIGHT / 2;
    const walls: [number, number, number][] = [
      [ARENA_HALF + wallT, h, 0],
      [-ARENA_HALF - wallT, h, 0],
      [0, h, ARENA_HALF + wallT],
      [0, h, -ARENA_HALF - wallT],
    ];
    for (const [x, y, z] of walls) {
      const sizeX = z === 0 ? wallT : ARENA_HALF + wallT;
      const sizeZ = x === 0 ? wallT : ARENA_HALF + wallT;
      const wall = RAPIER.ColliderDesc.cuboid(sizeX, h, sizeZ)
        .setTranslation(x, y, z)
        .setFriction(0.5)
        .setRestitution(0.2);
      this.world.createCollider(wall);
    }
  }

  addPlayer(
    id: string,
    radius: number,
    x: number,
    z: number,
    ownerId?: string,
  ): PlayerBody {
    const r = clampRadius(radius);
    const mass = massFromRadius(r);
    const y = GROUND_Y + r + 0.02;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(linearDampingForMass(mass))
      .setAngularDamping(angularDampingForMass(mass))
      .setCanSleep(false);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(r)
      .setFriction(SPHERE_FRICTION)
      .setRestitution(SPHERE_RESTITUTION)
      .setDensity(mass / ((4 / 3) * Math.PI * r ** 3));
    const collider = this.world.createCollider(colliderDesc, body);

    const entry: PlayerBody = {
      id,
      ownerId: ownerId ?? id,
      radius: r,
      mass,
      body,
      collider,
      input: { moveX: 0, moveZ: 0, brake: false },
    };
    this.players.set(id, entry);
    return entry;
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.world.removeRigidBody(p.body);
    this.players.delete(id);
  }

  setInput(id: string, input: InputMessage): void {
    const p = this.players.get(id);
    if (!p) return;
    p.input = { ...input };
  }

  setRadius(id: string, radius: number): void {
    const p = this.players.get(id);
    if (!p) return;
    const r = clampRadius(radius);
    p.radius = r;
    p.mass = massFromRadius(r);
    p.body.setLinearDamping(linearDampingForMass(p.mass));
    p.body.setAngularDamping(angularDampingForMass(p.mass));
    this.world.removeCollider(p.collider, true);
    const colliderDesc = RAPIER.ColliderDesc.ball(r)
      .setFriction(SPHERE_FRICTION)
      .setRestitution(SPHERE_RESTITUTION)
      .setDensity(p.mass / ((4 / 3) * Math.PI * r ** 3));
    p.collider = this.world.createCollider(colliderDesc, p.body);
  }

  teleport(id: string, x: number, z: number, radius: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.setRadius(id, radius);
    const r = p.radius;
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setTranslation({ x, y: GROUND_Y + r + 0.02, z }, true);
  }

  getPlayer(id: string): PlayerBody | undefined {
    return this.players.get(id);
  }

  getAllPlayers(): PlayerBody[] {
    return [...this.players.values()];
  }

  step(dt: number): void {
    for (const p of this.players.values()) {
      const { moveX, moveZ, brake, boost } = p.input;
      const len = Math.hypot(moveX, moveZ);
      const braking = !!brake;
      const moving = len > 0.06 && !braking;
      const boosting = boost && moving;
      const boostMul = boosting ? BOOST_SPEED_MULTIPLIER : 1;

      if (moving) {
        const nx = moveX / len;
        const nz = moveZ / len;
        const v = p.body.linvel();
        const torque = rollingDriveTorque(
          p.radius,
          p.mass,
          nx,
          nz,
          v.x,
          v.z,
        );
        const impulse = rollingDriveImpulse(
          p.radius,
          p.mass,
          nx,
          nz,
          v.x,
          v.z,
        );
        p.body.applyImpulse(
          {
            x: impulse.x * dt * boostMul,
            y: 0,
            z: impulse.z * dt * boostMul,
          },
          true,
        );
        p.body.applyTorqueImpulse(
          {
            x: torque.x * dt * boostMul,
            y: torque.y * dt * boostMul,
            z: torque.z * dt * boostMul,
          },
          true,
        );
        if (boosting) {
          const burst = 1.1 * p.mass;
          p.body.applyImpulse({ x: nx * burst * dt, y: 0, z: nz * burst * dt }, true);
        }
      }

      if (brake) {
        p.collider.setFriction(SLIDE_CONTACT_FRICTION);
        p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        const v = p.body.linvel();
        const slide = applyLockedWheelSlide(v.x, v.z, moveX, moveZ, dt);
        p.body.applyImpulse(
          { x: slide.dvx * p.mass, y: 0, z: slide.dvz * p.mass },
          true,
        );
        const after = p.body.linvel();
        const gripped = applyDriftLateralGrip(after.x, after.z, moveX, moveZ, dt);
        p.body.setLinvel({ x: gripped.vx, y: after.y, z: gripped.vz }, true);
      } else {
        p.collider.setFriction(SPHERE_FRICTION);
      }
    }

    this.world.timestep = dt;
    this.world.step();

    for (const p of this.players.values()) {
      if (p.input.brake) {
        p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      this.clampPlayerVelocity(p);
    }
  }

  private clampPlayerVelocity(p: PlayerBody): void {
    const maxLin = maxLinearSpeedForRadius(p.radius);
    const lv = p.body.linvel();
    const ls = Math.hypot(lv.x, lv.y, lv.z);
    if (ls > maxLin) {
      const s = maxLin / ls;
      p.body.setLinvel({ x: lv.x * s, y: lv.y * s, z: lv.z * s }, true);
    }
    const av = p.body.angvel();
    const as = Math.hypot(av.x, av.y, av.z);
    if (as > MAX_ANGULAR_SPEED) {
      const s = MAX_ANGULAR_SPEED / as;
      p.body.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
    }
  }
}
