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

/** Сервер → клиент: итоги матча */
export interface MatchEndMessage {
  score: number;
  kills: number;
  deaths: number;
  timeSec: number;
  rank: number;
  players: number;
}
