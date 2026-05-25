import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  type Scene,
} from "@babylonjs/core";
import { PELLET_RADIUS } from "@spherio/shared";

interface PlayerSnap {
  id: string;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  radius: number;
  color: number;
  name: string;
  invulnUntil: number;
}

interface PelletSnap {
  id: string;
  x: number;
  y: number;
  z: number;
}

export class EntitySync {
  private players = new Map<string, Mesh>();
  private pellets = new Map<string, Mesh>();
  private materials = new Map<number, StandardMaterial>();

  constructor(private scene: Scene) {}

  syncPlayers(
    list: PlayerSnap[],
    localId: string | null,
    now: number,
  ): Mesh | null {
    const seen = new Set<string>();
    let localNode: Mesh | null = null;

    for (const p of list) {
      seen.add(p.id);
      let node = this.players.get(p.id);
      if (!node) {
        node = MeshBuilder.CreateSphere(
          `player_${p.id}`,
          { diameter: 1, segments: 24 },
          this.scene,
        );
        node.rotationQuaternion = Quaternion.Identity();
        node.material = this.mat(p.color);
        this.players.set(p.id, node);
      }

      const alpha = p.id === localId ? 1 : 0.35;
      const t = node.position;
      t.x += (p.x - t.x) * alpha;
      t.y += (p.y - t.y) * alpha;
      t.z += (p.z - t.z) * alpha;
      const targetQ = new Quaternion(p.qx, p.qy, p.qz, p.qw);
      const cur = node.rotationQuaternion ?? Quaternion.Identity();
      node.rotationQuaternion = Quaternion.Slerp(cur, targetQ, alpha);
      const scale = p.radius * 2;
      node.scaling.set(scale, scale, scale);

      const invuln = p.invulnUntil > now;
      const mat = node.material as StandardMaterial;
      mat.alpha = invuln ? 0.45 + 0.25 * Math.sin(now * 0.01) : 1;

      if (p.id === localId) localNode = node;
    }

    for (const [id, node] of this.players) {
      if (!seen.has(id)) {
        node.dispose();
        this.players.delete(id);
      }
    }

    return localNode;
  }

  syncPellets(list: PelletSnap[]): void {
    const seen = new Set<string>();
    for (const p of list) {
      seen.add(p.id);
      let node = this.pellets.get(p.id);
      if (!node) {
        node = MeshBuilder.CreateSphere(
          `pellet_${p.id}`,
          { diameter: PELLET_RADIUS * 2, segments: 8 },
          this.scene,
        );
        const m = new StandardMaterial(`pellet_mat_${p.id}`, this.scene);
        m.emissiveColor = new Color3(0.4, 0.9, 0.5);
        m.diffuseColor = new Color3(0.2, 0.7, 0.35);
        node.material = m;
        this.pellets.set(p.id, node);
      }
      node.position.set(p.x, p.y, p.z);
    }
    for (const [id, node] of this.pellets) {
      if (!seen.has(id)) {
        node.dispose();
        this.pellets.delete(id);
      }
    }
  }

  private mat(color: number): StandardMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new StandardMaterial(`mat_${color}`, this.scene);
      const c = Color3.FromHexString("#" + color.toString(16).padStart(6, "0"));
      m.diffuseColor = c;
      m.specularColor = new Color3(0.3, 0.3, 0.35);
      this.materials.set(color, m);
    }
    return m;
  }

  dispose(): void {
    for (const n of this.players.values()) n.dispose();
    for (const n of this.pellets.values()) n.dispose();
    this.players.clear();
    this.pellets.clear();
  }
}
