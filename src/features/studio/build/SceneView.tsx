import { useEffect, useMemo, useRef } from 'react';
import RoomCanvas from './RoomCanvas';
import type { CatalogReader } from '../../../domain/catalog';
import type { Room } from '../../../domain/types';
import { useStudio, useStudioStoreApi } from '../context';
import type { SceneApi } from '../types';

interface Props {
  /** 방 범위 카탈로그를 만들 수 있는 레지스트리 (Provider가 공급) */
  catalog: CatalogReader & { scoped(room: Pick<Room, 'customSpecs'>): CatalogReader };
  /** 생성 애니메이션(벽 상승) */
  animate?: boolean;
  editable?: boolean;
}

/**
 * 3D 씬 — 스토어 구독 → RoomCanvas(순수 WebGL 래퍼) 재배선.
 * 드래그는 live(히스토리 없음) → 드롭 시 commitLive 1회. SceneApi는 store.attachScene으로 노출.
 */
export default function SceneView({ catalog, animate = false, editable = true }: Props) {
  const store = useStudioStoreApi();
  const room = useStudio((s) => s.room);
  const selectedId = useStudio((s) => s.selectedId);
  const collisions = useStudio((s) => s.collisions);
  const cameraMode = useStudio((s) => s.cameraMode);
  const lightingPreset = useStudio((s) => s.lightingPreset);
  const apiRef = useRef<SceneApi | null>(null);
  const scoped = useMemo(() => (room ? catalog.scoped(room) : catalog), [catalog, room?.customSpecs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    store.getState().attachScene(apiRef);
    return () => store.getState().attachScene(null);
  }, [store]);

  if (!room) return null;
  const a = store.getState();
  return (
    <RoomCanvas
      room={room}
      editable={editable}
      selectedId={selectedId}
      collisions={collisions}
      cameraMode={cameraMode}
      lightingPreset={lightingPreset}
      animate={animate}
      apiRef={apiRef}
      catalog={scoped}
      onSelect={a.select}
      onMove={(id, x, z, opts) => a.patch(id, { x, z }, { live: true, skipWallSnap: opts?.skipWallSnap })}
      onDragEnd={() => a.commitLive()}
      onWalkLockChange={a.setWalkLocked}
    />
  );
}
