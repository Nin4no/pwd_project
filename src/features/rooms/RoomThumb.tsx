import { useEffect, useRef } from 'react';
import type { Room } from '../../domain/types';
import { getEffectiveSize, wallsBounds } from '../../engine/geometry';
import { useCatalog } from '../../app/providers';
import s from './RoomThumb.module.css';

const W = 480;
const H = 300;

/** 캔버스는 CSS 변수를 못 읽으므로 토큰 값을 계산 스타일에서 가져온다 */
function token(name: string, fallbackVar: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || getComputedStyle(document.documentElement).getPropertyValue(fallbackVar).trim();
}

/**
 * 썸네일(dataURL)이 있으면 이미지, 없으면(샘플 등) 2D 탑뷰 미니 도면 (현행 RoomThumb 이식).
 * 가구 스펙은 방 범위 카탈로그(catalog.scoped(room))로 조회 — 전역 등록 없음.
 */
export default function RoomThumb({ room, className }: { room: Room; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const catalog = useCatalog();

  useEffect(() => {
    if (room.thumbnail) return;
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = token('--primary-soft', '--bg');
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = token('--grid-major', '--line');
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const b = wallsBounds(room.walls);
    if (!b) return;
    const pad = 36;
    const k = Math.min((W - pad * 2) / Math.max(b.width, 0.5), (H - pad * 2) / Math.max(b.depth, 0.5));
    const tx = (x: number) => W / 2 + (x - b.cx) * k;
    const ty = (y: number) => H / 2 + (y - b.cy) * k;

    const scoped = catalog.scoped(room);
    ctx.strokeStyle = token('--dim-ink', '--muted');
    for (const f of room.furniture) {
      const spec = scoped.get(f.specId);
      if (!spec) continue;
      const [effW, effD] = getEffectiveSize(f, spec);
      ctx.save();
      // 가구 좌표는 방 중심 기준
      ctx.translate(W / 2 + f.x * k, H / 2 + f.z * k);
      ctx.rotate((-f.rotation * Math.PI) / 180);
      ctx.fillStyle = spec.color;
      ctx.fillRect((-effW * k) / 2, (-effD * k) / 2, effW * k, effD * k);
      ctx.strokeRect((-effW * k) / 2, (-effD * k) / 2, effW * k, effD * k);
      ctx.restore();
    }
    ctx.strokeStyle = token('--primary', '--text');
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const w of room.walls) {
      ctx.beginPath();
      ctx.moveTo(tx(w.a.x), ty(w.a.y));
      ctx.lineTo(tx(w.b.x), ty(w.b.y));
      ctx.stroke();
    }
  }, [room, catalog]);

  const cls = `${s.thumb}${className ? ` ${className}` : ''}`;
  if (room.thumbnail) return <img src={room.thumbnail} alt={room.title} className={cls} loading="lazy" />;
  return <canvas ref={ref} className={cls} role="img" aria-label={`${room.title} 도면`} />;
}
