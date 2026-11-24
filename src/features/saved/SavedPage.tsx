import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, EmptyState, Field, Menu, Spinner, useToast } from '../../design/components';
import type { Room } from '../../domain/types';
import { decodeRoom, downloadRoomJSON, readRoomJSON } from '../../domain/share';
import { useRepositories } from '../../app/providers';
import RoomThumb from '../rooms/RoomThumb';
import { errorText, formatDate, roomArea } from '../rooms/roomMeta';
import page from '../../app/Page.module.css';
import s from './SavedPage.module.css';

function RoomCard({ room, onDuplicate, onExport, onRemove }: { room: Room; onDuplicate: () => void; onExport: () => void; onRemove: () => void }) {
  const { m2, pyeong } = roomArea(room);
  const href = `/studio/${room.id}`;
  return (
    <article className={s.card}>
      <Link to={href} className={s.thumb} aria-label={`${room.title} 열기`}>
        <RoomThumb room={room} />
      </Link>
      <div className={s.body}>
        <div className={s.head}>
          <Link to={href} className={s.title} title={room.title}>
            {room.title}
          </Link>
          {room.remixedFrom ? <Badge tone="info">리믹스</Badge> : null}
        </div>
        <p className={s.meta}>
          <span className="num">{pyeong.toFixed(1)}</span>평 (<span className="num">{m2.toFixed(1)}</span>m²) · 가구{' '}
          <span className="num">{room.furniture.length}</span>개
        </p>
        <div className={s.foot}>
          <span className={s.date}>
            수정 <span className="num">{formatDate(room.updatedAt)}</span>
          </span>
          <Menu
            aria-label={`${room.title} 더 보기`}
            items={[
              { key: 'dup', label: '복제', onSelect: onDuplicate },
              { key: 'json', label: 'JSON 내보내기', onSelect: onExport },
              { key: 'del', label: '삭제', danger: true, divider: true, onSelect: onRemove },
            ]}
          />
        </div>
      </div>
    </article>
  );
}

/** 저장함: 카드 그리드 · 검색 · 가져오기(JSON 파일/공유 코드) · 복제 · 삭제 · JSON 내보내기 */
export default function SavedPage() {
  const nav = useNavigate();
  const toast = useToast();
  const { rooms: repo } = useRepositories();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [showImport, setShowImport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setRooms(await repo.list());
    } catch (err) {
      setRooms((cur) => cur ?? []);
      toast.show(errorText(err, '저장함을 불러오지 못했습니다.'), 'error');
    }
  }, [repo, toast]);

  useEffect(() => {
    setRooms(null);
    void refresh();
  }, [refresh]);

  const remove = async (r: Room) => {
    if (!window.confirm(`"${r.title}"을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await repo.remove(r.id);
      toast.show('삭제되었습니다.');
    } catch (err) {
      toast.show(errorText(err, '삭제하지 못했습니다.'), 'error');
    }
    void refresh();
  };

  const duplicate = async (r: Room) => {
    try {
      await repo.clone(r, { title: `${r.title} (사본)` });
      toast.show('사본이 만들어졌습니다.');
      void refresh();
    } catch (err) {
      toast.show(errorText(err, '사본을 만들지 못했습니다.'), 'error');
    }
  };

  /** 가져온 방을 저장함에 넣고 스튜디오로 이동 */
  const importRoom = async (room: Room | null, failMsg: string) => {
    if (!room) {
      toast.show(failMsg, 'error');
      return;
    }
    try {
      const saved = await repo.clone(room);
      nav(`/studio/${saved.id}`);
    } catch (err) {
      toast.show(errorText(err, '가져오지 못했습니다.'), 'error');
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importRoom(await readRoomJSON(file), '올바른 Atelier 3D JSON 파일이 아닙니다.');
  };

  const onCode = () => {
    // 전체 링크를 붙여넣어도 d= 파라미터만 추출
    const m = code.match(/[?&]d=([^&\s]+)/);
    void importRoom(decodeRoom(m ? m[1] : code.trim()), '공유 코드를 해석할 수 없습니다.');
  };

  const q = query.trim().toLowerCase();
  const list = rooms ? (q ? rooms.filter((r) => r.title.toLowerCase().includes(q)) : rooms) : [];

  return (
    <div className={page.page}>
      <div className={page.head}>
        <h1 className={page.title}>저장함</h1>
        <p className={page.sub}>
          내 방 <b className="num">{rooms?.length ?? 0}</b>개
        </p>
      </div>
      <div className={page.toolbar}>
        <Field
          className={page.search}
          label="방 제목 검색"
          hideLabel
          type="search"
          placeholder="방 제목 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={page.spacer} />
        <Button aria-expanded={showImport} onClick={() => setShowImport((v) => !v)}>
          {showImport ? '가져오기 닫기' : '가져오기'}
        </Button>
      </div>

      {showImport ? (
        <section className={s.import} aria-label="방 가져오기">
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            JSON 파일 업로드
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e)} />
          <Field
            className={s.code}
            label="공유 링크 또는 코드"
            hideLabel
            placeholder="공유 링크 또는 코드 붙여넣기"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && code.trim() && onCode()}
            trailing={
              <Button variant="primary" disabled={!code.trim()} onClick={onCode}>
                불러오기
              </Button>
            }
          />
        </section>
      ) : null}

      {rooms === null ? (
        <div className={page.loading}>
          <Spinner label="저장함을 불러오는 중" />
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState
          title="아직 만든 방이 없습니다"
          description="도면을 그리거나 템플릿으로 첫 방을 만들어 보세요."
          action={
            <Button variant="primary" onClick={() => nav('/')}>
              새 방 만들기
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState plain title={`"${query}"에 해당하는 방이 없습니다`} action={<Button onClick={() => setQuery('')}>검색 초기화</Button>} />
      ) : (
        <div className={page.grid}>
          {list.map((r) => (
            <RoomCard
              key={r.id}
              room={r}
              onDuplicate={() => void duplicate(r)}
              onExport={() => downloadRoomJSON(r)}
              onRemove={() => void remove(r)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
