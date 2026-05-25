import { Engine, Scene } from "@babylonjs/core";
import type { Room } from "colyseus.js";
import { getPing } from "../net/colyseus.js";
import { buildArena } from "./ArenaScene.js";
import { CameraController } from "./CameraController.js";
import { EntitySync } from "./EntitySync.js";
import { InputController } from "./InputController.js";
import { updateHud } from "../ui/hud.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ArenaState = any;

export class Game {
  private engine: Engine;
  private scene: Scene;
  private camera: CameraController;
  private entities: EntitySync;
  private input = new InputController();
  private room: Room | null = null;
  private localId: string | null = null;
  private inputTimer = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    this.scene = new Scene(this.engine);
    buildArena(this.scene);
    this.camera = new CameraController(this.scene, canvas);
    this.entities = new EntitySync(this.scene);
  }

  async connect(room: Room): Promise<void> {
    this.room = room;
    this.localId = room.sessionId;
    room.onStateChange((state: ArenaState) => {
      this.lastState = state;
    });
  }

  private lastState: ArenaState | null = null;

  startLoop(): void {
    this.engine.runRenderLoop(() => {
      const now = Date.now();
      if (this.room) {
        this.inputTimer += this.engine.getDeltaTime();
        if (this.inputTimer > 33) {
          this.inputTimer = 0;
          this.room.send("input", this.input.getInput());
        }
        const state = this.lastState ?? this.room.state;
        if (state) {
          const players: {
            id: string;
            x: number;
            y: number;
            z: number;
            qx: number;
            qy: number;
            qz: number;
            qw: number;
            radius: number;
            color: number;
            name: string;
            invulnUntil: number;
          }[] = [];
          state.players.forEach((p: ArenaState) => {
            players.push({
              id: p.id,
              x: p.x,
              y: p.y,
              z: p.z,
              qx: p.qx,
              qy: p.qy,
              qz: p.qz,
              qw: p.qw,
              radius: p.radius,
              color: p.color,
              name: p.name,
              invulnUntil: p.invulnUntil,
            });
          });
          const pellets: { id: string; x: number; y: number; z: number }[] = [];
          for (let i = 0; i < state.pellets.length; i++) {
            const p = state.pellets[i];
            pellets.push({ id: p.id, x: p.x, y: p.y, z: p.z });
          }
          const local = this.entities.syncPlayers(players, this.localId, now);
          this.entities.syncPellets(pellets);
          this.camera.follow(local, local?.scaling.x ? local.scaling.x / 2 : 0.5);
          const me = players.find((p) => p.id === this.localId);
          updateHud(me, players, this.room ? getPing(this.room) : 0);
        }
      }
      this.scene.render();
    });
    window.addEventListener("resize", () => this.engine.resize());
  }

  dispose(): void {
    this.engine.stopRenderLoop();
    this.entities.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
