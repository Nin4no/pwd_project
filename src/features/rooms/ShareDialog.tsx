import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Modal, Tabs, useToast } from '../../design/components';
import type { Room } from '../../domain/types';
import { uid } from '../../domain/ids';
import { downloadRoomJSON, encodeRoom } from '../../domain/share';
import { useRepositories } from '../../app/providers';
import { useSessionStore } from '../session/store';
import { copyText, errorText } from './roomMeta';
import s from './Dialogs.module.css';

const AUTHOR_KEY = 'dyr:author';

const readAuthor = () => {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? '';
  } catch {
    return '';
  }
};

export interface ShareDialogProps {
  open: boolean;
  room: Room;
  /** 게시 전에 저장 보장 (썸네일 포함 최신 Room). 실패 시 null */
  ensureSaved: () => Promise<Room | null> | Room | null;
  onClose: () => void;
}

type Tab = 'link' | 'showroom';

/** 공유 (현행 ShareModal 이식): 링크 탭(v2 코드 + 길이 초과 경고 + JSON) / 쇼룸 게시 탭. WP5 Studio가 사용 */
export default function ShareDialog({ open, room, ensureSaved, onClose }: ShareDialogProps) {
  const nav = useNavigate();
  const toast = useToast();
  const { showroom } = useRepositories();
  const user = useSessionStore((st) => st.user);
  const isCloud = useSessionStore((st) => st.isCloud);
  const requireLogin = useSessionStore((st) => st.requireLogin);
  const needsLogin = isCloud && !user;

  const [tab, setTab] = useState<Tab>('link');
  const [title, setTitle] = useState(room.title);
  const [author, setAuthor] = useState(() => user?.displayName || readAuthor());
  const [desc, setDesc] = useState('');
  const [posting, setPosting] = useState(false);

  const encoded = useMemo(() => (open ? encodeRoom(room) : null), [open, room]);
  const link = encoded ? `${location.origin}${location.pathname}#/share?d=${encoded.code}` : '';

  const copy = async () => {
    if (await copyText(link)) toast.show('공유 링크가 복사되었습니다.');
  };

  const publish = async () => {
    if (needsLogin) {
      onClose();
      requireLogin('쇼룸에 공유하려면 로그인해 주세요.');
      return;
    }
    setPosting(true);
    try {
      const saved = await ensureSaved();
      if (!saved) return;
      const name = author.trim() || '익명의 디자이너';
      const postTitle = title.trim() || saved.title;
      try {
        localStorage.setItem(AUTHOR_KEY, name);
      } catch {
        // 저장 공간 제한 무시
      }
      await showroom.publish({
        id: uid('post_'),
        room: { ...saved, title: postTitle },
        author: name,
        authorId: user?.id,
        description: desc.trim() || `${postTitle}의 가구 배치를 공유합니다.`,
        likes: 0,
        remixCount: 0,
        sharedAt: Date.now(),
      });
      toast.show('쇼룸 갤러리에 공유되었습니다!');
      onClose();
      nav('/showroom');
    } catch (err) {
      toast.show(errorText(err, '쇼룸에 게시하지 못했습니다.'), 'error');
    } finally {
      setPosting(false);
    }
  };

  const linkPanel = (
    <div className={s.stack}>
      <Field
        label="공유 링크"
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        hint="받는 사람은 로그인 없이 3D로 볼 수 있습니다."
        trailing={
          <Button variant="primary" onClick={() => void copy()}>
            복사
          </Button>
        }
      />
      {encoded?.customSpecsDropped ? (
        <p className={s.warn} role="status">
          링크 길이 제한으로 AI 가구 모양이 빠졌습니다. 받는 쪽에서는 일부 가구가 기본 상자로 보입니다. 전체를 보내려면 JSON 파일을 쓰세요.
        </p>
      ) : null}
      <Button block onClick={() => downloadRoomJSON(room)}>
        JSON 파일로 내보내기
      </Button>
    </div>
  );

  const showroomPanel = (
    <div className={s.stack}>
      <Field label="게시물 제목" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 햇살 드는 원룸" maxLength={100} />
      <Field label="작성자 이름" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="예: 이지은" maxLength={20} />
      <Field
        label="소개글"
        multiline
        rows={3}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="배치 포인트를 소개해 주세요"
        maxLength={200}
      />
      {needsLogin ? (
        <p className={s.info} role="status">
          <span className={s.infoTitle}>로그인이 필요합니다</span>
          <span>쇼룸에 공유하려면 로그인해 주세요.</span>
        </p>
      ) : null}
      <Button variant="primary" block loading={posting} onClick={() => void publish()}>
        {needsLogin ? '로그인하고 공유하기' : '쇼룸에 게시하기'}
      </Button>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} size="sm" title="내 방 공유하기">
      <Tabs<Tab>
        aria-label="공유 방법"
        fill
        value={tab}
        onChange={setTab}
        items={[
          { value: 'link', label: '링크 공유', panel: linkPanel },
          { value: 'showroom', label: '쇼룸 게시', panel: showroomPanel },
        ]}
      />
    </Modal>
  );
}
