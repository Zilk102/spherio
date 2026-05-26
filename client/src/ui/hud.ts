import { EAT_RATIO, TARGET_BONUS_MULT, scoreFromRadius } from "@spherio/shared";

interface PlayerHud {
  name: string;
  radius: number;
  vx: number;
  vz: number;
}

interface MatchTimerInfo {
  matchEndsAt: number;
  matchPhase: string;
  isPrivate: boolean;
}

export interface HudTargetInfo {
  name: string;
  radius: number;
  myRadius: number;
  expiresAt: number;
  now: number;
}

export function updateHud(
  me: PlayerHud | undefined,
  all: PlayerHud[],
  ping: number,
): void {
  const nameEl = document.getElementById("hud-name");
  const statsEl = document.getElementById("hud-stats");
  const leaderEl = document.getElementById("hud-leader");
  const pingEl = document.getElementById("hud-ping");
  if (!nameEl || !statsEl || !leaderEl || !pingEl) return;

  if (me) {
    nameEl.textContent = me.name;
    const score = scoreFromRadius(me.radius);
    const speed = Math.hypot(me.vx, me.vz);
    statsEl.textContent = `Очки: ${score} · размер ${me.radius.toFixed(2)} · ${speed.toFixed(1)} м/с`;
  }

  const sorted = [...all]
    .sort((a, b) => b.radius - a.radius)
    .slice(0, 5);
  leaderEl.innerHTML =
    "<span class=\"hud-board-title\">Арена</span>" +
    sorted
      .map((p, i) => {
        const score = scoreFromRadius(p.radius);
        return `<div class="lb-row"><span>${i + 1}</span> ${p.name} <em>${score}</em></div>`;
      })
      .join("");

  pingEl.textContent = `Ping: ${Math.round(ping)} ms`;
}

export function updateHudTimer(info: MatchTimerInfo): void {
  const root = document.getElementById("hud-timer");
  const value = document.getElementById("hud-timer-value");
  const label = root?.querySelector(".hud-timer-label") as HTMLElement | null;
  if (!root || !value) return;

  if (info.matchPhase === "ended") {
    root.classList.remove("hidden");
    root.classList.add("hud-timer--ended");
    if (label) label.textContent = "Матч завершён";
    value.textContent = "00:00";
    return;
  }

  if (!info.matchEndsAt || info.matchPhase === "waiting") {
    if (info.isPrivate) {
      root.classList.remove("hidden");
      root.classList.remove("hud-timer--ended");
      root.classList.add("hud-timer--waiting");
      if (label) label.textContent = "Ждём игроков";
      value.textContent = "—";
    } else {
      root.classList.add("hidden");
    }
    return;
  }

  root.classList.remove("hidden");
  root.classList.remove("hud-timer--waiting");
  root.classList.remove("hud-timer--ended");
  const remainingMs = Math.max(0, info.matchEndsAt - Date.now());
  if (label) label.textContent = info.isPrivate ? "Приватный матч" : "До конца матча";
  value.textContent = formatTimer(remainingMs);
  root.classList.toggle("hud-timer--urgent", remainingMs <= 60_000);
}

function formatTimer(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function updateHudTarget(info: HudTargetInfo | null): void {
  const root = document.getElementById("hud-target");
  const nameEl = document.getElementById("hud-target-name");
  const timerEl = document.getElementById("hud-target-timer");
  const stateEl = document.getElementById("hud-target-state");
  if (!root || !nameEl || !timerEl || !stateEl) return;

  if (!info) {
    root.classList.add("hidden");
    return;
  }

  root.classList.remove("hidden");
  nameEl.textContent = info.name;
  const remainingMs = Math.max(0, info.expiresAt - info.now);
  const total = Math.round(remainingMs / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  timerEl.textContent = `${m.toString().padStart(1, "0")}:${s.toString().padStart(2, "0")}`;

  // Подсказка по состоянию цели: можем съесть / нужно подрасти / опасна.
  const me = info.myRadius;
  const t = info.radius;
  let label = "";
  let mod = "";
  if (me <= 0) {
    label = "ждём респавна";
    mod = "hud-target--wait";
  } else if (me >= t * EAT_RATIO) {
    label = `атакуй · ×${TARGET_BONUS_MULT}`;
    mod = "hud-target--ready";
  } else if (t >= me * EAT_RATIO) {
    label = "крупнее — лучше переждать";
    mod = "hud-target--danger";
  } else {
    label = "подрасти и атакуй";
    mod = "hud-target--grow";
  }
  stateEl.textContent = label;
  root.classList.remove(
    "hud-target--ready",
    "hud-target--danger",
    "hud-target--grow",
    "hud-target--wait",
  );
  root.classList.add(mod);
  root.classList.toggle("hud-target--urgent", remainingMs <= 10_000);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showTargetBonusToast(msg: { victimName: string; mult: number }): void {
  let root = document.getElementById("target-bonus-toast");
  if (!root) {
    root = document.createElement("div");
    root.id = "target-bonus-toast";
    root.className = "target-bonus-toast hidden";
    document.body.appendChild(root);
  }
  root.innerHTML =
    `<span class="target-bonus-mult">×${msg.mult}</span>` +
    `<span class="target-bonus-label">Цель поглощена · ${escapeText(msg.victimName)}</span>`;
  root.classList.remove("hidden");
  root.classList.add("target-bonus-toast--show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    root?.classList.remove("target-bonus-toast--show");
    root?.classList.add("hidden");
    toastTimer = null;
  }, 2200);
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const SPLIT_REASON_RU: Record<string, string> = {
  too_small: "Слишком маленький шар для деления",
  max_parts: "Максимум частей",
  cooldown: "Деление на перезарядке",
  no_parts: "Нет активной сферы",
};

export function showSplitHint(reason: string): void {
  const text = SPLIT_REASON_RU[reason] ?? "Деление недоступно";
  let root = document.getElementById("split-hint-toast");
  if (!root) {
    root = document.createElement("div");
    root.id = "split-hint-toast";
    root.className = "split-hint-toast hidden";
    document.body.appendChild(root);
  }
  root.textContent = text;
  root.classList.remove("hidden");
  root.classList.add("split-hint-toast--show");
  window.setTimeout(() => {
    root?.classList.remove("split-hint-toast--show");
    root?.classList.add("hidden");
  }, 1600);
}
