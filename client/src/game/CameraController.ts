import {
  ArcRotateCamera,
  Scene,
  Vector3,
  type AbstractMesh,
} from "@babylonjs/core";
import { ARENA_HALF } from "@spherio/shared";

export class CameraController {
  private camera: ArcRotateCamera;
  private target = Vector3.Zero();
  private smooth = Vector3.Zero();

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.camera = new ArcRotateCamera(
      "cam",
      -Math.PI / 2,
      Math.PI / 3.2,
      18,
      Vector3.Zero(),
      scene,
    );
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 6;
    this.camera.upperRadiusLimit = 80;
    this.camera.wheelPrecision = 0.4;
    this.camera.panningSensibility = 0;
  }

  follow(node: AbstractMesh | null, radius: number): void {
    if (!node) return;
    const p = node.position;
    this.target.set(p.x, p.y, p.z);
    this.smooth.scaleInPlace(0.88);
    this.smooth.addInPlace(this.target.scale(0.12));
    this.camera.setTarget(this.smooth);
    const dist = 10 + radius * 3.5;
    this.camera.radius += (dist - this.camera.radius) * 0.06;
    const limit = ARENA_HALF + 10;
    this.camera.target.x = Math.max(-limit, Math.min(limit, this.camera.target.x));
    this.camera.target.z = Math.max(-limit, Math.min(limit, this.camera.target.z));
  }
}
