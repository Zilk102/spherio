import type { MatchEndMessage, MatchResultsMessage } from "@spherio/shared";

type ServerMatchResults = MatchResultsMessage & { you?: string };

interface ResultsHandlers {
  /** Пользователь нажал «Новая публичная сессия». */
  onRestartPublic?: () => void;
  /** Пользователь нажал «В меню». */
  onMenu: () => void;
}

export class MatchEndOverlay {
  private el: HTMLElement;
  private visible = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: ResultsHandlers = {
    onMenu: () => window.dispatchEvent(new CustomEvent("sphere3d:leave-game")),
  };

  constructor(id = "match-end") {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not found`);
    this.el = el;
    document.getElementById("match-end-menu")?.addEventListener("click", () => {
      this.handlers.onMenu();
    });
    document.getElementById("match-end-restart")?.addEventListener("click", () => {
      this.handlers.onRestartPublic?.();
    });
  }

  setHandlers(h: Partial<ResultsHandlers>): void {
    this.handlers = { ...this.handlers, ...h };
  }

  /** Per-player итоги (старая модалка при добровольном выходе после disconnect). */
  show(data: MatchEndMessage): void {
    this.visible = true;
    this.el.classList.remove("hidden");
    this.clearHold();
    this.setText("match-end-title", "Итоги матча");
    this.setText("match-end-subtitle", "");
    this.setText("match-end-score", String(data.score));
    this.setText(
      "match-end-detail",
      `Место ${data.rank}/${data.players} · ${data.kills} убийств · ${data.deaths} смертей · ${data.timeSec} с`,
    );
    this.setRowsHidden(true);
    this.setRestartVisible(false);
    this.setText("match-end-hint", "");
  }

  /** Итоги матча по таймеру (broadcast от сервера, для всех в комнате). */
  showResults(data: ServerMatchResults): void {
    this.visible = true;
    this.el.classList.remove("hidden");
    this.clearHold();

    this.setText(
      "match-end-title",
      data.isPrivate ? "Приватный матч завершён" : "Матч завершён",
    );
    this.setText(
      "match-end-subtitle",
      `15 минут истекло · длительность ${formatDuration(data.durationSec)}`,
    );

    const meIdx = data.rows.findIndex(
      (r) => r.sessionId && data.you && r.sessionId === data.you,
    );
    const me = meIdx >= 0 ? data.rows[meIdx] : undefined;
    if (me) {
      const rank = meIdx + 1;
      this.setText("match-end-score", String(me.score));
      this.setText(
        "match-end-detail",
        `Ваше место: ${rank}/${data.rows.length} · размер ${me.radius.toFixed(2)}`,
      );
    } else {
      this.setText("match-end-score", "—");
      this.setText("match-end-detail", "Вы наблюдали со стороны");
    }

    const ol = document.getElementById("match-end-rows") as HTMLOListElement | null;
    if (ol) {
      ol.innerHTML = "";
      ol.classList.remove("hidden");
      const top = data.rows.slice(0, 8);
      for (let i = 0; i < top.length; i++) {
        const r = top[i];
        const isMe = !!(r.sessionId && data.you && r.sessionId === data.you);
        const li = document.createElement("li");
        li.className = `match-end-row${isMe ? " is-me" : ""}${r.isBot ? " is-bot" : ""}`;
        li.innerHTML =
          `<span class="match-end-row-rank">${i + 1}</span>` +
          `<span class="match-end-row-name">${escapeHtml(r.name)}${r.isBot ? " <em>бот</em>" : ""}</span>` +
          `<span class="match-end-row-score">${r.score}</span>`;
        ol.appendChild(li);
      }
    }

    this.setRestartVisible(data.canRestartPublic);
    this.setText(
      "match-end-hint",
      data.isPrivate
        ? "Очки из приватного матча в глобальный топ не идут."
        : `Окно закроется через ${Math.ceil(data.holdMs / 1000)} с — пересоберём новую сессию автоматически.`,
    );

    if (data.holdMs > 0) {
      this.holdTimer = setTimeout(() => {
        // Если игрок ничего не нажал — отправляем его в меню.
        this.handlers.onMenu();
      }, data.holdMs + 500);
    }
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.classList.add("hidden");
    this.clearHold();
  }

  private clearHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private setText(id: string, text: string): void {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  private setRowsHidden(hidden: boolean): void {
    const ol = document.getElementById("match-end-rows");
    if (!ol) return;
    ol.classList.toggle("hidden", hidden);
  }

  private setRestartVisible(visible: boolean): void {
    const btn = document.getElementById("match-end-restart");
    if (!btn) return;
    btn.classList.toggle("hidden", !visible);
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
