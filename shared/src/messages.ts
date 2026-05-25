/** Ввод игрока (клиент → сервер). moveX/moveZ — направление на плоскости XZ (нормализовано). */
export interface InputMessage {
  moveX: number;
  moveZ: number;
  brake: boolean;
  boost?: boolean;
}

export interface KillFeedEntry {
  killerName: string;
  victimName: string;
  at: number;
}

export interface ChatMessage {
  name: string;
  text: string;
  at?: number;
}

/** throttle: 1 вперёд, -1 назад, 0 нет (клиент считает из камеры) */
export type DriveThrottle = -1 | 0 | 1;

export interface JoinOptions {
  name?: string;
  skinId?: string;
  /** RGB 0xRRGGBB — цвет для tintable-скинов (emoji, боулинг) */
  skinColor?: number;
  /** Код приватного лобби */
  code?: string;
  /** JWT access token */
  token?: string;
  /** Токен реконнекта Colyseus */
  reconnectionToken?: string;
}

/** Сервер → клиент: итоги сессии игрока (при выходе/disconnect) */
export interface MatchEndMessage {
  score: number;
  kills: number;
  deaths: number;
  timeSec: number;
  rank: number;
  players: number;
}

/** Одна строчка финального лидерборда матча. */
export interface MatchLeaderboardRow {
  id: string;
  name: string;
  score: number;
  radius: number;
  isBot: boolean;
  /** sessionId Colyseus у клиента, чтобы выделить «себя» */
  sessionId?: string;
}

/** Сервер → клиент (broadcast): матч закончился по таймеру, показываем лидерборд. */
export interface MatchResultsMessage {
  reason: "timeup";
  /** Длительность матча в секундах. */
  durationSec: number;
  /** Через сколько мс комната будет уничтожена (для авто-возврата в меню). */
  holdMs: number;
  /** Можно ли по результатам начать новую публичную сессию (false для приватных). */
  canRestartPublic: boolean;
  rows: MatchLeaderboardRow[];
  /** Был ли этот матч приватным (счёт не пишется в глобальный топ). */
  isPrivate: boolean;
}
