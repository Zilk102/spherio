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
  scene.clearColor = new Color4(0.04, 0.07, 0.12, 1);

  const light = new HemisphericLight("sun", new Vector3(0.3, 1, 0.2), scene);
  light.intensity = 1.1;
  light.groundColor = new Color3(0.15, 0.2, 0.28);

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: ARENA_SIZE, height: ARENA_SIZE },
    scene,
  );
  const gMat = new StandardMaterial("groundMat", scene);
  gMat.diffuseColor = new Color3(0.12, 0.22, 0.18);
  gMat.specularColor = new Color3(0.05, 0.08, 0.06);
  ground.material = gMat;
  ground.receiveShadows = true;

  const grid = MeshBuilder.CreateGround(
    "grid",
    { width: ARENA_SIZE, height: ARENA_SIZE, subdivisions: 20 },
    scene,
  );
  const gridMat = new StandardMaterial("gridMat", scene);
  gridMat.wireframe = true;
  gridMat.alpha = 0.15;
  gridMat.diffuseColor = new Color3(0.3, 0.55, 0.45);
  grid.material = gridMat;
  grid.position.y = 0.02;

  const wallMat = new StandardMaterial("wallMat", scene);
  wallMat.diffuseColor = new Color3(0.2, 0.35, 0.5);
  wallMat.alpha = 0.35;

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
