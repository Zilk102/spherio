import { joinArena } from "./net/colyseus.js";
import { Game } from "./game/Game.js";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const menu = document.getElementById("menu");
const hud = document.getElementById("hud");
const playBtn = document.getElementById("play-btn");
const nickInput = document.getElementById("nick") as HTMLInputElement;
const status = document.getElementById("status");

let game: Game | null = null;

function setStatus(msg: string): void {
  if (status) status.textContent = msg;
}

playBtn?.addEventListener("click", async () => {
  const name = nickInput?.value.trim() || "Игрок";
  playBtn.setAttribute("disabled", "true");
  setStatus("Подключение…");
  try {
    const room = await joinArena(name);
    game = new Game(canvas);
    await game.connect(room);
    game.startLoop();
    menu?.classList.add("hidden");
    hud?.classList.remove("hidden");
    setStatus("");
  } catch (e) {
    console.error(e);
    setStatus("Ошибка подключения. Проверьте сервер.");
    playBtn.removeAttribute("disabled");
  }
});
