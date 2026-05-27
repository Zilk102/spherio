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
import {
  GROUND_Y,
  pelletRadiusForKind,
  PelletKind,
} from "@spherio/shared";
import { createHedgehogMesh } from "./hedgehogMesh.js";
import { attachSkinDecal, disposeSkinMaterials, getSphereBaseMaterial } from "./skinTextures.js";
import { isLocalPart } from "../lib/playerParts.js";
import type { LocalPredictor } from "./LocalPredictor.js";
import {
  netSampleFromPlayer,
  pushNetPair,
  sampleNetPair,
  type NetPair,
} from "./netSnap.js";
import { interpDelayMs } from "../net/serverClock.js";

interface PlayerSnap {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
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
  kind?: number;
}

interface HedgehogSnap {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
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
  private labelNames = new Map<string, string>();
  private pellets = new Map<string, Mesh>();
  private pelletMats = new Map<PelletKind, StandardMaterial>();
  private hedgehogs = new Map<string, TransformNode>();
  private playerMatKeys = new Map<string, string>();
  private readonly playerSeen = new Set<string>();
  private shadowMat: StandardMaterial;
  private targetIndicator: TransformNode | null = null;
  private targetIndicatorMat: StandardMaterial | null = null;
  private smooth = new Map<string, SmoothState>();
  private netPairs = new Map<string, NetPair>();
  private readonly _qA = new Quaternion();
  private readonly _qB = new Quaternion();
  private readonly _qOut = new Quaternion();

  constructor(private scene: Scene) {
    this.shadowMat = new StandardMaterial("blobShadow", scene);
    this.shadowMat.diffuseColor = Color3.Black();
    this.shadowMat.specularColor = Color3.Black();
    this.shadowMat.alpha = 0.32;
    this.shadowMat.disableLighting = true;
    this.shadowMat.disableDepthWrite = true;
    this.shadowMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.shadowMat.zOffset = -8;

    this.pelletMats.set(PelletKind.Green, this.makePelletMat("green", 0.35, 0.82, 0.48));
    this.pelletMats.set(PelletKind.Blue, this.makePelletMat("blue", 0.28, 0.55, 0.95));
    this.pelletMats.set(PelletKind.Red, this.makePelletMat("red", 0.92, 0.32, 0.28));
  }

  private makePelletMat(
    name: string,
    r: number,
    g: number,
    b: number,
  ): StandardMaterial {
    const m = new StandardMaterial(`pelletKind_${name}`, this.scene);
    m.diffuseColor = new Color3(r, g, b);
    m.emissiveColor = new Color3(r * 0.2, g * 0.2, b * 0.2);
    m.specularColor = Color3.Black();
    return m;
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

  /** Снимки игроков с патча (~30 Гц) — не в render loop на каждом кадре. */
  ingestPlayersPatch(players: PlayerSnap[], serverTimeMs: number): void {
    if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return;
    for (const p of players) {
      pushNetPair(this.netPairs, p.id, netSampleFromPlayer(p, serverTimeMs));
    }
  }

  syncPlayers(
    list: PlayerSnap[],
    localId: string | null,
    now: number,
    dtSec: number,
    predictor: LocalPredictor | null = null,
    pingMs = 0,
  ): Mesh | null {
    const renderT = now - interpDelayMs(pingMs);
    const seen = this.playerSeen;
    seen.clear();
    let localNode: Mesh | null = null;
    let localBestR = 0;

    for (const p of list) {
      seen.add(p.id);
      let node = this.players.get(p.id);
      let shadow = this.shadows.get(p.id);

      if (!node) {
        node = MeshBuilder.CreateSphere(
          `player_${p.id}`,
          { diameter: 1, segments: 16 },
          this.scene,
        );
        node.rotationQuaternion = Quaternion.Identity();
        node.material = this.playerMat(p.skinId, p.color);
        this.players.set(p.id, node);

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
        pushNetPair(this.netPairs, p.id, netSampleFromPlayer(p, now));

        if (!isLocalPart(p.id, localId)) {
          const label = this.createNameLabel(p.id, p.name);
          this.labels.set(p.id, label);
          this.labelNames.set(p.id, p.name);
        }
      } else if (
        !isLocalPart(p.id, localId) &&
        this.labelNames.get(p.id) !== p.name
      ) {
        this.updateNameLabel(p.id, p.name);
        this.labelNames.set(p.id, p.name);
      }

      const pair = this.netPairs.get(p.id);
      const target = pair ? sampleNetPair(pair, renderT) : p;
      const s = this.smooth.get(p.id)!;
      const isLocal = isLocalPart(p.id, localId);
      const pred = isLocal && predictor ? predictor.getPredicted(p.id) : undefined;

      if (pred) {
        // Позиция — prediction; вращение — последний патч сервера + один slerp (без «отстающего» renderT).
        s.x = pred.body.x;
        s.y = pred.body.y;
        s.z = pred.body.z;
        s.radius = pred.body.radius;
        const rot = pair?.to ?? target;
        const blendQ = 1 - Math.exp(-45 * dtSec);
        this._qA.set(s.qx, s.qy, s.qz, s.qw);
        this._qB.set(rot.qx, rot.qy, rot.qz, rot.qw);
        if (Quaternion.Dot(this._qA, this._qB) < 0) {
          this._qB.set(-rot.qx, -rot.qy, -rot.qz, -rot.qw);
        }
        Quaternion.SlerpToRef(this._qA, this._qB, blendQ, this._qOut);
        s.qx = this._qOut.x;
        s.qy = this._qOut.y;
        s.qz = this._qOut.z;
        s.qw = this._qOut.w;
      } else {
        const blend = 1 - Math.exp(-36 * dtSec);
        s.x += (target.x - s.x) * blend;
        s.y += (target.y - s.y) * blend;
        s.z += (target.z - s.z) * blend;
        s.radius += (target.radius - s.radius) * blend;
        s.qx = target.qx;
        s.qy = target.qy;
        s.qz = target.qz;
        s.qw = target.qw;
      }

      node.position.set(s.x, s.y, s.z);
      if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.Identity();
      node.rotationQuaternion.set(s.qx, s.qy, s.qz, s.qw);
      const scale = s.radius * 2;
      node.scaling.set(scale, scale, scale);

      const matKey = `${p.skinId}_${p.color & 0xffffff}`;
      if (this.playerMatKeys.get(p.id) !== matKey) {
        const prevSkin = this.playerMatKeys.get(p.id)?.split("_")[0];
        node.material = this.playerMat(p.skinId, p.color);
        this.playerMatKeys.set(p.id, matKey);
        if (prevSkin !== p.skinId) {
          this.disposeDecal(p.id);
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
        node.dispose(false, false);
        this.shadows.get(id)?.dispose(false, false);
        this.labels.get(id)?.dispose(true, true);
        this.labelTextures.get(id)?.dispose();
        this.players.delete(id);
        this.shadows.delete(id);
        this.labels.delete(id);
        this.labelTextures.delete(id);
        this.labelNames.delete(id);
        this.smooth.delete(id);
        this.netPairs.delete(id);
        this.playerMatKeys.delete(id);
      }
    }

    return localNode;
  }

  syncPellets(list: PelletSnap[]): void {
    const seen = new Set<string>();
    for (const p of list) {
      seen.add(p.id);
      const kind = (p.kind ?? PelletKind.Green) as PelletKind;
      const pr = pelletRadiusForKind(kind);
      let node = this.pellets.get(p.id);
      if (!node) {
        node = MeshBuilder.CreateSphere(
          `pellet_${p.id}`,
          { diameter: pr * 2, segments: 10 },
          this.scene,
        );
        this.pellets.set(p.id, node);
      }
      const mat = this.pelletMats.get(kind) ?? this.pelletMats.get(PelletKind.Green)!;
      node.material = mat;
      const scale = pr / pelletRadiusForKind(PelletKind.Green);
      node.scaling.set(scale, scale, scale);
      node.position.set(p.x, p.y ?? GROUND_Y + pr, p.z);
    }
    for (const [id, node] of this.pellets) {
      if (!seen.has(id)) {
        node.dispose(false, false);
        this.pellets.delete(id);
      }
    }
  }

  syncHedgehogs(list: HedgehogSnap[]): void {
    const seen = new Set<string>();
    for (const h of list) {
      seen.add(h.id);
      let root = this.hedgehogs.get(h.id);
      if (!root) {
        root = createHedgehogMesh(this.scene, h.id, h.radius);
        this.hedgehogs.set(h.id, root);
      }
      root.position.set(h.x, h.y, h.z);
      if (root.rotationQuaternion) {
        root.rotationQuaternion.set(h.qx, h.qy, h.qz, h.qw);
      } else {
        root.rotationQuaternion = new Quaternion(h.qx, h.qy, h.qz, h.qw);
      }
    }
    for (const [id, root] of this.hedgehogs) {
      if (!seen.has(id)) {
        root.dispose(false, true);
        this.hedgehogs.delete(id);
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
    for (const n of this.decals.values()) n.dispose(false, false);
    for (const n of this.players.values()) n.dispose(false, false);
    for (const n of this.shadows.values()) n.dispose(false, false);
    for (const n of this.labels.values()) n.dispose(true, true);
    for (const t of this.labelTextures.values()) t.dispose();
    for (const n of this.pellets.values()) n.dispose(false, false);
    for (const h of this.hedgehogs.values()) h.dispose(false, true);
    for (const m of this.pelletMats.values()) m.dispose();
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
    this.labelNames.clear();
    this.pellets.clear();
    this.hedgehogs.clear();
    this.pelletMats.clear();
    this.smooth.clear();
    this.netPairs.clear();
  }
}
