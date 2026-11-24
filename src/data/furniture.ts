import type { FurnitureSpec } from '../domain/types';
import { APPLIANCES } from './appliances';

/** 기본 카탈로그 (정적 배열). 조회는 domain/catalog의 CatalogRegistry를 사용 */
export const FURNITURE: FurnitureSpec[] = [
  { id: 'bed-single', name: '침대 (싱글)', category: 'bed', size: [1.0, 2.0, 0.45], color: '#c9a27a', brand: '하우스베이직', material: '원목 + 패브릭', shopUrl: 'https://ohou.se/search/index?query=싱글침대', source: 'catalog' },
  { id: 'bed-super-single', name: '침대 (슈퍼싱글)', category: 'bed', size: [1.1, 2.0, 0.45], color: '#b98c62', brand: '하우스베이직', material: '원목 + 패브릭', shopUrl: 'https://ohou.se/search/index?query=슈퍼싱글침대', source: 'catalog' },
  { id: 'bed-queen', name: '퀸 원목 침대', category: 'bed', size: [1.5, 2.0, 0.45], color: '#a8784f', brand: '우드랩', material: '고무나무 원목', shopUrl: 'https://ohou.se/search/index?query=퀸침대', source: 'catalog' },
  { id: 'desk-basic', name: '일반 책상', category: 'desk', size: [1.2, 0.6, 0.73], color: '#e8dcc8', brand: '데스커', material: 'LPM 파티클보드', shopUrl: 'https://ohou.se/search/index?query=책상', source: 'catalog' },
  { id: 'desk-motion', name: '모션데스크', category: 'desk', size: [1.4, 0.7, 0.75], color: '#f2f2f2', brand: '데스커', material: '스틸 프레임 + E0 상판', shopUrl: 'https://ohou.se/search/index?query=모션데스크', source: 'catalog' },
  { id: 'wardrobe', name: '수납장 (옷장)', category: 'storage', size: [0.8, 0.6, 1.9], color: '#ffffff', brand: '리바트', material: 'E0 PB', shopUrl: 'https://ohou.se/search/index?query=옷장', source: 'catalog' },
  { id: 'hanger', name: '행거', category: 'storage', size: [1.2, 0.45, 1.6], color: '#4b5563', brand: '홈앤', material: '스틸', shopUrl: 'https://ohou.se/search/index?query=행거', source: 'catalog' },
  { id: 'shelf', name: '책장 (5단)', category: 'storage', size: [0.8, 0.3, 1.8], color: '#d8c3a5', brand: '한샘', material: 'LPM', shopUrl: 'https://ohou.se/search/index?query=책장', source: 'catalog' },
  { id: 'drawer', name: '서랍장 (3단)', category: 'storage', size: [0.8, 0.45, 0.8], color: '#efe6da', brand: '한샘', material: 'LPM', shopUrl: 'https://ohou.se/search/index?query=서랍장', source: 'catalog' },
  { id: 'chair', name: '데스크 의자', category: 'seating', size: [0.6, 0.6, 1.0], color: '#1f2937', brand: '시디즈', material: '메쉬', shopUrl: 'https://ohou.se/search/index?query=의자', source: 'catalog' },
  { id: 'sofa-2', name: '2인 소파', category: 'seating', size: [1.6, 0.85, 0.8], color: '#7c93b5', brand: '자코모', material: '패브릭', shopUrl: 'https://ohou.se/search/index?query=2인소파', source: 'catalog' },
  { id: 'table-round', name: '원형 테이블', category: 'table', size: [0.8, 0.8, 0.72], color: '#f5f0e6', brand: '이케아', material: '원목 무늬', shopUrl: 'https://ohou.se/search/index?query=원형테이블', source: 'catalog' },
  { id: 'table-low', name: '좌식 테이블', category: 'table', size: [0.9, 0.5, 0.35], color: '#c7a37d', brand: '홈앤', material: '고무나무', shopUrl: 'https://ohou.se/search/index?query=좌식테이블', source: 'catalog' },
  { id: 'lamp-floor', name: '플로어 조명', category: 'lighting', size: [0.35, 0.35, 1.6], color: '#fde68a', brand: '일광', material: '스틸 + 패브릭', shopUrl: 'https://ohou.se/search/index?query=장스탠드', source: 'catalog' },

  /* 가전제품 (절차적 프리미티브 형상) */
  ...APPLIANCES,

  /* 창문 (벽 부착형): 깊이 = 창틀 두께, elevation = 창대 높이 */
  { id: 'window-s', name: '창문 (소형)', category: 'window', size: [0.6, 0.12, 0.6], elevation: 1.2, wallMounted: true, color: '#e0f2fe', brand: '기본 창호', material: 'PVC 프레임 + 복층유리', source: 'catalog' },
  { id: 'window-v', name: '창문 (세로형)', category: 'window', size: [0.6, 0.12, 1.5], elevation: 0.6, wallMounted: true, color: '#e0f2fe', brand: '기본 창호', material: 'PVC 프레임 + 복층유리', source: 'catalog' },
  { id: 'window-m', name: '창문 (중형)', category: 'window', size: [1.2, 0.12, 1.2], elevation: 0.9, wallMounted: true, color: '#e0f2fe', brand: '기본 창호', material: 'PVC 프레임 + 복층유리', source: 'catalog' },
  { id: 'window-l', name: '창문 (대형)', category: 'window', size: [1.8, 0.12, 1.5], elevation: 0.9, wallMounted: true, color: '#e0f2fe', brand: '기본 창호', material: 'PVC 프레임 + 복층유리', source: 'catalog' },
  { id: 'window-balcony', name: '통창 (발코니)', category: 'window', size: [2.4, 0.12, 2.1], elevation: 0.05, wallMounted: true, color: '#e0f2fe', brand: '기본 창호', material: '알루미늄 프레임 + 복층유리', source: 'catalog' },

  /* 문 (벽 부착형): 바닥(elevation=0)부터 벽에 개구부를 내고 장착 */
  { id: 'door-wood', name: '방문 (원목)', category: 'door', size: [0.9, 0.12, 2.1], elevation: 0, wallMounted: true, color: '#b98c62', brand: '기본 도어', material: 'ABS 원목 무늬 + 스틸 핸들', source: 'catalog' },
  { id: 'door-white', name: '방문 (화이트)', category: 'door', size: [0.9, 0.12, 2.1], elevation: 0, wallMounted: true, color: '#f1f5f9', brand: '기본 도어', material: 'ABS 화이트 + 스틸 핸들', source: 'catalog' },
  { id: 'door-sliding', name: '슬라이딩 중문', category: 'door', size: [1.4, 0.12, 2.1], elevation: 0, wallMounted: true, color: '#475569', brand: '기본 도어', material: '알루미늄 슬림 프레임 + 강화유리', source: 'catalog' },
];
