import {
  Color3,
  Color4,
  DynamicTexture,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { ARENA_HALF, ARENA_SIZE } from "@spherio/shared";
import {
  GROUND_TEX_SIZE,
  GROUND_TEX_VERSION,
  paintAsphaltTexture,
} from "./groundTexture.js";

export function buildArena(scene: Scene): void {
  scene.clearColor = new Color4(0.06, 0.1, 0.14, 1);

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.95;
  hemi.groundColor = new Color3(0.12, 0.16, 0.14);
  hemi.diffuse = new Color3(0.92, 0.94, 0.98);

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: ARENA_SIZE, height: ARENA_SIZE, subdivisions: 1 },
    scene,
  );
  const groundMat = new StandardMaterial("groundMat", scene);
  const asphaltTex = new DynamicTexture(
    `asphalt_v${GROUND_TEX_VERSION}`,
    GROUND_TEX_SIZE,
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  asphaltTex.wrapU = Texture.WRAP_ADDRESSMODE;
  asphaltTex.wrapV = Texture.WRAP_ADDRESSMODE;
  asphaltTex.anisotropicFilteringLevel = 8;
  // тайлим текстуру так, чтобы один кафель ≈ 6 метров —
  // мелкое зерно щебня различимо вблизи и сливается вдали
  const tileMeters = 6;
  asphaltTex.uScale = ARENA_SIZE / tileMeters;
  asphaltTex.vScale = ARENA_SIZE / tileMeters;
  const ctx = asphaltTex.getContext() as CanvasRenderingContext2D;
  ctx.putImageData(paintAsphaltTexture(GROUND_TEX_SIZE), 0, 0);
  asphaltTex.update();
  groundMat.diffuseTexture = asphaltTex;
  groundMat.specularColor = new Color3(0.03, 0.03, 0.04);
  groundMat.specularPower = 32;
  ground.material = groundMat;

  const wallMat = new StandardMaterial("wallMat", scene);
  wallMat.diffuseColor = new Color3(0.22, 0.32, 0.42);
  wallMat.alpha = 0.35;
  wallMat.specularColor = Color3.Black();

  const h = 2;
  const t = 0.5;
  const specs: [number, number, number, number, number][] = [
    [ARENA_SIZE + t, h, t, 0, ARENA_HALF],
    [ARENA_SIZE + t, h, t, 0, -ARENA_HALF],
    [t, h, ARENA_SIZE + t, ARENA_HALF, 0],
    [t, h, ARENA_SIZE + t, -ARENA_HALF, 0],
  ];
  for (const [w, ht, d, x, z] of specs) {
    const wall = MeshBuilder.CreateBox("wall", { width: w, height: ht, depth: d }, scene);
    wall.position.set(x, ht / 2, z);
    wall.material = wallMat;
  }
}
