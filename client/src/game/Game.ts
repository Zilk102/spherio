import { Engine, Scene } from "@babylonjs/core";
import type { KillFeedEntry, MatchEndMessage, MatchResultsMessage } from "@spherio/shared";
import { SKID_MIN_SPEED } from "@spherio/shared";
import type { Room } from "colyseus.js";
import {
  attachRoomPing,
  clearReconnectToken,
  detachRoomPing,
  getPing,
  tickRoomPing,
} from "../net/colyseus.js";
import { pickLargestLocalPart } from "../lib/playerParts.js";
import { buildArena } from "./ArenaScene.js";
import { CameraController } from "./CameraController.js";
import { EntitySync } from "./EntitySync.js";
import { InputController } from "./InputController.js";
import { isTouchPrimaryDevice } from "../lib/touchDevice.js";
import {
  showSplitHint,
  showTargetBonusToast,
  updateHud,
  updateHudTarget,
  updateHudTimer,
} from "../ui/hud.js";
import { KillFeedUi } from "../ui/killfeed.js";
import { getChatUi } from "../ui/chat.js";
import { DeathOverlay } from "../ui/death.js";
import { MatchEndOverlay } from "../ui/matchEnd.js";
import { LocalPredictor } from "./LocalPredictor.js";
import { SkidMarkSystem } from "./SkidMarkSystem.js";
import { isLocalPart } from "../lib/playerParts.js";
import type { SplitResultMessage } from "@spherio/shared";
import { InputSender } from "../net/inputSender.js";
import { ServerClock } from "../net/serverClock.js";

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
  braking?: boolean;
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
  private spectating = false;
  private intentionalLeave = false;
  private menuOpen = false;
  private readonly killFeed = new KillFeedUi();
  private readonly death = new DeathOverlay();
  private readonly matchEnd = new MatchEndOverlay();
  private readonly predictor = new LocalPredictor();
  private skidMarks!: SkidMarkSystem;
  private hasPendingPatch = false;
  private latestPatchServerTime = 0;
  private readonly serverClock = new ServerClock();
  private readonly inputSender = new InputSender();

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });
    this.scene = new Scene(this.engine);
    const ground = buildArena(this.scene);
    this.camera = new CameraController(this.scene, canvas);
    this.entities = new EntitySync(this.scene);
    this.skidMarks = new SkidMarkSystem(this.scene, ground);
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
    attachRoomPing(room);
    this.localId = room.sessionId;
    this.playerName = playerName;
    this.serverClock.reset();
    this.hasPendingPatch = true;
    this.latestPatchServerTime = 0;
    this.inputSender.reset();
    getChatUi().bindRoom(room, playerName);
    room.onStateChange((state: ArenaState) => {
      this.lastState = state;
      const st = typeof state.serverTime === "number" ? state.serverTime : 0;
      if (st > 0) {
        this.serverClock.onServerTime(st);
        this.latestPatchServerTime = st;
      }
      this.hasPendingPatch = true;
    });
    room.onMessage("kill", (msg: KillFeedEntry) => {
      this.killFeed.push([msg]);
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
    room.onMessage("split_result", (msg: SplitResultMessage) => {
      if (!msg.ok && msg.reason && msg.reason !== "cooldown") {
        showSplitHint(msg.reason);
      }
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
        const axes = this.camera.getMoveAxes();
        const input = this.input.getInput(axes);
        if (!this.menuOpen && !this.matchEndVisible()) {
          this.predictor.setInputForSession(this.localId, input);
          this.inputSender.send(this.room, input, now);
          if (this.input.consumeSplit()) {
            this.inputSender.flush(this.room);
            this.room.send("split", { moveX: input.moveX, moveZ: input.moveZ });
          }
        }
        tickRoomPing(this.room, now);
        const state = this.lastState ?? this.room.state;
        if (state) {
          const ping = getPing(this.room);
          const players: PlayerSnap[] = [];
          state.players.forEach((p: PlayerSnap) => {
            players.push({
              id: p.id,
              x: p.x,
              y: p.y,
              z: p.z,
              vx: p.vx,
              vz: p.vz,
              qx: p.qx,
              qy: p.qy,
              qz: p.qz,
              qw: p.qw,
              radius: p.radius,
              color: p.color,
              skinId: p.skinId,
              name: p.name,
              invulnUntil: p.invulnUntil,
              targetId: p.targetId,
              targetExpiresAt: p.targetExpiresAt,
              braking: p.braking,
            });
          });

          const seen = new Set<string>();
          for (const p of players) {
            seen.add(p.id);
            if (isLocalPart(p.id, this.localId)) {
              this.predictor.ensurePart(p.id, p);
            }
          }
          this.predictor.prune(seen, this.localId);

          if (this.hasPendingPatch && this.latestPatchServerTime > 0) {
            for (const p of players) {
              if (isLocalPart(p.id, this.localId)) {
                this.predictor.reconcilePart(p.id, p);
              }
            }
            this.entities.ingestPlayersPatch(players, this.latestPatchServerTime);
            const pellets: {
              id: string;
              x: number;
              y: number;
              z: number;
              kind: number;
            }[] = [];
            for (let i = 0; i < state.pellets.length; i++) {
              const p = state.pellets[i];
              pellets.push({
                id: p.id,
                x: p.x,
                y: p.y,
                z: p.z,
                kind: typeof p.kind === "number" ? p.kind : 0,
              });
            }
            this.entities.syncPellets(pellets);
            this.hasPendingPatch = false;
          }

          this.predictor.simulate(dtSec);

          const hedgehogs: {
            id: string;
            x: number;
            y: number;
            z: number;
            radius: number;
            qx: number;
            qy: number;
            qz: number;
            qw: number;
          }[] = [];
          const hh = state.hedgehogs;
          if (hh) {
            for (let i = 0; i < hh.length; i++) {
              const h = hh[i];
              hedgehogs.push({
                id: h.id,
                x: h.x,
                y: h.y,
                z: h.z,
                radius: typeof h.radius === "number" ? h.radius : 1.05,
                qx: h.qx,
                qy: h.qy,
                qz: h.qz,
                qw: h.qw,
              });
            }
          }
          this.entities.syncHedgehogs(hedgehogs);

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
            this.serverClock.estimateNow(),
            dtSec,
            this.predictor,
            ping,
          );

          const localBrake = !this.menuOpen && this.input.brake;
          this.skidMarks.update(
            players.map((p) => {
              const pos = this.entities.getDisplayPosition(p.id);
              const isLocal = isLocalPart(p.id, this.localId);
              const predVel = isLocal ? this.predictor.getVelocity(p.id) : null;
              const vx = predVel?.vx ?? p.vx;
              const vz = predVel?.vz ?? p.vz;
              const speed = Math.hypot(vx, vz);
              const braking =
                speed >= SKID_MIN_SPEED &&
                (isLocal ? localBrake : !!p.braking);
              return {
                id: p.id,
                x: pos?.x ?? p.x,
                z: pos?.z ?? p.z,
                vx,
                vz,
                radius: p.radius,
                braking,
                color: p.color,
                skinId: p.skinId,
              };
            }),
            now,
          );

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
            ping,
          );

          updateHudTimer({
            matchEndsAt: typeof state.matchEndsAt === "number" ? state.matchEndsAt : 0,
            matchPhase: typeof state.matchPhase === "string" ? state.matchPhase : "running",
            isPrivate: !!state.isPrivate,
          });

          // Цель локального игрока + 3D-индикатор и HUD-строка.
          const localTargetId = me?.targetId ?? "";
          const localTargetExpires = me?.targetExpiresAt ?? 0;
          const targetSnap =
            localTargetId && !isLocalPart(localTargetId, this.localId)
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
    detachRoomPing(this.room);
    this.engine.stopRenderLoop();
    this.killFeed.clear();
    this.matchEnd.hide();
    this.death.hide();
    this.entities.dispose();
    this.skidMarks.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
