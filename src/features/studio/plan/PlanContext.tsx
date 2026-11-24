import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { FloorplanEditor, PlanHover, PlanTool } from '../../../engine/floorplan';

/** 도면 배경 사진 (모드 전환·에디터 재생성 후에도 유지) */
export interface PlanPhoto {
  image: HTMLImageElement;
  visible: boolean;
}

interface PlanUiState {
  editor: FloorplanEditor | null;
  tool: PlanTool;
  drawing: boolean;
  /** onChange 수신마다 증가 — summary()·문 속성 재계산 트리거 */
  revision: number;
  /** 마지막으로 가리킨(호버/클릭) 문 id */
  doorId: string | null;
  photo: PlanPhoto | null;
}

export interface PlanUiActions {
  setEditor(editor: FloorplanEditor | null): void;
  setTool(tool: PlanTool): void;
  setDrawing(drawing: boolean): void;
  bump(): void;
  hover(h: PlanHover): void;
  clearDoor(): void;
  setPhoto(photo: PlanPhoto | null): void;
}

const Ctx = createContext<{ state: PlanUiState; actions: PlanUiActions } | null>(null);

/** PlanView(엔진 래퍼)와 도구 막대·인스펙터·사진 위저드가 공유하는 2D UI 상태. StudioPage 범위(전역 아님) */
export function PlanUiProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlanUiState>({ editor: null, tool: 'select', drawing: false, revision: 0, doorId: null, photo: null });
  const actions = useMemo<PlanUiActions>(() => {
    const patch = (p: Partial<PlanUiState>) => setState((s) => ({ ...s, ...p }));
    return {
      setEditor: (editor) => patch({ editor }),
      setTool: (tool) => patch({ tool }),
      setDrawing: (drawing) => patch({ drawing }),
      bump: () => setState((s) => ({ ...s, revision: s.revision + 1 })),
      hover: (h) => { if (h.doorId) setState((s) => (s.doorId === h.doorId ? s : { ...s, doorId: h.doorId })); },
      clearDoor: () => patch({ doorId: null }),
      setPhoto: (photo) => patch({ photo }),
    };
  }, []);
  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlanUi: PlanUiProvider 밖에서 호출됨');
  return v;
}
