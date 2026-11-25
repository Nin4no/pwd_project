import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Modal } from '../../design/components';
import { useStudio } from './context';
import { STUDIO_SHORTCUTS } from './types';
import s from './HelpDialog.module.css';

type PartId = 'topbar' | 'plan' | 'build' | 'ai';

interface GuideCard {
  title: string;
  tag?: string;
  desc: string;
}

interface GuidePart {
  id: PartId;
  code: string;
  tabLabel: string;
  title: string;
  zones: ReadonlyArray<'top' | 'left' | 'center' | 'right' | 'dock'>;
  cards: ReadonlyArray<GuideCard>;
}

const STUDIO_GUIDE_PARTS: ReadonlyArray<GuidePart> = [
  {
    id: 'topbar',
    code: 'PART 01',
    tabLabel: '상단 막대',
    title: '상단 도구 막대 · 저장 및 공유',
    zones: ['top'],
    cards: [
      {
        title: '방 이름 · 저장 상태 · Undo/Redo',
        tag: 'Ctrl+Z/Y',
        desc: '제목을 눌러 방 이름을 고치고, 상태 배지(저장 전·변경됨·저장됨) 옆 버튼으로 작업을 되돌리거나 다시 실행해요.',
      },
      {
        title: '2D 도면 ↔ 3D 배치 전환',
        tag: 'M',
        desc: '중앙 스위치를 누르면 벽·문을 그리는 2D 도면 모드와 가구를 놓는 3D 배치 모드를 즉시 오갈 수 있어요.',
      },
      {
        title: '저장 · 공유 · ? 설명서',
        tag: 'Ctrl+S',
        desc: '저장으로 내 계정/브라우저에 보관하고, 공유 버튼으로 쇼룸에 게시하거나 링크·JSON 파일로 나눌 수 있어요.',
      },
      {
        title: '⋯ 더 보기 메뉴',
        tag: 'PNG/JSON',
        desc: 'JSON 내보내기·가져오기와 현재 3D 장면을 이미지로 내려받는 스냅샷 저장 기능을 모아 두었어요.',
      },
    ],
  },
  {
    id: 'plan',
    code: 'PART 02',
    tabLabel: '2D 도면',
    title: '2D 도면 그리기 & 방 크기 설정',
    zones: ['left', 'center', 'right'],
    cards: [
      {
        title: '도면 도구 5종',
        tag: '1~5',
        desc: '1 선택(V) · 2 벽 · 3 사각형(R) · 4 문 · 5 지우개(E)로 방 구조를 그려요. 벽을 이어 시작점에 닫거나 사각형을 그리면 바닥과 면적이 완성돼요.',
      },
      {
        title: '화면 이동 · 확대 · 맞춤',
        tag: 'Space · 휠 · F',
        desc: '마우스 휠로 확대/축소하고, Space+드래그·휠 드래그·트랙패드·WASD/방향키로 화면을 이동해요. F 키나 화면 맞춤으로 한눈에 맞춰요.',
      },
      {
        title: 'AI 사진 변환 · 배경 사진',
        tag: '사진→방',
        desc: '좌측 하단 사진으로 만들기로 도면·방 사진을 올려 구조를 세우고, 적용된 배경 사진은 숨기기/보이기 버튼으로 켜고 끌 수 있어요.',
      },
      {
        title: '방 크기 정밀 조절 · 문 경첩/방향',
        tag: '0.01m · Shift',
        desc: '도면 드래그는 0.1m 단위로 맞춰지며, 우측 방 크기에서 가로·세로를 0.01m 단위로 정밀 조절해요. 벽 높이(2~5m)와 문 경첩·방향(Shift+클릭)도 우측에서 바꿔요.',
      },
    ],
  },
  {
    id: 'build',
    code: 'PART 03',
    tabLabel: '3D 배치',
    title: '3D 가구 배치 · 카메라 · 조명',
    zones: ['left', 'center', 'right', 'dock'],
    cards: [
      {
        title: '좌측 가구 카탈로그',
        tag: 'Drag/Click',
        desc: '검색·카테고리 탭으로 가구를 찾아 3D 공간으로 끌어다 놓거나 클릭해 배치해요. AI로 만든 가구도 여기에 모여요.',
      },
      {
        title: '우측 가구 속성 · 배치 목록',
        tag: 'R · Q/E',
        desc: '회전·크기·위치 미세 조절, 복제(Ctrl+D), 삭제(Delete)를 지원하며, 배치 목록 탭에서 겹친 가구를 빠르게 찾아요.',
      },
      {
        title: '가려진 가구 투시(보기)',
        tag: 'F',
        desc: '가구를 클릭하거나 보기(F)를 누르면 카메라 앞을 가리는 벽·큰 가구가 자동으로 반투명해져 안쪽까지 확인돼요.',
      },
      {
        title: '하단 카메라 · 조명 · 스마트 정렬',
        tag: 'Shift+드래그 · WASD',
        desc: '3D/탑뷰/걷기(WASD) 시점과 조명을 바꾸고, 벽에 붙이기 또는 Shift+드래그 바닥 가이드선(밀착·모서리·중앙)으로 가구를 반듯하게 맞춰요.',
      },
    ],
  },
  {
    id: 'ai',
    code: 'PART 04',
    tabLabel: 'AI · 단축키',
    title: 'AI 도구 활용 & 키보드 단축키',
    zones: ['top', 'right'],
    cards: [
      {
        title: 'AI 가구 만들기 (말로 만들기 / 사진으로 추출)',
        tag: 'Ctrl+V',
        desc: '상단 AI 메뉴의 가구 만들기에서 말로 만들기 탭에 설명을 적거나, 사진으로 추출 탭에 이미지 업로드·붙여넣기(Ctrl+V)로 가구를 생성해요.',
      },
      {
        title: 'AI 배치 추천 (4종 프리셋)',
        tag: '자동 배치',
        desc: '풀옵션 원룸, 홈오피스 & 서재, 아늑한 침실, 거실 & 라운지 중 스타일을 고르면 방 크기에 맞춰 배치해요. Ctrl+Z로 되돌릴 수 있어요.',
      },
    ],
  },
];

function PartPreview({ part }: { part: GuidePart }) {
  const has = (z: GuidePart['zones'][number]) => part.zones.includes(z);
  const topActive = has('top');
  const leftLabel = part.id === 'plan' ? '도면 도구' : part.id === 'build' ? '카탈로그' : '좌측 패널';
  const rightLabel =
    part.id === 'plan' ? '도면 속성' : part.id === 'build' ? '속성·목록' : part.id === 'ai' ? 'AI 드로어' : '우측 패널';

  return (
    <div className={s.diagram} aria-hidden="true">
      <div className={`${s.zoneTop}${topActive ? ` ${s.zoneActive}` : ''}`}>
        <span>홈 · 방 이름 · 상태 · Undo/Redo</span>
        <span>2D 도면 | 3D 배치</span>
        <span>AI · 저장 · 공유 · ? · ⋯</span>
      </div>
      <div className={s.zoneBody}>
        <div className={`${s.zoneSide}${has('left') ? ` ${s.zoneActive}` : ''}`}>{leftLabel}</div>
        <div className={`${s.zoneCanvasWrap}${has('center') ? ` ${s.zoneActive}` : ''}`}>
          <span>{part.id === 'plan' ? '2D 도면 캔버스' : '3D 공간 캔버스'}</span>
          {part.id !== 'plan' ? (
            <div className={`${s.zoneDock}${has('dock') ? ` ${s.zoneActive}` : ''}`}>
              3D · 탑뷰 · 걷기 | 주간·오후·야간 | 벽에 붙이기
            </div>
          ) : null}
        </div>
        <div className={`${s.zoneSide}${has('right') ? ` ${s.zoneActive}` : ''}`}>{rightLabel}</div>
      </div>
    </div>
  );
}

/** 편집 화면 파트별 슬라이딩 설명서 모달 */
export default function HelpDialog() {
  const open = useStudio((st) => st.panels.help);
  const setPanel = useStudio((st) => st.setPanel);
  const [partIdx, setPartIdx] = useState(0);
  const dirRef = useRef<'next' | 'prev'>('next');
  const shouldAnimateRef = useRef(false);
  const slideRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const total = STUDIO_GUIDE_PARTS.length;
  const part = STUDIO_GUIDE_PARTS[partIdx];
  const close = useCallback(() => setPanel('help', false), [setPanel]);

  const goTo = useCallback(
    (nextIdx: number, syncDotFocus = false) => {
      const clamped = Math.max(0, Math.min(total - 1, nextIdx));
      if (clamped === partIdx) return;
      dirRef.current = clamped > partIdx ? 'next' : 'prev';
      shouldAnimateRef.current = true;
      setPartIdx(clamped);
      if (syncDotFocus) {
        dotRefs.current[clamped]?.focus();
      }
    },
    [partIdx, total],
  );

  // 열거나 닫을 때 1파트로 초기화하고 진행 중인 애니메이션을 정리
  useEffect(() => {
    shouldAnimateRef.current = false;
    setPartIdx(0);
    if (!open) {
      animRef.current?.cancel();
      animRef.current = null;
    }
  }, [open]);

  // 좌우 화살표 키 및 Home/End로 파트 전환
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const active = document.activeElement as HTMLButtonElement | null;
      const syncDotFocus = Boolean(active && dotRefs.current.includes(active));

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        goTo(partIdx + 1, syncDotFocus);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        goTo(partIdx - 1, syncDotFocus);
      } else if (e.key === 'Home') {
        e.preventDefault();
        e.stopPropagation();
        goTo(0, syncDotFocus);
      } else if (e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        goTo(total - 1, syncDotFocus);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, partIdx, total, goTo]);

  useLayoutEffect(() => {
    if (!open || !shouldAnimateRef.current) return;
    shouldAnimateRef.current = false;

    const el = slideRef.current;
    if (!el || typeof el.animate !== 'function') return;
    animRef.current?.cancel();
    animRef.current = null;

    const easing =
      window.getComputedStyle(el).getPropertyValue('--ease-out').trim() ||
      'cubic-bezier(0.23, 1, 0.32, 1)';
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const offset = dirRef.current === 'next' ? '28px' : '-28px';

    const anim = el.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { transform: `translate3d(${offset}, 0, 0)`, opacity: 0 },
            { transform: 'translate3d(0, 0, 0)', opacity: 1 },
          ],
      { duration: reduced ? 120 : 260, easing, fill: 'backwards' },
    );
    animRef.current = anim;
    anim.onfinish = () => {
      if (animRef.current === anim) animRef.current = null;
    };
  }, [open, partIdx]);

  useEffect(
    () => () => {
      animRef.current?.cancel();
      animRef.current = null;
    },
    [],
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title="편집 화면 설명서"
      size="lg"
      className={s.dialog}
      footer={
        <div className={s.footer}>
          <div className={s.dots} role="group" aria-label="설명서 페이지">
            {STUDIO_GUIDE_PARTS.map((item, idx) => (
              <button
                key={item.id}
                ref={(el) => {
                  dotRefs.current[idx] = el;
                }}
                type="button"
                className={s.dot}
                aria-label={`${idx + 1}번째 파트 (${item.tabLabel})`}
                aria-current={idx === partIdx ? 'step' : undefined}
                onClick={() => goTo(idx)}
              />
            ))}
          </div>
          <div className={s.actions}>
            <Button
              size="sm"
              variant="secondary"
              disabled={partIdx === 0}
              onClick={() => goTo(partIdx - 1)}
            >
              이전
            </Button>
            {partIdx < total - 1 ? (
              <Button size="sm" variant="primary" onClick={() => goTo(partIdx + 1)}>
                다음
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={close}>
                시작하기
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className={s.viewport}>
        <div
          key={part.id}
          ref={slideRef}
          className={s.slide}
          role="group"
          aria-roledescription="slide"
          aria-label={part.title}
        >
          <div className={s.partHead}>
            <div className={s.partEyebrowRow}>
              <span className={s.partEyebrow}>{part.code}</span>
              <span className={s.partDivider} aria-hidden="true">
                ·
              </span>
              <span className={s.counter} aria-live="polite" aria-atomic="true">
                {partIdx + 1} / {total}
              </span>
            </div>
            <h3 className={s.partTitle}>{part.title}</h3>
          </div>
          <PartPreview part={part} />
          <div className={s.cards}>
            {part.cards.map((card) => (
              <article key={card.title} className={s.card}>
                <div className={s.cardTitle}>
                  <span>{card.title}</span>
                  {card.tag ? <span className={s.cardTag}>{card.tag}</span> : null}
                </div>
                <p className={s.cardDesc}>{card.desc}</p>
              </article>
            ))}
          </div>
          {part.id === 'ai' ? (
            <div className={s.shortcutSection}>
              <span className={s.shortcutLabel}>키보드 단축키 한눈에 보기</span>
              <div className={s.shortcutGrid}>
                {STUDIO_SHORTCUTS.map((item) => (
                  <div key={item.keys} className={s.shortcutItem}>
                    <span>{item.label}</span>
                    <kbd>{item.keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
