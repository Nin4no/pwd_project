/**
 * 가구 배치 엔진 v2 — 가중치·치수 상수 (튜닝은 이 파일에서만)
 * 치수 근거: eval/layout/research/C_layout_models.md §4 (실무 관례값, 일부 출처 미확인)
 */
import type { FurnitureCategory } from '../../domain/types';
import type { Clearance } from './problem';

/** 하드 제약 위반 1건당 비용 — 다른 항보다 항상 크게 */
export const HARD = 1e6;

export const W = {
  /** 접근 공간이 막힌 면적(m²)당 */
  clearance: 400,
  /** 문에서 도달 못 하는 가구 1개당 */
  unreachable: 2500,
  /** 문 진입 지점 자체가 막힘 */
  entryBlocked: 20000,
  /** 문에서 못 가는 빈 바닥 비율(0~1)당 — 방을 둘로 나누는 배치 억제 */
  islandFraction: 3000,
  /** face 관계 각도 오차 (1-cos)/2 당 */
  face: 600,
  /** near/far 거리 위반 m당 */
  distance: 300,
  /** 창 앞을 막는 키 큰 가구 (겹침 m²당) */
  windowBlock: 500,
  /** 벽 부착 가구가 벽에서 떨어진 거리 m당 / 각도 어긋남 (1-cos)/2 당 */
  wallGap: 800,
  wallAngle: 800,
  /** 가구 면적 무게중심과 방 중심 거리 (방 크기로 정규화) */
  balance: 120,
  /** 방 중심(동선 핵심부)을 큰 가구가 차지한 면적 m²당 */
  center: 150,
};

/** 동선 격자 해상도(m)와 보행자 반경(60cm 통로 = 반경 0.3) */
export const GRID = 0.1;
export const WALKER_RADIUS = 0.3;
/** 문 진입 지점: 문 중심에서 방 안쪽으로 */
export const DOOR_ENTRY_DEPTH = 0.5;
/** 창 앞 차단 판정 깊이 / 판정 대상 최소 높이 */
export const WINDOW_STRIP = 0.5;
export const WINDOW_BLOCK_MIN_HEIGHT = 1.0;

/** 카테고리 기본 접근 공간 (가구별로 program.ts에서 덮어쓸 수 있음) */
export const CLEARANCE_BY_CATEGORY: Record<FurnitureCategory, Clearance> = {
  bed: { front: 0.6, side: 0.6, sideMode: 'one' },
  desk: { front: 0.75 },
  storage: { front: 0.75 },
  seating: { front: 0.45 },
  table: { front: 0.45 },
  lighting: { front: 0 },
  appliance: { front: 0.6 },
  window: { front: 0 },
  door: { front: 0 },
};

/** 가구 id별 예외 */
export const CLEARANCE_BY_SPEC: Record<string, Clearance> = {
  wardrobe: { front: 0.8 },
  shelf: { front: 0.6 },
  hanger: { front: 0.6 },
  drawer: { front: 0.75 },
  chair: { front: 0 }, // 책상 front 0.75 안에 포함됨
  'sofa-2': { front: 0.35 }, // 앞 테이블과 35~45cm
};

/** 페어 간격 */
export const PAIR_GAP = { deskChair: 0.15, sofaTable: 0.4 };
