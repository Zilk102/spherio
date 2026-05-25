import type { ChatMessage } from "@spherio/shared";
import type { Room } from "colyseus.js";
import { setChatCapturing } from "../lib/chatFocus.js";

const GAME_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space", "ShiftLeft", "ShiftRight",
]);

let chatUi: ChatUi | null = null;

export function getChatUi(): ChatUi {
  if (!chatUi) chatUi = new ChatUi();
  return chatUi;
}

export class ChatUi {
  private panel: HTMLElement;
  private log: HTMLElement;
  private input: HTMLInputElement;
  private toggleBtn: HTMLButtonElement;
  private room: Room | null = null;
  private boundSessionId: string | null = null;
  private name = "Игрок";
  private open = false;

  constructor() {
    const panel = document.getElementById("chat-panel");
    const log = document.getElementById("chat-log");
    const input = document.getElementById("chat-input") as HTMLInputElement | null;
    const toggleBtn = document.getElementById("chat-toggle") as HTMLButtonElement | null;
    if (!panel || !log || !input || !toggleBtn) {
      throw new Error("chat elements missing");
    }
    this.panel = panel;
    this.log = log;
    this.input = input;
    this.toggleBtn = toggleBtn;

    toggleBtn.addEventListener("click", () => this.toggle());
    document.getElementById("chat-send")?.addEventListener("click", () => this.send());

    input.addEventListener("focus", () => setChatCapturing(true));
    input.addEventListener("blur", () => {
      if (!this.open) setChatCapturing(false);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.send();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      if (GAME_KEYS.has(e.code)) {
        e.stopPropagation();
      }
    });

    document.addEventListener(
      "keydown",
      (e) => {
        if (!this.isGameVisible()) return;
        if (e.code === "Enter" && !this.open) {
          e.preventDefault();
          this.openChat();
          return;
        }
        if (e.code === "Escape" && this.open) {
          e.preventDefault();
          this.close();
        }
      },
      true,
    );

    this.close();
  }

  bindRoom(room: Room, playerName: string): void {
    if (this.boundSessionId === room.sessionId) {
      this.room = room;
      this.name = playerName;
      return;
    }
    this.boundSessionId = room.sessionId;
    this.room = room;
    this.name = playerName;
    room.onMessage("chat", (msg: ChatMessage) => {
      this.append(msg.name, msg.text);
    });
  }

  unbindRoom(): void {
    this.room = null;
    this.boundSessionId = null;
  }

  private isGameVisible(): boolean {
    return !document.getElementById("chat-root")?.classList.contains("hidden");
  }

  private toggle(): void {
    if (this.open) this.close();
    else this.openChat();
  }

  private openChat(): void {
    this.open = true;
    this.panel.classList.add("chat-panel--open");
    this.toggleBtn.classList.add("chat-toggle--active");
    this.toggleBtn.setAttribute("aria-expanded", "true");
    setChatCapturing(true);
    this.input.focus();
  }

  private close(): void {
    this.open = false;
    this.panel.classList.remove("chat-panel--open");
    this.toggleBtn.classList.remove("chat-toggle--active");
    this.toggleBtn.setAttribute("aria-expanded", "false");
    this.input.blur();
    setChatCapturing(false);
  }

  private send(): void {
    const text = this.input.value.trim();
    if (!text) return;

    if (!this.room) {
      this.append("Система", "Чат недоступен — вы не в матче");
      return;
    }

    const payload: ChatMessage = { name: this.name, text, at: Date.now() };
    try {
      this.room.send("chat", payload);
      this.input.value = "";
      this.toggleBtn.classList.remove("chat-toggle--unread");
    } catch {
      this.append("Система", "Не удалось отправить сообщение");
    }
  }

  private append(name: string, text: string): void {
    const line = document.createElement("div");
    line.className = "chat-line";
    line.innerHTML = `<span class="chat-name">${escapeHtml(name)}</span><span class="chat-text">${escapeHtml(text)}</span>`;
    this.log.append(line);
    this.log.scrollTop = this.log.scrollHeight;
    while (this.log.children.length > 50) {
      this.log.firstElementChild?.remove();
    }
    if (!this.open && this.log.children.length > 0) {
      this.toggleBtn.classList.add("chat-toggle--unread");
    } else if (this.open) {
      this.toggleBtn.classList.remove("chat-toggle--unread");
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
