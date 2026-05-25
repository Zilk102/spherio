import RAPIER from "@dimforge/rapier3d-compat";
import {
  ARENA_HALF,
  MAX_ANGULAR_SPEED,
  MAX_LINEAR_SPEED,
  SPHERE_FRICTION,
  SPHERE_RESTITUTION,
  WALL_HEIGHT,
} from "@spherio/shared";
import {
  angularDampingForMass,
  clampRadius,
  linearDampingForMass,
  massFromRadius,
  rollTorqueImpulse,
  brakeImpulse,
} from "@spherio/shared";
import type { InputMessage } from "@spherio/shared";

export interface PlayerBody {
  id: string;
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
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.createArena();
    this.initialized = true;
  }

  private createArena(): void {
    const groundDesc = RAPIER.ColliderDesc.cuboid(ARENA_HALF, 0.5, ARENA_HALF)
      .setFriction(1.2)
      .setRestitution(0);
    this.world.createCollider(groundDesc);

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
        .setFriction(0.6);
      this.world.createCollider(wall);
    }
  }

  addPlayer(id: string, radius: number, x: number, z: number): PlayerBody {
    const r = clampRadius(radius);
    const mass = massFromRadius(r);
    const y = r + 0.05;
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
    const len = Math.hypot(input.moveX, input.moveZ);
    if (len > 1) {
      p.input = {
        moveX: input.moveX / len,
        moveZ: input.moveZ / len,
        brake: input.brake,
      };
    } else {
      p.input = { moveX: input.moveX, moveZ: input.moveZ, brake: input.brake };
    }
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
    const t = p.body.translation();
    p.body.setTranslation({ x: t.x, y: r + 0.05, z: t.z }, true);
  }

  teleport(id: string, x: number, z: number, radius: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.setRadius(id, radius);
    const r = p.radius;
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setTranslation({ x, y: r + 0.05, z }, true);
  }

  getPlayer(id: string): PlayerBody | undefined {
    return this.players.get(id);
  }

  getAllPlayers(): PlayerBody[] {
    return [...this.players.values()];
  }

  step(dt: number): void {
    for (const p of this.players.values()) {
      const { moveX, moveZ, brake } = p.input;
      if (Math.abs(moveX) > 0.01 || Math.abs(moveZ) > 0.01) {
        const t = rollTorqueImpulse(p.radius, moveX, moveZ);
        p.body.applyTorqueImpulse(t, true);
      }
      if (brake) {
        const v = p.body.linvel();
        const imp = brakeImpulse(p.mass, v.x, v.z);
        p.body.applyImpulse({ x: imp.x, y: 0, z: imp.z }, true);
      }
      p.input.brake = false;
    }
    this.world.timestep = dt;
    this.world.step();
    this.clampVelocities();
  }

  private clampVelocities(): void {
    for (const p of this.players.values()) {
      const lv = p.body.linvel();
      const ls = Math.hypot(lv.x, lv.y, lv.z);
      if (ls > MAX_LINEAR_SPEED) {
        const s = MAX_LINEAR_SPEED / ls;
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
}
