import { HowToPlayHedgehogPreview } from "../game/HowToPlayHedgehogPreview.js";

const STORAGE_KEY = "sphere3d_howtoplay_hidden";

export class HowToPlayOverlay {
  private readonly el: HTMLElement;
  private hedgePreview: HowToPlayHedgehogPreview | null = null;
  private onDismiss: (() => void) | null = null;

  constructor(id = "how-to-play") {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not found`);
    this.el = el;
    document.getElementById("how-to-play-ok")?.addEventListener("click", () => this.hide());
  }

  shouldShow(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  }

  tryShow(onDismiss?: () => void): boolean {
    if (!this.shouldShow()) return false;
    this.onDismiss = onDismiss ?? null;
    this.el.classList.remove("hidden");
    this.el.setAttribute("aria-hidden", "false");

    const canvas = document.getElementById("how-to-play-hedge-canvas") as HTMLCanvasElement | null;
    if (canvas) {
      this.hedgePreview?.dispose();
      this.hedgePreview = new HowToPlayHedgehogPreview(canvas);
      this.hedgePreview.start();
    }
    return true;
  }

  hide(): void {
    const never = document.getElementById("how-to-play-never") as HTMLInputElement | null;
    if (never?.checked) localStorage.setItem(STORAGE_KEY, "1");

    this.el.classList.add("hidden");
    this.el.setAttribute("aria-hidden", "true");
    if (never) never.checked = false;

    this.hedgePreview?.dispose();
    this.hedgePreview = null;

    const cb = this.onDismiss;
    this.onDismiss = null;
    cb?.();
  }

  hideIfVisible(): void {
    if (this.el.classList.contains("hidden")) return;
    this.hide();
  }
}

let instance: HowToPlayOverlay | null = null;

export function getHowToPlayOverlay(): HowToPlayOverlay {
  if (!instance) instance = new HowToPlayOverlay();
  return instance;
}
