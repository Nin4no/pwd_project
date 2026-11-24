import { createContext, useContext, type ReactNode } from 'react';
import { useStore, type StoreApi } from 'zustand';
import type { StudioStore } from './types';

const StudioStoreContext = createContext<StoreApi<StudioStore> | null>(null);

/** StudioPage가 createStudioStore(deps)로 만든 스토어를 하위 트리에 공급 */
export function StudioStoreProvider({ store, children }: { store: StoreApi<StudioStore>; children: ReactNode }) {
  return <StudioStoreContext.Provider value={store}>{children}</StudioStoreContext.Provider>;
}

/** 스토어 API (subscribe·getState — 엔진 래퍼·단축키용) */
export function useStudioStoreApi(): StoreApi<StudioStore> {
  const store = useContext(StudioStoreContext);
  if (!store) throw new Error('useStudio: StudioStoreProvider 밖에서 호출됨');
  return store;
}

/** selector 구독 — UI는 필요한 조각만 읽는다 */
export function useStudio<T>(selector: (s: StudioStore) => T): T {
  return useStore(useStudioStoreApi(), selector);
}
