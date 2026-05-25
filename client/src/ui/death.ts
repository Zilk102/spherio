export class DeathOverlay {
  private el: HTMLElement;
  private visible = false;

  constructor(id = "death-overlay") {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not found`);
    this.el = el;
  }

  show(message = "Вас съели! Респавн…"): void {
    if (this.visible) return;
    this.visible = true;
    this.el.classList.remove("hidden");
    const msg = this.el.querySelector(".death-msg");
    if (msg) msg.textContent = message;
  }

  hide(): void {
    this.visible = false;
    this.el.classList.add("hidden");
  }
}
