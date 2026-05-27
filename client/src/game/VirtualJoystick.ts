/** Виртуальный джойстик (touch + mouse) для мобильных. */
export class VirtualJoystick {
  private zone: HTMLElement;
  private knob: HTMLElement;
  private active = false;
  private pointerId = -1;
  private centerX = 0;
  private centerY = 0;
  private maxRadius = 48;
  x = 0;
  z = 0;

  constructor(zoneId: string, knobId: string) {
    const zone = document.getElementById(zoneId);
    const knob = document.getElementById(knobId);
    if (!zone || !knob) throw new Error("Joystick elements not found");
    this.zone = zone;
    this.knob = knob;
    this.syncRadius();
    const ro = new ResizeObserver(() => this.syncRadius());
    ro.observe(zone);

    this.zone.addEventListener("pointerdown", (e) => this.onDown(e));
    this.zone.addEventListener("pointermove", (e) => this.onMove(e));
    this.zone.addEventListener("pointerup", (e) => this.onUp(e));
    this.zone.addEventListener("pointercancel", (e) => this.onUp(e));
  }

  private syncRadius(): void {
    const size = Math.min(this.zone.clientWidth, this.zone.clientHeight);
    this.maxRadius = Math.max(36, size * 0.38);
  }

  private onDown(e: PointerEvent): void {
    if (this.active) return;
    this.syncRadius();
    this.active = true;
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);
    const rect = this.zone.getBoundingClientRect();
    this.centerX = rect.left + rect.width / 2;
    this.centerY = rect.top + rect.height / 2;
    this.update(e.clientX, e.clientY);
  }

  private onMove(e: PointerEvent): void {
    if (!this.active || e.pointerId !== this.pointerId) return;
    this.update(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = -1;
    this.x = 0;
    this.z = 0;
    this.knob.style.transform = "translate(-50%, -50%)";
    try {
      this.zone.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private update(clientX: number, clientY: number): void {
    let dx = clientX - this.centerX;
    let dy = clientY - this.centerY;
    const len = Math.hypot(dx, dy);
    if (len > this.maxRadius) {
      dx = (dx / len) * this.maxRadius;
      dy = (dy / len) * this.maxRadius;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    const nx = dx / this.maxRadius;
    const ny = dy / this.maxRadius;
    this.x = nx;
    this.z = ny;
  }

  reset(): void {
    this.active = false;
    this.x = 0;
    this.z = 0;
    this.knob.style.transform = "translate(-50%, -50%)";
  }
}
