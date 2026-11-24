import React from 'react';
import ReactDOM from 'react-dom/client';
// 전역 스타일은 base.css(tokens.css 포함)뿐. 컴포넌트 스타일은 각 *.module.css
import './design/base.css';
import App from './app/App';
import AuthCallback from './features/session/AuthCallback';

// /auth/callback은 해시 라우터 바깥 경로 — 훅 규칙을 지키려고 렌더 전에 분기
const isAuthCallback = typeof window !== 'undefined' && window.location.pathname === '/auth/callback';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isAuthCallback ? <AuthCallback /> : <App />}</React.StrictMode>,
);
