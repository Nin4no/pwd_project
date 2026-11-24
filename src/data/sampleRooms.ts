import type { Point, Room, ShowroomPost, Wall } from '../domain/types';

/** 꼭짓점 목록 → 닫힌 벽 목록 */
function loop(id: string, pts: [number, number][]): Wall[] {
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { id: `${id}_w${i}`, a: { x: p[0], y: p[1] } as Point, b: { x: q[0], y: q[1] } as Point };
  });
}

const T0 = new Date('2026-09-20T10:00:00+09:00').getTime();
const DAY = 86400000;

const roomA: Room = {
  id: 'sample-oneroom',
  title: '[래미안 포레스트 24A] 6평 원룸 미니멀 배치',
  wallHeight: 2.4,
  walls: loop('sa', [[0, 0], [3.5, 0], [3.5, 4.0], [0, 4.0]]),
  furniture: [
    { id: 'sa_f1', specId: 'bed-super-single', x: -1.13, z: -0.94, rotation: 0 },
    { id: 'sa_f2', specId: 'desk-basic', x: 1.39, z: 0.4, rotation: -90 },
    { id: 'sa_f3', specId: 'chair', x: 0.64, z: 0.4, rotation: 90 },
    { id: 'sa_f4', specId: 'wardrobe', x: 1.39, z: -1.5, rotation: -90 },
    { id: 'sa_f5', specId: 'lamp-floor', x: -1.5, z: 1.6, rotation: 0 },
  ],
  createdAt: T0,
  updatedAt: T0,
};

const roomB: Room = {
  id: 'sample-lshape',
  title: 'ㄱ자 원룸 · 홈오피스',
  wallHeight: 2.4,
  walls: loop('sb', [[0, 0], [5, 0], [5, 3], [3, 3], [3, 4.5], [0, 4.5]]),
  furniture: [
    { id: 'sb_f1', specId: 'bed-queen', x: -1.44, z: 1.44, rotation: 90 },
    { id: 'sb_f2', specId: 'desk-motion', x: 1.0, z: -1.84, rotation: 0 },
    { id: 'sb_f3', specId: 'chair', x: 1.0, z: -1.15, rotation: 180 },
    { id: 'sb_f4', specId: 'shelf', x: 2.29, z: -0.6, rotation: -90 },
    { id: 'sb_f5', specId: 'sofa-2', x: -1.3, z: -1.76, rotation: 0 },
    { id: 'sb_f6', specId: 'table-low', x: -1.3, z: -0.7, rotation: 0 },
  ],
  createdAt: T0 + 86400000,
  updatedAt: T0 + 86400000,
};

const roomC: Room = {
  id: 'sample-studio',
  title: '투룸 거실 · 카페 무드',
  wallHeight: 2.5,
  walls: loop('sc', [[0, 0], [4.5, 0], [4.5, 3.6], [0, 3.6]]),
  furniture: [
    { id: 'sc_f1', specId: 'sofa-2', x: 0, z: 1.31, rotation: 180 },
    { id: 'sc_f2', specId: 'table-round', x: -1.3, z: -0.9, rotation: 0 },
    { id: 'sc_f3', specId: 'chair', x: -0.58, z: -0.9, rotation: -90 },
    { id: 'sc_f4', specId: 'shelf', x: 1.0, z: -1.59, rotation: 0 },
    { id: 'sc_f5', specId: 'drawer', x: 1.96, z: 0.5, rotation: -90 },
    { id: 'sc_f6', specId: 'lamp-floor', x: 1.9, z: 1.4, rotation: 0 },
    { id: 'sc_f7', specId: 'table-low', x: 0, z: 0.3, rotation: 0 },
  ],
  createdAt: T0 + 2 * 86400000,
  updatedAt: T0 + 2 * 86400000,
};

const roomD: Room = {
  id: 'sample-bedroom',
  title: '화이트 모던 침실 · 드레스룸',
  wallHeight: 2.5,
  walls: loop('sd', [[0.8, 0], [4.4, 0], [4.4, 3.8], [0, 3.8], [0, 1.4], [0.8, 1.4]]),
  furniture: [
    { id: 'sd_f1', specId: 'bed-queen', x: 1.0, z: -0.82, rotation: 0 },
    { id: 'sd_f2', specId: 'wardrobe', x: -1.83, z: 0.18, rotation: 90 },
    { id: 'sd_f3', specId: 'hanger', x: -1.9, z: 1.23, rotation: 90 },
    { id: 'sd_f4', specId: 'drawer', x: -1.1, z: 1.6, rotation: 180 },
    { id: 'sd_f5', specId: 'table-round', x: 1.45, z: 1.25, rotation: 0 },
    { id: 'sd_f6', specId: 'chair', x: 0.65, z: 1.25, rotation: 90 },
    { id: 'sd_f7', specId: 'lamp-floor', x: 1.95, z: -1.65, rotation: 0 },
    { id: 'sd_f8', specId: 'air-purifier', x: -0.15, z: 1.66, rotation: 0 },
    { id: 'sd_f9', specId: 'window-l', x: 0.3, z: 1.9, rotation: 180 },
    { id: 'sd_f10', specId: 'door-white', x: -1.4, z: -1.2, rotation: 90, swing: { hinge: 'left', dir: 'in' } },
  ],
  createdAt: T0 + 3 * DAY,
  updatedAt: T0 + 3 * DAY,
};

const roomE: Room = {
  id: 'sample-cinema-loft',
  title: '미니멀 거실 · 1인 홈시네마',
  wallHeight: 2.6,
  walls: loop('se', [[0, 0], [5.2, 0], [5.2, 3.8], [0, 3.8]]),
  furniture: [
    { id: 'se_f1', specId: 'tv-65-stand', x: -1.1, z: -1.6, rotation: 0 },
    { id: 'se_f2', specId: 'aircon-stand', x: -2.32, z: -1.65, rotation: 0 },
    { id: 'se_f3', specId: 'sofa-2', x: -1.1, z: 1.4, rotation: 180 },
    { id: 'se_f4', specId: 'table-low', x: -1.1, z: 0.25, rotation: 0 },
    { id: 'se_f5', specId: 'lamp-floor', x: -2.32, z: 1.62, rotation: 0 },
    { id: 'se_f6', specId: 'shelf', x: 0.65, z: -1.68, rotation: 0 },
    { id: 'se_f7', specId: 'fridge-mini', x: 1.55, z: -1.58, rotation: 0 },
    { id: 'se_f8', specId: 'table-round', x: 1.55, z: 0.35, rotation: 0 },
    { id: 'se_f9', specId: 'chair', x: 0.75, z: 0.35, rotation: 90 },
    { id: 'se_f10', specId: 'chair', x: 1.55, z: 1.15, rotation: 180 },
    { id: 'se_f11', specId: 'window-balcony', x: 2.6, z: 0, rotation: -90 },
    { id: 'se_f12', specId: 'door-sliding', x: -2.6, z: 0, rotation: 90 },
  ],
  createdAt: T0 + 4 * DAY,
  updatedAt: T0 + 4 * DAY,
};

export const SAMPLE_POSTS: ShowroomPost[] = [
  { id: 'post-sample-1', room: roomA, author: '이지은', description: '6평 원룸에 슈퍼싱글 + 책상 + 옷장까지! 문 열림 동선 확보했어요.', likes: 128, remixCount: 34, sharedAt: roomA.createdAt, builtin: true },
  { id: 'post-sample-2', room: roomB, author: '김자취', description: 'ㄱ자 구조를 살려서 침실/작업 공간을 분리한 배치입니다.', likes: 96, remixCount: 21, sharedAt: roomB.createdAt, builtin: true },
  { id: 'post-sample-3', room: roomC, author: '홈카페러버', description: '거실을 카페처럼! 원형 테이블과 플로어 조명 포인트.', likes: 77, remixCount: 12, sharedAt: roomC.createdAt, builtin: true },
  { id: 'post-sample-4', room: roomD, author: '박서연', description: '알코브 입구와 드레스존을 나눈 4.7평 모던 침실 · 파우더 공간입니다.', likes: 64, remixCount: 15, sharedAt: roomD.createdAt, builtin: true },
  { id: 'post-sample-5', room: roomE, author: '최민준', description: '65인치 스탠드 TV와 다이닝 바가 공존하는 미니멀 홈시네마 거실입니다.', likes: 52, remixCount: 9, sharedAt: roomE.createdAt, builtin: true },
];
