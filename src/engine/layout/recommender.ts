import type { PlacedFurniture, Room } from '../../domain/types';
import { recommend } from './index';

export type RoomPresetId = 'studio_full' | 'home_office' | 'cozy_bedroom' | 'living_lounge';

export interface RoomPresetMeta {
  id: RoomPresetId;
  label: string;
  icon: string;
  description: string;
  items: string[];
}

export interface LayoutRecommendation {
  preset: RoomPresetMeta;
  placed: PlacedFurniture[];
  reasons: Array<{ furnitureName: string; reason: string }>;
  score: number;
  summary: string;
}

export const ROOM_PRESETS: RoomPresetMeta[] = [
  {
    id: 'studio_full',
    label: '풀옵션 원룸',
    icon: '',
    description: '침대, 데스크, 옷장, 수납을 조화롭게 배치한 1인가구 최적 레이아웃',
    items: ['침대', '책상', '의자', '옷장', '플로어 조명'],
  },
  {
    id: 'home_office',
    label: '홈오피스 & 서재',
    icon: '',
    description: '모션데스크와 5단 책장, 집중력을 극대화하는 프로페셔널 워크스페이스',
    items: ['모션데스크', '데스크 의자', '5단 책장', '서랍장', '플로어 조명'],
  },
  {
    id: 'cozy_bedroom',
    label: '아늑한 침실',
    icon: '',
    description: '퀸/슈퍼싱글 침대와 3단 서랍장, 따뜻한 무드 조명의 힐링 베드룸',
    items: ['원목 침대', '서랍장', '좌식 테이블', '플로어 조명'],
  },
  {
    id: 'living_lounge',
    label: '거실 & 라운지',
    icon: '',
    description: '2인 소파와 원형 테이블, 개방형 책장으로 구성된 감성 휴식 공간',
    items: ['2인 소파', '원형 테이블', '수납 책장', '플로어 조명'],
  },
];

export class AiLayoutRecommender {
  /**
   * 주어진 방의 도면 형태와 면적을 정밀 분석하여 최적의 가구 레이아웃을 추천합니다.
   */
  public recommendLayout(
    room: Room,
    presetId: RoomPresetId,
    keepExisting = false,
  ): LayoutRecommendation {
    const preset = ROOM_PRESETS.find((p) => p.id === presetId) ?? ROOM_PRESETS[0];
    const res = recommend(room, presetId, keepExisting);
    return {
      preset,
      placed: res.placed,
      reasons: res.reasons,
      score: res.score,
      summary: res.summary,
    };
  }
}

export const aiLayoutRecommender = new AiLayoutRecommender();
