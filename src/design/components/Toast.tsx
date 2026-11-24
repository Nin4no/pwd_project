import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import s from './Toast.module.css';

export type ToastTone = 'default' | 'success' | 'error';

export interface ToastApi {
  /** 현행 useToast().show 의미 유지: 같은 자리에 하나만, 2.2초 후 사라짐 */
  show(message: string, tone?: ToastTone): void;
}

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

const DURATION = 2200;
const ToastContext = createContext<ToastApi | null>(null);

/** 단독 사용 훅 (Provider 없이): { show, node } — 구 components/Toast.tsx와 같은 모양 */
export function useToastState(): ToastApi & { node: ReactNode } {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number>();
  const seq = useRef(0);
  const show = useCallback((message: string, tone: ToastTone = 'default') => {
    seq.current += 1;
    setToast({ id: seq.current, message, tone });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), DURATION);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const node = toast ? <ToastView key={toast.id} message={toast.message} tone={toast.tone} /> : null;
  return { show, node };
}

function ToastView({ message, tone }: { message: string; tone: ToastTone }) {
  return (
    <div className={`${s.toast} ${s[tone]}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
      {message}
    </div>
  );
}

/** 앱 전역 토스트 (providers.tsx에서 1회) */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { show, node } = useToastState();
  const api = useMemo<ToastApi>(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' ? createPortal(<div className={s.region}>{node}</div>, document.body) : null}
    </ToastContext.Provider>
  );
}

/** 전역 토스트 API. Provider 밖이면 오류 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export default ToastProvider;
