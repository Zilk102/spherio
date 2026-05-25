import { ArcRotateCamera, Scene, Vector3, type AbstractMesh } from "@babylonjs/core";
import { ARENA_HALF, MIN_RADIUS, cameraRadiusForPlayer } from "@spherio/shared";

const FIXED_ALPHA = -Math.PI / 4;
const FIXED_BETA = 1.05;

export interface CameraMoveAxes {
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
}

export class CameraController {
  private camera: ArcRotateCamera;
  private smooth = Vector3.Zero();
  private smoothRadius = cameraRadiusForPlayer(MIN_RADIUS);
  private axes: CameraMoveAxes = { forwardX: 0, forwardZ: 1, rightX: 1, rightZ: 0 };

  constructor(scene: Scene, _canvas: HTMLCanvasElement) {
    this.smoothRadius = cameraRadiusForPlayer(MIN_RADIUS);
    this.camera = new ArcRotateCamera(
      "cam",
      FIXED_ALPHA,
      FIXED_BETA,
      this.smoothRadius,
      Vector3.Zero(),
      scene,
    );
    this.camera.inputs.clear();
    this.updateAxes();
  }

  getMoveAxes(): CameraMoveAxes {
    return this.axes;
  }

  getZoomRadius(): number {
    return this.smoothRadius;
  }

  private updateAxes(): void {
    const pos = this.camera.position;
    const tgt = this.camera.target;
    // W/↑ = вверх экрана (луч от цели к камере)
    let fx = tgt.x - pos.x;
    let fz = tgt.z - pos.z;
    const len = Math.hypot(fx, fz);
    if (len < 1e-5) {
      fx = 0;
      fz = 1;
    } else {
      fx /= len;
      fz /= len;
    }
    this.axes = {
      forwardX: fx,
      forwardZ: fz,
      rightX: fz,
      rightZ: -fx,
    };
  }

  follow(
    node: AbstractMesh | null,
    playerRadius = MIN_RADIUS,
    snapTarget = false,
  ): void {
    const r = Number.isFinite(playerRadius) && playerRadius > 0
      ? playerRadius
      : MIN_RADIUS;
    const targetZoom = cameraRadiusForPlayer(r);

    if (!node) {
      this.smoothRadius += (targetZoom - this.smoothRadius) * 0.08;
      this.camera.radius = this.smoothRadius;
      this.updateAxes();
      return;
    }

    const p = node.position;
    const dt = this.camera.getScene().getEngine().getDeltaTime() / 1000;
    const followRate = snapTarget ? 28 : 14;
    const t = 1 - Math.exp(-followRate * dt);
    const zoomT = 1 - Math.exp(-6 * dt);

    this.smooth.x += (p.x - this.smooth.x) * t;
    this.smooth.y += (p.y - this.smooth.y) * t;
    this.smooth.z += (p.z - this.smooth.z) * t;

    this.smoothRadius += (targetZoom - this.smoothRadius) * zoomT;

    this.camera.setTarget(this.smooth);
    this.camera.alpha = FIXED_ALPHA;
    this.camera.beta = FIXED_BETA;
    this.camera.radius = this.smoothRadius;
    this.updateAxes();

    const limit = ARENA_HALF + 6;
    this.camera.target.x = Math.max(-limit, Math.min(limit, this.camera.target.x));
    this.camera.target.z = Math.max(-limit, Math.min(limit, this.camera.target.z));
  }
}
