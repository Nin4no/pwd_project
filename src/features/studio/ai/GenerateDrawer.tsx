import { useState, type FormEvent } from 'react';
import { Badge, Button, Field, Sheet, Tabs } from '../../../design/components';
import type { CatalogRegistry } from '../../../domain/catalog';
import { aiApi, type AiApi } from '../../../services/api';
import { useStudio, useStudioStoreApi } from '../context';
import { generateFurniture, type GeneratedFurniture } from './furnitureGen';
import PhotoFurnitureTab from './PhotoFurnitureTab';
import s from './Ai.module.css';

const EXAMPLES = ['원목 2인용 소파', '120cm 화이트 책상 서랍 2개', '5단 철제 선반', '퀸 사이즈 침대 헤드보드'];
const cm = (m: number) => Math.round(m * 100);

type CreateTab = 'text' | 'photo';

interface Props {
  catalog: CatalogRegistry;
  /** 테스트·데모용 주입. 기본은 서버 프록시 */
  ai?: Pick<AiApi, 'generateFurniture'> & Partial<Pick<AiApi, 'generateFurnitureFromPhoto'>>;
}

/** AI 가구 만들기: 말로 설명 또는 사진 추출 → 카탈로그 AI 탭 등록 → 바로 배치 */
export default function GenerateDrawer({ catalog, ai = aiApi }: Props) {
  const store = useStudioStoreApi();
  const open = useStudio((st) => st.panels.ai === 'generate');
  const busy = useStudio((st) => st.busy === 'generating');
  const [tab, setTab] = useState<CreateTab>('text');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<GeneratedFurniture | null>(null);

  const close = () => {
    setError('');
    store.getState().setPanel('ai', null);
  };
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    const a = store.getState();
    a.setBusy('generating');
    setError('');
    setResult(null);
    try {
      const r = await generateFurniture(ai, text);
      const spec = catalog.addUserFurniture(r.spec);
      setResult({ ...r, spec });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error && err.message ? err.message : '가구를 생성하지 못했어요.');
    } finally {
      store.getState().setBusy(null);
    }
  };
  const placeNow = () => {
    if (!result) return;
    const a = store.getState();
    if (a.mode !== 'build') a.setMode('build');
    a.place(result.spec.id, { x: 0, z: 0 }); // 시점 자동 이동 없음
    close();
  };

  const textPanel = (
    <>
      <form className={s.form} onSubmit={submit}>
        <Field
          label="가구 설명"
          multiline
          rows={3}
          placeholder="예: 원목 수납장 120cm, 문 2개"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.currentTarget.value);
            if (error) setError('');
          }}
          disabled={busy}
        />
        <div className={s.examples} role="group" aria-label="예시 문장">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className={s.example}
              onClick={() => {
                setPrompt(ex);
                if (error) setError('');
              }}
              disabled={busy}
            >
              {ex}
            </button>
          ))}
        </div>
        {error && <p className={s.error} role="alert">{error}</p>}
      </form>

      {busy && <p className={s.status} role="status">설계도를 그리고 있어요…</p>}

      {result && (
        <section className={s.result} aria-live="polite">
          <div className={s.resultHead}>
            <span className={s.swatch} style={{ background: result.spec.color }} aria-hidden="true" />
            <strong>{result.spec.name}</strong>
            <Badge tone={result.via === 'server' ? 'ai' : 'neutral'}>{result.via === 'server' ? 'AI 설계' : '내장 생성기'}</Badge>
          </div>
          <p className={s.mono}>{cm(result.spec.size[0])} × {cm(result.spec.size[1])} × {cm(result.spec.size[2])} cm · {result.spec.material ?? ''}</p>
          {result.reason && <p className={s.notice}>{result.reason} — 내장 생성기로 만들었어요.</p>}
          {result.description && <p className={s.desc}>{result.description}</p>}
          {result.notes.length > 0 && (
            <ul className={s.notes}>{result.notes.slice(0, 4).map((n) => <li key={n}>{n}</li>)}</ul>
          )}
        </section>
      )}
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={close}
      title="AI 가구 만들기"
      description="말로 설명하거나 사진에서 추출해 카탈로그의 AI 탭에 저장해요."
      footer={
        tab === 'text' ? (
          result ? (
            <>
              <Button variant="secondary" onClick={() => { setResult(null); setPrompt(''); setError(''); }}>하나 더 만들기</Button>
              <Button onClick={placeNow}>바로 배치</Button>
            </>
          ) : (
            <Button onClick={() => void submit()} loading={busy} disabled={!prompt.trim()}>만들기</Button>
          )
        ) : undefined
      }
    >
      <Tabs
        aria-label="가구 만들기 방식"
        fill
        value={tab}
        onChange={(next) => {
          if (!busy) setTab(next);
        }}
        items={[
          { value: 'text', label: '말로 만들기', disabled: busy, panel: textPanel },
          {
            value: 'photo',
            label: '사진으로 추출',
            disabled: busy,
            panel: <PhotoFurnitureTab catalog={catalog} ai={ai} onPlaced={close} />,
          },
        ]}
      />
    </Sheet>
  );
}
