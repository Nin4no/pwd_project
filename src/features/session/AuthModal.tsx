import { useEffect, useState, type FormEvent } from 'react';
import { Badge, Button, Field, Modal, Segmented } from '../../design/components';
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

const errMsg = (err: unknown): string => {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    const msg = ((err as { message: string }).message || '').trim();
    if (msg) return msg;
  }
  return '잠시 후 다시 시도해 주세요.';
};

function readErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

const sanitizeOtp = (raw: string): string => raw.replace(/\D+/g, '').slice(0, 6);

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
        if (!useSessionStore.getState().mfaChallenge) {
          closeAuthModal();
        }
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

function MfaChallengeForm() {
  const mfaChallenge = useSessionStore((st) => st.mfaChallenge);
  const verifyMfaChallenge = useSessionStore((st) => st.verifyMfaChallenge);
  const cancelMfaChallenge = useSessionStore((st) => st.cancelMfaChallenge);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const clean = sanitizeOtp(code);
    if (clean.length !== 6) {
      setNotice({ title: '인증 코드를 확인해 주세요', message: '인증 앱의 6자리 숫자 코드를 입력해 주세요.' });
      return;
    }
    setBusy(true);
    try {
      await verifyMfaChallenge(clean);
    } catch (err: unknown) {
      const c = classifyAuthError(err);
      setNotice({ title: c.title, message: c.message });
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={s.form} onSubmit={onSubmit} noValidate>
      <p className={s.mfaDesc}>
        인증 앱(Google Authenticator 등)에 표시된 6자리 일회용 인증 코드를 입력해 주세요.
        {mfaChallenge?.email ? (
          <>
            <br />
            <span className={s.mfaEmail}>{mfaChallenge.email}</span>
          </>
        ) : null}
      </p>
      <Field
        label="인증 코드 (6자리)"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        className={s.otpField}
        value={code}
        onChange={(e) => {
          setCode(sanitizeOtp(e.target.value));
          if (notice) setNotice(null);
        }}
        data-autofocus=""
      />
      {notice ? <NoticeText notice={notice} /> : null}
      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={code.length !== 6}>
        인증 확인
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="md"
        block
        disabled={busy}
        onClick={() => {
          void cancelMfaChallenge();
        }}
      >
        취소
      </Button>
    </form>
  );
}

function AccountPanel({ user }: { user: User }) {
  const signOut = useSessionStore((st) => st.signOut);
  const updateProfile = useSessionStore((st) => st.updateProfile);
  const deactivate = useSessionStore((st) => st.deactivate);
  const closeAuthModal = useSessionStore((st) => st.closeAuthModal);
  const mfa = useSessionStore((st) => st.mfa);
  const loadMfaStatus = useSessionStore((st) => st.loadMfaStatus);
  const startMfaEnroll = useSessionStore((st) => st.startMfaEnroll);
  const confirmMfaEnroll = useSessionStore((st) => st.confirmMfaEnroll);
  const cancelMfaEnroll = useSessionStore((st) => st.cancelMfaEnroll);
  const verifyMfaChallenge = useSessionStore((st) => st.verifyMfaChallenge);
  const unenrollMfa = useSessionStore((st) => st.unenrollMfa);

  const [name, setName] = useState(user.displayName);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [enrollCode, setEnrollCode] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);

  const [unenrollStepUpOpen, setUnenrollStepUpOpen] = useState(false);
  const [unenrollCode, setUnenrollCode] = useState('');

  const [deactivateStepUpOpen, setDeactivateStepUpOpen] = useState(false);
  const [deactivateCode, setDeactivateCode] = useState('');

  useEffect(() => {
    if (mfa.supported) {
      void loadMfaStatus().catch(() => {});
    }
  }, [mfa.supported, loadMfaStatus]);

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

  const onStartEnroll = async () => {
    setNotice(null);
    setInfo(null);
    setEnrollCode('');
    setCopiedSecret(false);
    setBusy(true);
    try {
      await startMfaEnroll();
    } catch (err: unknown) {
      const c = classifyAuthError(err);
      setNotice({ title: c.title, message: c.message });
    } finally {
      setBusy(false);
    }
  };

  const onConfirmEnroll = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setInfo(null);
    const clean = sanitizeOtp(enrollCode);
    if (clean.length !== 6) {
      setNotice({ title: '인증 코드를 확인해 주세요', message: '인증 앱의 6자리 숫자 코드를 입력해 주세요.' });
      return;
    }
    setBusy(true);
    try {
      await confirmMfaEnroll(clean);
      setEnrollCode('');
      setInfo('2단계 인증(TOTP)이 활성화되었습니다.');
    } catch (err: unknown) {
      const c = classifyAuthError(err);
      setNotice({ title: c.title, message: c.message });
      setEnrollCode('');
    } finally {
      setBusy(false);
    }
  };

  const onCancelEnroll = async () => {
    setNotice(null);
    setEnrollCode('');
    setBusy(true);
    try {
      await cancelMfaEnroll();
    } catch (err: unknown) {
      setNotice({ title: '등록 취소에 실패했습니다', message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  const onCopySecret = async (secret: string) => {
    try {
      await navigator.clipboard?.writeText(secret);
      setCopiedSecret(true);
      window.setTimeout(() => setCopiedSecret(false), 1800);
    } catch {
      // 클립보드 권한 거부 시 무시
    }
  };

  const onClickUnenroll = async () => {
    setNotice(null);
    setInfo(null);
    if (mfa.currentLevel !== 'aal2') {
      setUnenrollStepUpOpen(true);
      setUnenrollCode('');
      return;
    }
    if (!window.confirm('2단계 인증을 해제하시겠습니까?')) return;
    setBusy(true);
    try {
      await unenrollMfa();
      setInfo('2단계 인증이 해제되었습니다.');
    } catch (err: unknown) {
      const c = classifyAuthError(err);
      setNotice({ title: c.title, message: c.message });
    } finally {
      setBusy(false);
    }
  };

  const onConfirmUnenrollStepUp = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setInfo(null);
    const clean = sanitizeOtp(unenrollCode);
    if (clean.length !== 6) {
      setNotice({ title: '인증 코드를 확인해 주세요', message: '해제를 위해 6자리 숫자 코드를 입력해 주세요.' });
      return;
    }
    setBusy(true);
    try {
      await verifyMfaChallenge(clean);
      await unenrollMfa();
      setUnenrollStepUpOpen(false);
      setUnenrollCode('');
      setInfo('2단계 인증이 해제되었습니다.');
    } catch (err: unknown) {
      const c = classifyAuthError(err);
      setNotice({ title: c.title, message: c.message });
      setUnenrollCode('');
    } finally {
      setBusy(false);
    }
  };

  const onDeactivate = async () => {
    setNotice(null);
    setInfo(null);
    if (mfa.enrolled && mfa.currentLevel !== 'aal2') {
      setDeactivateStepUpOpen(true);
      setDeactivateCode('');
      return;
    }
    if (!window.confirm('정말로 계정을 비활성화하시겠습니까? 비활성화 시 로그아웃되며 계정이 비활성화됩니다.')) return;
    setBusy(true);
    try {
      await deactivate();
      closeAuthModal();
    } catch (err: unknown) {
      if (readErrorCode(err) === 'MFA_STEP_UP_REQUIRED') {
        setDeactivateStepUpOpen(true);
        setDeactivateCode('');
        setNotice({ title: '2단계 인증이 필요합니다', message: errMsg(err) });
      } else {
        setNotice({ title: '계정 비활성화에 실패했습니다', message: errMsg(err) });
      }
      setBusy(false);
    }
  };

  const onConfirmDeactivateStepUp = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setInfo(null);
    const clean = sanitizeOtp(deactivateCode);
    if (clean.length !== 6) {
      setNotice({ title: '인증 코드를 확인해 주세요', message: '탈퇴 확인을 위해 6자리 숫자 코드를 입력해 주세요.' });
      return;
    }
    setBusy(true);
    try {
      await verifyMfaChallenge(clean);
      await deactivate();
      closeAuthModal();
    } catch (err: unknown) {
      setNotice({ title: '계정 비활성화에 실패했습니다', message: errMsg(err) });
      setDeactivateCode('');
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

          {mfa.supported ? (
            <div className={s.mfaSection}>
              <div className={s.mfaHeader}>
                <span className={s.mfaTitle}>2단계 인증 (TOTP)</span>
                <Badge tone={mfa.enrolled ? 'success' : 'neutral'}>{mfa.enrolled ? '사용 중' : '미설정'}</Badge>
              </div>

              {!mfa.enrolled && !mfa.enrollment ? (
                <>
                  <p className={s.mfaDesc}>
                    로그인 및 회원 탈퇴 시 인증 앱의 6자리 일회용 코드를 추가로 확인하여 계정을 보호합니다.
                  </p>
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={busy || mfa.loading}
                      onClick={() => void onStartEnroll()}
                    >
                      2단계 인증 설정
                    </Button>
                  </div>
                </>
              ) : null}

              {mfa.enrollment ? (
                <form className={s.enrollCard} onSubmit={onConfirmEnroll} noValidate>
                  <p className={s.mfaDesc}>
                    인증 앱(Google Authenticator, Authy 등)에서 아래 QR 코드를 스캔한 뒤 6자리 코드를 입력해 주세요.
                  </p>
                  <div className={s.qrWrap}>
                    <img src={mfa.enrollment.qrCode} alt="2단계 인증 QR 코드" className={s.qrImage} />
                  </div>
                  <div className={s.secretBox}>
                    <span className={s.secretLabel}>수동 입력 키</span>
                    <div className={s.secretRow}>
                      <code className={s.secretCode}>{mfa.enrollment.secret}</code>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void onCopySecret(mfa.enrollment!.secret)}
                      >
                        {copiedSecret ? '복사됨' : '복사'}
                      </Button>
                    </div>
                  </div>
                  <Field
                    label="인증 코드 (6자리)"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    className={s.otpField}
                    value={enrollCode}
                    onChange={(e) => {
                      setEnrollCode(sanitizeOtp(e.target.value));
                      if (notice) setNotice(null);
                    }}
                  />
                  <div className={s.actionRow}>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      loading={busy}
                      disabled={enrollCode.length !== 6}
                    >
                      등록 완료
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onCancelEnroll()}
                    >
                      취소
                    </Button>
                  </div>
                </form>
              ) : null}

              {mfa.enrolled ? (
                <>
                  <p className={s.mfaDesc}>인증 앱을 통한 2단계 보안 인증이 적용되어 있습니다.</p>
                  {!unenrollStepUpOpen ? (
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy || mfa.loading}
                        onClick={() => void onClickUnenroll()}
                      >
                        2단계 인증 해제
                      </Button>
                    </div>
                  ) : (
                    <form className={s.stepUpBox} onSubmit={onConfirmUnenrollStepUp} noValidate>
                      <p className={s.mfaDesc}>해제를 위해 인증 앱의 6자리 코드를 입력해 주세요.</p>
                      <Field
                        label="인증 코드 (6자리)"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        className={s.otpField}
                        value={unenrollCode}
                        onChange={(e) => {
                          setUnenrollCode(sanitizeOtp(e.target.value));
                          if (notice) setNotice(null);
                        }}
                      />
                      <div className={s.actionRow}>
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          loading={busy}
                          disabled={unenrollCode.length !== 6}
                        >
                          인증 후 해제
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setUnenrollStepUpOpen(false);
                            setUnenrollCode('');
                          }}
                        >
                          취소
                        </Button>
                      </div>
                    </form>
                  )}
                </>
              ) : null}
            </div>
          ) : null}

          <div className={s.deactivateWrap}>
            <button type="button" className={s.deactivate} onClick={() => void onDeactivate()} disabled={busy}>
              회원 탈퇴
            </button>
            {deactivateStepUpOpen ? (
              <form className={`${s.stepUpBox} ${s.stepUpDanger}`} onSubmit={onConfirmDeactivateStepUp} noValidate>
                <p className={s.mfaDesc}>
                  회원 탈퇴를 진행하려면 인증 앱의 6자리 코드를 입력해 본인임을 확인해 주세요. 탈퇴 즉시 계정이
                  비활성화되고 로그아웃됩니다.
                </p>
                <Field
                  label="탈퇴 확인 인증 코드 (6자리)"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  className={s.otpField}
                  value={deactivateCode}
                  onChange={(e) => {
                    setDeactivateCode(sanitizeOtp(e.target.value));
                    if (notice) setNotice(null);
                  }}
                />
                <div className={s.actionRow}>
                  <Button
                    type="submit"
                    variant="danger"
                    size="sm"
                    loading={busy}
                    disabled={deactivateCode.length !== 6}
                  >
                    인증 및 회원 탈퇴
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setDeactivateStepUpOpen(false);
                      setDeactivateCode('');
                    }}
                  >
                    취소
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </details>
    </div>
  );
}

/** 로그인/가입·2단계 인증·계정 관리 모달. 상태는 useSessionStore(authModalOpen·authNotice·mfaChallenge) */
export default function AuthModal() {
  const open = useSessionStore((st) => st.authModalOpen);
  const user = useSessionStore((st) => st.user);
  const mfaChallenge = useSessionStore((st) => st.mfaChallenge);
  const authNotice = useSessionStore((st) => st.authNotice) as Notice | null;
  const closeAuthModal = useSessionStore((st) => st.closeAuthModal);
  const cancelMfaChallenge = useSessionStore((st) => st.cancelMfaChallenge);

  const handleClose = () => {
    if (!user && mfaChallenge) {
      void cancelMfaChallenge();
    }
    closeAuthModal();
  };

  const title = user ? '내 계정 정보' : mfaChallenge ? '2단계 인증' : '계정 로그인';

  return (
    <Modal open={open} onClose={handleClose} size="sm" title={title}>
      {user ? (
        <AccountPanel key={user.id} user={user} />
      ) : mfaChallenge ? (
        <MfaChallengeForm />
      ) : (
        <SignInForm initialNotice={authNotice} />
      )}
    </Modal>
  );
}
