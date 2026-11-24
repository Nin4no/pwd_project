import type { Room } from '../types';
import { fromPayloadV1, isPayloadV1 } from './v1';
import { fromPayloadV2, isPayloadV2, toPayloadV2, type SharePayloadV2 } from './v2';

/** 공유 링크 코드 상한 (브라우저·메신저 URL 제한 고려). 초과 시 AI 가구 스펙을 생략 */
export const SHARE_CODE_MAX_BYTES = 8 * 1024;

/* UTF-8 안전 base64url (브라우저·Node 공통) */
export function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export interface EncodedShare {
  code: string;
  /** 길이 제한으로 AI 가구 스펙이 빠졌으면 true (받는 쪽에서 "알 수 없는 가구"로 표시됨) */
  customSpecsDropped: boolean;
}

/** 방 → 공유 코드 (항상 v2). 상한 초과 시 AI 스펙 생략 후 재시도 */
export function encodeRoom(room: Room, maxBytes = SHARE_CODE_MAX_BYTES): EncodedShare {
  const full = toPayloadV2(room);
  const code = b64urlEncode(JSON.stringify(full));
  if (!full.c || code.length <= maxBytes) return { code, customSpecsDropped: false };
  const slim = toPayloadV2(room, { includeCustomSpecs: false });
  return { code: b64urlEncode(JSON.stringify(slim)), customSpecsDropped: true };
}

/** 페이로드(v1·v2) → Room. 실패 시 null */
export function roomFromPayload(p: unknown, now = Date.now()): Room | null {
  if (isPayloadV2(p)) return fromPayloadV2(p, now);
  if (isPayloadV1(p)) return fromPayloadV1(p, now);
  return null;
}

/** 공유 코드 → Room (v1·v2 모두). 실패 시 null */
export function decodeRoom(code: string): Room | null {
  try {
    return roomFromPayload(JSON.parse(b64urlDecode(code.trim())));
  } catch {
    return null;
  }
}

export const shareUrl = (room: Room, origin = location.origin + location.pathname) =>
  `${origin}#/share?d=${encodeRoom(room).code}`;

/* ───── JSON 파일 내보내기 / 가져오기 (길이 제한 없음, 항상 전체 스펙 포함) ───── */
export interface RoomJsonFile extends SharePayloadV2 {
  app: 'design-your-room';
}

export const toRoomJson = (room: Room): string =>
  JSON.stringify({ app: 'design-your-room', ...toPayloadV2(room) } satisfies RoomJsonFile, null, 2);

export function parseRoomJson(text: string): Room | null {
  try {
    return roomFromPayload(JSON.parse(text));
  } catch {
    return null;
  }
}

export const safeFileName = (title: string) => title.replace(/[\\/:*?"<>|]/g, '_') || 'room';

export function downloadRoomJSON(room: Room) {
  const blob = new Blob([toRoomJson(room)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeFileName(room.title)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readRoomJSON(file: File): Promise<Room | null> {
  try {
    return parseRoomJson(await file.text());
  } catch {
    return null;
  }
}
