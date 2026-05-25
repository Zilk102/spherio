const BLOCKED = ["spam", "cheat", "hack"];

export function filterChatText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const low = t.toLowerCase();
  for (const w of BLOCKED) {
    if (low.includes(w)) return null;
  }
  return t.slice(0, 120);
}
