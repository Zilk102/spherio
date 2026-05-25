/** Чат захватил клавиатуру — игровой ввод отключён. */
let capturing = false;

export function setChatCapturing(value: boolean): void {
  capturing = value;
}

export function isChatCapturing(): boolean {
  return capturing;
}
