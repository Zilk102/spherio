import {
  AbstractMesh,
  Color3,
  DynamicTexture,
  Material,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { GROUND_Y, PELLET_RADIUS } from "@spherio/shared";
import { attachSkinDecal, disposeSkinMaterials, getSphereBaseMaterial } from "./skinTextures.js";
import { isLocalPart } from "../lib/playerParts.js";
import type { LocalPredictor } from "./LocalPredictor.js";

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
  skinId: string;
  name: string;
  invulnUntil: number;
}

interface PelletSnap {
  id: string;
  x: number;
  y: number;
  z: number;
}

interface SmoothState {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  radius: number;
}

/** Базовая задержка рендера ~2 тика при 30 Hz патчах */
const INTERP_DELAY_BASE_MS = 66;
const INTERP_DELAY_MAX_MS = 180;

function interpDelayMs(pingMs: number): number {
  return Math.min(INTERP_DELAY_MAX_MS, Math.max(INTERP_DELAY_BASE_MS, INTERP_DELAY_BASE_MS + pingMs * 0.55));
}
const HISTORY_MAX_MS = 400;
const SNAP_EPS = 0.008;
/** Чуть выше пола, ниже дна сферы (дно ≈ GROUND_Y + 0.02) */
const SHADOW_Y = GROUND_Y + 0.004;
/** Фиксированный размер плашки в мире (не зависит от scale шара) */
const NAME_LABEL_WIDTH = 3;
const NAME_LABEL_HEIGHT = 0.85;

export class EntitySync {
  private players = new Map<string, Mesh>();
  private decals = new Map<string, Mesh>();
  private shadows = new Map<string, Mesh>();
  private labels = new Map<string, Mesh>();
  private labelTextures = new Map<string, DynamicTexture>();
  private pellets = new Map<string, Mesh>();
  private playerMatKeys = new Map<string, string>();
  private shadowMat: StandardMaterial;
  private targetIndicator: TransformNode | null = null;
  private targetIndicatorMat: StandardMaterial | null = null;
  private smooth = new Map<string, SmoothState>();
  private history = new Map<
    string,
    {
      t: number;
      x: number;
      y: number;
      z: number;
      qx: number;
      qy: number;
      qz: number;
      qw: number;
      radius: number;
    }[]
  >();

  constructor(private scene: Scene) {
    this.shadowMat = new StandardMaterial("blobShadow", scene);
    this.shadowMat.diffuseColor = Color3.Black();
    this.shadowMat.specularColor = Color3.Black();
    this.shadowMat.alpha = 0.32;
    this.shadowMat.disableLighting = true;
    this.shadowMat.disableDepthWrite = true;
    this.shadowMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.shadowMat.zOffset = -8;
  }

  /**
   * Создать (лениво) или обновить 3D-индикатор цели над сферой-жертвой.
   * Если targetId не задан, нет такой сферы или это сам игрок — индикатор скрывается.
   */
  updateTargetIndicator(
    targetId: string | null,
    nowMs: number,
    selfId: string | null,
  ): void {
    if (!this.targetIndicator) {
      this.targetIndicator = this.buildTargetIndicator();
    }
    if (!targetId || targetId === selfId) {
      this.targetIndicator.setEnabled(false);
      return;
    }
    const mesh = this.players.get(targetId);
    const smooth = this.smooth.get(targetId);
    if (!mesh || !smooth) {
      this.targetIndicator.setEnabled(false);
      return;
    }
    const r = smooth.radius;
    // Парим над сферой, лёгкое колыхание по Y чтобы привлекать внимание.
    const bob = Math.sin(nowMs * 0.004) * 0.18;
    const above = r + 1.4 + bob;
    this.targetIndicator.position.set(smooth.x, smooth.y + above, smooth.z);
    // Вращение вокруг вертикальной оси — 1 оборот за ~2.5 секунды.
    this.targetIndicator.rotation.y = (nowMs / 1000) * (Math.PI * 0.8);
    this.targetIndicator.setEnabled(true);
  }

  /** Построить меш: круглая «шапочка» с пиками-стрелками по 4 сторонам, направленными вниз. */
  private buildTargetIndicator(): TransformNode {
    const root = new TransformNode("targetIndicator", this.scene);
    const mat = new StandardMaterial("targetIndicatorMat", this.scene);
    mat.diffuseColor = new Color3(0.95, 0.18, 0.18);
    mat.emissiveColor = new Color3(0.9, 0.12, 0.12);
    mat.specularColor = new Color3(0.4, 0.1, 0.1);
    mat.specularPower = 32;
    mat.alpha = 0.95;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.backFaceCulling = false;
    this.targetIndicatorMat = mat;

    // Главная стрелка — острый конус, направленный вниз.
    const cone = MeshBuilder.CreateCylinder(
      "targetArrowCone",
      {
        diameterTop: 0,
        diameterBottom: 1.05,
        height: 1.55,
        tessellation: 24,
      },
      this.scene,
    );
    cone.material = mat;
    cone.parent = root;
    cone.rotation.x = Math.PI; // острым концом вниз
    cone.position.y = 0.0;

    // Шток сверху, чтобы стрелка читалась как 3D-указатель.
    const shaft = MeshBuilder.CreateCylinder(
      "targetArrowShaft",
      {
        diameter: 0.32,
        height: 0.7,
        tessellation: 18,
      },
      this.scene,
    );
    shaft.material = mat;
    shaft.parent = root;
    shaft.position.y = 1.1;

    // Кольцо-нимб вокруг штока — даёт нарядный «прицельный» вид.
    const halo = MeshBuilder.CreateTorus(
      "targetArrowHalo",
      {
        diameter: 1.55,
        thickness: 0.12,
        tessellation: 32,
      },
      this.scene,
    );
    halo.material = mat;
    halo.parent = root;
    halo.position.y = 1.05;

    root.scaling = new Vector3(0.9, 0.9, 0.9);
    root.setEnabled(false);
    return root;
  }

  syncPlayers(
    list: PlayerSnap[],
    localId: string | null,
    now: number,
    dtSec: number,
    predictor: LocalPredictor | null = null,
    pingMs = 0,
  ): Mesh | null {
    const seen = new Set<string>();
    let localNode: Mesh | null = null;
    let localBestR = 0;
    const renderT = now - interpDelayMs(pingMs);

    for (const p of list) {
      seen.add(p.id);
      let node = this.players.get(p.id);
      let shadow = this.shadows.get(p.id);

      if (!node) {
        node = MeshBuilder.CreateSphere(
          `player_${p.id}`,
          { diameter: 1, segments: 32 },
          this.scene,
        );
        node.rotationQuaternion = Quaternion.Identity();
        node.material = this.playerMat(p.skinId, p.color);
        this.players.set(p.id, node);
        this.applyDecal(p.id, node, p.skinId);

        shadow = MeshBuilder.CreateDisc(
          `shadow_${p.id}`,
          { radius: 0.5, tessellation: 24 },
          this.scene,
        );
        shadow.material = this.shadowMat;
        shadow.rotation.x = Math.PI / 2;
        this.shadows.set(p.id, shadow);

        this.smooth.set(p.id, {
          x: p.x,
          y: p.y,
          z: p.z,
          qx: p.qx,
          qy: p.qy,
          qz: p.qz,
          qw: p.qw,
          radius: p.radius,
        });
        this.history.set(p.id, []);

        if (!isLocalPart(p.id, localId)) {
          const label = this.createNameLabel(p.id, p.name);
          this.labels.set(p.id, label);
        }
      } else {
        this.updateNameLabel(p.id, p.name);
      }

      const hist = this.history.get(p.id)!;
      this.pushHistory(hist, now, p);

      const target = this.interpolate(hist, renderT) ?? p;
      const s = this.smooth.get(p.id)!;
      const isLocal = isLocalPart(p.id, localId);
      const pred = isLocal && predictor ? predictor.getPredicted(p.id) : undefined;

      if (pred) {
        // Позиция — client prediction (отзывчивый ввод).
        // Вращение — с сервера (Rapier, реальное качение), иначе шар «скользит».
        s.x = pred.body.x;
        s.y = pred.body.y;
        s.z = pred.body.z;
        s.radius = pred.body.radius;
        const blendQ = 1 - Math.exp(-28 * dtSec);
        const cq = new Quaternion(s.qx, s.qy, s.qz, s.qw);
        const tq = new Quaternion(target.qx, target.qy, target.qz, target.qw);
        const oq = Quaternion.Slerp(cq, tq, blendQ);
        s.qx = oq.x;
        s.qy = oq.y;
        s.qz = oq.z;
        s.qw = oq.w;
      } else if (isLocal) {
        const blend = 1 - Math.exp(-32 * dtSec);
        s.x += (target.x - s.x) * blend;
        s.y += (target.y - s.y) * blend;
        s.z += (target.z - s.z) * blend;
        s.radius += (target.radius - s.radius) * blend;
        const cq = new Quaternion(s.qx, s.qy, s.qz, s.qw);
        const tq = new Quaternion(target.qx, target.qy, target.qz, target.qw);
        const oq = Quaternion.Slerp(cq, tq, blend);
        s.qx = oq.x;
        s.qy = oq.y;
        s.qz = oq.z;
        s.qw = oq.w;
      } else {
        s.x = target.x;
        s.y = target.y;
        s.z = target.z;
        s.radius = target.radius;
        const cq = new Quaternion(s.qx, s.qy, s.qz, s.qw);
        const tq = new Quaternion(target.qx, target.qy, target.qz, target.qw);
        const oq = Quaternion.Slerp(cq, tq, Math.min(1, dtSec * 14));
        s.qx = oq.x;
        s.qy = oq.y;
        s.qz = oq.z;
        s.qw = oq.w;
      }

      const oq = new Quaternion(s.qx, s.qy, s.qz, s.qw);

      node.position.set(s.x, s.y, s.z);
      node.rotationQuaternion = oq;
      const scale = s.radius * 2;
      node.scaling.set(scale, scale, scale);

      const matKey = `${p.skinId}_${p.color & 0xffffff}`;
      if (this.playerMatKeys.get(p.id) !== matKey) {
        const prevSkin = this.playerMatKeys.get(p.id)?.split("_")[0];
        node.material = this.playerMat(p.skinId, p.color);
        this.playerMatKeys.set(p.id, matKey);
        if (prevSkin !== p.skinId) {
          this.disposeDecal(p.id);
          this.applyDecal(p.id, node, p.skinId);
        }
      }
      const mat = node.material as StandardMaterial;
      mat.alpha = p.invulnUntil > now ? 0.55 + 0.2 * Math.sin(now * 0.01) : 1;

      if (shadow) {
        const shadowScale = s.radius * 1.05;
        shadow.scaling.set(shadowScale, 1, shadowScale * 0.82);
        shadow.position.set(s.x, SHADOW_Y, s.z);
      }

      const label = this.labels.get(p.id);
      if (label && !isLocalPart(p.id, localId)) {
        label.position.set(s.x, s.y + s.radius + 0.65, s.z);
        label.scaling.set(NAME_LABEL_WIDTH, NAME_LABEL_HEIGHT, 1);
      }

      if (isLocalPart(p.id, localId) && s.radius >= localBestR) {
        localBestR = s.radius;
        localNode = node;
      }
    }

    for (const [id, node] of this.players) {
      if (!seen.has(id)) {
        this.disposeDecal(id);
        node.dispose();
        this.shadows.get(id)?.dispose();
        this.labels.get(id)?.dispose();
        this.labelTextures.get(id)?.dispose();
        this.players.delete(id);
        this.shadows.delete(id);
        this.labels.delete(id);
        this.labelTextures.delete(id);
        this.smooth.delete(id);
        this.history.delete(id);
        this.playerMatKeys.delete(id);
      }
    }

    return localNode;
  }

  private pushHistory(
    hist: {
      t: number;
      x: number;
      y: number;
      z: number;
      qx: number;
      qy: number;
      qz: number;
      qw: number;
      radius: number;
    }[],
    t: number,
    p: PlayerSnap,
  ): void {
    const last = hist[hist.length - 1];
    if (last) {
      const moved =
        Math.hypot(last.x - p.x, last.z - p.z) > SNAP_EPS ||
        Math.abs(last.y - p.y) > SNAP_EPS * 0.5 ||
        Math.abs(last.radius - p.radius) > SNAP_EPS * 0.5;
      const qDot = Math.abs(last.qx * p.qx + last.qy * p.qy + last.qz * p.qz + last.qw * p.qw);
      const rotated = qDot < 0.9995;
      if (!moved && !rotated && t - last.t < 40) return;
    }
    hist.push({
      t,
      x: p.x,
      y: p.y,
      z: p.z,
      qx: p.qx,
      qy: p.qy,
      qz: p.qz,
      qw: p.qw,
      radius: p.radius,
    });
    while (hist.length > 2 && hist[0].t < t - HISTORY_MAX_MS) hist.shift();
  }

  private extrapolate(
    a: {
      t: number;
      x: number;
      y: number;
      z: number;
      qx: number;
      qy: number;
      qz: number;
      qw: number;
      radius: number;
    },
    b: {
      t: number;
      x: number;
      y: number;
      z: number;
      qx: number;
      qy: number;
      qz: number;
      qw: number;
      radius: number;
    },
    renderT: number,
  ): SmoothState {
    const dtSec = Math.max(0.001, (b.t - a.t) / 1000);
    const ahead = Math.min(0.1, Math.max(0, (renderT - b.t) / 1000));
    const vx = (b.x - a.x) / dtSec;
    const vy = (b.y - a.y) / dtSec;
    const vz = (b.z - a.z) / dtSec;
    const cq = new Quaternion(a.qx, a.qy, a.qz, a.qw);
    const bq = new Quaternion(b.qx, b.qy, b.qz, b.qw);
    const oq = Quaternion.Slerp(cq, bq, 1);
    return {
      x: b.x + vx * ahead,
      y: b.y + vy * ahead,
      z: b.z + vz * ahead,
      qx: oq.x,
      qy: oq.y,
      qz: oq.z,
      qw: oq.w,
      radius: b.radius + ((b.radius - a.radius) / dtSec) * ahead,
    };
  }

  private interpolate(
    hist: {
      t: number;
      x: number;
      y: number;
      z: number;
      qx: number;
      qy: number;
      qz: number;
      qw: number;
      radius: number;
    }[],
    renderT: number,
  ): SmoothState | null {
    if (hist.length === 0) return null;
    if (hist.length === 1) return hist[0];
    let a = hist[0];
    let b = hist[hist.length - 1];
    for (let i = 0; i < hist.length - 1; i++) {
      if (hist[i].t <= renderT && hist[i + 1].t >= renderT) {
        a = hist[i];
        b = hist[i + 1];
        break;
      }
    }
    if (renderT > b.t && hist.length >= 2) {
      return this.extrapolate(hist[hist.length - 2], b, renderT);
    }
    const span = b.t - a.t;
    const f = span > 1e-3 ? Math.max(0, Math.min(1, (renderT - a.t) / span)) : 1;
    const cq = new Quaternion(a.qx, a.qy, a.qz, a.qw);
    const bq = new Quaternion(b.qx, b.qy, b.qz, b.qw);
    const oq = Quaternion.Slerp(cq, bq, f);
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
      qx: oq.x,
      qy: oq.y,
      qz: oq.z,
      qw: oq.w,
      radius: a.radius + (b.radius - a.radius) * f,
    };
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
        const m = new StandardMaterial(`pellet_${p.id}`, this.scene);
        m.diffuseColor = new Color3(0.35, 0.82, 0.48);
        m.emissiveColor = new Color3(0.06, 0.14, 0.08);
        m.specularColor = Color3.Black();
        node.material = m;
        this.pellets.set(p.id, node);
      }
      node.position.set(p.x, p.y ?? GROUND_Y + PELLET_RADIUS, p.z);
    }
    for (const [id, node] of this.pellets) {
      if (!seen.has(id)) {
        node.dispose();
        this.pellets.delete(id);
      }
    }
  }

  private createNameLabel(id: string, name: string): Mesh {
    const plane = MeshBuilder.CreatePlane(
      `nameLabel_${id}`,
      { width: 1, height: 0.28 },
      this.scene,
    );
    plane.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;
    const tex = new DynamicTexture(
      `nameTex_${id}`,
      { width: 512, height: 128 },
      this.scene,
      false,
    );
    this.labelTextures.set(id, tex);
    this.drawName(tex, name);
    const mat = new StandardMaterial(`nameMat_${id}`, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    plane.material = mat;
    return plane;
  }

  private updateNameLabel(id: string, name: string): void {
    const tex = this.labelTextures.get(id);
    if (tex) this.drawName(tex, name);
  }

  private drawName(tex: DynamicTexture, name: string): void {
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(40, 36, 432, 56);
    ctx.font = "bold 40px system-ui, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f0f6ff";
    ctx.fillText(name.slice(0, 16), 256, 64);
    tex.update();
  }

  getMesh(id: string): Mesh | undefined {
    return this.players.get(id);
  }

  /** Текущая отображаемая позиция (интерполяция / prediction). */
  getDisplayPosition(id: string): { x: number; y: number; z: number } | null {
    const s = this.smooth.get(id);
    if (!s) return null;
    return { x: s.x, y: s.y, z: s.z };
  }

  private playerMat(skinId: string, color: number): StandardMaterial {
    return getSphereBaseMaterial(this.scene, skinId, color);
  }

  private applyDecal(id: string, sphere: Mesh, skinId: string): void {
    const decal = attachSkinDecal(this.scene, sphere, skinId);
    if (decal) this.decals.set(id, decal);
  }

  private disposeDecal(id: string): void {
    const d = this.decals.get(id);
    if (d) {
      d.dispose();
      this.decals.delete(id);
    }
  }

  dispose(): void {
    for (const n of this.decals.values()) n.dispose();
    for (const n of this.players.values()) n.dispose();
    for (const n of this.shadows.values()) n.dispose();
    for (const n of this.labels.values()) n.dispose();
    for (const t of this.labelTextures.values()) t.dispose();
    for (const n of this.pellets.values()) n.dispose();
    this.shadowMat.dispose();
    this.targetIndicator?.dispose();
    this.targetIndicatorMat?.dispose();
    this.targetIndicator = null;
    this.targetIndicatorMat = null;
    disposeSkinMaterials(this.scene);
    this.playerMatKeys.clear();
    this.decals.clear();
    this.players.clear();
    this.shadows.clear();
    this.labels.clear();
    this.labelTextures.clear();
    this.pellets.clear();
    this.smooth.clear();
    this.history.clear();
  }
}
