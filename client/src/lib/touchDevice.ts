/** Сенсорный экран как основной ввод (телефон/планшет). */
export function isTouchPrimaryDevice(): boolean {
  if (typeof window === "undefined") return false;
  const touchPoints = navigator.maxTouchPoints > 0;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  const narrow = window.innerWidth <= 1024;
  if (coarse && touchPoints) return true;
  if (noHover && touchPoints) return true;
  if (touchPoints && narrow) return true;
  return false;
}

/** Показать/скрыть тач-контролы и класс `in-game--touch` на body. */
export function syncTouchGameChrome(inGame: boolean): void {
  const controls = document.getElementById("controls");
  const touch = inGame && isTouchPrimaryDevice();

  document.body.classList.toggle("in-game--touch", touch);
  document.getElementById("hud")?.classList.toggle("hud--touch", touch);

  if (!controls) return;
  if (touch) {
    controls.classList.remove("hidden", "touch-only");
  } else {
    controls.classList.add("hidden");
    if (!isTouchPrimaryDevice()) {
      controls.classList.add("touch-only");
    } else {
      controls.classList.remove("touch-only");
    }
  }
}
