import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Spinner } from '../../design/components';
import type { Room } from '../../domain/types';
import { useRepositories } from '../../app/providers';
import RoomThumb from '../rooms/RoomThumb';
import { formatDate, roomArea } from '../rooms/roomMeta';
import page from '../../app/Page.module.css';
import CardCarousel from './CardCarousel';
import HomeSection from './HomeSection';
import hs from './HomeSection.module.css';
import s from './Home.module.css';
import c from './HomeCards.module.css';

const MAX_RECENT_ROOMS = 12;

/** 최근 작업한 방 (최신 수정순 최대 12개, 카드 캐러셀). 없으면 빈 상태 */
export default function RecentRooms({ onStart }: { onStart: () => void }) {
  const { rooms: repo } = useRepositories();
  const [rooms, setRooms] = useState<Room[] | null>(null);

  useEffect(() => {
    let alive = true;
    repo
      .list()
      .then((list) => {
        if (!alive) return;
        const sorted = [...list]
          .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
          .slice(0, MAX_RECENT_ROOMS);
        setRooms(sorted);
      })
      .catch(() => alive && setRooms([]));
    return () => {
      alive = false;
    };
  }, [repo]);

  return (
    <HomeSection
      id="recent-rooms"
      titleId="recent-title"
      title="최근 작업한 방"
      moreTo="/saved"
      moreLabel="저장함 전체보기 →"
      framed={rooms !== null && rooms.length > 0}
      tone="base"
    >
      {(revealState) =>
        rooms === null ? (
          <div className={page.loading}>
            <Spinner label="최근 작업을 불러오는 중" />
          </div>
        ) : rooms.length === 0 ? (
          <EmptyState
            plain
            className={hs.emptySurface}
            title="아직 만든 방이 없습니다"
            description="도면을 그리면 실제 비율의 3D 방이 만들어집니다."
            action={
              <button type="button" className={s.textCta} onClick={onStart}>
                첫 도면 그리기
              </button>
            }
          />
        ) : (
          <CardCarousel label="최근 작업한 방 목록" itemCount={rooms.length} revealState={revealState}>
            {rooms.map((r) => {
              const { m2, pyeong } = roomArea(r);
              const py = pyeong.toFixed(1);
              return (
                <article key={r.id} className={c.card}>
                  <Link to={`/studio/${r.id}`} className={c.thumb} aria-label={`${r.title} 편집하기`}>
                    <RoomThumb room={r} />
                  </Link>
                  <div className={c.body}>
                    <div className={c.head}>
                      <h3 className={c.title} title={r.title}>
                        {r.title}
                      </h3>
                      <span className={c.pill}>
                        {py}
                        <span className={c.unit}>평</span>
                      </span>
                    </div>
                    <ul className={c.info}>
                      <li>
                        실면적 <span className="num">{m2.toFixed(1)}</span>m² (<span className="num">{py}</span>평)
                      </li>
                      <li>
                        배치 가구 <span className="num">{r.furniture.length}</span>개
                      </li>
                      <li>
                        최근 수정 <span className="num">{formatDate(r.updatedAt)}</span>
                      </li>
                    </ul>
                    <div className={c.foot}>
                      <span className={c.sub}>내 작업실</span>
                      <Link to={`/studio/${r.id}`} className={c.more}>
                        <span>편집하기</span>
                        <span className={c.moreArrow} aria-hidden="true">
                          →
                        </span>
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </CardCarousel>
        )
      }
    </HomeSection>
  );
}
