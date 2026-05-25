import type { InputMessage } from "@spherio/shared";

export function sanitizeInput(msg: InputMessage): InputMessage | null {
  const moveX = Number(msg.moveX);
  const moveZ = Number(msg.moveZ);
  if (!Number.isFinite(moveX) || !Number.isFinite(moveZ)) return null;
  const len = Math.hypot(moveX, moveZ);
  if (len > 1.05) {
    return {
      moveX: moveX / len,
      moveZ: moveZ / len,
      brake: !!msg.brake,
      boost: !!msg.boost,
    };
  }
  return {
    moveX,
    moveZ,
    brake: !!msg.brake,
    boost: !!msg.boost,
  };
}
