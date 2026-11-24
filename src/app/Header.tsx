import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Button } from '../design/components';
import { useSessionStore } from '../features/session/store';
import s from './Header.module.css';

export function Logo() {
  return (
    <Link to="/" className={s.logo} aria-label="Atelier 3D 홈">
      <img
        src="/atelier-logo-4.png"
        alt=""
        className={s.logoLockup}
        width={161}
        height={38}
      />
    </Link>
  );
}

const NAV = [
  { to: '/', label: '홈', end: true },
  { to: '/showroom', label: '쇼룸', end: false },
  { to: '/saved', label: '저장함', end: false },
] as const;

function SyncState() {
  const isCloud = useSessionStore((st) => st.isCloud);
  const status = useSessionStore((st) => st.syncStatus);
  // 평소(saved)에는 숨김 — 진행 중·오류만 알림
  if (!isCloud || status === 'saved') return null;
  const error = status === 'error';
  return (
    <span className={`${s.sync}${error ? ` ${s.syncError}` : ''}`} role="status" title={error ? '동기화 오류가 발생했습니다' : '동기화 중'}>
      <span className={s.syncDot} aria-hidden="true" />
      <span className={s.syncText}>{error ? '동기화 오류' : '동기화 중'}</span>
    </span>
  );
}

/** 공용 헤더: 로고 · 홈/쇼룸/저장함 · 동기화 상태 · 로그인/이름 */
export default function Header() {
  const user = useSessionStore((st) => st.user);
  const openAuthModal = useSessionStore((st) => st.openAuthModal);

  // 401 등으로 저장소가 로그인을 요구하면(구 코드와 같은 이벤트) 로그인 창을 엶
  useEffect(() => {
    const onRequired = () => openAuthModal();
    window.addEventListener('auth:required', onRequired);
    return () => window.removeEventListener('auth:required', onRequired);
  }, [openAuthModal]);

  return (
    <header className={s.header}>
      <Logo />
      <nav className={s.nav} aria-label="주요 메뉴">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `${s.link}${isActive ? ` ${s.active}` : ''}`}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className={s.side}>
        <SyncState />
        {user ? (
          <button type="button" className={s.user} onClick={openAuthModal} title={`${user.displayName} (계정 관리)`}>
            <span className={s.avatar} aria-hidden="true">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className={s.userName}>{user.displayName}</span>
          </button>
        ) : (
          <Button variant="brand" size="sm" onClick={openAuthModal}>
            로그인
          </Button>
        )}
      </div>
    </header>
  );
}
