/**
 * 프롬프트 → 설계도(Blueprint) 규칙 파서.
 * "기본형 1개 + 수식어 여러 개"를 조합하여 Blueprint를 생성한다.
 */
import type { FurnitureCategory } from '../../domain/types';
import type { Anchor, Blueprint, MaterialKey, ModuleSpec, ModuleType, ParamValue } from './blueprint';

export interface ParseBlueprintResult {
  blueprint: Blueprint;
  notes: string[];
  unknown: string[];
}

type BaseKind =
  | 'vanity'
  | 'pegboard'
  | 'rack'
  | 'tv_stand'
  | 'desk'
  | 'appliance'
  | 'bed'
  | 'carcass'
  | 'seat'
  | 'table'
  | 'lamp'
  | 'mirror'
  | 'board_shelf'
  | 'window'
  | 'door'
  | 'unknown';

interface BaseRule {
  kind: BaseKind;
  moduleType: ModuleType;
  category: FurnitureCategory;
  pattern: RegExp;
  label: string;
}

/** 구체적인 기본형 우선 판정 표 */
const BASE_RULES: BaseRule[] = [
  // 1. 책상/테이블 위에 놓거나 결합된 조명 어구 ("책상 조명", "데스크 램프")는 조명으로 우선 판정
  {
    kind: 'lamp',
    moduleType: 'lamp',
    category: 'lighting',
    pattern: /(?:책상|데스크|테이블|스탠드|플로어|나선형|아치)\s*(?:조명|램프|라이트)|스탠드\s*조명|플로어\s*램프|데스크\s*램프|무드등|단스탠드/i,
    label: '조명',
  },
  // 2. 화장대 (table + mirror + under carcass 조합)
  {
    kind: 'vanity',
    moduleType: 'table',
    category: 'storage',
    pattern: /화장대|드레서|화장\s*테이블|파우더룸/i,
    label: '화장대',
  },
  // 3. 타공판 ('타공판 선반' 포함 — 벽선반/선반보다 먼저)
  {
    kind: 'pegboard',
    moduleType: 'board',
    category: 'storage',
    pattern: /타공판|페그보드|pegboard|타공보드/i,
    label: '타공판',
  },
  // 4. 철제 선반 / 스틸랙 ('선반'보다 먼저)
  {
    kind: 'rack',
    moduleType: 'rack',
    category: 'storage',
    pattern: /(?:철제|스틸|메탈|앵글).*?(?:선반|랙)|스틸랙|메탈랙|철제선반|(?<![가-힣a-z])rack(?![가-힣a-z])|(?<![가-힣])랙(?![가-힣])/i,
    label: '철제 선반',
  },
  // 5. TV장 / 거실장 (가전 TV보다 먼저)
  {
    kind: 'tv_stand',
    moduleType: 'carcass',
    category: 'storage',
    pattern: /tv\s*장|티비\s*장|거실장|tv\s*콘솔|미디어장/i,
    label: 'TV장',
  },
  // 6. 책상 / 데스크 (책장/선반/서랍 수식어보다 기본형 우선)
  {
    kind: 'desk',
    moduleType: 'table',
    category: 'desk',
    pattern: /책상|데스크|desk|작업대/i,
    label: '책상',
  },
  // 7. 가전제품
  {
    kind: 'appliance',
    moduleType: 'appliance',
    category: 'appliance',
    pattern: /가전|냉장고|세탁기|건조기|에어컨|공기청정기|스타일러|의류관리기|티비|텔레비전|tv|fridge|refrigerator|washer|dryer|aircon/i,
    label: '가전',
  },
  // 8. 침대
  {
    kind: 'bed',
    moduleType: 'bedframe',
    category: 'bed',
    pattern: /침대|매트리스|베드|bed/i,
    label: '침대',
  },
  // 9. 상자형 수납 가구 ('벤치형 수납장' 등이 벤치보다 우선)
  {
    kind: 'carcass',
    moduleType: 'carcass',
    category: 'storage',
    pattern: /책장|옷장|서랍장|신발장|슈즈랙|수납장|협탁|장식장|캐비닛|wardrobe|cabinet|bookshelf|bookcase|drawer/i,
    label: '수납장',
  },
  // 10. 좌석 (벤치·스툴·소파·의자)
  {
    kind: 'seat',
    moduleType: 'seat',
    category: 'seating',
    pattern: /벤치|스툴|소파|의자|체어|암체어|카우치|sofa|chair|couch|stool|bench/i,
    label: '좌석',
  },
  // 11. 거울
  {
    kind: 'mirror',
    moduleType: 'mirror',
    category: 'storage',
    pattern: /거울|미러|mirror/i,
    label: '거울',
  },
  // 12. 벽선반 / 선반 단독
  {
    kind: 'board_shelf',
    moduleType: 'board',
    category: 'storage',
    pattern: /벽\s*선반|월\s*선반|선반|shelf/i,
    label: '벽선반',
  },
  // 13. 식탁 / 테이블
  {
    kind: 'table',
    moduleType: 'table',
    category: 'table',
    pattern: /식탁|테이블|탁자|다이닝|table|dining/i,
    label: '테이블',
  },
  // 14. 일반 조명
  {
    kind: 'lamp',
    moduleType: 'lamp',
    category: 'lighting',
    pattern: /조명|램프|스탠드|라이트|전등|lamp|light/i,
    label: '조명',
  },
  // 15. 창문 / 문 (미등록 모듈 — assemble 폴백 대상)
  {
    kind: 'window',
    moduleType: 'window' as ModuleType,
    category: 'window',
    pattern: /창문|창호|유리창|미닫이\s*창|window/i,
    label: '창문',
  },
  {
    kind: 'door',
    moduleType: 'door' as ModuleType,
    category: 'door',
    pattern: /미닫이문|슬라이딩\s*도어|여닫이문|현관문|방문|중문|도어|(?<![가-힣])문(?![가-힣])|door/i,
    label: '도어',
  },
];

interface ParseContext {
  raw: string;
  lower: string;
  base: BaseRule;
  dims: [number, number, number];
  explicitDims: boolean;
  material: MaterialKey;
  accent?: MaterialKey;
  explicitMaterial: boolean;
  mount?: 'floor' | 'wall';
  mountY?: number;
  rootParams: Record<string, ParamValue>;
  children: ModuleSpec[];
  appliedLabels: string[];
  mirrorH?: number;
}

interface ModifierRule {
  id: string;
  /** 적용 가능한 루트 모듈 타입 (생략 시 전체) */
  types?: ModuleType[];
  pattern: RegExp;
  apply: (ctx: ParseContext, match: RegExpMatchArray) => void;
}

function addChild(ctx: ParseContext, child: ModuleSpec) {
  ctx.children.push(child);
}

function findUnderCarcass(ctx: ParseContext): ModuleSpec | undefined {
  return ctx.children.find((c) => c.type === 'carcass' && c.anchor === 'under');
}

/** 수식어 규칙 테이블 — 일치하는 모든 규칙이 순서대로 누적 적용된다 */
const MODIFIER_RULES: ModifierRule[] = [
  {
    id: 'l_desk',
    types: ['table'],
    pattern: /L자|ㄱ자|코너\s*(?:책상|데스크)|l-?shape/i,
    apply: (ctx) => {
      // L자 = 가로 책상 + 옆에 세로로 붙인 날개 책상. dims: 전체 가로 W × (깊이 ≥ 1.0이면 전체 세로, 아니면 책상 깊이)
      const [W, D, H] = ctx.dims;
      const mainD = D >= 1.0 ? Math.min(0.7, D / 2) : D;
      const wingLen = D >= 1.0 ? D : Math.max(1.1, W * 0.7);
      const wingW = mainD;
      ctx.dims = [Math.max(0.8, W - wingW), mainD, H];
      const isLeft = /왼쪽|좌측|left/i.test(ctx.raw);
      addChild(ctx, {
        type: 'table',
        anchor: isLeft ? 'left' : 'right',
        w: wingW,
        d: wingLen,
        h: H,
        params: { ...ctx.rootParams },
      });
      ctx.appliedLabels.push('L자 날개 책상');
    },
  },
  {
    id: 'study_partition',
    types: ['table'],
    pattern: /독서실|칸막이|집중형/i,
    apply: (ctx) => {
      ctx.rootParams.legs = 'panel';
      const hasLed = /조명|led/i.test(ctx.raw);
      addChild(ctx, {
        type: 'partition',
        anchor: 'top',
        h: 0.55,
        params: { sides: true, back: true, shelf: true, led: hasLed },
      });
      ctx.appliedLabels.push(hasLed ? '칸막이(조명)' : '독서실 칸막이');
    },
  },
  {
    id: 'table_hutch',
    types: ['table'],
    pattern: /(?:선반\s*달린|책장형|상부장|책장\s*책상|수납\s*책상|책상\s*선반|선반\s*있는|책꽂이|허치)/i,
    apply: (ctx) => {
      if (/옆\s*책장|책장\s*붙은|사이드\s*책장/i.test(ctx.raw) && !/선반\s*달린|책장형|상부장|책장\s*책상|수납\s*책상|책상\s*선반/i.test(ctx.raw)) {
        return;
      }
      const tierMatch = ctx.raw.match(/(\d+)\s*단/);
      const shelves = tierMatch ? Math.max(1, Math.min(2, parseInt(tierMatch[1], 10))) : 1;
      addChild(ctx, {
        type: 'carcass',
        anchor: 'top-back',
        d: 0.28,
        h: 0.6,
        params: { kind: 'open', shelves },
      });
      ctx.appliedLabels.push('상단 선반');
    },
  },
  {
    id: 'side_bookcase',
    types: ['table'],
    pattern: /(?:옆\s*(?:에\s*)?책장|책장\s*(?:붙은|달린|포함)|사이드\s*책장)/i,
    apply: (ctx) => {
      const isLeft = /왼쪽|좌측|left/i.test(ctx.raw);
      const anchor: Anchor = isLeft ? 'left' : 'right';
      addChild(ctx, {
        type: 'carcass',
        anchor,
        w: 0.4,
        d: 0.3,
        h: 1.6,
        params: { kind: 'open', shelves: 4 },
      });
      ctx.appliedLabels.push(isLeft ? '좌측 책장' : '옆 책장');
    },
  },
  {
    id: 'table_under_drawers',
    types: ['table'],
    pattern: /(?:서랍\s*(\d+)\s*단|(\d+)\s*단\s*서랍)/i,
    apply: (ctx, match) => {
      const n = Math.max(1, Math.min(6, parseInt(match[1] ?? match[2], 10)));
      const existing = findUnderCarcass(ctx);
      if (existing) {
        existing.params = { ...(existing.params ?? {}), drawers: n };
      } else {
        const side = /왼쪽|좌측|left/i.test(ctx.raw) ? 'left' : 'right';
        addChild(ctx, {
          type: 'carcass',
          anchor: 'under',
          params: { side, drawers: n, plinth: 0 },
        });
      }
      ctx.appliedLabels.push(`서랍 ${n}단`);
    },
  },
  {
    id: 'table_apron_drawer',
    types: ['table'],
    pattern: /서랍/i,
    apply: (ctx) => {
      // '서랍 N단'이 이미 적용되었거나 화장대 하부 서랍장이면 앞치마 서랍 중복 방지
      if (/(?:서랍\s*\d+\s*단|\d+\s*단\s*서랍)/i.test(ctx.raw)) return;
      if (ctx.base.kind === 'vanity') return;
      ctx.rootParams.drawers = 1;
      ctx.appliedLabels.push('서랍');
    },
  },
  {
    id: 'table_legs',
    types: ['table'],
    pattern: /접이식|폴딩|트레슬|게이밍|모션|철제|스틸|프레임/i,
    apply: (ctx) => {
      if (ctx.rootParams.legs === 'panel') return;
      if (/접이식|폴딩|트레슬/i.test(ctx.raw)) {
        ctx.rootParams.legs = 'trestle';
        ctx.appliedLabels.push('접이식');
      } else {
        ctx.rootParams.legs = 'frame';
      }
    },
  },
  {
    id: 'desk_lamp',
    types: ['table'],
    pattern: /조명|스탠드\s*포함|램프/i,
    apply: (ctx) => {
      // 독서실 칸막이가 이미 LED를 처리하므로 중복 램프 방지
      if (ctx.children.some((c) => c.type === 'partition')) return;
      addChild(ctx, {
        type: 'lamp',
        anchor: 'top-right',
        w: 0.24,
        d: 0.24,
        h: 0.42,
        material: 'white',
        accent: 'steel_black',
        params: { style: 'desk' },
      });
      ctx.appliedLabels.push('조명');
    },
  },
  {
    id: 'bed_bunk',
    types: ['bedframe'],
    pattern: /2층|이층|벙커|bunk/i,
    apply: (ctx) => {
      ctx.rootParams.bunk = true;
      if (!ctx.explicitDims) {
        ctx.dims = [1.05, 2.05, 1.65];
      }
      ctx.appliedLabels.push('2층');
    },
  },
  {
    id: 'bed_drawers',
    types: ['bedframe'],
    pattern: /서랍|수납/i,
    apply: (ctx) => {
      const m = ctx.raw.match(/(\d+)\s*(?:개|단)?\s*서랍|서랍\s*(\d+)/);
      const count = m ? Math.max(1, Math.min(4, parseInt(m[1] ?? m[2], 10))) : 2;
      ctx.rootParams.drawers = count;
      ctx.rootParams.legs = 'platform';
      ctx.appliedLabels.push('수납');
    },
  },
  {
    id: 'bed_no_headboard',
    types: ['bedframe'],
    pattern: /헤드\s*없는|무헤드|평상형/i,
    apply: (ctx) => {
      ctx.rootParams.headboard = false;
      if (!ctx.explicitDims && !ctx.rootParams.bunk) {
        ctx.dims[2] = 0.45;
      }
      ctx.appliedLabels.push('무헤드');
    },
  },
  {
    id: 'carcass_doors',
    types: ['carcass'],
    pattern: /문\s*달린|도어\s*달린|여닫이|닫힌|(?<![가-힣])(\d+)\s*도어/i,
    apply: (ctx, match) => {
      const doors = match[1] ? Math.max(1, Math.min(2, parseInt(match[1], 10))) : 2;
      ctx.rootParams.doors = doors;
      ctx.rootParams.kind = 'closed';
      ctx.appliedLabels.push('도어');
    },
  },
  {
    id: 'carcass_open',
    types: ['carcass'],
    pattern: /오픈|open|개방형/i,
    apply: (ctx) => {
      ctx.rootParams.kind = 'open';
      ctx.rootParams.doors = 0;
      ctx.appliedLabels.push('오픈');
    },
  },
  {
    id: 'tiers_count',
    types: ['carcass', 'rack', 'board'],
    pattern: /(\d+)\s*(?:단|칸|tier)/i,
    apply: (ctx, match) => {
      const n = Math.max(1, parseInt(match[1], 10));
      if (ctx.base.moduleType === 'carcass') {
        const isDrawerChest = /서랍장|서랍/.test(ctx.raw) && !/책장|수납장|신발장|옷장/.test(ctx.raw);
        if (isDrawerChest) {
          ctx.rootParams.drawers = Math.min(8, n);
          ctx.rootParams.shelves = 0;
        } else {
          ctx.rootParams.shelves = Math.min(10, n);
        }
        ctx.appliedLabels.push(`${n}단`);
      } else if (ctx.base.moduleType === 'rack') {
        ctx.rootParams.shelves = Math.min(12, n);
        ctx.appliedLabels.push(`${n}단`);
      } else if (ctx.base.moduleType === 'board') {
        // 타공판은 구멍 격자 예산(<=40) 유지를 위해 선반은 최대 1개로 제한
        if (ctx.rootParams.kind === 'pegboard') {
          ctx.rootParams.shelves = 1;
        } else {
          ctx.rootParams.shelves = Math.min(3, n);
          ctx.appliedLabels.push(`${n}단`);
        }
      }
    },
  },
  {
    id: 'seat_count',
    types: ['seat'],
    pattern: /(\d+)\s*인(?:용)?/i,
    apply: (ctx, match) => {
      const n = Math.max(1, Math.min(3, parseInt(match[1], 10)));
      ctx.rootParams.seats = n;
      if (n >= 2) {
        ctx.rootParams.style = 'sofa';
        ctx.rootParams.arms = true;
        ctx.rootParams.back = true;
        if (!ctx.explicitDims) {
          ctx.dims = n >= 3 ? [2.0, 0.88, 0.82] : [1.6, 0.85, 0.8];
        }
      }
      ctx.appliedLabels.push(`${n}인`);
    },
  },
  {
    id: 'seat_options',
    types: ['seat'],
    pattern: /팔걸이\s*없는|암리스|등받이\s*없는|회전|원형\s*베이스/i,
    apply: (ctx) => {
      if (/팔걸이\s*없는|암리스/i.test(ctx.raw)) ctx.rootParams.arms = false;
      if (/등받이\s*없는/i.test(ctx.raw)) ctx.rootParams.back = false;
      if (/회전|원형\s*베이스/i.test(ctx.raw)) ctx.rootParams.legs = 'base';
    },
  },
  {
    id: 'mirror_arch',
    types: ['mirror'],
    pattern: /아치|arch/i,
    apply: (ctx) => {
      ctx.rootParams.arch = true;
      ctx.appliedLabels.push('아치형');
    },
  },
  {
    id: 'wall_mount',
    types: ['board', 'mirror', 'carcass'],
    pattern: /벽걸이|벽부착|벽\s*선반|월\s*선반|벽\s*수납/i,
    apply: (ctx) => {
      ctx.mount = 'wall';
      ctx.mountY = ctx.mountY ?? 1.0;
      if (ctx.base.moduleType === 'mirror') {
        ctx.rootParams.stand = false;
        if (!ctx.explicitDims) ctx.dims = [0.6, 0.04, 0.9];
      }
      if (ctx.base.moduleType === 'carcass') {
        ctx.rootParams.plinth = 0;
      }
    },
  },
];

/* ───────── 치수 / 소재 / 미인식 명사 추출 (PromptParser 로직 공유) ───────── */

const roundDim = (v: number) => Math.round(v * 100) / 100;

function normalizeDimension(val: number, explicitUnit?: string): number {
  if (explicitUnit === 'mm') return val / 1000;
  if (explicitUnit === 'cm') return val / 100;
  if (explicitUnit === 'm') return val;
  if (val >= 1000) return val / 1000;
  if (val >= 10) return val / 100;
  return val;
}

function defaultHeightFor(base: BaseRule): number {
  switch (base.kind) {
    case 'bed': return 0.9;
    case 'desk': return 0.73;
    case 'vanity': return 0.75;
    case 'table': return 0.73;
    case 'seat': return 0.82;
    case 'lamp': return 1.6;
    case 'window': return 1.2;
    case 'door': return 2.1;
    case 'appliance': return 0.85;
    case 'mirror': return 1.7;
    case 'pegboard': return 0.6;
    case 'board_shelf': return 0.35;
    case 'rack': return 1.5;
    default: return 0.85;
  }
}

function defaultDimsFor(base: BaseRule, raw: string): [number, number, number] {
  switch (base.kind) {
    case 'vanity':
      return [0.9, 0.45, 0.75];
    case 'pegboard':
      return [0.8, 0.12, 0.6];
    case 'board_shelf':
      return [0.8, 0.22, 0.35];
    case 'rack':
      return [0.8, 0.4, 1.5];
    case 'tv_stand':
      return [1.6, 0.4, 0.42];
    case 'desk':
      if (/독서실|칸막이|집중형/i.test(raw)) return [1.0, 0.65, 0.73];
      if (/L자|ㄱ자|코너|l-?shape/i.test(raw)) return [1.6, 1.2, 0.74];
      if (/게이밍/i.test(raw)) return [1.4, 0.7, 0.74];
      return [1.2, 0.6, 0.73];
    case 'table':
      if (/접이식/i.test(raw)) return [1.0, 0.6, 0.73];
      if (/원형|카페/i.test(raw)) return [0.85, 0.85, 0.73];
      if (/좌식/i.test(raw)) return [0.9, 0.5, 0.35];
      if (/커피|티테이블|사이드/i.test(raw)) return [0.9, 0.55, 0.42];
      return [1.2, 0.75, 0.73];
    case 'bed':
      if (/2층|이층|벙커|bunk/i.test(raw)) return [1.05, 2.05, 1.65];
      if (/퀸|queen/i.test(raw)) return [1.5, 2.0, 0.9];
      if (/슈퍼싱글|ss/i.test(raw)) return [1.1, 2.0, 0.9];
      return [1.0, 2.0, 0.9];
    case 'carcass':
      if (/신발장|슈즈랙/i.test(raw)) return [0.8, 0.35, 1.0];
      if (/협탁/i.test(raw)) return [0.5, 0.4, 0.55];
      if (/옷장|wardrobe/i.test(raw)) return [0.8, 0.6, 1.9];
      if (/책장|bookshelf|bookcase/i.test(raw)) return [0.8, 0.32, 1.6];
      if (/서랍/i.test(raw)) return [0.8, 0.45, 0.8];
      return [0.8, 0.4, 0.9];
    case 'seat':
      if (/벤치/i.test(raw)) return [1.2, 0.38, 0.45];
      if (/스툴/i.test(raw)) return [0.38, 0.38, 0.45];
      if (/3인/i.test(raw)) return [2.0, 0.88, 0.82];
      if (/2인/i.test(raw)) return [1.6, 0.85, 0.8];
      if (/소파|카우치|sofa|couch/i.test(raw)) return [1.8, 0.85, 0.8];
      return [0.6, 0.6, 0.95];
    case 'lamp':
      if (/책상|데스크|테이블|단스탠드|탁상/i.test(raw)) return [0.25, 0.25, 0.45];
      return [0.35, 0.35, 1.6];
    case 'mirror':
      return /벽걸이|벽부착/i.test(raw) ? [0.6, 0.04, 0.9] : [0.6, 0.35, 1.7];
    case 'window':
      return [1.2, 0.16, 1.2];
    case 'door':
      return /중문|슬라이딩|3연동/i.test(raw) ? [1.5, 0.12, 2.1] : [0.9, 0.12, 2.1];
    case 'appliance':
      if (/냉장고|fridge|refrigerator/i.test(raw)) {
        if (/소형|미니|mini/i.test(raw)) return [0.48, 0.5, 0.85];
        if (/1도어|단문|원룸/.test(raw)) return [0.6, 0.68, 1.8];
        return [0.91, 0.92, 1.79];
      }
      if (/세탁기|washer/i.test(raw)) return raw.includes('통돌이') ? [0.62, 0.65, 1.0] : [0.6, 0.65, 0.85];
      if (/건조기|dryer/i.test(raw)) return [0.6, 0.7, 0.85];
      if (/tv|티비|텔레비전/i.test(raw)) return raw.includes('스탠드') ? [1.45, 0.46, 1.6] : [1.6, 0.42, 1.21];
      if (/에어컨|aircon/i.test(raw)) return [0.37, 0.33, 1.83];
      if (/공기청정기/i.test(raw)) return [0.32, 0.32, 0.68];
      if (/스타일러|의류관리기/i.test(raw)) return [0.45, 0.6, 1.85];
      return [0.6, 0.65, 0.85];
    default:
      return [0.8, 0.4, 0.9];
  }
}

export function extractDimensionsFromPrompt(
  text: string,
  base: BaseRule,
): { dims: [number, number, number]; explicit: boolean; mirrorH?: number } {
  const threeMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:cm|mm|m)?\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*(?:cm|mm|m)?\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*(cm|mm|m)?/i,
  );
  if (threeMatch) {
    const u = threeMatch[4];
    const w = roundDim(normalizeDimension(parseFloat(threeMatch[1]), u));
    const d = roundDim(normalizeDimension(parseFloat(threeMatch[2]), u));
    let h = roundDim(normalizeDimension(parseFloat(threeMatch[3]), u));
    if (base.kind === 'vanity' && h > 1.0) {
      return { dims: [w, d, 0.75], explicit: true, mirrorH: roundDim(h - 0.75) };
    }
    return { dims: [w, d, h], explicit: true };
  }

  const wMatch = text.match(/(?:가로|폭|W)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(cm|mm|m)?/i);
  const dMatch = text.match(/(?:깊이|세로|D)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(cm|mm|m)?/i);
  const hMatch = text.match(/(?:높이|H)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(cm|mm|m)?/i);
  if (wMatch && dMatch) {
    const w = roundDim(normalizeDimension(parseFloat(wMatch[1]), wMatch[2]));
    const d = roundDim(normalizeDimension(parseFloat(dMatch[1]), dMatch[2]));
    const h = hMatch ? roundDim(normalizeDimension(parseFloat(hMatch[1]), hMatch[2])) : defaultHeightFor(base);
    if (base.kind === 'vanity' && h > 1.0) {
      return { dims: [w, d, 0.75], explicit: true, mirrorH: roundDim(h - 0.75) };
    }
    return { dims: [w, d, h], explicit: true };
  }

  const twoMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:cm|mm|m)?\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*(cm|mm|m)?/i,
  );
  if (twoMatch) {
    const u = twoMatch[3];
    const num1 = normalizeDimension(parseFloat(twoMatch[1]), u);
    const num2 = normalizeDimension(parseFloat(twoMatch[2]), u);
    if (base.kind === 'mirror') {
      return { dims: [roundDim(Math.min(num1, num2)), 0.35, roundDim(Math.max(num1, num2))], explicit: true };
    }
    return { dims: [roundDim(num1), roundDim(num2), defaultHeightFor(base)], explicit: true };
  }

  return { dims: defaultDimsFor(base, text), explicit: false };
}

function detectMaterialKey(
  raw: string,
  base: BaseRule,
): { material: MaterialKey; accent?: MaterialKey; explicit: boolean } {
  const hasWood = /원목|우드|오크|월넛|고무나무|나무|wood|oak|walnut/i.test(raw);
  const hasWhite = /화이트|백색|하양|흰색|white/i.test(raw);
  const hasBlack = /블랙|차콜|검정|black|charcoal/i.test(raw);
  const hasSteel = /철제|스틸|메탈|실버|알루미늄|steel|metal|silver/i.test(raw);
  const hasGlass = /유리|글래스|glass/i.test(raw);
  const hasLeather = /가죽|레더|leather/i.test(raw);
  const hasFabric = /패브릭|벨벳|천|린넨|fabric|velvet|linen/i.test(raw);
  const hasNavy = /네이비|블루|파랑|navy|blue/i.test(raw);
  const hasGreen = /그린|카키|올리브|초록|green|olive/i.test(raw);
  const hasBeige = /베이지|아이보리|크림|beige|ivory|cream/i.test(raw);
  const hasGray = /그레이|회색|gray|grey/i.test(raw);
  const hasGold = /골드|황동|브라스|gold|brass/i.test(raw);
  const isGaming = /게이밍|gaming|rgb/i.test(raw);

  const woodKey: MaterialKey = /월넛|walnut/i.test(raw)
    ? 'wood_walnut'
    : /오크|oak/i.test(raw)
      ? 'wood_oak'
      : hasWhite
        ? 'wood_white'
        : 'wood_natural';

  // 가전·랙·타공판은 기본 비원목 재질 규칙 유지
  if (base.kind === 'pegboard') {
    if (hasBlack) return { material: 'steel_black', accent: 'steel_black', explicit: true };
    if (hasSteel) return { material: 'steel_white', accent: 'steel_black', explicit: true };
    return { material: 'steel_white', accent: 'steel_black', explicit: hasWhite };
  }
  if (base.kind === 'rack') {
    if (hasWhite) return { material: 'steel_white', accent: 'steel_white', explicit: true };
    if (hasBlack) return { material: 'steel_black', accent: 'steel_black', explicit: true };
    return { material: 'steel_black', accent: 'steel_black', explicit: hasSteel };
  }
  if (base.kind === 'appliance') {
    const isTv = /tv|티비|텔레비전/i.test(raw);
    if (isTv) return { material: hasWhite ? 'steel_white' : 'black', accent: 'steel_black', explicit: hasWhite || hasBlack };
    if (hasBlack) return { material: 'black', accent: 'steel_black', explicit: true };
    if (hasGray) return { material: 'gray', accent: 'steel', explicit: true };
    if (hasSteel && !hasWhite) return { material: 'steel', accent: 'steel_black', explicit: true };
    return { material: 'steel_white', accent: hasWood ? woodKey : 'steel', explicit: hasWhite };
  }

  if (base.kind === 'mirror') {
    if (hasWood) return { material: woodKey, accent: woodKey, explicit: true };
    if (hasGold) return { material: 'gold', accent: 'gold', explicit: true };
    if (hasBlack) return { material: 'steel_black', accent: 'steel_black', explicit: true };
    if (hasWhite) return { material: 'white', accent: 'white', explicit: true };
    if (hasSteel) return { material: 'steel', accent: 'steel', explicit: true };
    return { material: 'wood_natural', accent: 'wood_natural', explicit: false };
  }

  if (hasLeather) {
    return { material: hasBlack ? 'leather_black' : 'leather_brown', explicit: true };
  }
  if (hasFabric || hasNavy || hasGreen || hasBeige) {
    const mat: MaterialKey = hasNavy
      ? 'fabric_navy'
      : hasGreen
        ? 'fabric_green'
        : hasBeige
          ? 'fabric_beige'
          : 'fabric_gray';
    return { material: mat, accent: hasWood ? woodKey : 'steel_black', explicit: true };
  }
  if (hasGlass && base.kind !== 'window') {
    return { material: 'glass', accent: hasWood ? woodKey : 'steel_black', explicit: true };
  }
  if (hasGold) {
    return { material: 'gold', accent: 'gold', explicit: true };
  }
  if (hasWood) {
    return { material: woodKey, accent: hasSteel ? 'steel_black' : undefined, explicit: true };
  }
  if (hasSteel || isGaming) {
    const mat: MaterialKey = hasWhite ? 'steel_white' : hasBlack || isGaming ? 'steel_black' : 'steel';
    return { material: mat, accent: 'steel_black', explicit: true };
  }
  if (hasWhite) return { material: 'white', explicit: true };
  if (hasBlack) return { material: 'black', explicit: true };
  if (hasGray) return { material: 'gray', explicit: true };

  // 카테고리별 기본 재질
  switch (base.kind) {
    case 'seat':
      return { material: 'fabric_gray', accent: 'wood_natural', explicit: false };
    case 'lamp':
      return { material: 'fabric_beige', accent: 'steel_black', explicit: false };
    case 'desk':
      return { material: /독서실|칸막이/.test(raw) ? 'white' : 'wood_oak', accent: 'steel_black', explicit: false };
    case 'tv_stand':
    case 'vanity':
      return { material: 'wood_natural', explicit: false };
    default:
      return { material: 'wood_natural', explicit: false };
  }
}

const STOP_WORDS = new Set([
  '가로', '세로', '높이', '깊이', '폭', '단', '칸', '층',
  '화이트', '백색', '하양', '흰색', 'white',
  '블랙', '검정', '차콜', 'black', 'charcoal',
  '그레이', '회색', 'gray', 'grey',
  '네이비', '블루', '파랑', 'navy', 'blue',
  '그린', '초록', '카키', '올리브', 'green', 'olive',
  '베이지', '아이보리', '크림', 'beige', 'ivory', 'cream',
  '골드', '황동', '브라스', 'gold', 'brass',
  '실버', '은색', 'silver',
  '원목', '우드', '나무', 'wood',
  '오크', '월넛', '고무나무', 'oak', 'walnut',
  '철제', '스틸', '메탈', 'steel', 'metal',
  '알루미늄', '유리', '글래스', 'glass',
  '가죽', '레더', 'leather',
  '패브릭', '천', '린넨', '벨벳', 'fabric', 'linen', 'velvet',
  'lpm',
  '대형', '중형', '소형', '미니', 'mini', 'large', 'small',
  '슬림', '빅', '와이드', 'wide', 'slim',
  '퀸', '싱글', '슈퍼싱글', '더블', '킹', 'queen', 'single', 'king',
  '낮은', '높은', '긴', '넓은', '작은', '큰',
  '모던', '심플', '고급', '앤틱', '엔틱', '빈티지', '인테리어', '가구',
]);

function extractUnknownNoun(prompt: string): string {
  const tokens = prompt.trim().split(/\s+/);
  for (const t of tokens) {
    const clean = t.replace(/^[^\w가-힣]+|[^\w가-힣]+$/g, '').toLowerCase();
    if (!clean || /\d/.test(clean) || STOP_WORDS.has(clean)) continue;
    return t.replace(/^[^\w가-힣]+|[^\w가-힣]+$/g, '');
  }
  return tokens[0] || prompt;
}

function detectApplianceKind(raw: string): string {
  if (/냉장고|fridge|refrigerator/i.test(raw)) {
    if (/소형|미니|mini/i.test(raw)) return 'minifridge';
    if (/1도어|단문|원룸/.test(raw)) return 'fridge1';
    return 'fridge';
  }
  if (/세탁기|washer/i.test(raw)) return raw.includes('통돌이') ? 'toploader' : 'washer';
  if (/건조기|dryer/i.test(raw)) return 'dryer';
  if (/tv|티비|텔레비전/i.test(raw)) return raw.includes('스탠드') ? 'tvstand' : 'tv';
  if (/에어컨|aircon/i.test(raw)) return 'aircon';
  if (/공기청정기/i.test(raw)) return 'purifier';
  if (/스타일러|의류관리기/i.test(raw)) return 'styler';
  return 'fridge';
}

function materialLabelForName(key: MaterialKey): string {
  switch (key) {
    case 'wood_natural': return '원목';
    case 'wood_oak': return '오크';
    case 'wood_walnut': return '월넛';
    case 'wood_white':
    case 'white':
    case 'steel_white': return '화이트';
    case 'black':
    case 'steel_black':
    case 'leather_black': return '블랙';
    case 'gray':
    case 'fabric_gray': return '그레이';
    case 'steel': return '스틸';
    case 'gold': return '골드';
    case 'fabric_beige': return '베이지';
    case 'fabric_navy': return '네이비';
    case 'fabric_green': return '그린';
    case 'leather_brown': return '브라운 가죽';
    case 'glass': return '유리';
    default: return '';
  }
}

function buildName(ctx: ParseContext): string {
  const { raw, base, material, explicitMaterial, rootParams, appliedLabels } = ctx;
  const matWord =
    base.kind === 'appliance' || base.kind === 'pegboard' || base.kind === 'rack'
      ? (material.startsWith('wood_') ? '' : explicitMaterial ? materialLabelForName(material) : '')
      : explicitMaterial
        ? materialLabelForName(material)
        : '';

  let baseWord = base.label;
  if (base.kind === 'desk') {
    baseWord = /독서실/.test(raw) ? '독서실 책상' : /데스크|desk/i.test(raw) ? '데스크' : '책상';
  } else if (base.kind === 'table') {
    baseWord = /식탁/.test(raw) ? '식탁' : '테이블';
  } else if (base.kind === 'bed') {
    const size = /퀸|queen/i.test(raw) ? '퀸 ' : /슈퍼싱글/i.test(raw) ? '슈퍼싱글 ' : /싱글/i.test(raw) ? '싱글 ' : '';
    baseWord = `${size}침대`;
  } else if (base.kind === 'carcass') {
    if (/협탁/.test(raw)) baseWord = '협탁';
    else if (/신발장|슈즈랙/i.test(raw)) baseWord = '신발장';
    else if (/옷장/.test(raw)) baseWord = '옷장';
    else if (/책장/.test(raw)) baseWord = '책장';
    else if (/서랍장|서랍/.test(raw)) baseWord = '서랍장';
    else baseWord = '수납장';
  } else if (base.kind === 'seat') {
    if (/벤치/.test(raw)) baseWord = '벤치';
    else if (/스툴/.test(raw)) baseWord = '스툴';
    else if (/소파|카우치|sofa|couch/i.test(raw)) baseWord = '소파';
    else baseWord = '의자';
  } else if (base.kind === 'rack') {
    baseWord = '스틸 랙';
  } else if (base.kind === 'lamp') {
    baseWord = rootParams.style === 'desk' ? '데스크 램프' : '플로어 램프';
  } else if (base.kind === 'mirror') {
    baseWord = ctx.mount === 'wall' ? '벽걸이 거울' : '전신거울';
  } else if (base.kind === 'appliance') {
    const k = String(rootParams.kind ?? 'fridge');
    if (k === 'minifridge') baseWord = '소형 냉장고';
    else if (k === 'fridge1') baseWord = '1도어 냉장고';
    else if (k === 'fridge') baseWord = '냉장고';
    else if (k === 'toploader') baseWord = '통돌이 세탁기';
    else if (k === 'washer') baseWord = /드럼/.test(raw) ? '드럼 세탁기' : '세탁기';
    else if (k === 'dryer') baseWord = '건조기';
    else if (k === 'tvstand') baseWord = '스탠드 TV';
    else if (k === 'tv') baseWord = 'TV';
    else if (k === 'aircon') baseWord = '에어컨';
    else if (k === 'purifier') baseWord = '공기청정기';
    else if (k === 'styler') baseWord = '의류관리기';
  }

  // 이미 baseWord나 appliedLabels에 포함된 중복 수식어 제거
  const mods = appliedLabels.filter(
    (l) => !baseWord.includes(l) && !(l === '독서실 칸막이' && baseWord.includes('독서실')),
  );
  return [matWord, ...mods, baseWord].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function parseToBlueprint(prompt: string): ParseBlueprintResult {
  const raw = prompt.trim();
  const lower = raw.toLowerCase();

  let matchedBase: BaseRule | undefined;
  for (const rule of BASE_RULES) {
    if (rule.pattern.test(raw) || rule.pattern.test(lower)) {
      matchedBase = rule;
      break;
    }
  }

  const unknown: string[] = [];
  const notes: string[] = [];
  const base: BaseRule = matchedBase ?? {
    kind: 'unknown',
    moduleType: 'carcass',
    category: 'storage',
    pattern: /.*/,
    label: '수납장',
  };

  const dimRes = extractDimensionsFromPrompt(raw, base);
  const matRes = detectMaterialKey(raw, base);

  const ctx: ParseContext = {
    raw,
    lower,
    base,
    dims: dimRes.dims,
    explicitDims: dimRes.explicit,
    material: matRes.material,
    accent: matRes.accent,
    explicitMaterial: matRes.explicit,
    rootParams: {},
    children: [],
    appliedLabels: [],
    mirrorH: dimRes.mirrorH,
  };

  // 기본형별 초기 파라미터 및 기본 자식 구성
  switch (base.kind) {
    case 'vanity': {
      const mirrorH = ctx.mirrorH ?? 0.6;
      ctx.children.push(
        {
          type: 'mirror',
          anchor: 'top-back',
          w: roundDim(Math.min(0.6, ctx.dims[0] * 0.68)),
          d: 0.14,
          h: mirrorH,
        },
        {
          type: 'carcass',
          anchor: 'under',
          params: { side: 'right', drawers: 2, plinth: 0 },
        },
      );
      break;
    }
    case 'pegboard':
      ctx.mount = 'wall';
      ctx.mountY = 1.0;
      ctx.rootParams = { kind: 'pegboard', holes: true, hooks: 4, shelves: /선반/.test(raw) ? 1 : 0 };
      break;
    case 'board_shelf':
      ctx.mount = 'wall';
      ctx.mountY = 1.0;
      ctx.rootParams = { kind: 'shelf', holes: false, shelves: 2, hooks: 0 };
      break;
    case 'rack':
      ctx.rootParams = { shelves: 4 };
      break;
    case 'tv_stand':
      ctx.rootParams = { shelves: 1, doors: 2, kind: 'closed' };
      break;
    case 'desk':
      ctx.rootParams = { legs: /게이밍|모션|철제|스틸/.test(raw) ? 'frame' : 'four' };
      break;
    case 'table':
      ctx.rootParams = { legs: 'four' };
      break;
    case 'bed':
      ctx.rootParams = { headboard: true, legs: 'four', drawers: 0, bunk: false };
      break;
    case 'carcass':
      if (/협탁/.test(raw)) ctx.rootParams = { drawers: 2, shelves: 0 };
      else if (/서랍/.test(raw) && !/책장|옷장|신발장/.test(raw)) ctx.rootParams = { drawers: 3, shelves: 0 };
      else if (/책장/.test(raw)) ctx.rootParams = { kind: 'open', shelves: 4, doors: 0 };
      else if (/신발장|슈즈랙/i.test(raw)) ctx.rootParams = { kind: 'closed', doors: 2, shelves: 3 };
      else if (/옷장/.test(raw)) ctx.rootParams = { kind: 'closed', doors: 2, shelves: 1 };
      else ctx.rootParams = { kind: 'closed', doors: 2, shelves: 2 };
      break;
    case 'seat':
      if (/벤치/.test(raw)) ctx.rootParams = { style: 'bench', back: false, arms: false };
      else if (/스툴/.test(raw)) ctx.rootParams = { style: 'stool', back: false, arms: false };
      else if (/소파|카우치|sofa|couch/i.test(raw)) ctx.rootParams = { style: 'sofa', back: true, arms: true };
      else ctx.rootParams = { style: 'chair', back: true, arms: false };
      break;
    case 'lamp':
      ctx.rootParams = { style: ctx.dims[2] >= 0.9 ? 'floor' : 'desk' };
      break;
    case 'mirror':
      ctx.rootParams = { stand: true, arch: false };
      break;
    case 'appliance':
      ctx.rootParams = { kind: detectApplianceKind(raw) };
      break;
    case 'unknown':
      ctx.rootParams = { kind: 'closed', doors: 2, shelves: 2 };
      break;
  }

  // 수식어 규칙 일괄 적용 (조합)
  for (const mod of MODIFIER_RULES) {
    if (mod.types && !mod.types.includes(base.moduleType)) continue;
    const m = raw.match(mod.pattern);
    if (m) mod.apply(ctx, m);
  }

  const name = buildName(ctx);

  if (!matchedBase) {
    const noun = extractUnknownNoun(raw);
    unknown.push(noun);
    notes.push(
      `'${noun}'은(는) 아직 내장 생성기가 모르는 형태라 가장 가까운 '${name}'(으)로 만들었어요. 로그인하면 AI(Gemini)가 직접 설계해요.`,
    );
  }

  const blueprint: Blueprint = {
    name,
    category: base.category,
    material: ctx.material,
    ...(ctx.accent ? { accent: ctx.accent } : {}),
    ...(ctx.mount ? { mount: ctx.mount, mountY: ctx.mountY } : {}),
    root: {
      type: base.moduleType,
      w: ctx.dims[0],
      d: ctx.dims[1],
      h: ctx.dims[2],
      ...(Object.keys(ctx.rootParams).length ? { params: ctx.rootParams } : {}),
      ...(ctx.children.length ? { children: ctx.children } : {}),
    },
    ...(notes.length ? { notes } : {}),
  };

  return { blueprint, notes, unknown };
}

/** 사용된 모듈 구성을 한국어 1문장 요약을 위한 구절로 변환한다 */
export function describeBlueprint(bp: Blueprint): string {
  const describeModule = (m: ModuleSpec, isRoot: boolean): string => {
    const p = m.params ?? {};
    switch (m.type) {
      case 'table': {
        if (bp.category === 'storage') return '화장대 상판';
        if (bp.category === 'table') return bp.name.includes('식탁') ? '식탁' : '테이블';
        const extras: string[] = [];
        if (Number(p.drawers) > 0) extras.push(`앞치마 서랍 ${p.drawers}개`);
        return extras.length ? `책상(${extras.join('·')})` : '책상';
      }
      case 'partition': {
        const parts: string[] = [];
        if (p.shelf !== false) parts.push('선반');
        if (p.led === true) parts.push('조명');
        return parts.length ? `칸막이(${parts.join('·')})` : '칸막이';
      }
      case 'carcass': {
        if (!isRoot && m.anchor === 'under') {
          return Number(p.drawers) > 0 ? `하부 서랍장(${p.drawers}단)` : '하부 수납장';
        }
        if (!isRoot && (m.anchor === 'left' || m.anchor === 'right')) {
          return Number(p.shelves) > 0 ? `사이드 책장(${p.shelves}단)` : '사이드 책장';
        }
        if (!isRoot && m.anchor?.startsWith('top')) {
          const detail: string[] = [];
          if (p.kind === 'open') detail.push('오픈');
          if (Number(p.shelves) > 0) detail.push(`${p.shelves}단`);
          return detail.length ? `상단 선반장(${detail.join('·')})` : '상단 선반장';
        }
        const detail: string[] = [];
        if (Number(p.drawers) > 0) detail.push(`서랍 ${p.drawers}단`);
        if (Number(p.shelves) > 0) detail.push(`선반 ${p.shelves}단`);
        if (Number(p.doors) > 0) detail.push(`도어 ${p.doors}개`);
        const label = bp.name.includes('책장') ? '책장' : bp.name.includes('서랍장') ? '서랍장' : bp.name.includes('옷장') ? '옷장' : '수납장';
        return detail.length ? `${label}(${detail.join('·')})` : label;
      }
      case 'bedframe': {
        const detail: string[] = [];
        if (p.bunk === true) detail.push('2층');
        if (Number(p.drawers) > 0) detail.push(`서랍 ${p.drawers}개`);
        if (p.headboard === false) detail.push('무헤드');
        return detail.length ? `침대 프레임(${detail.join('·')})` : '침대 프레임';
      }
      case 'seat': {
        const style = String(p.style ?? 'chair');
        const label = style === 'sofa' ? '소파' : style === 'bench' ? '벤치' : style === 'stool' ? '스툴' : '의자';
        return style === 'sofa' && Number(p.seats) > 0 ? `${label}(${p.seats}인)` : label;
      }
      case 'board': {
        const isPeg = String(p.kind ?? 'pegboard') === 'pegboard';
        const extras: string[] = [];
        if (Number(p.shelves) > 0) extras.push(`선반 ${p.shelves}단`);
        if (Number(p.hooks) > 0) extras.push(`후크 ${p.hooks}개`);
        return extras.length ? `${isPeg ? '타공판' : '벽선반'}(${extras.join('·')})` : isPeg ? '타공판' : '벽선반';
      }
      case 'rack':
        return `철제 랙(${Number(p.shelves ?? 4)}단)`;
      case 'lamp':
        return String(p.style ?? 'floor') === 'desk' ? '데스크 램프' : '플로어 램프';
      case 'mirror':
        if (!isRoot) return '상판 거울';
        return p.arch === true ? '아치형 거울' : p.stand === false ? '벽걸이 거울' : '전신거울';
      case 'appliance':
        return `가전(${bp.name})`;
      default:
        return bp.name;
    }
  };

  const parts = [describeModule(bp.root, true)];
  for (const child of bp.root.children ?? []) {
    parts.push(describeModule(child, false));
  }
  return parts.join(' + ');
}
