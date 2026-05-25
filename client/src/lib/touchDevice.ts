/** Сенсорный экран как основной ввод (телефон/планшет). */
export function isTouchPrimaryDevice(): boolean {
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}
