import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { attachSkinDecal, getSphereBaseMaterial } from "./skinTextures.js";

const INITIAL_ALPHA = Math.PI / 2;
const INITIAL_BETA = 1.15;
const INITIAL_RADIUS = 3.35;

export class SkinPreview3D {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private sphere: Mesh | null = null;
  private decal: Mesh | null = null;
  private camera: ArcRotateCamera | null = null;
  private matKey = "";
  private running = false;
  private readonly onResize = () => this.engine?.resize();

  constructor(private canvas: HTMLCanvasElement) {}

  start(): void {
    if (!this.engine) {
      this.engine = new Engine(this.canvas, true, {
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      this.scene = new Scene(this.engine);
      this.scene.clearColor = new Color4(0, 0, 0, 0);

      const camera = new ArcRotateCamera(
        "skinPreviewCam",
        INITIAL_ALPHA,
        INITIAL_BETA,
        INITIAL_RADIUS,
        new Vector3(0, 0.05, 0),
        this.scene,
      );
      camera.fov = 0.55;
      camera.minZ = 0.1;
      camera.maxZ = 100;
      camera.lowerRadiusLimit = INITIAL_RADIUS;
      camera.upperRadiusLimit = INITIAL_RADIUS;
      camera.lowerBetaLimit = 0.25;
      camera.upperBetaLimit = Math.PI - 0.25;
      camera.wheelPrecision = 1000;
      camera.panningSensibility = 0;
      camera.angularSensibilityX = 250;
      camera.angularSensibilityY = 250;
      camera.inertia = 0.78;
      camera.attachControl(this.canvas, true);
      this.camera = camera;

      const hemi = new HemisphericLight(
        "skinPreviewHemi",
        new Vector3(0.2, 1, 0.4),
        this.scene,
      );
      hemi.intensity = 0.65;
      hemi.groundColor = new Color3(0.1, 0.14, 0.18);
      hemi.diffuse = new Color3(0.9, 0.94, 1);

      const key = new DirectionalLight("skinPreviewKey", new Vector3(-0.35, -0.8, -0.45), this.scene);
      key.intensity = 1.1;
      key.diffuse = new Color3(1, 0.98, 0.94);

      const rim = new DirectionalLight("skinPreviewRim", new Vector3(0.6, -0.2, 0.8), this.scene);
      rim.intensity = 0.45;
      rim.diffuse = new Color3(0.6, 0.85, 1);

      const disc = MeshBuilder.CreateDisc(
        "skinPreviewDisc",
        { radius: 0.95, tessellation: 64 },
        this.scene,
      );
      disc.rotation.x = Math.PI / 2;
      disc.position.y = -0.62;
      const discMat = new StandardMaterial("skinPreviewDiscMat", this.scene);
      discMat.diffuseColor = new Color3(0.14, 0.22, 0.18);
      discMat.specularColor = new Color3(0.04, 0.04, 0.04);
      discMat.alpha = 0.85;
      disc.material = discMat;

      this.sphere = MeshBuilder.CreateSphere(
        "skinPreviewSphere",
        { diameter: 1, segments: 48 },
        this.scene,
      );
      this.sphere.position.y = 0.05;
      this.sphere.scaling.setAll(1.15);

      this.canvas.style.touchAction = "none";

      window.addEventListener("resize", this.onResize);
      this.onResize();
    }

    this.running = true;
    requestAnimationFrame(() => this.onResize());
    if (this.engine && !this.engine.isDisposed) {
      this.engine.stopRenderLoop();
      this.engine.runRenderLoop(() => {
        if (!this.running || !this.scene) return;
        this.scene.render();
      });
    }
  }

  stop(): void {
    this.running = false;
    this.engine?.stopRenderLoop();
  }

  /** Возврат камеры к фронтальному виду (эмодзи/узор смотрят в кадр) */
  resetView(): void {
    if (!this.camera) return;
    this.camera.alpha = INITIAL_ALPHA;
    this.camera.beta = INITIAL_BETA;
    this.camera.radius = INITIAL_RADIUS;
  }

  setSkin(skinId: string, color: number): void {
    if (!this.scene || !this.sphere) return;
    const key = `${skinId}_${color & 0xffffff}`;
    if (key === this.matKey) return;
    const prevSkin = this.matKey.split("_")[0];
    this.matKey = key;
    this.sphere.material = getSphereBaseMaterial(this.scene, skinId, color);
    if (prevSkin !== skinId.split("_")[0] || prevSkin !== skinId) {
      this.decal?.dispose();
      this.decal = attachSkinDecal(this.scene, this.sphere, skinId);
    }
    this.resetView();
  }

  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    this.camera?.detachControl();
    this.decal?.dispose();
    this.sphere?.dispose();
    this.scene?.dispose();
    this.engine?.dispose();
    this.decal = null;
    this.sphere = null;
    this.scene = null;
    this.engine = null;
    this.camera = null;
  }
}
