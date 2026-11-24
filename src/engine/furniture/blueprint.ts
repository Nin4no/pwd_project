/**
 * 가구 설계도(Blueprint) v1 — "이해"(프롬프트 → 설계도)와 "조립"(설계도 → 3D 부품)을 분리하는 계약.
 *
 * - 이해 단계(Gemini 또는 규칙 파서)는 좌표를 계산하지 않고 모듈 조합만 기술한다.
 * - 조립 엔진(assemble.ts)이 치수·좌표를 계산하고, 모든 부품이 바닥 또는 다른 부품에 닿도록 보장한다.
 *
 * 가구 로컬 좌표: 원점 = 바닥 중심, y 위, 정면 = +z, 단위 m.
 */
import type { FurnitureCategory } from '../../domain/types';

export type MaterialKey =
  | 'wood_natural' | 'wood_oak' | 'wood_walnut' | 'wood_white'
  | 'white' | 'black' | 'gray'
  | 'steel' | 'steel_white' | 'steel_black' | 'gold'
  | 'fabric_gray' | 'fabric_beige' | 'fabric_navy' | 'fabric_green'
  | 'leather_brown' | 'leather_black'
  | 'glass' | 'mirror'
  | 'mattress' | 'led';

export type ModuleType =
  /** 상판 + 받침 (책상·식탁·테이블·화장대 상판) */
  | 'table'
  /** 상자형 몸체: 측판·상하판·뒤판 + 내부(선반/서랍/문) — 책장·옷장·서랍장·신발장·TV장·상부장 */
  | 'carcass'
  /** 칸막이 패널(독서실 책상 측·후면 가림판) */
  | 'partition'
  /** 침대 프레임 + 매트리스 (+헤드보드, 하부 서랍) */
  | 'bedframe'
  /** 좌석: 소파·의자·벤치·스툴 */
  | 'seat'
  /** 벽걸이 판: 타공판·벽선반 */
  | 'board'
  /** 기둥 + 선반판 (철제 랙) */
  | 'rack'
  | 'lamp'
  | 'mirror'
  /** 가전 — 기존 appliances.ts 생성기에 위임 */
  | 'appliance';

/**
 * 부모 모듈 기준 부착 위치.
 * - floor: 바닥(루트 전용)
 * - top / top-back / top-left / top-right: 부모 윗면 위 (back = 뒤쪽 가장자리에 맞춤)
 * - under: 부모 상판 아래 (params.side = 'left' | 'right' | 'center')
 * - left / right: 부모 옆 바닥에 나란히 (가구 전체 폭이 늘어남)
 */
export type Anchor = 'floor' | 'top' | 'top-back' | 'top-left' | 'top-right' | 'under' | 'left' | 'right';

export type ParamValue = number | string | boolean;

export interface ModuleSpec {
  type: ModuleType;
  anchor?: Anchor;
  /** 모듈 크기(m). 생략하면 부모·기본 규칙으로 결정 */
  w?: number;
  d?: number;
  h?: number;
  material?: MaterialKey;
  /** 보조 재질(다리·손잡이·프레임 등) */
  accent?: MaterialKey;
  /**
   * 모듈별 파라미터 (assemble.ts / modules/*.ts 각 빌더 주석 참고)
   * table:     legs('four'|'panel'|'frame'|'trestle'), top(두께), drawers(앞치마 서랍 수)
   * carcass:   shelves, drawers, doors(0|1|2), plinth(걸레받이 높이), back(boolean), kind('open'|'closed')
   * partition: sides(boolean), back(boolean), shelf(boolean, 상단 선반), led(boolean)
   * bedframe:  headboard(boolean, 기본 true), legs('low'|'four'|'platform'), drawers(0~4), bunk(boolean)
   * seat:      style('sofa'|'chair'|'bench'|'stool'), back(boolean), arms(boolean), seats(1~3), legs('four'|'base')
   * board:     kind('pegboard'|'shelf'), holes(boolean|number), shelves(0~3), hooks(0~6)
   * rack:      shelves(기본 4)
   * lamp:      style('floor'|'desk')
   * mirror:    stand(boolean, 기본 true), arch(boolean, 기본 false)
   * appliance: kind('fridge'|'fridge1'|'minifridge'|'washer'|'toploader'|'dryer'|'tv'|'tvstand'|'aircon'|'purifier'|'styler')
   */
  params?: Record<string, ParamValue>;
  children?: ModuleSpec[];
}

export interface Blueprint {
  name: string;
  category: FurnitureCategory;
  /** 전체 기본 재질 (모듈 material 미지정 시) */
  material: MaterialKey;
  accent?: MaterialKey;
  /**
   * 설치 방식. 'wall'(타공판·벽선반·벽걸이 거울)은 루트를 바닥에서 mountY(m, 기본 0.9)만큼 띄워 조립하고,
   * 부유 검사는 가장 낮은 부품을 기준면으로 삼는다(부품끼리 연결만 확인).
   */
  mount?: 'floor' | 'wall';
  mountY?: number;
  /** 루트 모듈 — w·d·h 필수 */
  root: ModuleSpec & { w: number; d: number; h: number };
  /** 이해 단계에서 남기는 메모(미인식 단어 등). 조립에는 영향 없음 */
  notes?: string[];
}

/** 조립 중 각 모듈이 차지하는 상자 (가구 로컬 좌표) */
export interface Box3 {
  x0: number; x1: number;
  y0: number; y1: number;
  z0: number; z1: number;
}

export const boxW = (b: Box3) => b.x1 - b.x0;
export const boxH = (b: Box3) => b.y1 - b.y0;
export const boxD = (b: Box3) => b.z1 - b.z0;
export const boxCenter = (b: Box3): [number, number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
