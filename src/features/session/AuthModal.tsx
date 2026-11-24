import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Modal, Segmented } from '../../design/components';
import type { User } from '../../domain/types';
import { classifyAuthError } from './authErrors';
import SocialLoginButtons from './SocialLoginButtons';
import { useSessionStore } from './store';
import s from './AuthModal.module.css';

interface Notice {
  title: string;
  message: string;
  tone?: 'error' | 'info';
}

type Tab = 'signin' | 'signup';

function NoticeText({ notice }: { notice: Notice }) {
  const info = notice.tone === 'info';
  return (
    <p className={`${s.notice}${info ? ` ${s.info}` : ''}`} role={info ? 'status' : 'alert'}>
      <span className={s.noticeTitle}>{notice.title}</span>
      <span>{notice.message}</span>
    </p>
  );
}

const errMsg = (err: unknown) => (err instanceof Error && err.message ? err.message : '잠시 후 다시 시도해 주세요.');

function SignInForm({ initialNotice }: { initialNotice: Notice | null }) {
  const signIn = useSessionStore((st) => st.signIn);
  const signUp = useSessionStore((st) => st.signUp);
  const closeAuthModal = useSessionStore((st) => st.closeAuthModal);
  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [notice, setNotice] = useState<Notice | null>(initialNotice);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setNotice(initialNotice), [initialNotice]);

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (notice) setNotice(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setInfo(null);
    const cleanEmail = email.trim();
    if (!cleanEmail) return setNotice({ title: '이메일을 입력해 주세요', message: '로그인에 사용할 이메일 주소가 필요합니다.' });
    if (!password) return setNotice({ title: '비밀번호를 입력해 주세요', message: '계정 비밀번호를 입력해 주세요.' });
    if (tab === 'signup' && !displayName.trim())
      return setNotice({ title: '닉네임을 입력해 주세요', message: '서비스에서 표시할 닉네임을 입력해 주세요.' });

    setBusy(true);
    try {
      if (tab === 'signin') {
        await signIn(cleanEmail, password);
        closeAuthModal();
      } else {
        await signUp(cleanEmail, password, displayName.trim());
        // 이메일 확인이 필요한 가입은 세션이 없음 → 안내 후 창 유지
        if (useSessionStore.getState().user) closeAuthModal();
        else setInfo('회원가입 요청이 완료되었습니다. 확인 메일을 확인해 주세요.');
      }
    } catch (err: unknown) {
      const c = classifyAuthError(err);
      setNotice({ title: c.title, message: c.message });
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={s.form} onSubmit={onSubmit} noValidate>
      <Segmented<Tab>
        aria-label="로그인 또는 회원가입"
        block
        value={tab}
        onChange={(t) => {
          setTab(t);
          setNotice(null);
          setInfo(null);
        }}
        options={[
          { value: 'signin', label: '로그인' },
          { value: 'signup', label: '회원가입' },
        ]}
      />
      {info ? (
        <p className={`${s.notice} ${s.info}`} role="status">
          {info}
        </p>
      ) : null}
      <Field
        label="이메일"
        type="email"
        placeholder="user@example.com"
        autoComplete="email"
        value={email}
        onChange={(e) => edit(setEmail)(e.target.value)}
        data-autofocus=""
      />
      {tab === 'signup' ? (
        <Field
          label="닉네임"
          type="text"
          placeholder="표시할 이름"
          value={displayName}
          onChange={(e) => edit(setDisplayName)(e.target.value)}
        />
      ) : null}
      <Field
        label="비밀번호"
        type="password"
        placeholder="비밀번호"
        autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => edit(setPassword)(e.target.value)}
      />
      {notice ? <NoticeText notice={notice} /> : null}
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        {tab === 'signin' ? '로그인' : '회원가입'}
      </Button>
      <div className={s.divider}>
        <span>또는</span>
      </div>
      <SocialLoginButtons />
    </form>
  );
}

function AccountPanel({ user }: { user: User }) {
  const signOut = useSessionStore((st) => st.signOut);
  const updateProfile = useSessionStore((st) => st.updateProfile);
  const deactivate = useSessionStore((st) => st.deactivate);
  const closeAuthModal = useSessionStore((st) => st.closeAuthModal);
  const [name, setName] = useState(user.displayName);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onRename = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setInfo(null);
    const clean = name.trim();
    if (!clean) return setNotice({ title: '닉네임을 입력해 주세요', message: '변경할 닉네임이 비어 있습니다.' });
    setBusy(true);
    try {
      await updateProfile(clean);
      setInfo('프로필이 수정되었습니다.');
    } catch (err: unknown) {
      setNotice({ title: '프로필 수정에 실패했습니다', message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  const onDeactivate = async () => {
    if (!window.confirm('정말로 계정을 비활성화하시겠습니까? 비활성화 시 로그아웃되며 계정이 비활성화됩니다.')) return;
    setBusy(true);
    try {
      await deactivate();
      closeAuthModal();
    } catch (err: unknown) {
      setNotice({ title: '계정 비활성화에 실패했습니다', message: errMsg(err) });
      setBusy(false);
    }
  };

  return (
    <div className={s.form}>
      {notice ? <NoticeText notice={notice} /> : null}
      {info ? (
        <p className={`${s.notice} ${s.info}`} role="status">
          {info}
        </p>
      ) : null}
      <div className={s.profile}>
        <span className={s.avatar} aria-hidden="true">
          {user.avatar ? <img src={user.avatar} alt="" /> : user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className={s.profileText}>
          <span className={s.profileName}>{user.displayName}</span>
          <span className={s.profileEmail}>{user.email || '소셜 계정'}</span>
        </div>
      </div>
      <Button
        variant="danger"
        size="lg"
        block
        disabled={busy}
        onClick={async () => {
          await signOut();
          closeAuthModal();
        }}
      >
        로그아웃
      </Button>
      <details className={s.manage}>
        <summary className={s.summary}>계정 관리</summary>
        <div className={s.manageBody}>
          <form onSubmit={onRename}>
            <Field
              label="닉네임 변경"
              type="text"
              placeholder="변경할 닉네임"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (notice) setNotice(null);
              }}
              trailing={
                <Button type="submit" size="md" disabled={busy || !name.trim() || name.trim() === user.displayName}>
                  저장
                </Button>
              }
            />
          </form>
          <button type="button" className={s.deactivate} onClick={onDeactivate} disabled={busy}>
            회원 탈퇴
          </button>
        </div>
      </details>
    </div>
  );
}

/** 로그인/가입·계정 관리 모달. 상태는 useSessionStore(authModalOpen·authNotice) */
export default function AuthModal() {
  const open = useSessionStore((st) => st.authModalOpen);
  const user = useSessionStore((st) => st.user);
  const authNotice = useSessionStore((st) => st.authNotice) as Notice | null;
  const closeAuthModal = useSessionStore((st) => st.closeAuthModal);

  return (
    <Modal open={open} onClose={closeAuthModal} size="sm" title={user ? '내 계정 정보' : '계정 로그인'}>
      {user ? <AccountPanel key={user.id} user={user} /> : <SignInForm initialNotice={authNotice} />}
    </Modal>
  );
}
