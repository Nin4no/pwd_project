/** 식별자 생성 — 도메인 전체에서 단일 출처 (engine/geometry의 uid와 동일 형식) */
export const uid = (prefix = ''): string =>
  prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const newRoomId = () => uid('room_');
export const newWallId = () => uid('w_');
export const newFurnitureId = () => uid('f_');
export const newSpecId = () => uid('ai_');
