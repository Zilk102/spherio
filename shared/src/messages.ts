/** Ввод игрока (клиент → сервер) */
export interface InputMessage {
  moveX: number;
  moveZ: number;
  brake: boolean;
}

export interface JoinOptions {
  name?: string;
}
