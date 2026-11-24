import type { Room } from '../../domain/types';
import { totalArea } from '../../engine/geometry';

const M2_PER_PYEONG = 3.3058;

/** 카드·요약용 면적 (m²·평) */
export function roomArea(room: Pick<Room, 'walls'>): { m2: number; pyeong: number } {
  const m2 = totalArea(room.walls);
  return { m2, pyeong: m2 / M2_PER_PYEONG };
}

export const formatPyeong = (room: Pick<Room, 'walls'>) => roomArea(room).pyeong.toFixed(1);

export const formatDate = (ms: number) => new Date(ms).toLocaleDateString();

export const formatPrice = (n?: number) => (n == null ? '-' : `${n.toLocaleString()}원`);

/** 오류 → 토스트 문구 */
export const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

/** 클립보드 복사 (실패 시 prompt로 대체 — 현행 동작) */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('아래 링크를 복사하세요', text);
    return false;
  }
}
