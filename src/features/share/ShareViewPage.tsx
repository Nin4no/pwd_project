import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, EmptyState, useToast } from '../../design/components';
import { decodeRoom } from '../../domain/share';
import { useRepositories } from '../../app/providers';
import { errorText } from '../rooms/roomMeta';
import { FurnitureList, RoomStats, RoomViewer3D } from '../showroom/RoomViewer';
import page from '../../app/Page.module.css';

/** 공유 링크 미리보기 (#/share?d=코드, v1·v2) → "내 저장함에 담기" */
export default function ShareViewPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { rooms } = useRepositories();
  const code = params.get('d') ?? '';
  const room = useMemo(() => (code ? decodeRoom(code) : null), [code]);
  const [busy, setBusy] = useState(false);

  if (!room) {
    return (
      <div className={page.page}>
        <EmptyState
          title="공유 링크를 열 수 없습니다"
          description="링크가 올바르지 않거나 일부가 잘렸습니다. 링크 전체를 다시 복사하거나, 저장함의 가져오기에 코드를 붙여 넣어 보세요."
          action={
            <Button variant="primary" onClick={() => nav('/saved')}>
              저장함에서 코드로 불러오기
            </Button>
          }
        />
      </div>
    );
  }

  const importRoom = async () => {
    setBusy(true);
    try {
      const saved = await rooms.clone(room);
      nav(`/studio/${saved.id}`);
    } catch (err) {
      toast.show(errorText(err, '저장함에 담지 못했습니다.'), 'error');
      setBusy(false);
    }
  };

  return (
    <div className={page.page}>
      <div className={page.head}>
        <h1 className={page.title}>공유받은 방</h1>
      </div>
      <div className={page.viewerLayout}>
        <RoomViewer3D room={room} />
        <aside className={page.panel} aria-label="방 정보">
          <h2 className={page.panelTitle}>{room.title}</h2>
          <RoomStats room={room} />
          <Button variant="primary" size="lg" block loading={busy} onClick={() => void importRoom()}>
            내 저장함에 담기
          </Button>
          <details className={page.accordion}>
            <summary className={page.accordionSummary}>배치된 가구 ({room.furniture.length})</summary>
            <FurnitureList room={room} />
          </details>
        </aside>
      </div>
    </div>
  );
}
