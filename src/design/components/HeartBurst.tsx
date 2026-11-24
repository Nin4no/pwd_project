import { useEffect, useRef, useState, type CSSProperties } from 'react';
import s from './HeartBurst.module.css';

export interface HeartBurstProps {
  /** 값이 바뀔 때마다(초기 마운트·0 제외) 버스트 애니메이션 1회 재생 */
  trigger: number;
}

interface Particle {
  id: number;
  dx: number;
  peakY: number;
  endY: number;
  size: number;
  alpha: number;
  scale: number;
  rotMid: number;
  rotEnd: number;
  duration: number;
  delay: number;
  color: string;
}

const HEART_TINTS = [
  'var(--danger)',
  'color-mix(in srgb, var(--danger) 82%, #ffffff)',
  'color-mix(in srgb, var(--danger) 88%, #ff9eb5)',
] as const;

function createParticles(): Particle[] {
  const count = 6 + Math.floor(Math.random() * 3);
  const arcStart = -Math.PI * 0.86;
  const arcSpan = Math.PI * 0.72;
  const sector = arcSpan / count;

  return Array.from({ length: count }, (_, i) => {
    const angle = arcStart + sector * (i + 0.15 + Math.random() * 0.7);
    const dist = 16 + Math.random() * 16;
    const dx = Math.cos(angle) * dist * 1.1;
    const peakY = Math.sin(angle) * dist - (4 + Math.random() * 6);
    const endY = 8 + Math.random() * 13;
    const size = Math.round((8 + Math.random() * 4) * 10) / 10;
    const alpha = Math.round((0.75 + Math.random() * 0.25) * 100) / 100;
    const scale = Math.round((0.88 + Math.random() * 0.28) * 100) / 100;
    const rotMid = Math.round((Math.random() - 0.5) * 32);
    const rotEnd = Math.round(rotMid + (Math.random() - 0.5) * 44);
    const duration = Math.round(640 + Math.random() * 110);
    const delay = Math.round(Math.random() * 45);
    const color = HEART_TINTS[Math.floor(Math.random() * HEART_TINTS.length)];

    return { id: i, dx, peakY, endY, size, alpha, scale, rotMid, rotEnd, duration, delay, color };
  });
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** 좋아요 등 position: relative 컨테이너 안에서 1회성 하트 파티클을 재생 */
export default function HeartBurst({ trigger }: HeartBurstProps) {
  const prevTrigger = useRef(trigger);
  const nextBurstId = useRef(1);
  const [burst, setBurst] = useState<{ id: number; particles: Particle[] } | null>(null);

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;
    if (!trigger || prefersReducedMotion()) return;

    const id = nextBurstId.current++;
    const particles = createParticles();
    const maxEnd = Math.max(...particles.map((p) => p.duration + p.delay));
    setBurst({ id, particles });

    const timer = window.setTimeout(() => {
      setBurst((cur) => (cur?.id === id ? null : cur));
    }, maxEnd + 40);

    return () => window.clearTimeout(timer);
  }, [trigger]);

  if (!burst) return null;

  return (
    <span key={burst.id} className={s.root} aria-hidden="true">
      {burst.particles.map((p) => {
        const style = {
          '--dx': `${p.dx.toFixed(1)}px`,
          '--peak-y': `${p.peakY.toFixed(1)}px`,
          '--end-y': `${p.endY.toFixed(1)}px`,
          '--size-p': `${p.size}px`,
          '--alpha-p': String(p.alpha),
          '--scale-p': String(p.scale),
          '--rot-mid': `${p.rotMid}deg`,
          '--rot-end': `${p.rotEnd}deg`,
          '--dur-p': `${p.duration}ms`,
          '--delay-p': `${p.delay}ms`,
          '--color-p': p.color,
        } as CSSProperties;

        return (
          <span key={p.id} className={s.particleX} style={style}>
            <span className={s.particleY}>
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 16.5s-6.5-3.9-6.5-8.6A3.6 3.6 0 0 1 10 5.6a3.6 3.6 0 0 1 6.5 2.3c0 4.7-6.5 8.6-6.5 8.6z" />
              </svg>
            </span>
          </span>
        );
      })}
    </span>
  );
}
