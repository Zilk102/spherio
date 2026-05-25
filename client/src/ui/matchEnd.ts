import type { MatchEndMessage } from "@spherio/shared";

export class MatchEndOverlay {
  private el: HTMLElement;
  private visible = false;

  constructor(id = "match-end") {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not found`);
    this.el = el;
    document.getElementById("match-end-menu")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("sphere3d:leave-game"));
    });
  }

  show(data: MatchEndMessage): void {
    this.visible = true;
    this.el.classList.remove("hidden");
    const score = document.getElementById("match-end-score");
    const detail = document.getElementById("match-end-detail");
    if (score) score.textContent = String(data.score);
    if (detail) {
      detail.textContent = `Место ${data.rank}/${data.players} · ${data.kills} убийств · ${data.deaths} смертей · ${data.timeSec} с`;
    }
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.classList.add("hidden");
  }
}
