import { useEffect, useState } from 'react';
import type { CatalogRegistry } from '../../../domain/catalog';

/** 사용자 AI 가구 추가·삭제 시 리렌더 (레지스트리 subscribe) */
export function useCatalogVersion(catalog: CatalogRegistry): number {
  const [v, setV] = useState(0);
  useEffect(() => catalog.subscribe(() => setV((n) => n + 1)), [catalog]);
  return v;
}
