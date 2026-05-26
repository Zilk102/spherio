import { MainMenu } from "./ui/menu.js";
import { getChatUi } from "./ui/chat.js";
import { isTouchPrimaryDevice } from "./lib/touchDevice.js";

getChatUi();

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const controls = document.getElementById("controls");
const status = document.getElementById("status");
const menuHint = document.getElementById("menu-hint");

if (menuHint) {
  menuHint.textContent = isTouchPrimaryDevice()
    ? "Джойстик — движение · кнопки справа · Enter — чат"
    : "WASD — движение · Shift — boost · Space — стоп · E — split · Меню";
}

const hudControls = document.getElementById("hud-controls");
if (hudControls) {
  hudControls.textContent = isTouchPrimaryDevice()
    ? "Чат: кнопка или Enter"
    : "Чат: Enter открыть · Esc закрыть";
}

if (controls && !isTouchPrimaryDevice()) {
  controls.classList.add("touch-only");
}

function setStatus(msg: string): void {
  if (status) status.textContent = msg;
}

const menu = new MainMenu(canvas, {
  setStatus,
  onEnterGame: () => {
    document.body.classList.add("in-game");
    if (isTouchPrimaryDevice()) {
      document.body.classList.add("in-game--touch");
    }
    controls?.classList.remove("hidden");
    if (!isTouchPrimaryDevice()) {
      controls?.classList.add("touch-only");
    }
  },
});
