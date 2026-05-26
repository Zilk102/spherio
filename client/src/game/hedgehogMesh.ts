import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { HEDGEHOG_RADIUS_MAX } from "@spherio/shared";

const SPIKE_COUNT = 80;
const BODY_COLOR = new Color3(0.38, 0.39, 0.42);
const SPIKE_COLOR = new Color3(0.32, 0.33, 0.36);

/**
 * Шар-ёж как на референсе: плотные короткие конические шипы, матовый серый.
 */
export function createHedgehogMesh(
  scene: Scene,
  id: string,
  radius: number,
): TransformNode {
  const root = new TransformNode(`hedgehog_${id}`, scene);
  const scale = radius / HEDGEHOG_RADIUS_MAX;

  const core = MeshBuilder.CreateIcoSphere(
    `hedgehog_core_${id}`,
    { radius: radius * 0.72, subdivisions: 2 },
    scene,
  );
  const coreMat = new StandardMaterial(`hedgehog_core_mat_${id}`, scene);
  coreMat.diffuseColor = BODY_COLOR;
  coreMat.emissiveColor = new Color3(0.04, 0.04, 0.045);
  coreMat.specularColor = new Color3(0.06, 0.06, 0.07);
  coreMat.specularPower = 12;
  core.material = coreMat;
  core.parent = root;

  const spikeMeshes: Mesh[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < SPIKE_COUNT; i++) {
    const spike = MeshBuilder.CreateCylinder(
      `hedgehog_spike_${id}_${i}`,
      {
        diameterTop: 0.02 * scale,
        diameterBottom: 0.11 * scale,
        height: 0.22 * scale,
        tessellation: 7,
      },
      scene,
    );

    const phi = Math.acos(1 - (2 * (i + 0.5)) / SPIKE_COUNT);
    const theta = golden * i;
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);

    const baseR = radius * 0.68;
    const tipR = radius * 1.02;
    spike.position.set(nx * baseR, ny * baseR, nz * baseR);

    const dir = new Vector3(nx, ny, nz);
    const quat = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, quat);
    spike.rotationQuaternion = quat;
    spike.parent = root;
    spikeMeshes.push(spike);
  }

  if (spikeMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(spikeMeshes, true, true, undefined, false, true);
    if (merged) {
      merged.name = `hedgehog_spikes_${id}`;
      merged.parent = root;
      const spikeMat = new StandardMaterial(`hedgehog_spike_mat_${id}`, scene);
      spikeMat.diffuseColor = SPIKE_COLOR;
      spikeMat.emissiveColor = new Color3(0.03, 0.03, 0.035);
      spikeMat.specularColor = new Color3(0.05, 0.05, 0.06);
      spikeMat.specularPower = 16;
      merged.material = spikeMat;
      for (const s of spikeMeshes) s.dispose();
    }
  }

  return root;
}
