import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  Vector3,
  type Scene as BabylonScene,
} from "@babylonjs/core";
import { createHedgehogMesh } from "./hedgehogMesh.js";

/** Только ёж для блока «Избегай». */
export class HowToPlayHedgehogPreview {
  private engine: Engine | null = null;
  private scene: BabylonScene | null = null;
  private running = false;
  private readonly onResize = () => this.engine?.resize();

  constructor(private canvas: HTMLCanvasElement) {}

  start(): void {
    this.engine = new Engine(this.canvas, true, {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
    });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);

    const cam = new ArcRotateCamera(
      "htpHedgeCam",
      -Math.PI / 2,
      1.05,
      3.4,
      new Vector3(0, 0.05, 0),
      this.scene,
    );
    cam.fov = 0.55;
    cam.lowerRadiusLimit = 3.4;
    cam.upperRadiusLimit = 3.4;
    cam.inputs.clear();

    const hemi = new HemisphericLight("htpHemi", new Vector3(0.1, 1, 0.2), this.scene);
    hemi.intensity = 0.75;
    hemi.diffuse = new Color3(0.95, 0.97, 1);

    const key = new DirectionalLight("htpKey", new Vector3(-0.35, -0.7, -0.45), this.scene);
    key.intensity = 1.15;

    const hedge = createHedgehogMesh(this.scene, "htpHedge", 1.1);
    hedge.position.y = 0.1;

    window.addEventListener("resize", this.onResize);
    this.onResize();

    this.running = true;
    this.engine.runRenderLoop(() => {
      if (!this.running || !this.scene) return;
      hedge.rotation.y += 0.012;
      this.scene.render();
    });
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener("resize", this.onResize);
    this.engine?.stopRenderLoop();
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
  }
}
