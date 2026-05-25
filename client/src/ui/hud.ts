import { scoreFromRadius } from "@spherio/shared";

interface PlayerHud {
  name: string;
  radius: number;
  vx: number;
  vz: number;
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
