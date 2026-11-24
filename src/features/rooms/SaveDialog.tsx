import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Modal } from '../../design/components';
import type { Room } from '../../domain/types';
import { formatPyeong } from './roomMeta';
import s from './Dialogs.module.css';

export interface SaveDialogProps {
  open: boolean;
  room: Room;
  /** 첫 저장 여부 (문구만 다름) */
  isDraft: boolean;
  onSave: (title: string) => void;
  onClose: () => void;
  /** 저장 진행 중 */
  saving?: boolean;
}

/** 저장 전 방 이름 확인 (현행 SaveModal 이식). WP5 Studio가 사용 */
export default function SaveDialog({ open, room, isDraft, onSave, onClose, saving }: SaveDialogProps) {
  const [title, setTitle] = useState(room.title);
  useEffect(() => {
    if (open) setTitle(room.title);
  }, [open, room.title]);
  const trimmed = title.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed) onSave(trimmed);
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" title={isDraft ? '새 방 저장' : '저장하기'}>
      <form className={s.stack} onSubmit={submit}>
        <Field
          label="방 이름"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 햇살 드는 원룸"
          maxLength={40}
          onFocus={(e) => e.currentTarget.select()}
          data-autofocus=""
        />
        <p className={s.summary}>
          <span className="num">{formatPyeong(room)}</span>평 · 가구 <span className="num">{room.furniture.length}</span>개
        </p>
        <div className={s.actions}>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" variant="primary" disabled={!trimmed} loading={saving}>
            저장
          </Button>
        </div>
      </form>
    </Modal>
  );
}
