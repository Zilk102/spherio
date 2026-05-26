import {
  Color3,
  DynamicTexture,
  Material,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
} from "@babylonjs/core";
import { getSkin, type SkinKind } from "@spherio/shared";
import { SKID_MIN_SPEED } from "@spherio/shared";

export interface SkidEntity {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  braking: boolean;
  color: number;
  skinId: string;
}

interface SkidMark {
  mesh: Mesh;
  material: StandardMaterial;
  born: number;
  lifeMs: number;
  peakAlpha: number;
}

const MARK_LIFE_MS = 7000;
const MIN_SEGMENT_DIST = 0.05;
const MAX_MARKS = 480;
const SKID_LOCAL_Y = 0.03;

function colorTo(rgb: number): Color3 {
  return new Color3(
    ((rgb >> 16) & 0xff) / 255,
    ((rgb >> 8) & 0xff) / 255,
    (rgb & 0xff) / 255,
  );
}

/** Цвет следа на асфальте от цвета шара и типа скина. */
function skidTintForPlayer(
  color: number,
  skinId: string,
): { tint: Color3; emissive: Color3; peakAlpha: number } {
  const skin = getSkin(skinId);
  const kind: SkinKind | undefined = skin?.kind;
  const c = colorTo(color & 0xffffff);

  const darken = (r: number, g: number, b: number, k = 0.38, lift = 0.05) =>
    new Color3(
      Math.min(1, r * k + lift),
      Math.min(1, g * k + lift),
      Math.min(1, b * k + lift),
    );

  switch (kind) {
    case "football":
      return {
        tint: new Color3(0.22, 0.22, 0.26),
        emissive: new Color3(0.08, 0.08, 0.1),
        peakAlpha: 0.68,
      };
    case "basketball":
      return {
        tint: new Color3(0.72, 0.38, 0.12),
        emissive: new Color3(0.2, 0.1, 0.03),
        peakAlpha: 0.7,
      };
    case "volleyball":
      return {
        tint: new Color3(0.58, 0.5, 0.44),
        emissive: new Color3(0.14, 0.12, 0.1),
        peakAlpha: 0.65,
      };
    case "bowling":
    case "billiard": {
      const base = skin?.defaultColor ?? color;
      const t = darken(
        ((base >> 16) & 0xff) / 255,
        ((base >> 8) & 0xff) / 255,
        (base & 0xff) / 255,
        0.5,
        0.06,
      );
      return {
        tint: t,
        emissive: new Color3(t.r * 0.35, t.g * 0.35, t.b * 0.35),
        peakAlpha: 0.72,
      };
    }
    case "emoji":
    default:
      break;
  }

  const tint = darken(c.r, c.g, c.b, 0.48, 0.06);
  return {
    tint,
    emissive: new Color3(tint.r * 0.4, tint.g * 0.4, tint.b * 0.4),
    peakAlpha: 0.7,
  };
}

/** Непрозрачный рисунок протектора (только RGB, без дыр в альфе). */
function buildTreadTexture(scene: Scene): DynamicTexture {
  const tw = 128;
  const th = 256;
  const tex = new DynamicTexture("skidTreadRgb", { width: tw, height: th }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = "#a8a8b0";
  ctx.fillRect(0, 0, tw, th);

  for (let y = 0; y < th; y += 14) {
    ctx.fillStyle = "#2a2a32";
    ctx.fillRect(0, y, tw, 3);
    ctx.fillStyle = "#d8d8e0";
    ctx.fillRect(0, y + 3, tw, 4);
    ctx.fillStyle = "#909098";
    ctx.fillRect(2, y + 7, tw - 4, 5);
  }

  for (let i = 0; i < 10; i++) {
    const x = ((i * 21 + 4) % (tw - 4)) + 2;
    ctx.fillStyle = "#404048";
    ctx.fillRect(x, 0, 2, th);
  }

  tex.update();
  return tex;
}

export class SkidMarkSystem {
  private marks: SkidMark[] = [];
  private readonly treadTex: DynamicTexture;
  private readonly scene: Scene;
  private lastStamp = new Map<string, { x: number; z: number }>();
  private tagCounter = 0;

  constructor(
    scene: Scene,
    private readonly ground: Mesh,
  ) {
    this.scene = scene;
    this.treadTex = buildTreadTexture(scene);
  }

  /** Новый материал на сегмент (без clone — иначе теряется текстура в Babylon). */
  private createSegmentMaterial(
    color: number,
    skinId: string,
    peakAlpha: number,
    tag: string,
  ): StandardMaterial {
    const { tint, emissive } = skidTintForPlayer(color, skinId);
    const mat = new StandardMaterial(`skid_${tag}`, this.scene);
    mat.diffuseTexture = this.treadTex;
    mat.emissiveTexture = this.treadTex;
    mat.diffuseColor = tint;
    mat.emissiveColor = emissive;
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.disableDepthWrite = true;
    mat.zOffset = -8;
    mat.backFaceCulling = false;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.alpha = peakAlpha;
    return mat;
  }

  update(entities: SkidEntity[], now: number): void {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      const age = now - m.born;
      if (age >= m.lifeMs) {
        m.material.dispose();
        m.mesh.dispose();
        this.marks.splice(i, 1);
        continue;
      }
      const t = age / m.lifeMs;
      const a = m.peakAlpha * (1 - t * t);
      m.material.alpha = a;
      m.mesh.visibility = a;
    }

    for (const e of entities) {
      const speed = Math.hypot(e.vx, e.vz);
      if (!e.braking || speed < SKID_MIN_SPEED) continue;

      const prev = this.lastStamp.get(e.id);
      if (prev) {
        const dist = Math.hypot(e.x - prev.x, e.z - prev.z);
        if (dist < MIN_SEGMENT_DIST) continue;
      }
      this.lastStamp.set(e.id, { x: e.x, z: e.z });

      const inv = 1 / speed;
      const dirX = e.vx * inv;
      const dirZ = e.vz * inv;
      const yaw = Math.atan2(dirX, dirZ);

      const treadW = Math.max(0.45, e.radius * 0.65);
      const segLen = Math.max(0.14, 0.12 + speed * 0.05);
      const behind = e.radius * 0.32;
      const px = e.x - dirX * behind;
      const pz = e.z - dirZ * behind;

      const { peakAlpha } = skidTintForPlayer(e.color, e.skinId);
      const tag = `${e.id}_${this.tagCounter++}`;
      const mat = this.createSegmentMaterial(e.color, e.skinId, peakAlpha, tag);

      const mesh = MeshBuilder.CreateDisc(
        `skid_${tag}`,
        { radius: 1, tessellation: 10 },
        this.scene,
      );
      mesh.material = mat;
      mesh.parent = this.ground;
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.y = yaw;
      mesh.scaling.set(treadW * 0.5, 1, segLen * 0.5);
      mesh.position.set(px, SKID_LOCAL_Y, pz);
      mesh.isPickable = false;
      mesh.visibility = peakAlpha;

      this.marks.push({
        mesh,
        material: mat,
        born: now,
        lifeMs: MARK_LIFE_MS,
        peakAlpha,
      });

      if (this.marks.length > MAX_MARKS) {
        const drop = this.marks.shift();
        if (drop) {
          drop.material.dispose();
          drop.mesh.dispose();
        }
      }
    }

    for (const id of [...this.lastStamp.keys()]) {
      if (!entities.some((ent) => ent.id === id)) this.lastStamp.delete(id);
    }
  }

  dispose(): void {
    for (const m of this.marks) {
      m.material.dispose();
      m.mesh.dispose();
    }
    this.marks = [];
    this.lastStamp.clear();
    this.treadTex.dispose();
  }
}
