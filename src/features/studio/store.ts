import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PlacedFurniture, Room } from '../../domain/types';
import type { CatalogReader } from '../../domain/catalog';
import {
  addFurniture,
  applyLayoutFurniture,
  applyPlanDocument,
  collisionsOf,
  duplicateFurniture,
  furnitureOutside,
  removeFurniture,
  setRoomFacing,
  snapPlaced,
  updateFurniture,
  type FurniturePatch,
} from '../../domain/room';
import { RoomAccessError, type RoomRepository } from '../rooms/repository/RoomRepository';
import { beginLive, commitLiveHistory, emptyHistory, pushHistory, redoHistory, undoHistory } from './history';
import type { RoomStatus, SceneRef, StudioPanels, StudioState, StudioStore } from './types';

/** 스토어가 scoped 카탈로그를 만들 수 있는 최소 계약 (CatalogRegistry가 구현) */
export type StudioCatalog = CatalogReader & { scoped(room: Pick<Room, 'customSpecs'>): CatalogReader };

export interface StudioDeps {
  catalog: StudioCatalog;
  /** 세션(모드·로그인)에 따라 저장소가 바뀌므로 getter */
  rooms(): RoomRepository;
  /** 초안 자동 저장 지연(ms). 테스트는 0 */
  draftDelay?: number;
}

export const DRAFT_ID = 'draft';

const PANELS: StudioPanels = { catalog: true, inspector: true, placedList: false, ai: null, help: false, share: false, save: false, photoWizard: false, moreMenu: false };

const initialState = (): StudioState => ({
  roomId: null, isDraft: false, room: null, roomStatus: 'idle', dirty: false,
  mode: 'build', selectedId: null, cameraMode: 'orbit', lightingPreset: 'daylight', walkLocked: false, snap: true,
  collisions: new Set(), outside: [], panels: { ...PANELS }, history: emptyHistory(), busy: null,
});

const statusOf = (err: unknown): RoomStatus => {
  if (err instanceof RoomAccessError) return err.kind === 'network' ? 'not-found' : err.kind;
  return 'not-found';
};

/**
 * Studio 스토어 (zustand vanilla). React는 `context.tsx`의 `useStudio(selector)`로 구독하고,
 * 엔진(SceneView·PlanView)은 `store.subscribe`로 구독한다. 모든 문서 변경은 domain/room 순수 함수에 위임.
 */
export function createStudioStore(deps: StudioDeps): StoreApi<StudioStore> {
  let sceneRef: SceneRef | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let loadSeq = 0;

  return createStore<StudioStore>((set, get) => {
    const scoped = (room: Room) => deps.catalog.scoped(room);
    const derived = (room: Room) => {
      const cat = scoped(room);
      return { room, collisions: collisionsOf(room, cat), outside: furnitureOutside(room, cat) };
    };
    const persistDraft = (room: Room) => {
      if (!get().isDraft) return;
      if (draftTimer) clearTimeout(draftTimer);
      const write = () => { draftTimer = null; try { deps.rooms().draft.set(room); } catch { /* 저장 공간 부족 등 — 명시 저장 시 알림 */ } };
      if (!deps.draftDelay) write(); else draftTimer = setTimeout(write, deps.draftDelay);
    };
    /** 히스토리에 남기는 변경 */
    const commit = (next: Room) => {
      const { room, history } = get();
      if (!room || next === room) return;
      set({ ...derived(next), history: pushHistory(history, room), dirty: true });
      persistDraft(next);
    };
    /** 드래그 등 실시간 변경 */
    const live = (next: Room) => {
      const { room, history } = get();
      if (!room || next === room) return;
      set({ ...derived(next), history: beginLive(history, room), dirty: true });
      persistDraft(next);
    };
    const editFurniture = (id: string, patch: FurniturePatch, isLive: boolean, skipWallSnap = false) => {
      const { room, snap } = get();
      if (!room) return;
      const cat = scoped(room);
      let next = updateFurniture(room, id, patch);
      if ('x' in patch || 'z' in patch || 'rotation' in patch || 'width' in patch || 'depth' in patch || 'height' in patch) {
        const f = next.furniture.find((p) => p.id === id);
        if (f) {
          next = updateFurniture(next, id, snapPlaced(f, cat.get(f.specId), next.walls, skipWallSnap ? false : snap));
        }
      }
      (isLive ? live : commit)(next);
    };

    return {
      ...initialState(),

      async load(roomId) {
        const seq = ++loadSeq;
        const repo = deps.rooms();
        if (roomId === DRAFT_ID) {
          const draft = repo.draft.get();
          set({ ...initialState(), roomId, isDraft: true, dirty: true, ...(draft ? { ...derived(draft), roomStatus: 'ready' } : { roomStatus: 'not-found' }) });
          return;
        }
        set({ ...initialState(), roomId, roomStatus: 'loading' });
        try {
          const room = await repo.get(roomId);
          if (seq !== loadSeq) return;
          set(room ? { ...derived(room), roomStatus: 'ready' } : { roomStatus: 'not-found' });
        } catch (err) {
          if (seq !== loadSeq) return;
          set({ roomStatus: statusOf(err) });
        }
      },

      newDraft(room) {
        loadSeq++;
        deps.rooms().draft.set(room);
        set({ ...initialState(), roomId: DRAFT_ID, isDraft: true, dirty: true, ...derived(room), roomStatus: 'ready' });
      },

      reset() { loadSeq++; if (draftTimer) clearTimeout(draftTimer); draftTimer = null; set(initialState()); },
      attachScene(ref) { sceneRef = ref; },
      scene() { return sceneRef?.current ?? null; },

      commit, live,
      commitLive() { set({ history: commitLiveHistory(get().history) }); },
      undo() {
        const { room, history } = get();
        if (!room) return;
        const r = undoHistory(history, room);
        if (r) { set({ ...derived(r.room), history: r.history, dirty: true }); persistDraft(r.room); }
      },
      redo() {
        const { room, history } = get();
        if (!room) return;
        const r = redoHistory(history, room);
        if (r) { set({ ...derived(r.room), history: r.history, dirty: true }); persistDraft(r.room); }
      },

      place(specId, at, rotation = 0) {
        const { room, snap } = get();
        if (!room) return null;
        const cat = scoped(room);
        const spec = cat.get(specId);
        if (!spec) return null;
        const added = addFurniture(room, spec, at, { rotation });
        const placed = snapPlaced(added.placed, spec, room.walls, snap);
        commit(updateFurniture(added.room, placed.id, placed));
        set({ selectedId: placed.id });
        return placed;
      },
      patch(id, patch, opts?: { live?: boolean; skipWallSnap?: boolean }) {
        editFurniture(id, patch, !!opts?.live, !!opts?.skipWallSnap);
      },
      remove(id) {
        const { room, selectedId } = get();
        if (!room) return;
        commit(removeFurniture(room, id));
        if (selectedId === id) set({ selectedId: null });
      },
      duplicate(id) {
        const { room, snap } = get();
        if (!room) return;
        const r = duplicateFurniture(room, id);
        if (!r) return;
        const cat = scoped(room);
        const placed = snapPlaced(r.placed, cat.get(r.placed.specId), room.walls, snap);
        commit(updateFurniture(r.room, placed.id, placed));
        set({ selectedId: placed.id });
      },
      applyPlan(walls, wallHeight, doors, furniture) {
        const { room } = get();
        if (!room) return;
        const planned = applyPlanDocument(room, { walls, wallHeight, doors }, scoped(room));
        commit(furniture?.length ? applyLayoutFurniture(planned, furniture, false, scoped(planned)) : planned);
      },
      applyLayout(furniture: PlacedFurniture[], keepExisting) {
        const { room } = get();
        if (!room) return;
        commit(applyLayoutFurniture(room, furniture, keepExisting, scoped(room)));
        set({ selectedId: null });
      },
      setTitle(title) {
        const { room } = get();
        if (room && title !== room.title) commit({ ...room, title });
      },
      setFacing(facing) {
        const { room } = get();
        if (room) commit(setRoomFacing(room, facing));
      },

      select(id) { set({ selectedId: id }); },
      setMode(mode) { if (mode !== get().mode) set({ mode, selectedId: null }); },
      setCamera(cameraMode) { set({ cameraMode, walkLocked: false }); },
      setLighting(lightingPreset) { set({ lightingPreset }); },
      setWalkLocked(walkLocked) { set({ walkLocked }); },
      setSnap(snap) { set({ snap }); },
      setPanel(key, value) { set({ panels: { ...get().panels, [key]: value } }); },
      setBusy(busy) { set({ busy }); },

      async save(opts) {
        const { room, isDraft } = get();
        if (!room) return null;
        const thumbnail = opts?.thumbnail ?? (sceneRef?.current?.capture() ?? room.thumbnail);
        const toSave: Room = { ...room, title: opts?.title ?? room.title };
        if (thumbnail) toSave.thumbnail = thumbnail;
        const repo = deps.rooms();
        const saved = await repo.save(toSave);
        if (get().room !== room && get().room?.id !== room.id) return saved; // 저장 중 다른 방으로 이동
        if (isDraft) { if (draftTimer) clearTimeout(draftTimer); draftTimer = null; repo.draft.clear(); }
        // 히스토리는 유지(저장은 편집이 아님). 저장 결과(소유자·updatedAt·썸네일)만 반영
        set({ ...derived(saved), dirty: false, isDraft: false, roomId: saved.id });
        return saved;
      },
    };
  });
}
