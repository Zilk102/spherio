import type { InputMessage } from "@spherio/shared";

export class InputController {
  private keys = new Set<string>();
  brake = false;

  constructor() {
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.brake = false;
    });
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.code;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) {
      e.preventDefault();
    }
    if (k === "Space") {
      this.brake = down;
      return;
    }
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  }

  getInput(): InputMessage {
    let moveX = 0;
    let moveZ = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) moveX -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) moveX += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) moveZ -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) moveZ += 1;
    return { moveX, moveZ, brake: this.brake };
  }
}
