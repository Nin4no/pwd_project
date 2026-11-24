import type { Room } from '../../domain/types';
import type { StudioHistory } from './types';

/**
 * Undo/Redo 히스토리 — 순수 함수 (구 `state/useHistory.ts`의 set/setLive/commitLive 의미 보존).
 * - push: 변경 전 스냅샷을 past에 기록, future 비움, live 기준 폐기
 * - beginLive: 연속 변경(드래그) 시작 시 기준 스냅샷 1회 보관, 프레임마다 쌓지 않음
 * - commitLive: 기준 스냅샷을 past로 확정
 */
export const HISTORY_LIMIT = 80;

export const emptyHistory = (): StudioHistory => ({ past: [], future: [], liveBase: null });

export function pushHistory(h: StudioHistory, prev: Room, limit = HISTORY_LIMIT): StudioHistory {
  return { past: [...h.past.slice(-(limit - 1)), prev], future: [], liveBase: null };
}

export function beginLive(h: StudioHistory, prev: Room): StudioHistory {
  return h.liveBase ? h : { ...h, liveBase: prev };
}

export function commitLiveHistory(h: StudioHistory, limit = HISTORY_LIMIT): StudioHistory {
  if (!h.liveBase) return h;
  return { past: [...h.past.slice(-(limit - 1)), h.liveBase], future: [], liveBase: null };
}

export function undoHistory(h: StudioHistory, current: Room): { history: StudioHistory; room: Room } | null {
  if (!h.past.length) return null;
  const room = h.past[h.past.length - 1];
  return { room, history: { past: h.past.slice(0, -1), future: [current, ...h.future], liveBase: null } };
}

export function redoHistory(h: StudioHistory, current: Room): { history: StudioHistory; room: Room } | null {
  if (!h.future.length) return null;
  const room = h.future[0];
  return { room, history: { past: [...h.past, current], future: h.future.slice(1), liveBase: null } };
}

export const canUndo = (h: StudioHistory) => h.past.length > 0;
export const canRedo = (h: StudioHistory) => h.future.length > 0;
