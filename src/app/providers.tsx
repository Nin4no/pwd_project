import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { CatalogRegistry, localStorageCatalogStorage } from '../domain/catalog';
import { FURNITURE } from '../data/furniture';
import { ToastProvider } from '../design/components';
import { createRepositories, type Repositories } from '../features/rooms/repository';
// 세션 스토어는 모듈 로드 시 init() (features/session/store.ts)
import { useSessionStore } from '../features/session/store';

const CatalogContext = createContext<CatalogRegistry | null>(null);
const RepositoriesContext = createContext<Repositories | null>(null);

/** 앱 전역 카탈로그 (기본 가구 + 사용자 AI 가구). data/furniture.ts의 함수 대신 이것을 사용 */
export function useCatalog(): CatalogRegistry {
  const c = useContext(CatalogContext);
  if (!c) throw new Error('useCatalog must be used within Providers');
  return c;
}

/** 방·쇼룸 저장소. 모드·로그인 사용자가 바뀌면 새로 조합된다(동기화 큐는 앱 전역 하나) */
export function useRepositories(): Repositories {
  const r = useContext(RepositoriesContext);
  if (!r) throw new Error('useRepositories must be used within Providers');
  return r;
}

function RepositoriesProvider({ catalog, children }: { catalog: CatalogRegistry; children: ReactNode }) {
  const mode = useSessionStore((st) => st.mode);
  const user = useSessionStore((st) => st.user);
  const repos = useMemo(() => createRepositories({ mode, user }, catalog), [mode, user, catalog]);
  return <RepositoriesContext.Provider value={repos}>{children}</RepositoriesContext.Provider>;
}

export default function Providers({ children }: { children: ReactNode }) {
  const catalog = useMemo(() => new CatalogRegistry(FURNITURE, localStorageCatalogStorage()), []);
  return (
    <CatalogContext.Provider value={catalog}>
      <RepositoriesProvider catalog={catalog}>
        <ToastProvider>{children}</ToastProvider>
      </RepositoriesProvider>
    </CatalogContext.Provider>
  );
}
