import type { KillFeedEntry } from "@spherio/shared";

export class KillFeedUi {
  private el: HTMLElement;
  private seen = new Set<string>();

  constructor(rootId = "killfeed") {
    const el = document.getElementById(rootId);
    if (!el) throw new Error(`#${rootId} not found`);
    this.el = el;
  }

  push(entries: KillFeedEntry[]): void {
    const now = Date.now();
    for (const e of entries) {
      const key = `${e.at}-${e.killerName}-${e.victimName}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      if (this.seen.size > 40) {
        const first = this.seen.values().next().value;
        if (first) this.seen.delete(first);
      }
      const line = document.createElement("div");
      line.className = "killfeed-line";
      line.textContent = `${e.killerName} → ${e.victimName}`;
      this.el.prepend(line);
      setTimeout(() => line.remove(), 8000);
    }
    while (this.el.children.length > 6) {
      this.el.lastElementChild?.remove();
    }
  }

  clear(): void {
    this.el.innerHTML = "";
    this.seen.clear();
  }
}
