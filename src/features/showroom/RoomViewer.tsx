import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import RoomCanvas, { type CameraMode } from '../studio/build/RoomCanvas';
import CompassHud from '../studio/build/CompassHud';
import type { SceneApi } from '../studio/build/RoomCanvas.types';
import { Segmented } from '../../design/components';
import type { Room } from '../../domain/types';
import { wallsBounds } from '../../engine/geometry';
import { useCatalog } from '../../app/providers';
import { formatPrice, roomArea } from '../rooms/roomMeta';
import s from './RoomViewer.module.css';

export interface RoomViewer3DProps {
  room: Room;
  showControls?: boolean;
  keyboardEnabled?: boolean;
  zoomEnabled?: boolean;
  apiRef?: MutableRefObject<SceneApi | null>;
  onRotate?: () => void;
}

/** 읽기 전용 3D 뷰어 (쇼룸 상세 / 공유 링크). WebGL RoomCanvas 그대로 사용 */
export function RoomViewer3D({
  room,
  showControls = true,
  keyboardEnabled = true,
  zoomEnabled = true,
  apiRef,
  onRotate,
}: RoomViewer3DProps) {
  const [mode, setMode] = useState<CameraMode>('orbit');
  const [locked, setLocked] = useState(false);
  const azimuthSinkRef = useRef<((azimuthRad: number) => void) | null>(null);
  return (
    <div className={s.viewer}>
      <RoomCanvas
        room={room}
        cameraMode={mode}
        keyboardEnabled={keyboardEnabled}
        zoomEnabled={zoomEnabled}
        onWalkLockChange={setLocked}
        onRotate={onRotate}
        onAzimuthChange={(az) => azimuthSinkRef.current?.(az)}
        apiRef={apiRef}
      />
      <CompassHud facing={room.facing} variant="viewer" azimuthSinkRef={azimuthSinkRef} />
      {showControls && mode === 'walk' && !locked ? (
        <div className={s.walkHint}>
          <p>
            화면을 클릭하면 1인칭 걷기 시작
            <br />
            WASD / 방향키 이동 · ESC 해제
          </p>
        </div>
      ) : null}
      {showControls && mode === 'walk' && locked ? <div className={s.crosshair} aria-hidden="true" /> : null}
      {showControls ? (
        <div className={s.camera}>
          <Segmented<CameraMode>
            aria-label="카메라 모드"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'orbit', label: '3D' },
              { value: 'top', label: '탑뷰' },
              { value: 'walk', label: '걷기' },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 방 요약: 평수·가구 수 + 상세 규격(접기) */
export function RoomStats({ room }: { room: Room }) {
  const b = wallsBounds(room.walls);
  const { m2, pyeong } = roomArea(room);
  return (
    <div className={s.stats}>
      <div className={s.summary}>
        <span className={s.big}>
          <b className="num">{pyeong.toFixed(1)}</b>
          <span className={s.unit}>평</span>
        </span>
        <span className={s.dim} aria-hidden="true" />
        <span>
          가구 <b className="num">{room.furniture.length}</b>
          <span className={s.unit}>개</span>
        </span>
      </div>
      <details className={s.details}>
        <summary className={s.detailsSummary}>방 상세 규격</summary>
        <dl className={s.specs}>
          <div>
            <dt>방 크기</dt>
            <dd className="num">{b ? `${b.width.toFixed(1)}×${b.depth.toFixed(1)} m` : '-'}</dd>
          </div>
          <div>
            <dt>실면적</dt>
            <dd className="num">{m2 > 0 ? `${m2.toFixed(1)} m²` : '-'}</dd>
          </div>
          <div>
            <dt>벽 높이</dt>
            <dd className="num">{room.wallHeight.toFixed(1)} m</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

/** 배치된 가구 목록 (같은 가구는 수량으로 묶음 + 가격·구매 링크) */
export function FurnitureList({ room }: { room: Room }) {
  const catalog = useCatalog();
  const rows = useMemo(() => {
    const scoped = catalog.scoped(room);
    const groups = new Map<string, number>();
    room.furniture.forEach((f) => groups.set(f.specId, (groups.get(f.specId) ?? 0) + 1));
    return [...groups.entries()].flatMap(([id, n]) => {
      const spec = scoped.get(id);
      return spec ? [{ spec, n }] : [];
    });
  }, [room, catalog]);
  const total = rows.reduce((sum, r) => sum + (r.spec.price ?? 0) * r.n, 0);

  if (rows.length === 0) return <p className={s.empty}>배치된 가구가 없습니다.</p>;
  return (
    <>
      <ul className={s.list}>
        {rows.map(({ spec, n }) => (
          <li key={spec.id} className={s.row}>
            <span className={s.name}>
              {spec.name}
              {n > 1 ? <span className={`${s.qty} num`}> ×{n}</span> : null}
            </span>
            <span className={s.price}>
              {spec.price != null ? <span className="num">{formatPrice(spec.price * n)}</span> : null}
              {spec.shopUrl ? (
                <a href={spec.shopUrl} target="_blank" rel="noreferrer noopener">
                  구매
                </a>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {total > 0 ? (
        <div className={s.total}>
          <span>예상 총 비용</span>
          <b className="num">{formatPrice(total)}</b>
        </div>
      ) : null}
    </>
  );
}
