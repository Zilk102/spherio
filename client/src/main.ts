import { MainMenu } from "./ui/menu.js";
import { getChatUi } from "./ui/chat.js";
import { isTouchPrimaryDevice, syncTouchGameChrome } from "./lib/touchDevice.js";
import { verifyEmailToken } from "./api/http.js";

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

syncTouchGameChrome(false);

function setStatus(msg: string): void {
  if (status) status.textContent = msg;
}

const verifyParam = new URLSearchParams(location.search).get("verify");
if (verifyParam) {
  void (async () => {
    try {
      const r = await verifyEmailToken(verifyParam);
      if (r.ok) {
        setStatus("Email подтверждён. Теперь можно войти в аккаунт.");
      } else if (r.error === "expired") {
        setStatus("Ссылка истекла. Запросите новое письмо при входе.");
      } else {
        setStatus("Ссылка недействительна или уже использована.");
      }
    } catch {
      setStatus("Не удалось подтвердить email");
    }
    const u = new URL(location.href);
    u.searchParams.delete("verify");
    history.replaceState({}, "", u.pathname + u.search + u.hash);
  })();
}

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) void r.unregister();
  });
}

const menu = new MainMenu(canvas, {
  setStatus,
  onEnterGame: () => {
    document.body.classList.add("in-game");
    syncTouchGameChrome(true);
  },
});
