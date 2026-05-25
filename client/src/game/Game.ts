import { Engine, Scene } from "@babylonjs/core";
import type { KillFeedEntry, MatchEndMessage, MatchResultsMessage } from "@spherio/shared";
import type { Room } from "colyseus.js";
import { clearReconnectToken, getPing } from "../net/colyseus.js";
import { pickLargestLocalPart } from "../lib/playerParts.js";
import { buildArena } from "./ArenaScene.js";
import { CameraController } from "./CameraController.js";
import { EntitySync } from "./EntitySync.js";
import { InputController } from "./InputController.js";
import { isTouchPrimaryDevice } from "../lib/touchDevice.js";
import { showTargetBonusToast, updateHud, updateHudTarget, updateHudTimer } from "../ui/hud.js";
import { KillFeedUi } from "../ui/killfeed.js";
import { getChatUi } from "../ui/chat.js";
import { DeathOverlay } from "../ui/death.js";
import { MatchEndOverlay } from "../ui/matchEnd.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ArenaState = any;

type PlayerSnap = {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  radius: number;
  color: number;
  skinId: string;
  name: string;
  invulnUntil: number;
  targetId: string;
  targetExpiresAt: number;
};

interface TargetBonusMessage {
  victimName: string;
  mult: number;
}

export interface GameLeaveDetail {
  matchEnd?: MatchEndMessage;
  /** Если true — пользователь хочет сразу попасть в новый публичный матч. */
  restartPublic?: boolean;
}

export class Game {
  private engine: Engine;
  private scene: Scene;
  private camera: CameraController;
  private entities: EntitySync;
  private input = new InputController(isTouchPrimaryDevice());
  private room: Room | null = null;
  private localId: string | null = null;
  private playerName = "Игрок";
  private lastState: ArenaState | null = null;
  private hadLocalPart = false;
  private killFeedSeen = 0;
  private spectating = false;
  private intentionalLeave = false;
  private menuOpen = false;
  private readonly killFeed = new KillFeedUi();
  private readonly death = new DeathOverlay();
  private readonly matchEnd = new MatchEndOverlay();

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });
    this.scene = new Scene(this.engine);
    buildArena(this.scene);
    this.camera = new CameraController(this.scene, canvas);
    this.entities = new EntitySync(this.scene);
  }

  async connect(room: Room, playerName: string): Promise<void> {
    this.intentionalLeave = false;
    this.matchEnd.hide();
    this.matchEnd.setHandlers({
      onMenu: () => window.dispatchEvent(new CustomEvent("sphere3d:leave-game")),
      onRestartPublic: () =>
        window.dispatchEvent(
          new CustomEvent<GameLeaveDetail>("sphere3d:leave-game", {
            detail: { restartPublic: true },
          }),
        ),
    });
    this.room = room;
    this.localId = room.sessionId;
    this.playerName = playerName;
    getChatUi().bindRoom(room, playerName);
    room.onStateChange((state: ArenaState) => {
      this.lastState = state;
    });
    room.onMessage("match_end", (msg: MatchEndMessage) => {
      if (this.intentionalLeave || !document.body.classList.contains("in-game")) {
        return;
      }
      this.matchEnd.show(msg);
      this.death.hide();
      window.dispatchEvent(
        new CustomEvent<GameLeaveDetail>("sphere3d:match-end", { detail: { matchEnd: msg } }),
      );
    });
    room.onMessage("target_bonus", (msg: TargetBonusMessage) => {
      showTargetBonusToast(msg);
    });
    room.onMessage("match_results", (msg: MatchResultsMessage & { you?: string }) => {
      if (this.intentionalLeave || !document.body.classList.contains("in-game")) {
        return;
      }
      this.matchEnd.showResults(msg);
      this.death.hide();
      window.dispatchEvent(
        new CustomEvent<GameLeaveDetail>("sphere3d:match-end", { detail: {} }),
      );
    });
    room.onLeave((code) => {
      if (code === 1000) clearReconnectToken();
    });
  }

  setMenuOpen(open: boolean): void {
    this.menuOpen = open;
  }

  startLoop(): void {
    this.engine.runRenderLoop(() => {
      const now = Date.now();
      const dtSec = this.engine.getDeltaTime() / 1000;
      if (this.room) {
        if (!this.menuOpen && !this.matchEndVisible()) {
          this.room.send("input", this.input.getInput(this.camera.getMoveAxes()));
        }
        const state = this.lastState ?? this.room.state;
        if (state) {
          const players: PlayerSnap[] = [];
          state.players.forEach((p: PlayerSnap) => {
            players.push({ ...p });
          });

          const pellets: { id: string; x: number; y: number; z: number }[] = [];
          for (let i = 0; i < state.pellets.length; i++) {
            const p = state.pellets[i];
            pellets.push({ id: p.id, x: p.x, y: p.y, z: p.z });
          }

          const me = pickLargestLocalPart(players, this.localId);
          const hasLocal = !!me;
          if (this.hadLocalPart && !hasLocal && !this.matchEndVisible()) {
            this.death.show("Вас съели — наблюдайте или ждите респавн");
            this.spectating = true;
          } else if (hasLocal) {
            this.death.hide();
            this.spectating = false;
          }
          this.hadLocalPart = hasLocal || this.hadLocalPart;

          const local = this.entities.syncPlayers(
            players,
            this.localId,
            now,
            dtSec,
          );
          this.entities.syncPellets(pellets);

          let camTarget = local;
          let camRadius = me?.radius ?? 0.5;
          if (!hasLocal && this.spectating) {
            const biggest = [...players].sort((a, b) => b.radius - a.radius)[0];
            if (biggest) {
              camTarget = this.entities.getMesh(biggest.id) ?? null;
              camRadius = biggest.radius;
            }
          }
          this.camera.follow(camTarget, camRadius, hasLocal && !this.spectating);

          const feed: KillFeedEntry[] = [];
          for (let i = 0; i < state.killFeed.length; i++) {
            const e = state.killFeed[i];
            feed.push({
              killerName: e.killerName,
              victimName: e.victimName,
              at: e.at,
            });
          }
          if (feed.length > this.killFeedSeen) {
            this.killFeed.push(feed.slice(this.killFeedSeen));
            this.killFeedSeen = feed.length;
          }

          updateHud(
            me
              ? {
                  name: me.name,
                  radius: me.radius,
                  vx: me.vx,
                  vz: me.vz,
                }
              : undefined,
            players.map((p) => ({
              name: p.name,
              radius: p.radius,
              vx: p.vx,
              vz: p.vz,
            })),
            this.room ? getPing(this.room) : 0,
          );

          updateHudTimer({
            matchEndsAt: typeof state.matchEndsAt === "number" ? state.matchEndsAt : 0,
            matchPhase: typeof state.matchPhase === "string" ? state.matchPhase : "running",
            isPrivate: !!state.isPrivate,
          });

          // Цель локального игрока + 3D-индикатор и HUD-строка.
          const localTargetId = me?.targetId ?? "";
          const localTargetExpires = me?.targetExpiresAt ?? 0;
          const targetSnap = localTargetId
            ? players.find((p) => p.id === localTargetId)
            : undefined;
          this.entities.updateTargetIndicator(
            targetSnap ? targetSnap.id : null,
            now,
            this.localId,
          );
          updateHudTarget(
            targetSnap
              ? {
                  name: targetSnap.name,
                  radius: targetSnap.radius,
                  myRadius: me?.radius ?? 0,
                  expiresAt: localTargetExpires,
                  now,
                }
              : null,
          );
        }
      }
      this.scene.render();
    });
    window.addEventListener("resize", () => this.engine.resize());
  }

  private matchEndVisible(): boolean {
    return !document.getElementById("match-end")?.classList.contains("hidden");
  }

  async leave(): Promise<void> {
    this.intentionalLeave = true;
    this.menuOpen = false;
    this.matchEnd.hide();
    getChatUi().unbindRoom();
    clearReconnectToken();
    const room = this.room;
    this.room = null;
    this.dispose();
    if (room) {
      try {
        await room.leave(true);
      } catch {
        /* уже отключён */
      }
    }
  }

  dispose(): void {
    this.engine.stopRenderLoop();
    this.killFeed.clear();
    this.matchEnd.hide();
    this.death.hide();
    this.entities.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
