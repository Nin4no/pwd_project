export interface Point {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: Point;
  b: Point;
}

export type FurnitureCategory =
  | 'bed'
  | 'desk'
  | 'storage'
  | 'seating'
  | 'table'
  | 'lighting'
  | 'window'
  | 'door'
  | 'appliance';

export interface PrimMat {
  color: string;
  roughness?: number;
  metalness?: number;
  alpha?: number;
  emissive?: string;
}

export type ProceduralPrimitive =
  | ({
      kind: 'box';
      pos: [number, number, number];
      size: [number, number, number];
    } & PrimMat)
  | ({
      kind: 'cylinder';
      pos: [number, number, number];
      radius: number;
      radiusTop?: number;
      height: number;
      segments?: number;
      openEnded?: boolean;
    } & PrimMat);

export type RoomFacing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export type WallMountMode = 'opening' | 'surface';

export interface FurnitureSpec {
  id: string;
  name: string;
  category: FurnitureCategory;
  size: [number, number, number];
  color: string;
  wallMounted?: boolean;
  wallMountMode?: WallMountMode;
  elevation?: number;
  price?: number;
  brand?: string;
  material?: string;
  shopUrl?: string;
  primitives?: ProceduralPrimitive[];
  source?: 'catalog' | 'ai' | 'ai-recommended';
  prompt?: string;
}

export interface PlacedFurniture {
  id: string;
  specId: string;
  x: number;
  z: number;
  rotation: number;
  width?: number;
  depth?: number;
  /** 사용자 지정 높이(H) 치수 (단위: m, 미지정 시 spec.size[2]) */
  height?: number;
  /** 여닫이 문 전용: 경첩 쪽과 열림 방향 (미지정 시 { hinge: 'left', dir: 'in' }) */
  swing?: { hinge: 'left' | 'right'; dir: 'in' | 'out' };
}

export interface Room {
  id: string;
  title: string;
  walls: Wall[];
  furniture: PlacedFurniture[];
  wallHeight: number;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  remixedFrom?: string;
  ownerId?: string;
  customSpecs?: FurnitureSpec[];
  facing?: RoomFacing;
}

export interface ShowroomPost {
  id: string;
  room: Room;
  author: string;
  authorId?: string;
  description: string;
  likes: number;
  remixCount: number;
  sharedAt: number;
  builtin?: boolean;
  likedByMe: boolean;
}

export type SocialProvider = 'google' | 'custom:naver';

export interface ProviderState {
  email: { provider: 'email'; enabled: boolean };
  google: { provider: 'google'; enabled: boolean };
  naver: { provider: 'custom:naver'; enabled: boolean };
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
