import type { StoreApi } from 'zustand/vanilla';
import { normalizeRotation } from '../../domain/room';
import type { StudioStore } from './types';

/** DOM 비의존 키 이벤트 (테스트는 객체 리터럴로) */
export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  preventDefault(): void;
}

export interface ShortcutOptions {
  /** 추가 차단 조건 (예: 입력 포커스 중인 커스텀 위젯) */
  blocked?(): boolean;
  /** Ctrl+S — 기본: 초안이면 저장 패널 열기, 아니면 store.save() */
  requestSave?(): void;
  onSaveError?(err: unknown): void;
}

const isEditable = (t: unknown) => {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? '') || !!el.isContentEditable);
};

/**
 * Studio 단축키 (구 Studio.tsx 키 핸들러 의미 보존 + 모드 전환).
 * 2D 모드에서는 FloorplanEditor가 1~5·F·Esc·방향키를 갖고, 여기서는 Ctrl 조합과 M만 처리한다.
 * @returns 처리했으면 true
 */
export function handleStudioKey(e: KeyLike, store: StoreApi<StudioStore>, opts: ShortcutOptions = {}): boolean {
  if (isEditable(e.target) || opts.blocked?.()) return false;
  const s = store.getState();
  const p = s.panels;
  if (p.share || p.save || p.help || p.photoWizard || p.ai) return false;
  const mod = !!(e.ctrlKey || e.metaKey);
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (mod && k === 's') {
    e.preventDefault();
    if (opts.requestSave) opts.requestSave();
    else if (s.isDraft) s.setPanel('save', true);
    else s.save().catch((err) => opts.onSaveError?.(err));
    return true;
  }
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return true; }
  if (mod && k === 'y') { e.preventDefault(); s.redo(); return true; }

  if (k === 'm' && !mod) { s.setMode(s.mode === 'plan' ? 'build' : 'plan'); return true; }
  if (s.mode === 'plan') return false;
  if (s.cameraMode === 'walk') return false;

  if (k === '1' && !mod) { s.setMode('plan'); return true; }
  if (k === '2' && !mod) return true; // 이미 3D

  if (mod && k === 'd') {
    e.preventDefault();
    if (s.selectedId) s.duplicate(s.selectedId);
    return !!s.selectedId;
  }
  if (k === 'Escape') {
    if (s.selectedId) s.select(null);
    else if (p.moreMenu || p.placedList) { s.setPanel('moreMenu', false); s.setPanel('placedList', false); }
    else return false;
    return true;
  }

  const sel = s.selectedId ? s.room?.furniture.find((f) => f.id === s.selectedId) : undefined;
  if (!sel) return false;
  const rotate = (delta: number) => s.patch(sel.id, { rotation: normalizeRotation(sel.rotation + delta) });
  const step = e.shiftKey ? 0.1 : 0.02;
  const nudge = (dx: number, dz: number) => s.patch(sel.id, { x: +(sel.x + dx).toFixed(3), z: +(sel.z + dz).toFixed(3) });
  switch (e.key) {
    case 'Delete': case 'Backspace': e.preventDefault(); s.remove(sel.id); return true;
    case 'r': case 'R': rotate(90); return true;
    case 'q': case 'Q': rotate(-15); return true;
    case 'e': case 'E': rotate(15); return true;
    case 'f': case 'F': s.scene()?.focusFurniture?.(sel.id); return true;
    case 'ArrowLeft': e.preventDefault(); nudge(-step, 0); return true;
    case 'ArrowRight': e.preventDefault(); nudge(step, 0); return true;
    case 'ArrowUp': e.preventDefault(); nudge(0, -step); return true;
    case 'ArrowDown': e.preventDefault(); nudge(0, step); return true;
  }
  return false;
}

/** window keydown 연결. 반환값으로 해제 */
export function attachStudioShortcuts(store: StoreApi<StudioStore>, opts: ShortcutOptions = {}): () => void {
  const h = (e: KeyboardEvent) => { handleStudioKey(e, store, opts); };
  window.addEventListener('keydown', h);
  return () => window.removeEventListener('keydown', h);
}
