import { TARGET_DURATION_MS } from "@spherio/shared";
import type { ArenaState, PlayerState } from "../schema/ArenaState.js";

/**
 * Поддерживает у каждого игрока/бота актуальную «случайную цель»:
 *  - назначается при появлении игрока в матче;
 *  - перевыбирается при истечении таймера, исчезновении цели или после поедания.
 *
 * Цель сохраняется в `PlayerState.targetId` и синхронизируется на клиент через ArenaState.
 */
export class TargetSystem {
  /** Текущая длительность цели, ms. Хранится отдельно, чтобы можно было менять в тестах. */
  private readonly durationMs = TARGET_DURATION_MS;

  /**
   * Назначить случайную цель указанному игроку. Возвращает id назначенной цели или "".
   * Цели исключают самого игрока и игроков, которые сейчас в invuln-окне после респавна,
   * чтобы стартовая цель не была неубиваемой.
   */
  assignTargetFor(
    playerId: string,
    state: ArenaState,
    now: number,
    invuln: Map<string, number>,
  ): string {
    const candidates: string[] = [];
    for (const [id, ps] of state.players) {
      if (id === playerId) continue;
      if (!ps) continue;
      // не выдаём цель, которая прямо сейчас неуязвима — обновится в следующем тике
      const inv = invuln.get(id) ?? 0;
      if (inv > now + 200) continue;
      candidates.push(id);
    }
    const me = state.players.get(playerId);
    if (!me) return "";

    if (candidates.length === 0) {
      me.targetId = "";
      me.targetExpiresAt = 0;
      return "";
    }

    // По возможности новая цель не должна совпадать с предыдущей.
    let pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (pick === me.targetId && candidates.length > 1) {
      while (pick === me.targetId) {
        pick = candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
    me.targetId = pick;
    me.targetExpiresAt = now + this.durationMs;
    return pick;
  }

  /**
   * Проверить всех игроков:
   *   - если цели нет / она исчезла / срок истёк — назначить новую.
   * Вызывается каждым tick'ом ArenaRoom.
   */
  tick(state: ArenaState, now: number, invuln: Map<string, number>): void {
    for (const [pid, ps] of state.players) {
      this.ensureTargetForPlayer(pid, ps, state, now, invuln);
    }
  }

  /**
   * Сигнал «игрок съел жертву». Если это была его текущая цель — возвращает true
   * и сразу назначает новую цель.
   */
  onPlayerEaten(
    eaterId: string,
    victimPlayerId: string,
    state: ArenaState,
    now: number,
    invuln: Map<string, number>,
  ): boolean {
    const eater = state.players.get(eaterId);
    if (!eater) return false;
    const hit = eater.targetId === victimPlayerId && eater.targetId !== "";
    if (hit) {
      this.assignTargetFor(eaterId, state, now, invuln);
    }
    // Все, у кого этот victim был целью — переназначим.
    for (const [pid, ps] of state.players) {
      if (pid === eaterId) continue;
      if (ps.targetId === victimPlayerId) {
        this.assignTargetFor(pid, state, now, invuln);
      }
    }
    return hit;
  }

  /** Игрок добавлен/респавнен — назначим начальную цель. */
  onPlayerSpawned(
    playerId: string,
    state: ArenaState,
    now: number,
    invuln: Map<string, number>,
  ): void {
    this.assignTargetFor(playerId, state, now, invuln);
    // Дадим этого новичка как цель кому-нибудь, у кого её нет — чтобы не висел без преследователей.
    for (const [pid, ps] of state.players) {
      if (pid === playerId) continue;
      if (!ps.targetId) {
        this.assignTargetFor(pid, state, now, invuln);
      }
    }
  }

  /** Игрок выбыл из state — у тех, у кого он был целью, выбрать новую. */
  onPlayerRemoved(
    removedId: string,
    state: ArenaState,
    now: number,
    invuln: Map<string, number>,
  ): void {
    for (const [pid, ps] of state.players) {
      if (ps.targetId === removedId) {
        this.assignTargetFor(pid, state, now, invuln);
      }
    }
  }

  private ensureTargetForPlayer(
    playerId: string,
    ps: PlayerState,
    state: ArenaState,
    now: number,
    invuln: Map<string, number>,
  ): void {
    // Цель пропала из state (например, съели её и она респавнилась под другим id) → выбрать новую.
    if (ps.targetId && !state.players.has(ps.targetId)) {
      this.assignTargetFor(playerId, state, now, invuln);
      return;
    }
    // Срок истёк или цели не было.
    if (!ps.targetId || !ps.targetExpiresAt || ps.targetExpiresAt <= now) {
      this.assignTargetFor(playerId, state, now, invuln);
    }
  }
}
