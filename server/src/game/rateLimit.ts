import { INPUT_MAX_PER_SEC } from "@spherio/shared";

const MIN_INTERVAL_MS = 1000 / INPUT_MAX_PER_SEC;

export class InputRateLimiter {
  private last = new Map<string, number>();

  allow(sessionId: string): boolean {
    const now = Date.now();
    const prev = this.last.get(sessionId) ?? 0;
    if (now - prev < MIN_INTERVAL_MS) return false;
    this.last.set(sessionId, now);
    return true;
  }

  remove(sessionId: string): void {
    this.last.delete(sessionId);
  }
}
