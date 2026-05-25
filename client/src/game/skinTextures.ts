import {
  Color3,
  DynamicTexture,
  StandardMaterial,
  Texture,
  type Scene,
} from "@babylonjs/core";
import { getSkin, type SkinDef } from "@spherio/shared";
import {
  SPHERE_TEX_SIZE,
  SPHERE_TEX_VERSION,
  blitImageData,
  paintBasketballTexture,
  paintBilliardTexture,
  paintBowlingTexture,
  paintEmojiTexture,
  paintFootballTexture,
  paintVolleyballTexture,
} from "./sphereTexturePaint.js";

function hexRgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

function css(color: number): string {
  const { r, g, b } = hexRgb(color);
  return `rgb(${r},${g},${b})`;
}

function paintSkin(
  ctx: CanvasRenderingContext2D,
  skin: SkinDef,
  color: number,
): void {
  const size = SPHERE_TEX_SIZE;
  let img;
  switch (skin.kind) {
    case "emoji":
      img = paintEmojiTexture(size, skin.emoji ?? "😀", color);
      break;
    case "football":
      img = paintFootballTexture(size);
      break;
    case "basketball":
      img = paintBasketballTexture(size);
      break;
    case "volleyball":
      img = paintVolleyballTexture(size);
      break;
    case "bowling":
      img = paintBowlingTexture(size, color);
      break;
    case "billiard":
      img = paintBilliardTexture(size, skin.defaultColor, skin.billiardNumber ?? 8);
      break;
    default:
      ctx.fillStyle = css(color);
      ctx.fillRect(0, 0, size, size);
      return;
  }
  blitImageData(ctx, img);
}

const cache = new Map<string, StandardMaterial>();

export function getPlayerSkinMaterial(
  scene: Scene,
  skinId: string,
  color: number,
): StandardMaterial {
  const key = `v${SPHERE_TEX_VERSION}_${skinId}_${(color & 0xffffff).toString(16)}`;
  let mat = cache.get(key);
  if (mat) return mat;

  const skin = getSkin(skinId);
  const tex = new DynamicTexture(
    `skinTex_${key}`,
    SPHERE_TEX_SIZE,
    scene,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;

  const ctx = tex.getContext() as CanvasRenderingContext2D;
  if (skin) {
    paintSkin(ctx, skin, color);
  } else {
    ctx.fillStyle = css(color);
    ctx.fillRect(0, 0, SPHERE_TEX_SIZE, SPHERE_TEX_SIZE);
  }
  tex.update();

  mat = new StandardMaterial(`skinMat_${key}`, scene);
  mat.diffuseTexture = tex;
  mat.ambientColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.35, 0.35, 0.38);
  mat.specularPower = 64;
  mat.emissiveColor = new Color3(0.08, 0.08, 0.09);
  cache.set(key, mat);
  return mat;
}

export function disposeSkinMaterials(): void {
  for (const m of cache.values()) {
    m.diffuseTexture?.dispose();
    m.dispose();
  }
  cache.clear();
}
