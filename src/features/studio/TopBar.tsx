import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, IconButton, Menu, useToast } from '../../design/components';
import { downloadRoomJSON, readRoomJSON, safeFileName } from '../../domain/share';
import { useSessionStore } from '../session/store';
import { useStudio, useStudioStoreApi } from './context';
import { canRedo, canUndo } from './history';
import { BackIcon, HelpIcon, RedoIcon, ShareIcon, SparkIcon, UndoIcon } from './icons';
import ModeSwitch from './ModeSwitch';
import s from './TopBar.module.css';

function SaveState() {
  const dirty = useStudio((st) => st.dirty);
  const isDraft = useStudio((st) => st.isDraft);
  const sync = useSessionStore((st) => st.syncStatus);
  const isCloud = useSessionStore((st) => st.isCloud);
  let text = '저장됨';
  let tone = 'ok';
  if (isDraft) { text = '저장 전'; tone = 'warn'; }
  else if (dirty) { text = '변경됨'; tone = 'warn'; }
  else if (isCloud && sync === 'syncing') { text = '동기화 중'; tone = 'busy'; }
  else if (isCloud && sync === 'error') { text = '동기화 실패'; tone = 'error'; }
  return <span className={s.saveState} data-tone={tone} role="status">{text}</span>;
}

function TitleEditor() {
  const title = useStudio((st) => st.room?.title ?? '');
  const setTitle = useStudio((st) => st.setTitle);
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  const commit = () => {
    const t = value.trim();
    if (t && t !== title) setTitle(t);
    else setValue(title);
  };
  return (
    <input
      className={s.title}
      aria-label="방 이름"
      value={value}
      maxLength={60}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setValue(title); e.currentTarget.blur(); }
      }}
    />
  );
}

/** Studio 상단 막대: 홈·제목·저장 상태·undo/redo·모드·AI·저장·공유·더보기 */
export default function TopBar({ requestSave }: { requestSave: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const store = useStudioStoreApi();
  const history = useStudio((st) => st.history);
  const mode = useStudio((st) => st.mode);
  const fileRef = useRef<HTMLInputElement>(null);
  const a = store.getState();

  const goHome = () => {
    const st = store.getState();
    if (st.dirty && !st.isDraft && !window.confirm('저장하지 않은 변경이 있어요. 홈으로 나갈까요?')) return;
    nav('/');
  };
  const exportJson = () => { const room = store.getState().room; if (room) downloadRoomJSON(room); };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    const room = await readRoomJSON(file).catch(() => null);
    if (!room) { toast.show('방 JSON 파일을 읽지 못했어요.', 'error'); return; }
    if (store.getState().dirty && !store.getState().isDraft && !window.confirm('지금 방의 저장하지 않은 변경이 사라져요. 가져올까요?')) return;
    store.getState().newDraft(room);
    nav('/studio/draft?mode=build');
    toast.show(`'${room.title}'을(를) 새 초안으로 열었어요.`);
  };
  const snapshot = () => {
    const st = store.getState();
    if (st.mode !== 'build') { st.setMode('build'); toast.show('3D 화면에서 다시 눌러 주세요.'); return; }
    const url = st.scene()?.capture();
    if (!url || !st.room) { toast.show('스냅샷을 만들지 못했어요.', 'error'); return; }
    const ext = url.startsWith('data:image/png') ? 'png' : 'jpg';
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(st.room.title)}.${ext}`;
    link.click();
  };

  return (
    <header className={s.bar}>
      <div className={s.left}>
        <IconButton aria-label="홈으로" icon={<BackIcon />} onClick={goHome} />
        <TitleEditor />
        <SaveState />
        <IconButton aria-label="되돌리기 (Ctrl+Z)" icon={<UndoIcon />} size="sm" disabled={!canUndo(history)} onClick={() => a.undo()} />
        <IconButton aria-label="다시 실행 (Ctrl+Y)" icon={<RedoIcon />} size="sm" disabled={!canRedo(history)} onClick={() => a.redo()} />
      </div>
      <div className={s.center}><ModeSwitch /></div>
      <div className={s.right}>
        <Menu
          aria-label="AI 기능"
          className={`${s.hideSm} ${s.aiMenu}`}
          trigger={<span className={s.aiTrigger}><SparkIcon /> AI ▾</span>}
          items={[
            { key: 'gen', label: '가구 만들기', onSelect: () => a.setPanel('ai', 'generate') },
            { key: 'rec', label: '배치 추천', onSelect: () => a.setPanel('ai', 'recommend') },
          ]}
        />
        <Button size="sm" variant="primary" onClick={requestSave}>저장</Button>
        <IconButton aria-label="공유" icon={<ShareIcon />} onClick={() => a.setPanel('share', true)} />
        <IconButton aria-label="편집 화면 설명서" icon={<HelpIcon />} onClick={() => a.setPanel('help', true)} />
        <Menu
          aria-label="더 보기"
          items={[
            { key: 'gen', label: 'AI 가구 만들기', onSelect: () => a.setPanel('ai', 'generate') },
            { key: 'rec', label: 'AI 배치 추천', onSelect: () => a.setPanel('ai', 'recommend') },
            { key: 'export', label: 'JSON 내보내기', onSelect: exportJson, divider: true },
            { key: 'import', label: 'JSON 가져오기', onSelect: () => fileRef.current?.click() },
            { key: 'snap', label: mode === 'build' ? '스냅샷 저장' : '스냅샷 저장 (3D)', onSelect: snapshot },
            { key: 'publish', label: '쇼룸에 게시', onSelect: () => a.setPanel('share', true), divider: true },
            { key: 'help', label: '화면 설명서 · 단축키', onSelect: () => a.setPanel('help', true) },
          ]}
        />
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void importJson(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </div>
    </header>
  );
}
