import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, EmptyState, Sheet, Spinner, useToast } from '../../design/components';
import { useCatalog, useRepositories } from '../../app/providers';
import SaveDialog from '../rooms/SaveDialog';
import ShareDialog from '../rooms/ShareDialog';
import { errorText } from '../rooms/roomMeta';
import { useSessionStore } from '../session/store';
import { StudioStoreProvider, useStudio, useStudioStoreApi } from './context';
import { attachStudioShortcuts } from './shortcuts';
import { createStudioStore, DRAFT_ID, type StudioCatalog } from './store';
import type { Room } from '../../domain/types';
import TopBar from './TopBar';
import HelpDialog from './HelpDialog';
import SceneView from './build/SceneView';
import CatalogPanel, { DRAG_MIME } from './build/CatalogPanel';
import Inspector from './build/Inspector';
import CameraPills from './build/CameraPills';
import PlanView from './plan/PlanView';
import PlanToolbar from './plan/PlanToolbar';
import PlanInspector from './plan/PlanInspector';
import { PlanUiProvider } from './plan/PlanContext';
import PhotoWizard from './photo/PhotoWizard';
import GenerateDrawer from './ai/GenerateDrawer';
import RecommendDrawer from './ai/RecommendDrawer';
import { PanelIcon } from './icons';
import s from './StudioPage.module.css';

const MOBILE = '(max-width: 768px)';
function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return m;
}

/** 라우트 `/studio/:roomId` — 스토어 1회 생성 후 하위 트리에 공급 */
export default function StudioPage() {
  const catalog = useCatalog();
  const repos = useRepositories();
  const reposRef = useRef(repos);
  reposRef.current = repos;
  // repos는 세션에 따라 바뀌지만 getter라 스토어는 재생성하지 않는다
  const store = useMemo(() => createStudioStore({ catalog, rooms: () => reposRef.current.rooms, draftDelay: 300 }), [catalog]);
  return (
    <StudioStoreProvider store={store}>
      <PlanUiProvider>
        <StudioScreen />
      </PlanUiProvider>
    </StudioStoreProvider>
  );
}

function StudioScreen() {
  const { roomId = DRAFT_ID } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const catalog = useCatalog();
  const repos = useRepositories();
  const store = useStudioStoreApi();
  const status = useStudio((st) => st.roomStatus);
  const isCloudUser = useSessionStore((st) => st.isCloud && !!st.user);
  const openAuthModal = useSessionStore((st) => st.openAuthModal);
  const [saving, setSaving] = useState(false);

  // 로드 (저장 직후 /studio/:newId로 바뀐 경우는 이미 같은 방이라 건너뜀)
  useEffect(() => {
    const st = store.getState();
    if (st.roomId === roomId && st.roomStatus === 'ready') return;
    const mode = params.get('mode');
    const photo = params.get('photo') === '1';
    void st.load(roomId).then(() => {
      const a = store.getState();
      if (a.roomStatus !== 'ready') return;
      if (mode === 'plan' || mode === 'build') a.setMode(mode);
      if (photo) { a.setMode('plan'); a.setPanel('photoWizard', true); }
    });
  }, [store, roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 로그인·모드 변경으로 저장소가 바뀌면 권한 오류 방을 다시 시도
  useEffect(() => {
    const st = store.getState();
    if (st.roomStatus === 'unauthorized' || st.roomStatus === 'forbidden') void st.load(roomId);
  }, [repos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (status === 'unauthorized') openAuthModal(); }, [status, openAuthModal]);
  useEffect(() => () => store.getState().reset(), [store]);

  const savedMsg = isCloudUser ? '계정에 저장했어요.' : '내 브라우저에 저장했어요.';
  const afterSave = (saved: Room | null, wasDraft: boolean) => {
    if (!saved) return;
    if (wasDraft) nav(`/studio/${saved.id}?mode=${store.getState().mode}`, { replace: true });
    toast.show(savedMsg, 'success');
  };
  const requestSave = () => {
    const st = store.getState();
    if (!st.room) return;
    if (st.isDraft) { st.setPanel('save', true); return; }
    st.save().then((r) => afterSave(r, false)).catch((err) => toast.show(errorText(err, '저장하지 못했어요.'), 'error'));
  };
  const saveRef = useRef(requestSave);
  saveRef.current = requestSave;

  useEffect(() => attachStudioShortcuts(store, { requestSave: () => saveRef.current() }), [store]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      const st = store.getState();
      if (st.dirty && !st.isDraft) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [store]);

  const onSaveTitle = async (title: string) => {
    const wasDraft = store.getState().isDraft;
    setSaving(true);
    try {
      const saved = await store.getState().save({ title });
      store.getState().setPanel('save', false);
      afterSave(saved, wasDraft);
    } catch (err) {
      toast.show(errorText(err, '저장하지 못했어요.'), 'error');
    } finally {
      setSaving(false);
    }
  };
  const ensureSaved = async () => {
    const st = store.getState();
    if (!st.room) return null;
    if (!st.dirty && !st.isDraft) return st.room;
    const wasDraft = st.isDraft;
    try {
      const saved = await st.save();
      afterSave(saved, wasDraft);
      return saved;
    } catch (err) {
      toast.show(errorText(err, '저장하지 못했어요.'), 'error');
      return null;
    }
  };

  if (status === 'idle' || status === 'loading') {
    return <div className={s.full}><Spinner size="lg" label="방을 불러오는 중" /></div>;
  }
  if (status !== 'ready') {
    const copy = {
      'not-found': { t: '방을 찾을 수 없어요', d: roomId === DRAFT_ID ? '이어서 편집할 초안이 없어요.' : '삭제되었거나 주소가 잘못되었어요.' },
      forbidden: { t: '열 수 없는 방이에요', d: '다른 사용자의 방이에요. 공유 링크나 쇼룸으로 볼 수 있어요.' },
      unauthorized: { t: '로그인이 필요해요', d: '계정에 저장된 방이에요. 로그인하면 바로 열려요.' },
    }[status];
    return (
      <div className={s.full}>
        <EmptyState
          title={copy.t}
          description={copy.d}
          action={
            <div className={s.row}>
              {status === 'unauthorized' && <Button onClick={openAuthModal}>로그인</Button>}
              <Button variant={status === 'unauthorized' ? 'secondary' : 'primary'} onClick={() => nav('/')}>홈으로</Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className={s.studio}>
      <TopBar requestSave={requestSave} />
      <Workspace catalog={catalog} />
      <Dialogs saving={saving} onSaveTitle={onSaveTitle} ensureSaved={ensureSaved} catalog={catalog} />
    </div>
  );
}

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === 'left' ? 'M10 3.5L5.5 8 10 12.5' : 'M6 3.5L10.5 8 6 12.5'} />
  </svg>
);

function Workspace({ catalog }: { catalog: ReturnType<typeof useCatalog> }) {
  const store = useStudioStoreApi();
  const mode = useStudio((st) => st.mode);
  const catalogOpen = useStudio((st) => st.panels.catalog);
  const inspectorOpen = useStudio((st) => st.panels.inspector);
  const setPanel = useStudio((st) => st.setPanel);
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState<null | 'left' | 'right'>(null);
  const studioCatalog: StudioCatalog = catalog;

  const left = mode === 'plan' ? <PlanToolbar /> : <CatalogPanel catalog={catalog} />;
  const right = mode === 'plan' ? <PlanInspector /> : <Inspector catalog={studioCatalog} />;
  const leftTitle = mode === 'plan' ? '도면 도구' : '가구 카탈로그';
  const rightTitle = mode === 'plan' ? '도면 속성' : '가구 속성';

  const onDrop = (e: DragEvent) => {
    const specId = e.dataTransfer.getData(DRAG_MIME);
    if (!specId) return;
    e.preventDefault();
    const st = store.getState();
    st.place(specId, st.scene()?.pickGround(e.clientX, e.clientY) ?? { x: 0, z: 0 });
  };

  const panel = (side: 'left' | 'right', title: string, body: ReactNode) => {
    if (mobile) return <Sheet open={sheet === side} onClose={() => setSheet(null)} title={title}>{body}</Sheet>;
    const isLeft = side === 'left';
    const open = isLeft ? catalogOpen : inspectorOpen;
    return (
      <aside className={isLeft ? s.left : s.right} data-open={open} aria-label={title} aria-hidden={!open}>
        <div className={s.panelScroll}>{body}</div>
        <button
          type="button"
          className={`${s.edgeTab} ${isLeft ? s.edgeTabLeft : s.edgeTabRight}`}
          aria-label={`${title} 패널 접기`}
          aria-expanded={open}
          onClick={() => setPanel(isLeft ? 'catalog' : 'inspector', false)}
        >
          <Chevron dir={isLeft ? 'left' : 'right'} />
        </button>
      </aside>
    );
  };

  const toggle = (side: 'left' | 'right', title: string) => {
    const isLeft = side === 'left';
    return (
      <button
        type="button"
        className={`${s.panelToggle} ${isLeft ? s.toggleLeft : s.toggleRight}`}
        aria-label={`${title} 패널 열기`}
        aria-expanded={false}
        onClick={() => setPanel(isLeft ? 'catalog' : 'inspector', true)}
      >
        {isLeft && <PanelIcon />}
        <span>{title}</span>
        {!isLeft && <PanelIcon />}
      </button>
    );
  };

  return (
    <div className={s.workspace}>
      {panel('left', leftTitle, left)}
      <main className={s.stage}>
        {mode === 'plan' ? (
          <PlanView catalog={studioCatalog} />
        ) : (
          <div className={s.scene} onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault(); }} onDrop={onDrop}>
            <SceneView catalog={studioCatalog} animate />
            <CameraPills />
          </div>
        )}
        {mobile && (
          <div className={s.mobileBar}>
            <Button size="sm" variant="secondary" icon={<PanelIcon />} onClick={() => setSheet('left')}>{leftTitle}</Button>
            <Button size="sm" variant="secondary" onClick={() => setSheet('right')}>{rightTitle}</Button>
          </div>
        )}
      </main>
      {panel('right', rightTitle, right)}
      {!mobile && !catalogOpen && toggle('left', leftTitle)}
      {!mobile && !inspectorOpen && toggle('right', rightTitle)}
    </div>
  );
}

interface DialogsProps {
  saving: boolean;
  onSaveTitle: (title: string) => void;
  ensureSaved: () => Promise<Room | null>;
  catalog: ReturnType<typeof useCatalog>;
}

function Dialogs({ saving, onSaveTitle, ensureSaved, catalog }: DialogsProps) {
  const room = useStudio((st) => st.room);
  const isDraft = useStudio((st) => st.isDraft);
  const saveOpen = useStudio((st) => st.panels.save);
  const shareOpen = useStudio((st) => st.panels.share);
  const setPanel = useStudio((st) => st.setPanel);
  if (!room) return null;
  return (
    <>
      <SaveDialog open={saveOpen} room={room} isDraft={isDraft} saving={saving} onSave={onSaveTitle} onClose={() => setPanel('save', false)} />
      {shareOpen && <ShareDialog open room={room} ensureSaved={ensureSaved} onClose={() => setPanel('share', false)} />}
      <HelpDialog />
      <PhotoWizard />
      <GenerateDrawer catalog={catalog} />
      <RecommendDrawer />
    </>
  );
}
