/** Базовый id сессии: `abc` или `abc~2` → `abc`. */
export function playerOwnerKey(id: string): string {
  const i = id.indexOf("~");
  return i >= 0 ? id.slice(0, i) : id;
}

export function isSamePlayerOwner(a: string, b: string): boolean {
  return playerOwnerKey(a) === playerOwnerKey(b);
}
