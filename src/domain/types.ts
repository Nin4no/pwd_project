import type { RoomFacing } from './orientation';

export type { RoomFacing };

/** 2D 도면 좌표 (단위: m). 3D 변환 시 (x, y) → (x, 0, y) */
export interface Point {
  x: number;
  y: number;
}

/** 벽 하나 = 두 점을 잇는 선분 */
export interface Wall {
  id: string;
  a: Point;
  b: Point;
}

/** 가구 카탈로그 항목 */
export type FurnitureCategory = 'bed' | 'desk' | 'storage' | 'seating' | 'table' | 'lighting' | 'window' | 'door' | 'appliance';

/** 절차적 3D 프리미티브 재질 속성 (Opus 5.5 Master Spec) */
export interface PrimMat {
  color: string;
  roughness?: number;
  metalness?: number;
  alpha?: number;
  emissive?: string;
}

/** AI 생성 및 커스텀 절차적 가구 구성을 위한 3D 프리미티브 */
export type ProceduralPrimitive =
  | ({
      kind: 'box';
      /** 바닥 중심(y=0) 기준 상대 좌표 [x, y, z] (m) */
      pos: [number, number, number];
      /** [가로(w), 높이(h), 깊이(d)] (m) */
      size: [number, number, number];
    } & PrimMat)
  | ({
      kind: 'cylinder';
      /** 바닥 중심(y=0) 기준 상대 좌표 [x, y, z] (m) */
      pos: [number, number, number];
      radius: number;
      radiusTop?: number;
      height: number;
      segments?: number;
      openEnded?: boolean;
    } & PrimMat);

/** 벽 부착 방식: opening=개구부(창문·문), surface=벽면 부착(콘센트 등) */
export type WallMountMode = 'opening' | 'surface';

export interface FurnitureSpec {
  id: string;
  name: string;
  category: FurnitureCategory;
  /** [가로(w), 깊이(d), 높이(h)] m */
  size: [number, number, number];
  color: string;
  /** 벽 부착형: opening은 벽 중심선에 매립·개구부 생성, surface는 벽 내측 표면에 밀착 */
  wallMounted?: boolean;
  /** 벽 부착 모드 (미지정 시 window/door는 'opening', 그 외 wallMounted는 'surface') */
  wallMountMode?: WallMountMode;
  /** 바닥에서 하단까지 높이 (창대·콘센트 설치 높이, m) */
  elevation?: number;
  /** 상세 스펙 · 구매 정보 (price는 추후 AI Agent 추천 가구 검색 시에만 설정됨) */
  price?: number;
  brand?: string;
  material?: string;
  shopUrl?: string;
  /** AI Agent가 생성한 절차적 서브 메쉬 리스트 */
  primitives?: ProceduralPrimitive[];
  /** 가구 출처 구분 ('ai-recommended': AI Agent 추천 검색 가구) */
  source?: 'catalog' | 'ai' | 'ai-recommended';
  /** AI 생성 시 프롬프트 기록 */
  prompt?: string;
}

/** 방에 배치된 가구 인스턴스 */
export interface PlacedFurniture {
  id: string;
  specId: string;
  x: number;
  z: number;
  /** 회전 각도 (deg, Y축) */
  rotation: number;
  /** 사용자 지정 가로(W) 치수 (단위: m, 미지정 시 spec.size[0]) */
  width?: number;
  /** 사용자 지정 세로/깊이(D) 치수 (단위: m, 미지정 시 spec.size[1]) */
  depth?: number;
  /** 사용자 지정 높이(H) 치수 (단위: m, 미지정 시 spec.size[2]) */
  height?: number;
  /** 여닫이 문 전용: 경첩 쪽과 열림 방향 (미지정 시 { hinge: 'left', dir: 'in' }) */
  swing?: { hinge: 'left' | 'right'; dir: 'in' | 'out' };
}

/** 저장 단위: 방 하나 */
export interface Room {
  id: string;
  title: string;
  walls: Wall[];
  furniture: PlacedFurniture[];
  wallHeight: number;
  createdAt: number;
  updatedAt: number;
  /** 썸네일 dataURL (JPEG) */
  thumbnail?: string;
  /** 쇼룸에서 리믹스한 경우 원본 id */
  remixedFrom?: string;
  /** 소유자 사용자 ID (DB/Auth 연동) */
  ownerId?: string;
  /** 방에 포함된 커스텀 AI 가구 스펙 (공유/리믹스 호환용) */
  customSpecs?: FurnitureSpec[];
  /** 방 정면(+Z)의 지리적 방위 (미지정 시 'S' 남향으로 해석) */
  facing?: RoomFacing;
}

/** 쇼룸 피드 게시물 */
export interface ShowroomPost {
  id: string;
  room: Room;
  author: string;
  authorId?: string;
  description: string;
  likes: number;
  remixCount: number;
  sharedAt: number;
  /** 기본 제공 샘플 여부 */
  builtin?: boolean;
  /** 현재 사용자(로그인 시)의 좋아요 여부 */
  likedByMe?: boolean;
}

/** 인증 사용자 정보 (Opus 5.5 DB & Auth Spec) */
export type SocialProvider = 'google' | 'custom:naver';

export interface ProviderState {
  email: { provider: 'email'; enabled: boolean };
  google: { provider: 'google'; enabled: boolean };
  naver: { provider: 'custom:naver'; enabled: boolean };
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  success?: boolean;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatar?: string | null;
  provider: 'supabase' | 'local' | (string & {});
  isActive?: boolean;
  createdAt: number;
  updatedAt?: number;
}
