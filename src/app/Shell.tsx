import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import AuthErrorScreen from '../features/session/AuthErrorScreen';
import AuthModal from '../features/session/AuthModal';
import Header from './Header';
import s from './Shell.module.css';

function Footer() {
  return (
    <footer className={s.footer}>
      <p>© 2026 Atelier 3D</p>
    </footer>
  );
}

/** Header + 본문 + Footer. 스튜디오는 전체 화면이라 크롬 없이 본문만 */
export default function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isStudio = pathname.startsWith('/studio');
  return (
    <>
      {isStudio ? (
        children
      ) : (
        <div className={s.shell}>
          <Header />
          <main className={s.content}>{children}</main>
          <Footer />
        </div>
      )}
      <AuthModal />
      <AuthErrorScreen />
    </>
  );
}
