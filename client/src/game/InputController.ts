import type { InputMessage } from "@spherio/shared";
import { isChatCapturing } from "../lib/chatFocus.js";
import type { CameraMoveAxes } from "./CameraController.js";
import { VirtualJoystick } from "./VirtualJoystick.js";

export class InputController {
  private keys = new Set<string>();
  brake = false;
  boost = false;
  private joystick: VirtualJoystick | null = null;
  private readonly touchUi: boolean;

  constructor(touchUi: boolean) {
    this.touchUi = touchUi;
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => this.reset());

    this.bindButton("btn-brake", () => (this.brake = true), () => (this.brake = false));
    this.bindButton("btn-boost", () => (this.boost = true), () => (this.boost = false));

    if (touchUi) {
      try {
        this.joystick = new VirtualJoystick("joystick-zone", "joystick-knob");
      } catch {
        this.joystick = null;
      }
    }
  }

  private bindButton(
    id: string,
    onDown: () => void,
    onUp: () => void,
  ): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onDown();
    });
    const up = () => onUp();
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("pointercancel", up);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (isChatCapturing()) return;

    const codes = [
      "KeyW", "KeyA", "KeyS", "KeyD",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "Space", "ShiftLeft", "ShiftRight",
    ];
    if (codes.includes(e.code)) e.preventDefault();

    if (e.code === "Space") {
      this.brake = down;
      return;
    }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      this.boost = down;
      return;
    }
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  }

  reset(): void {
    this.keys.clear();
    this.brake = false;
    this.boost = false;
    this.joystick?.reset();
  }

  getInput(axes: CameraMoveAxes): InputMessage {
    let moveX = 0;
    let moveZ = 0;

    const forward = this.keys.has("KeyW") || this.keys.has("ArrowUp");
    const backward = this.keys.has("KeyS") || this.keys.has("ArrowDown");
    const left = this.keys.has("KeyA") || this.keys.has("ArrowLeft");
    const right = this.keys.has("KeyD") || this.keys.has("ArrowRight");

    if (forward) {
      moveX += axes.forwardX;
      moveZ += axes.forwardZ;
    }
    if (backward) {
      moveX -= axes.forwardX;
      moveZ -= axes.forwardZ;
    }
    if (right) {
      moveX += axes.rightX;
      moveZ += axes.rightZ;
    }
    if (left) {
      moveX -= axes.rightX;
      moveZ -= axes.rightZ;
    }

    if (this.joystick) {
      const jx = this.joystick.x;
      const jz = this.joystick.z;
      moveX += axes.rightX * jx + axes.forwardX * -jz;
      moveZ += axes.rightZ * jx + axes.forwardZ * -jz;
    }

    const len = Math.hypot(moveX, moveZ);
    if (len > 1) {
      moveX /= len;
      moveZ /= len;
    }

    return {
      moveX,
      moveZ,
      brake: this.brake,
      boost: this.boost,
    };
  }
}
