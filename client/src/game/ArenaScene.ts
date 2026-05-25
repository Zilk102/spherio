import {
  Color3,
  Color4,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { ARENA_HALF, ARENA_SIZE } from "@spherio/shared";

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
  groundMat.diffuseColor = new Color3(0.2, 0.32, 0.26);
  groundMat.specularColor = new Color3(0.02, 0.02, 0.02);
  groundMat.specularPower = 4;
  ground.material = groundMat;

  const grid = MeshBuilder.CreateGround(
    "grid",
    { width: ARENA_SIZE, height: ARENA_SIZE, subdivisions: 24 },
    scene,
  );
  const gridMat = new StandardMaterial("gridMat", scene);
  gridMat.wireframe = true;
  gridMat.alpha = 0.12;
  gridMat.diffuseColor = new Color3(0.45, 0.7, 0.55);
  gridMat.specularColor = Color3.Black();
  grid.material = gridMat;
  grid.position.y = 0.01;

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
