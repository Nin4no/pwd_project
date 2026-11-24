import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '../design/components';
import HomePage from '../features/home/HomePage';
import SavedPage from '../features/saved/SavedPage';
import ShowroomPage from '../features/showroom/ShowroomPage';
import AuthCallback from '../features/session/AuthCallback';

/* WebGL·도면·가구 엔진을 쓰는 화면은 별도 청크 (초기 로드 감소) */
const StudioPage = lazy(() => import('../features/studio/StudioPage'));
const ShowroomViewPage = lazy(() => import('../features/showroom/ShowroomViewPage'));
const ShareViewPage = lazy(() => import('../features/share/ShareViewPage'));

const Lazy = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}><Spinner size="lg" label="불러오는 중" /></div>}>{children}</Suspense>
);

/** 라우트 표 (HashRouter 기준, 현행 경로와 동일) */
export const ROUTES = {
  home: '/',
  studio: '/studio/:roomId',
  saved: '/saved',
  showroom: '/showroom',
  showroomView: '/showroom/:postId',
  share: '/share',
  authCallback: '/auth/callback',
} as const;

export default function AppRoutes() {
  return (
    <Routes>
      <Route path={ROUTES.home} element={<HomePage />} />
      <Route path={ROUTES.studio} element={<Lazy><StudioPage /></Lazy>} />
      <Route path={ROUTES.saved} element={<SavedPage />} />
      <Route path={ROUTES.showroom} element={<ShowroomPage />} />
      <Route path={ROUTES.showroomView} element={<Lazy><ShowroomViewPage /></Lazy>} />
      <Route path={ROUTES.share} element={<Lazy><ShareViewPage /></Lazy>} />
      <Route path={ROUTES.authCallback} element={<AuthCallback />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
