import {
  TARGET_DURATION_MS,
  isSamePlayerOwner,
  playerOwnerKey,
} from "@spherio/shared";
import type { ArenaState, PlayerState } from "../schema/ArenaState.js";

/**
 * Поддерживает у каждого игрока/бота актуальную «случайную цель»:
 *  - назначается при появлении игрока в матче;
 *  - перевыбирается при истечении таймера, исчезновении цели или после поедания.
 *
 * Цель сохраняется в `PlayerState.targetId` и синхронизируется на клиент через ArenaState.
 * У частей одной сессии (split) цель общая.
 */
export class TargetSystem {
  /** Текущая длительность цели, ms. Хранится отдельно, чтобы можно было менять в тестах. */
  private readonly durationMs = TARGET_DURATION_MS;

  /**
   * Назначить случайную цель указанному игроку. Возвращает id назначенной цели или "".
   * Цели исключают самого игрока, его split-части и игроков в invuln после респавна.
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
      if (isSamePlayerOwner(id, playerId)) continue;
      if (!ps) continue;
      const inv = invuln.get(id) ?? 0;
      if (inv > now + 200) continue;
      candidates.push(id);
    }
    const me = state.players.get(playerId);
    if (!me) return "";

    if (candidates.length === 0) {
      this.syncTargetToOwner(playerId, "", 0, state);
      return "";
    }

    let pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (pick === me.targetId && candidates.length > 1) {
      while (pick === me.targetId) {
        pick = candidates[Math.floor(Math.random() * candidates.length)];
      }
    }

    const expiresAt = now + this.durationMs;
    this.syncTargetToOwner(playerId, pick, expiresAt, state);
    return pick;
  }

  /**
   * Проверить всех игроков:
   *   - если цели нет / она исчезла / срок истёк — назначить новую.
   * Вызывается каждым tick'ом ArenaRoom.
   */
  tick(state: ArenaState, now: number, invuln: Map<string, number>): void {
    const seenOwners = new Set<string>();
    for (const [pid, ps] of state.players) {
      const owner = playerOwnerKey(pid);
      if (seenOwners.has(owner)) continue;
      seenOwners.add(owner);
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
    for (const [pid, ps] of state.players) {
      if (pid === eaterId) continue;
      if (ps.targetId === victimPlayerId) {
        this.assignTargetFor(pid, state, now, invuln);
      }
    }
    return hit;
  }

  /** Новая часть после split — цель не меняем, копируем с соседних частей владельца. */
  onSplitPartSpawned(
    childId: string,
    state: ArenaState,
    now: number,
    invuln: Map<string, number>,
  ): void {
    const inherited = this.getValidOwnerTarget(childId, state, now, invuln);
    if (inherited) {
      this.syncTargetToOwner(
        childId,
        inherited.targetId,
        inherited.expiresAt,
        state,
      );
      return;
    }
    this.assignTargetFor(childId, state, now, invuln);
  }

  /** Игрок добавлен/респавнен — назначим начальную цель. */
  onPlayerSpawned(
    playerId: string,
    state: ArenaState,
    now: number,
    invuln: Map<string, number>,
  ): void {
    this.assignTargetFor(playerId, state, now, invuln);
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
    if (
      ps.targetId &&
      (isSamePlayerOwner(ps.targetId, playerId) ||
        !state.players.has(ps.targetId))
    ) {
      this.assignTargetFor(playerId, state, now, invuln);
      return;
    }
    if (!ps.targetId || !ps.targetExpiresAt || ps.targetExpiresAt <= now) {
      this.assignTargetFor(playerId, state, now, invuln);
    }
  }

  private getValidOwnerTarget(
    playerId: string,
    state: ArenaState,
    now: number,
    invuln: Map<string, number>,
  ): { targetId: string; expiresAt: number } | null {
    const owner = playerOwnerKey(playerId);
    for (const [id, ps] of state.players) {
      if (playerOwnerKey(id) !== owner) continue;
      const tid = ps.targetId;
      if (!tid || isSamePlayerOwner(tid, id)) continue;
      if (!state.players.has(tid)) continue;
      if ((invuln.get(tid) ?? 0) > now + 200) continue;
      if (!ps.targetExpiresAt || ps.targetExpiresAt <= now) continue;
      return { targetId: tid, expiresAt: ps.targetExpiresAt };
    }
    return null;
  }

  private syncTargetToOwner(
    playerId: string,
    targetId: string,
    expiresAt: number,
    state: ArenaState,
  ): void {
    const owner = playerOwnerKey(playerId);
    for (const [id, ps] of state.players) {
      if (playerOwnerKey(id) !== owner) continue;
      ps.targetId = targetId;
      ps.targetExpiresAt = expiresAt;
    }
  }
}
