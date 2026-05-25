/**
 * Скины сферы по‑настоящему: процедурные текстуры для мячей и
 * штатный Babylon `MeshBuilder.CreateDecal` для эмодзи.
 *
 * Документация: https://doc.babylonjs.com/features/featuresDeepDive/mesh/decals
 *
 * API
 *   getSphereBaseMaterial(scene, skinId, color)  — материал для самой сферы
 *   attachSkinDecal(scene, sphere, skinId)       — наклейка‑декаль (или null)
 *   disposeSkinMaterials()                       — очистка кеша
 */

import {
  Color3,
  DynamicTexture,
  Material,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Vector3,
  type Mesh,
  type Scene,
} from "@babylonjs/core";
import { getSkin } from "@spherio/shared";
import {
  SPHERE_TEX_SIZE,
  SPHERE_TEX_VERSION,
  blitImageData,
  paintBasketballTexture,
  paintBilliardTexture,
  paintBowlingTexture,
  paintFootballTexture,
  paintVolleyballTexture,
} from "./sphereTexturePaint.js";

/**
 * Кеши строго per-scene: материалы/текстуры Babylon живут на конкретном
 * Engine и при `scene.dispose()` (или `engine.dispose()`) GPU-ресурсы
 * умирают. Если хранить ссылки глобально, после закрытия превью скинов
 * (Engine #1) игра (Engine #2) получит cache hit на уже-disposed объект
 * и сфера будет рендериться пустой — останется только тень.
 *
 * WeakMap по сцене → когда сцена собрана GC, её кеш тоже исчезает.
 */
interface SceneCaches {
  base: Map<string, StandardMaterial>;
  decal: Map<string, StandardMaterial>;
  tex: Map<string, DynamicTexture>;
}
const sceneCaches = new WeakMap<Scene, SceneCaches>();

function cachesFor(scene: Scene): SceneCaches {
  let c = sceneCaches.get(scene);
  if (!c) {
    c = {
      base: new Map<string, StandardMaterial>(),
      decal: new Map<string, StandardMaterial>(),
      tex: new Map<string, DynamicTexture>(),
    };
    sceneCaches.set(scene, c);
    // когда сцена живьём диспозится — выкинуть кеш сразу, чтобы не отдать
    // ссылки на уже мёртвый GPU-state
    scene.onDisposeObservable.addOnce(() => sceneCaches.delete(scene));
  }
  return c;
}

function colorTo(color: number): Color3 {
  return new Color3(
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255,
  );
}

function makeProceduralTexture(
  scene: Scene,
  key: string,
  paint: (ctx: CanvasRenderingContext2D) => void,
): DynamicTexture {
  const cache = cachesFor(scene).tex;
  const cached = cache.get(key);
  if (cached) return cached;
  const tex = new DynamicTexture(
    `sphTex_${key}`,
    SPHERE_TEX_SIZE,
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  paint(ctx);
  tex.update();
  cache.set(key, tex);
  return tex;
}

/** Полированный шар с тонкими бликами — реалистичный без HDR */
function tuneGloss(mat: StandardMaterial): void {
  mat.specularColor = new Color3(0.55, 0.55, 0.6);
  mat.specularPower = 96;
  mat.ambientColor = new Color3(0.95, 0.95, 1);
  mat.emissiveColor = new Color3(0.06, 0.06, 0.07);
  mat.useSpecularOverAlpha = true;
  mat.maxSimultaneousLights = 6;
}

export function getSphereBaseMaterial(
  scene: Scene,
  skinId: string,
  color: number,
): StandardMaterial {
  const skin = getSkin(skinId);
  const tint = color & 0xffffff;
  const key = `v${SPHERE_TEX_VERSION}_base_${skinId}_${tint.toString(16)}`;
  const baseCache = cachesFor(scene).base;
  const cached = baseCache.get(key);
  if (cached) return cached;

  const mat = new StandardMaterial(`mat_${key}`, scene);
  tuneGloss(mat);

  if (!skin) {
    mat.diffuseColor = colorTo(tint);
    baseCache.set(key, mat);
    return mat;
  }

  if (skin.kind === "football") {
    mat.diffuseTexture = makeProceduralTexture(scene, `football_${SPHERE_TEX_VERSION}`, (ctx) =>
      blitImageData(ctx, paintFootballTexture(SPHERE_TEX_SIZE)),
    );
    mat.specularPower = 64;
  } else if (skin.kind === "basketball") {
    mat.diffuseTexture = makeProceduralTexture(scene, `basketball_${SPHERE_TEX_VERSION}`, (ctx) =>
      blitImageData(ctx, paintBasketballTexture(SPHERE_TEX_SIZE)),
    );
    mat.specularColor = new Color3(0.18, 0.12, 0.08);
    mat.specularPower = 24;
  } else if (skin.kind === "volleyball") {
    mat.diffuseTexture = makeProceduralTexture(scene, `volleyball_${SPHERE_TEX_VERSION}`, (ctx) =>
      blitImageData(ctx, paintVolleyballTexture(SPHERE_TEX_SIZE)),
    );
    mat.specularPower = 32;
  } else if (skin.kind === "bowling") {
    mat.diffuseTexture = makeProceduralTexture(
      scene,
      `bowling_${tint.toString(16)}_${SPHERE_TEX_VERSION}`,
      (ctx) => blitImageData(ctx, paintBowlingTexture(SPHERE_TEX_SIZE, tint)),
    );
    mat.specularPower = 160;
    mat.specularColor = new Color3(0.7, 0.7, 0.75);
  } else if (skin.kind === "billiard") {
    const num = skin.billiardNumber ?? 8;
    mat.diffuseTexture = makeProceduralTexture(
      scene,
      `billiard_${num}_${SPHERE_TEX_VERSION}`,
      (ctx) => blitImageData(ctx, paintBilliardTexture(SPHERE_TEX_SIZE, skin.defaultColor, num)),
    );
    mat.specularPower = 220;
    mat.specularColor = new Color3(0.9, 0.9, 0.95);
  } else if (skin.kind === "emoji") {
    // Чистый цвет шара — лицо ляжет наклейкой отдельной mesh’ью
    mat.diffuseColor = colorTo(tint);
  }

  baseCache.set(key, mat);
  return mat;
}

/** Текстура декали: квадратный канвас с прозрачным фоном и эмодзи в центре */
function getDecalMaterial(scene: Scene, emoji: string): StandardMaterial {
  const key = `v${SPHERE_TEX_VERSION}_decal_${emoji}`;
  const decalCache = cachesFor(scene).decal;
  const cached = decalCache.get(key);
  if (cached) return cached;

  const E = 512;
  const tex = new DynamicTexture(
    `decalTex_${key}`,
    { width: E, height: E },
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, E, E);
  ctx.font = `${Math.floor(E * 0.82)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, E / 2, E * 0.54);
  tex.update();

  const mat = new StandardMaterial(`decalMat_${key}`, scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
  mat.disableLighting = true;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.zOffset = -2;
  mat.backFaceCulling = true;
  decalCache.set(key, mat);
  return mat;
}

/**
 * Наклеить эмодзи на переднюю часть сферы (если у скина есть emoji).
 * Сфера передаётся в локальных координатах (диаметр=1). Декаль становится её ребёнком.
 * https://doc.babylonjs.com/features/featuresDeepDive/mesh/decals
 */
export function attachSkinDecal(
  scene: Scene,
  sphere: Mesh,
  skinId: string,
): Mesh | null {
  const skin = getSkin(skinId);
  if (!skin || skin.kind !== "emoji" || !skin.emoji) return null;

  const sphereRadius = 0.5;
  const worldFront = sphere.getAbsolutePosition().add(new Vector3(0, 0, sphereRadius));
  const decal = MeshBuilder.CreateDecal(
    `decal_${sphere.name}_${skinId}`,
    sphere,
    {
      position: worldFront,
      normal: new Vector3(0, 0, 1),
      size: new Vector3(0.9, 0.9, 0.6),
    },
  );
  decal.material = getDecalMaterial(scene, skin.emoji);
  decal.setParent(sphere);
  decal.isPickable = false;
  return decal;
}

/**
 * Выкинуть локальный (per-scene) кеш материалов/текстур, привязанный к
 * этой сцене. Использовать перед собственным `scene.dispose()` — обычно
 * этого не требуется, потому что Babylon сам диспозит owned-ресурсы при
 * выгрузке сцены, но мы явно очищаем мапы, чтобы освободить память.
 */
export function disposeSkinMaterials(scene?: Scene): void {
  if (!scene) return;
  const c = sceneCaches.get(scene);
  if (!c) return;
  for (const m of c.base.values()) m.dispose();
  for (const m of c.decal.values()) m.dispose();
  for (const t of c.tex.values()) t.dispose();
  c.base.clear();
  c.decal.clear();
  c.tex.clear();
  sceneCaches.delete(scene);
}

/** @deprecated — оставлено для обратной совместимости */
export function getPlayerSkinMaterial(
  scene: Scene,
  skinId: string,
  color: number,
): StandardMaterial {
  return getSphereBaseMaterial(scene, skinId, color);
}
