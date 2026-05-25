interface PlayerHud {
  name: string;
  radius: number;
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
    statsEl.textContent = `Радиус: ${me.radius.toFixed(2)}`;
  }

  const sorted = [...all]
    .sort((a, b) => b.radius - a.radius)
    .slice(0, 5);
  leaderEl.innerHTML =
    "<strong>Топ</strong><br>" +
    sorted
      .map((p, i) => `${i + 1}. ${p.name} (${p.radius.toFixed(1)})`)
      .join("<br>");

  pingEl.textContent = `Ping: ${Math.round(ping)} ms`;
}
