import { useEffect, useRef } from 'react';
import { FloorplanEditor, themeFromElement } from '../../../engine/floorplan';
import { roomOffset } from '../../../engine/geometry';
import { isDoorSpec, toPlanDocument } from '../../../domain/room';
import type { Room } from '../../../domain/types';
import { useStudioStoreApi } from '../context';
import type { StudioCatalog } from '../store';
import { usePlanUi } from './PlanContext';
import s from './Plan.module.css';

/** 문이 아닌 가구를 도면 좌표로 올려 미리보기로 (편집 대상 아님) */
function previewOf(room: Room, catalog: StudioCatalog) {
  const off = roomOffset(room.walls);
  const cat = catalog.scoped(room);
  return room.furniture
    .filter((f) => !isDoorSpec(cat.get(f.specId)))
    .map((f) => ({ ...f, x: +(f.x + off.x).toFixed(3), z: +(f.z + off.y).toFixed(3) }));
}

/**
 * 2D 도면 캔버스 — FloorplanEditor(순수 엔진) 생성·resize·dispose만 담당.
 * commit만 스토어(applyPlan)에 반영하고, 드래그 중 프리뷰(commit=false)는 3D로 보내지 않는다.
 */
export default function PlanView({ catalog }: { catalog: StudioCatalog }) {
  const store = useStudioStoreApi();
  const { state: ui, actions } = usePlanUi();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const room0 = store.getState().room;
    if (!canvas || !wrap || !room0) return;
    let echo: Room | null = null;
    const editor = new FloorplanEditor(canvas, toPlanDocument(room0, catalog.scoped(room0)), {
      catalog: catalog.scoped(room0),
      onChange(doc, commit) {
        actions.bump();
        if (!commit) return;
        const st = store.getState();
        st.applyPlan(doc.walls, doc.wallHeight, doc.doors);
        echo = store.getState().room;
      },
      onToolChange: actions.setTool,
      onHover: actions.hover,
      onDrawingChange: actions.setDrawing,
      onEscape: () => store.getState().setPanel('help', false),
      theme: themeFromElement(canvas),
    });
    editor.setFurniturePreview(previewOf(room0, catalog));
    actions.setTool(editor.getTool());
    actions.setEditor(editor);

    const unsub = store.subscribe((st, prev) => {
      if (!st.room || st.room === prev.room) return;
      // 에코 방지: 방금 이 에디터가 보낸 변경이면 문서는 이미 같다
      if (st.room !== echo) editor.setDocument(toPlanDocument(st.room, catalog.scoped(st.room)));
      editor.setFurniturePreview(previewOf(st.room, catalog));
      actions.bump();
    });

    let fitted = false;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      editor.resize(r.width, r.height, window.devicePixelRatio || 1);
      if (!fitted) { fitted = true; editor.fitToContent(); }
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      unsub();
      editor.dispose();
      actions.setEditor(null);
    };
  }, [store, catalog, actions]);

  useEffect(() => {
    if (!ui.editor) return;
    ui.editor.setBackground(ui.photo ? { image: ui.photo.image, visible: ui.photo.visible, opacity: 0.45 } : null);
  }, [ui.editor, ui.photo]);

  return (
    <div ref={wrapRef} className={s.canvasWrap}>
      <canvas ref={canvasRef} className={s.canvas} role="img" aria-label="2D 도면 편집 캔버스 — 1~5 도구, F 맞춤, 휠로 확대" tabIndex={0} />
    </div>
  );
}
