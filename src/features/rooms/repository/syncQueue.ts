import type { Room } from '../../../domain/types';
import type { SyncStatus } from './RoomRepository';
import { statusOf } from '../../../services/api/client';

/**
 * 클라우드 동기화 대기열 — 구 `backend.ts` RoomDatabaseService.pendingSync 의미 그대로.
 * - 방별 최신 상태만 보관(같은 id 재등록 시 교체, 재시도 횟수는 유지)
 * - 일시 오류는 지수 백오프(1s→2s→…≤60s) 후 재전송, `online` 이벤트·`flush()`로 즉시 재전송
 * - 401: 즉시 중단, 항목은 보존하고 상태 `error` + `onAuthRequired` → 재로그인 후 `flush()`
 * - 413: 썸네일을 제거하고 1회 재시도, 그래도 실패하면 버리고 `error`
 * 대기열은 메모리에만 있다(구 코드와 동일 — 방 자체는 이미 `dyr:rooms`에 저장돼 있음).
 */
export interface SyncQueueOptions {
  upload(room: Room): Promise<unknown>;
  onAuthRequired?: () => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 테스트용 타이머 주입 */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** `online` 이벤트 구독 대상 (기본: window). null이면 구독하지 않음 */
  onlineTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
}

interface PendingItem {
  room: Room;
  retryCount: number;
  thumbnailDropped: boolean;
}

type SendResult = 'ok' | 'auth' | 'drop' | 'retry';

export class SyncQueue {
  private readonly pending = new Map<string, PendingItem>();
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  private current: SyncStatus = 'saved';
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private again = false;
  private authBlocked = false;
  private readonly onOnline = () => {
    if (!this.authBlocked && this.pending.size > 0) void this.flush();
  };
  private readonly online: SyncQueueOptions['onlineTarget'];

  constructor(private readonly opts: SyncQueueOptions) {
    this.online = opts.onlineTarget !== undefined ? opts.onlineTarget : typeof window !== 'undefined' ? window : null;
    this.online?.addEventListener('online', this.onOnline);
  }

  status(): SyncStatus {
    return this.current;
  }

  size(): number {
    return this.pending.size;
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  /** 구독 즉시 현재 상태를 한 번 전달 (구 subscribeSyncStatus와 동일) */
  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => void this.listeners.delete(listener);
  }

  enqueue(room: Room): void {
    const prev = this.pending.get(room.id);
    this.pending.set(room.id, { room, retryCount: prev?.retryCount ?? 0, thumbnailDropped: prev?.thumbnailDropped ?? false });
    if (this.authBlocked) return; // 재로그인 후 flush()까지 보류
    if (this.running) this.again = true;
    else void this.flush();
  }

  /** 대기열에서 빼기 (방 삭제 시) */
  discard(id: string): void {
    this.pending.delete(id);
    if (!this.pending.size && !this.running) this.setStatus('saved');
  }

  async flush(): Promise<void> {
    this.authBlocked = false;
    this.clearRetry();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    if (!this.pending.size) {
      this.setStatus('saved');
      return;
    }
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  dispose(): void {
    this.clearRetry();
    this.online?.removeEventListener('online', this.onOnline);
    this.listeners.clear();
  }

  private async run(): Promise<void> {
    this.setStatus('syncing');
    let transient = false;
    let dropped = false;
    do {
      this.again = false;
      for (const [id, item] of Array.from(this.pending.entries())) {
        const result = await this.send(item);
        if (result === 'auth') {
          this.authBlocked = true;
          this.setStatus('error');
          this.opts.onAuthRequired?.();
          return;
        }
        if (result === 'retry') {
          item.retryCount += 1;
          transient = true;
          continue;
        }
        if (result === 'drop') dropped = true;
        // 전송 중 같은 방이 다시 저장됐으면(새 항목) 남겨 두고 다음 바퀴에서 보냄
        if (this.pending.get(id) === item) this.pending.delete(id);
      }
    } while (this.again && !transient);

    if (!this.pending.size) {
      this.setStatus(dropped ? 'error' : 'saved');
      return;
    }
    this.setStatus('error');
    this.scheduleRetry();
  }

  private async send(item: PendingItem): Promise<SendResult> {
    try {
      await this.opts.upload(item.room);
      return 'ok';
    } catch (err) {
      const status = statusOf(err);
      if (status === 401) return 'auth';
      if (status !== 413) return 'retry';
      if (item.thumbnailDropped || !item.room.thumbnail) return 'drop';
      item.thumbnailDropped = true;
      const slim: Room = { ...item.room };
      delete slim.thumbnail;
      item.room = slim;
      try {
        await this.opts.upload(item.room);
        return 'ok';
      } catch (retryErr) {
        return statusOf(retryErr) === 401 ? 'auth' : 'drop';
      }
    }
  }

  private scheduleRetry() {
    const base = this.opts.baseDelayMs ?? 1000;
    const max = this.opts.maxDelayMs ?? 60_000;
    const retries = Math.max(1, ...Array.from(this.pending.values(), (v) => v.retryCount));
    const delay = Math.min(base * 2 ** Math.min(retries - 1, 16), max);
    const set = this.opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = set(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private clearRetry() {
    if (this.timer === null) return;
    (this.opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private setStatus(status: SyncStatus) {
    if (this.current === status) return;
    this.current = status;
    for (const l of this.listeners) {
      try {
        l(status);
      } catch (err) {
        console.error('Sync listener error:', err);
      }
    }
  }
}
