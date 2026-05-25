/** Части игрока: sessionId и sessionId~N */
export function isLocalPart(id: string, sessionId: string | null): boolean {
  if (!sessionId) return false;
  return id === sessionId || id.startsWith(`${sessionId}~`);
}

export function pickLargestLocalPart<T extends { id: string; radius: number }>(
  players: T[],
  sessionId: string | null,
): T | undefined {
  let best: T | undefined;
  for (const p of players) {
    if (!isLocalPart(p.id, sessionId)) continue;
    if (!best || p.radius > best.radius) best = p;
  }
  return best;
}
