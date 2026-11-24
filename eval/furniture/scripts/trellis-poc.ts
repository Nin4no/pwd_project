import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client, handle_file } from '@gradio/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../..');
const POC_DIR = path.join(ROOT, 'eval/furniture/poc');
const REPORT_PATH = path.join(POC_DIR, 'poc-report.json');

// Load server/.env via dotenv without ever reading or printing its contents
const require = createRequire(path.join(ROOT, 'server/package.json'));
require('dotenv').config({ path: path.join(ROOT, 'server/.env'), quiet: true });

const CALL_TIMEOUT_MS = 180_000;
const CONNECT_TIMEOUT_MS = 25_000;
const MAX_REMOTE_CALLS = 15;

export interface PromptItem {
  index: number;
  ko: string;
  en: string;
}

export const PROMPTS: PromptItem[] = [
  {
    index: 1,
    ko: '타공판 선반',
    en: 'pegboard wall shelf, white metal, isolated product photo, solid white background, front isometric view',
  },
  {
    index: 2,
    ko: '1도어 냉장고',
    en: 'single door compact refrigerator, matte white, isolated product photo, solid white background, front isometric view',
  },
  {
    index: 3,
    ko: '원목 4단 책장',
    en: 'wooden 4-tier open bookcase shelf, natural oak wood, isolated product photo, solid white background, front isometric view',
  },
  {
    index: 4,
    ko: '철제 프레임 2인용 식탁',
    en: 'two-seater dining table with black steel frame and wood top, isolated product photo, solid white background, front isometric view',
  },
  {
    index: 5,
    ko: '패브릭 1인 소파',
    en: 'single-seater fabric armchair sofa, beige linen, isolated product photo, solid white background, front isometric view',
  },
];

export type ErrorCategory =
  | 'QuotaExceeded'
  | 'queue'
  | '5xx'
  | 'timeout'
  | '4xx'
  | 'space_unavailable'
  | 'budget_cap'
  | 'other';

export interface EndpointSummary {
  spaceId: string;
  stage?: string;
  hardware?: string;
  reachable: boolean;
  error?: string;
  namedEndpoints: Record<
    string,
    {
      parameters: Array<{ name: string; type: string; hasDefault: boolean; defaultVal?: unknown }>;
      returns: Array<{ label: string; type: string }>;
    }
  >;
}

export interface RunEntry {
  index: number;
  prompt: string;
  englishPrompt: string;
  path: 'A' | 'B1' | 'B2';
  spaceId: string;
  imageSpaceId?: string;
  meshSpaceId?: string;
  fallbackSpaceId?: string;
  ok: boolean;
  error: string | null;
  errorCategory: ErrorCategory | null;
  ms: {
    image?: number;
    preprocess?: number;
    mesh?: number;
    total: number;
  };
  glbBytes: number | null;
  glbValidHeader?: boolean;
  glbFile: string | null;
  imageFile: string | null;
  attempts: number;
  notes?: string;
}

export interface PocReport {
  generatedAt: string;
  authMode: 'hf_token' | 'anonymous';
  maxRemoteCalls: number;
  remoteCallsUsed: number;
  quotaExceeded: boolean;
  discoveredSpaces: Record<string, EndpointSummary>;
  geminiListModels: {
    configured: boolean;
    status: number | null;
    models: Array<{ name: string; methods: string[] }>;
  };
  geminiImageProbe?: {
    model: string;
    status: number | null;
    ok: boolean;
    ms: number;
    error?: string;
    savedFile?: string;
  };
  runs: RunEntry[];
}

function getHfToken(): `hf_${string}` | undefined {
  const raw = process.env.HF_TOKEN?.trim();
  if (!raw) return undefined;
  return raw as `hf_${string}`;
}

function getAuthMode(): 'hf_token' | 'anonymous' {
  return getHfToken() ? 'hf_token' : 'anonymous';
}

function redactSecrets(text: string): string {
  let out = text;
  const hf = process.env.HF_TOKEN?.trim();
  const gk = process.env.GEMINI_API_KEY?.trim();
  if (hf) out = out.split(hf).join('[REDACTED_HF_TOKEN]');
  if (gk) out = out.split(gk).join('[REDACTED_GEMINI_KEY]');
  return out.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
}

function classifyError(err: unknown): { category: ErrorCategory; message: string } {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null
        ? JSON.stringify(err)
        : String(err);
  const msg = redactSecrets(raw);
  const lower = msg.toLowerCase();
  if (
    lower.includes('quota') ||
    lower.includes('zerogpu') ||
    lower.includes('exceeded') ||
    lower.includes('gpu task aborted') ||
    lower.includes('you have exceeded')
  ) {
    return { category: 'QuotaExceeded', message: msg };
  }
  if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('timed out')) {
    return { category: 'timeout', message: msg };
  }
  if (lower.includes('queue') || lower.includes('full')) {
    return { category: 'queue', message: msg };
  }
  if (
    /\b5\d{2}\b/.test(lower) ||
    lower.includes('internal server error') ||
    lower.includes('bad gateway') ||
    lower.includes('service unavailable')
  ) {
    return { category: '5xx', message: msg };
  }
  if (/\b4(01|03|04|29)\b/.test(lower) || lower.includes('not found') || lower.includes('forbidden')) {
    return { category: '4xx', message: msg };
  }
  if (
    lower.includes('sleeping') ||
    lower.includes('paused') ||
    lower.includes('building') ||
    lower.includes('space_error') ||
    lower.includes('config_error')
  ) {
    return { category: 'space_unavailable', message: msg };
  }
  return { category: 'other', message: msg };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchSpaceMeta(
  spaceId: string,
): Promise<{ ok: boolean; status: number; stage?: string; hardware?: string }> {
  try {
    const res = await fetch(`https://huggingface.co/api/spaces/${spaceId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = (await res.json()) as any;
    return {
      ok: true,
      status: res.status,
      stage: data?.runtime?.stage,
      hardware: data?.runtime?.hardware?.current,
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function connectSpace(spaceId: string): Promise<Client> {
  const token = getHfToken();
  const options = token ? { hf_token: token } : undefined;
  return withTimeout(Client.connect(spaceId, options), CONNECT_TIMEOUT_MS, `connect:${spaceId}`);
}

async function inspectSpace(spaceId: string): Promise<EndpointSummary> {
  const meta = await fetchSpaceMeta(spaceId);
  if (!meta.ok) {
    return {
      spaceId,
      reachable: false,
      error: `HF Space API HTTP ${meta.status}`,
      namedEndpoints: {},
    };
  }
  if (meta.stage && meta.stage !== 'RUNNING') {
    return {
      spaceId,
      stage: meta.stage,
      hardware: meta.hardware,
      reachable: false,
      error: `Space stage=${meta.stage}`,
      namedEndpoints: {},
    };
  }
  let client: Client | undefined;
  try {
    client = await connectSpace(spaceId);
    const api = await withTimeout(client.view_api(), 15_000, `view_api:${spaceId}`);
    const namedEndpoints: EndpointSummary['namedEndpoints'] = {};
    for (const [name, info] of Object.entries(api.named_endpoints)) {
      namedEndpoints[name] = {
        parameters: info.parameters.map((p) => ({
          name: p.parameter_name ?? '(state)',
          type: p.type,
          hasDefault: Boolean(p.parameter_has_default),
          defaultVal: p.parameter_has_default ? p.parameter_default : undefined,
        })),
        returns: info.returns.map((r) => ({
          label: r.label,
          type: r.type,
        })),
      };
    }
    return {
      spaceId,
      stage: meta.stage,
      hardware: meta.hardware,
      reachable: true,
      namedEndpoints,
    };
  } catch (err) {
    return {
      spaceId,
      stage: meta.stage,
      hardware: meta.hardware,
      reachable: false,
      error: classifyError(err).message,
      namedEndpoints: {},
    };
  } finally {
    try {
      client?.close();
    } catch {
      // ignore
    }
  }
}

async function listGeminiImageModels(): Promise<PocReport['geminiListModels']> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return { configured: false, status: null, models: [] };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    return { configured: true, status: res.status, models: [] };
  }
  const data = (await res.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  };
  const models = (data.models ?? [])
    .filter(
      (m) =>
        /image|imagen/i.test(m.name) ||
        (m.supportedGenerationMethods ?? []).some((method) => /predict/i.test(method)),
    )
    .map((m) => ({
      name: m.name,
      methods: m.supportedGenerationMethods ?? [],
    }));
  return { configured: true, status: res.status, models };
}

function extractFileUrl(item: unknown): string | null {
  if (!item) return null;
  if (typeof item === 'string') {
    if (item.startsWith('http://') || item.startsWith('https://')) return item;
    return null;
  }
  if (typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    if (typeof obj.url === 'string' && obj.url.startsWith('http')) return obj.url;
    if (typeof obj.path === 'string' && obj.path.startsWith('http')) return obj.path;
  }
  return null;
}

async function downloadFile(url: string): Promise<Buffer> {
  const token = getHfToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Download HTTP ${res.status} from ${new URL(url).hostname}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

function isGlbBuffer(buf: Buffer): boolean {
  return buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'glTF';
}

function isPngBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  );
}

class CallBudget {
  used = 0;
  quotaExceeded = false;
  constructor(initialUsed = 0) {
    this.used = initialUsed;
  }
  canCall(): boolean {
    return !this.quotaExceeded && this.used < MAX_REMOTE_CALLS;
  }
  consume(label: string): void {
    if (this.quotaExceeded) {
      throw new Error(`QuotaExceeded already triggered; skipping ${label}`);
    }
    if (this.used >= MAX_REMOTE_CALLS) {
      throw new Error(`Remote call budget cap (${MAX_REMOTE_CALLS}) reached before ${label}`);
    }
    this.used += 1;
    console.log(`  [call ${this.used}/${MAX_REMOTE_CALLS}] ${label}`);
  }
}

async function callWithRetry<T>(
  budget: CallBudget,
  label: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T; attempts: number; ms: number } | { ok: false; category: ErrorCategory; error: string; attempts: number; ms: number }> {
  const tStart = Date.now();
  let attempts = 0;
  let lastCategory: ErrorCategory = 'other';
  let lastError = 'Unknown error';

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (!budget.canCall()) {
      return {
        ok: false,
        category: budget.quotaExceeded ? 'QuotaExceeded' : 'budget_cap',
        error: budget.quotaExceeded ? 'Aborted due to prior QuotaExceeded' : `Budget cap ${MAX_REMOTE_CALLS} reached`,
        attempts,
        ms: Date.now() - tStart,
      };
    }
    attempts += 1;
    try {
      budget.consume(`${label} (attempt ${attempt})`);
      const value = await withTimeout(fn(), CALL_TIMEOUT_MS, label);
      return { ok: true, value, attempts, ms: Date.now() - tStart };
    } catch (err) {
      const classified = classifyError(err);
      lastCategory = classified.category;
      lastError = classified.message;
      console.warn(`  [warn] ${label} attempt ${attempt} failed [${lastCategory}]: ${lastError}`);
      if (lastCategory === 'QuotaExceeded') {
        budget.quotaExceeded = true;
        break;
      }
      if (lastCategory === '4xx' || lastCategory === 'space_unavailable') {
        break;
      }
    }
  }
  return {
    ok: false,
    category: lastCategory,
    error: lastError,
    attempts,
    ms: Date.now() - tStart,
  };
}

async function generateGeminiImage(
  modelName: string,
  prompt: string,
  budget: CallBudget,
): Promise<{
  ok: boolean;
  status: number | null;
  buffer?: Buffer;
  mimeType?: string;
  error?: string;
  ms: number;
}> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const t0 = Date.now();
  if (!apiKey) {
    return { ok: false, status: null, error: 'GEMINI_API_KEY missing', ms: 0 };
  }
  if (!budget.canCall()) {
    return { ok: false, status: null, error: 'Budget cap or quota exceeded', ms: 0 };
  }
  const cleanModel = modelName.replace(/^models\//, '');
  budget.consume(`gemini:${cleanModel}`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errText = redactSecrets(await res.text().catch(() => ''));
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}: ${errText.slice(0, 240)}`,
        ms: Date.now() - t0,
      };
    }
    const json = (await res.json()) as any;
    const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find((p) => p?.inlineData?.data);
    if (!imgPart) {
      return {
        ok: false,
        status: res.status,
        error: 'No inlineData image returned in response',
        ms: Date.now() - t0,
      };
    }
    const buf = Buffer.from(imgPart.inlineData.data, 'base64');
    return {
      ok: true,
      status: res.status,
      buffer: buf,
      mimeType: imgPart.inlineData.mimeType ?? 'image/png',
      ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: classifyError(err).message,
      ms: Date.now() - t0,
    };
  }
}

async function runPathA(item: PromptItem, budget: CallBudget): Promise<RunEntry> {
  const spaceId = 'suvadityamuk/trellis-text-to-3d';
  const tStart = Date.now();
  let client: Client | undefined;
  try {
    client = await connectSpace(spaceId);
    const callRes = await callWithRetry(budget, `PathA:${item.index}:${spaceId}`, async () => {
      const result = await client!.predict('/generate_and_extract_glb', {
        prompt: item.en,
        seed: 0,
        ss_guidance_strength: 7.5,
        ss_sampling_steps: 12,
        slat_guidance_strength: 7.5,
        slat_sampling_steps: 12,
        mesh_simplify: 0.95,
        texture_size: 512,
      });
      return result.data as unknown[];
    });

    if (!callRes.ok) {
      return {
        index: item.index,
        prompt: item.ko,
        englishPrompt: item.en,
        path: 'A',
        spaceId,
        ok: false,
        error: callRes.error,
        errorCategory: callRes.category,
        ms: { mesh: callRes.ms, total: Date.now() - tStart },
        glbBytes: null,
        glbFile: null,
        imageFile: null,
        attempts: callRes.attempts,
      };
    }

    const data = callRes.value;
    const glbUrl = extractFileUrl(data[2]) ?? extractFileUrl(data[1]);
    if (!glbUrl) {
      return {
        index: item.index,
        prompt: item.ko,
        englishPrompt: item.en,
        path: 'A',
        spaceId,
        ok: false,
        error: `No GLB URL in response: ${JSON.stringify(data).slice(0, 240)}`,
        errorCategory: 'other',
        ms: { mesh: callRes.ms, total: Date.now() - tStart },
        glbBytes: null,
        glbFile: null,
        imageFile: null,
        attempts: callRes.attempts,
      };
    }

    const glbBuf = await downloadFile(glbUrl);
    const glbRel = `eval/furniture/poc/${item.index}_A.glb`;
    fs.writeFileSync(path.join(ROOT, glbRel), glbBuf);

    return {
      index: item.index,
      prompt: item.ko,
      englishPrompt: item.en,
      path: 'A',
      spaceId,
      ok: true,
      error: null,
      errorCategory: null,
      ms: { mesh: callRes.ms, total: Date.now() - tStart },
      glbBytes: glbBuf.length,
      glbValidHeader: isGlbBuffer(glbBuf),
      glbFile: glbRel,
      imageFile: null,
      attempts: callRes.attempts,
    };
  } catch (err) {
    const classified = classifyError(err);
    if (classified.category === 'QuotaExceeded') budget.quotaExceeded = true;
    return {
      index: item.index,
      prompt: item.ko,
      englishPrompt: item.en,
      path: 'A',
      spaceId,
      ok: false,
      error: classified.message,
      errorCategory: classified.category,
      ms: { total: Date.now() - tStart },
      glbBytes: null,
      glbFile: null,
      imageFile: null,
      attempts: 0,
    };
  } finally {
    try {
      client?.close();
    } catch {
      // ignore
    }
  }
}

async function runPathB(
  item: PromptItem,
  budget: CallBudget,
  geminiModel: string,
  allowHunyuanFallback: boolean,
  geminiAlreadyBlocked: boolean,
): Promise<RunEntry> {
  const b1Space = 'black-forest-labs/FLUX.1-schnell';
  const trellisSpace = 'trellis-community/TRELLIS';
  const hunyuanSpace = 'tencent/Hunyuan3D-2';
  const tStart = Date.now();

  let imagePathTag: 'B1' | 'B2' = 'B1';
  let imageSpaceId = b1Space;
  let imageBuf: Buffer | undefined;
  let imageMs = 0;
  let totalAttempts = 0;
  let imageError: { category: ErrorCategory; message: string } | undefined;

  // Step 1: B1 (HF Space FLUX.1-schnell)
  let fluxClient: Client | undefined;
  try {
    fluxClient = await connectSpace(b1Space);
    const imgRes = await callWithRetry(budget, `PathB1-img:${item.index}:${b1Space}`, async () => {
      const res = await fluxClient!.predict('/infer', {
        prompt: item.en,
        seed: 0,
        randomize_seed: true,
        width: 1024,
        height: 1024,
        num_inference_steps: 4,
      });
      return res.data as unknown[];
    });
    totalAttempts += imgRes.attempts;
    imageMs += imgRes.ms;
    if (imgRes.ok) {
      const imgUrl = extractFileUrl(imgRes.value[0]);
      if (imgUrl) {
        imageBuf = await downloadFile(imgUrl);
      } else {
        imageError = { category: 'other', message: 'FLUX returned no image URL' };
      }
    } else {
      imageError = { category: imgRes.category, message: imgRes.error };
    }
  } catch (err) {
    const c = classifyError(err);
    imageError = c;
    if (c.category === 'QuotaExceeded') budget.quotaExceeded = true;
  } finally {
    try {
      fluxClient?.close();
    } catch {
      // ignore
    }
  }

  // Step 1b: B2 fallback (Gemini image model) if B1 failed
  if (!imageBuf && budget.canCall() && !geminiAlreadyBlocked) {
    const gRes = await generateGeminiImage(geminiModel, item.en, budget);
    totalAttempts += 1;
    imageMs += gRes.ms;
    if (gRes.ok && gRes.buffer) {
      imagePathTag = 'B2';
      imageSpaceId = geminiModel;
      imageBuf = gRes.buffer;
    } else {
      imageError = {
        category: gRes.status === 429 ? 'QuotaExceeded' : gRes.status && gRes.status >= 400 ? '4xx' : 'other',
        message: `B1(${imageError?.message ?? 'fail'}) + B2(${gRes.error ?? gRes.status})`,
      };
    }
  }

  if (!imageBuf) {
    return {
      index: item.index,
      prompt: item.ko,
      englishPrompt: item.en,
      path: imagePathTag,
      spaceId: `${imageSpaceId} -> ${trellisSpace}`,
      imageSpaceId,
      meshSpaceId: trellisSpace,
      ok: false,
      error: imageError?.message ?? 'Image generation failed',
      errorCategory: imageError?.category ?? 'other',
      ms: { image: imageMs, total: Date.now() - tStart },
      glbBytes: null,
      glbFile: null,
      imageFile: null,
      attempts: totalAttempts,
    };
  }

  // Save intermediate image
  const rawImgExt = isPngBuffer(imageBuf) ? 'png' : 'webp';
  const rawImgRel = `eval/furniture/poc/${item.index}_${imagePathTag}_raw.${rawImgExt}`;
  const rawImgAbs = path.join(ROOT, rawImgRel);
  fs.writeFileSync(rawImgAbs, imageBuf);

  let finalImgRel = `eval/furniture/poc/${item.index}_${imagePathTag}.png`;
  let finalImgAbs = path.join(ROOT, finalImgRel);
  if (rawImgExt === 'png') {
    fs.writeFileSync(finalImgAbs, imageBuf);
  }

  // Step 2: Image -> GLB via trellis-community/TRELLIS
  let preprocessMs = 0;
  let meshMs = 0;
  let trellisClient: Client | undefined;
  let meshError: { category: ErrorCategory; message: string } | undefined;

  try {
    trellisClient = await connectSpace(trellisSpace);
    try {
      await withTimeout(trellisClient.predict('/start_session', []), 15_000, 'start_session');
    } catch {
      // start_session is best-effort
    }

    // Preprocess image on TRELLIS (rembg background removal -> PNG)
    let inputImageFor3D: string = rawImgAbs;
    if (budget.canCall()) {
      const prepRes = await callWithRetry(budget, `PathB-prep:${item.index}:${trellisSpace}`, async () => {
        const res = await trellisClient!.predict('/preprocess_image', {
          image: handle_file(rawImgAbs),
        });
        return res.data as unknown[];
      });
      totalAttempts += prepRes.attempts;
      preprocessMs = prepRes.ms;
      if (prepRes.ok) {
        const prepUrl = extractFileUrl(prepRes.value[0]);
        if (prepUrl) {
          const prepBuf = await downloadFile(prepUrl);
          fs.writeFileSync(finalImgAbs, prepBuf);
          inputImageFor3D = finalImgAbs;
        }
      }
    }

    if (budget.canCall()) {
      const meshRes = await callWithRetry(budget, `PathB-3d:${item.index}:${trellisSpace}`, async () => {
        const res = await trellisClient!.predict('/generate_and_extract_glb', {
          image: handle_file(inputImageFor3D),
          multiimages: [],
          seed: 0,
          ss_guidance_strength: 7.5,
          ss_sampling_steps: 12,
          slat_guidance_strength: 3,
          slat_sampling_steps: 12,
          multiimage_algo: 'stochastic',
          mesh_simplify: 0.95,
          texture_size: 1024,
        });
        return res.data as unknown[];
      });
      totalAttempts += meshRes.attempts;
      meshMs = meshRes.ms;

      if (meshRes.ok) {
        const glbUrl = extractFileUrl(meshRes.value[2]) ?? extractFileUrl(meshRes.value[1]);
        if (glbUrl) {
          const glbBuf = await downloadFile(glbUrl);
          const glbRel = `eval/furniture/poc/${item.index}_${imagePathTag}.glb`;
          fs.writeFileSync(path.join(ROOT, glbRel), glbBuf);
          return {
            index: item.index,
            prompt: item.ko,
            englishPrompt: item.en,
            path: imagePathTag,
            spaceId: `${imageSpaceId} -> ${trellisSpace}`,
            imageSpaceId,
            meshSpaceId: trellisSpace,
            ok: true,
            error: null,
            errorCategory: null,
            ms: { image: imageMs, preprocess: preprocessMs, mesh: meshMs, total: Date.now() - tStart },
            glbBytes: glbBuf.length,
            glbValidHeader: isGlbBuffer(glbBuf),
            glbFile: glbRel,
            imageFile: fs.existsSync(finalImgAbs) ? finalImgRel : rawImgRel,
            attempts: totalAttempts,
          };
        }
        meshError = { category: 'other', message: 'TRELLIS returned no GLB URL' };
      } else {
        meshError = { category: meshRes.category, message: meshRes.error };
      }
    } else {
      meshError = {
        category: budget.quotaExceeded ? 'QuotaExceeded' : 'budget_cap',
        message: budget.quotaExceeded ? 'Aborted due to QuotaExceeded' : 'Budget cap reached',
      };
    }
  } catch (err) {
    const c = classifyError(err);
    meshError = c;
    if (c.category === 'QuotaExceeded') budget.quotaExceeded = true;
  } finally {
    try {
      trellisClient?.close();
    } catch {
      // ignore
    }
  }

  // Step 3: Optional 1x comparison fallback to tencent/Hunyuan3D-2 if TRELLIS failed (and not QuotaExceeded)
  if (allowHunyuanFallback && budget.canCall() && meshError?.category !== 'QuotaExceeded') {
    let hyClient: Client | undefined;
    try {
      hyClient = await connectSpace(hunyuanSpace);
      const imgForHy = fs.existsSync(finalImgAbs) ? finalImgAbs : rawImgAbs;
      const hyRes = await callWithRetry(budget, `PathB-fallback:${item.index}:${hunyuanSpace}`, async () => {
        const res = await hyClient!.predict('/generation_all', {
          caption: null,
          image: handle_file(imgForHy),
          steps: 20,
          guidance_scale: 5,
          seed: 1234,
          octree_resolution: 256,
          check_box_rembg: true,
          num_chunks: 8000,
          randomize_seed: true,
        });
        return res.data as unknown[];
      });
      totalAttempts += hyRes.attempts;
      meshMs += hyRes.ms;

      if (hyRes.ok) {
        const glbUrl = extractFileUrl(hyRes.value[1]) ?? extractFileUrl(hyRes.value[0]);
        if (glbUrl) {
          const glbBuf = await downloadFile(glbUrl);
          const glbRel = `eval/furniture/poc/${item.index}_${imagePathTag}_hunyuan.glb`;
          fs.writeFileSync(path.join(ROOT, glbRel), glbBuf);
          return {
            index: item.index,
            prompt: item.ko,
            englishPrompt: item.en,
            path: imagePathTag,
            spaceId: `${imageSpaceId} -> ${hunyuanSpace}`,
            imageSpaceId,
            meshSpaceId: trellisSpace,
            fallbackSpaceId: hunyuanSpace,
            ok: true,
            error: `TRELLIS failed (${meshError?.message}); Hunyuan3D-2 fallback succeeded`,
            errorCategory: null,
            ms: { image: imageMs, preprocess: preprocessMs, mesh: meshMs, total: Date.now() - tStart },
            glbBytes: glbBuf.length,
            glbValidHeader: isGlbBuffer(glbBuf),
            glbFile: glbRel,
            imageFile: fs.existsSync(finalImgAbs) ? finalImgRel : rawImgRel,
            attempts: totalAttempts,
          };
        }
      }
    } catch (err) {
      const c = classifyError(err);
      if (c.category === 'QuotaExceeded') budget.quotaExceeded = true;
    } finally {
      try {
        hyClient?.close();
      } catch {
        // ignore
      }
    }
  }

  return {
    index: item.index,
    prompt: item.ko,
    englishPrompt: item.en,
    path: imagePathTag,
    spaceId: `${imageSpaceId} -> ${trellisSpace}`,
    imageSpaceId,
    meshSpaceId: trellisSpace,
    ok: false,
    error: meshError?.message ?? '3D conversion failed',
    errorCategory: meshError?.category ?? 'other',
    ms: { image: imageMs, preprocess: preprocessMs, mesh: meshMs, total: Date.now() - tStart },
    glbBytes: null,
    glbFile: null,
    imageFile: fs.existsSync(finalImgAbs) ? finalImgRel : rawImgRel,
    attempts: totalAttempts,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const argSet = new Set(args);
  const getVal = (prefix: string): string | undefined => {
    const eq = args.find((a) => a.startsWith(`${prefix}=`));
    if (eq) return eq.slice(prefix.length + 1);
    const idx = args.indexOf(prefix);
    if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
      return args[idx + 1];
    }
    return undefined;
  };

  fs.mkdirSync(POC_DIR, { recursive: true });

  console.log(`Auth mode: ${getAuthMode()}`);
  const spaceCandidates = [
    'trellis-community/TRELLIS-text',
    'suvadityamuk/trellis-text-to-3d',
    'JeffreyXiang/TRELLIS',
    'trellis-community/TRELLIS',
    'black-forest-labs/FLUX.1-schnell',
    'tencent/Hunyuan3D-2',
  ];

  const existingReport: Partial<PocReport> =
    argSet.has('--resume') && fs.existsSync(REPORT_PATH)
      ? JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
      : {};

  let discoveredSpaces = existingReport.discoveredSpaces;
  let geminiListModels = existingReport.geminiListModels;

  if (!discoveredSpaces || !geminiListModels || argSet.has('--discover')) {
    discoveredSpaces = {};
    for (const id of spaceCandidates) {
      discoveredSpaces[id] = await inspectSpace(id);
    }
    geminiListModels = await listGeminiImageModels();
  }

  if (argSet.has('--discover')) {
    console.log('=== Discovered Spaces ===');
    for (const [id, info] of Object.entries(discoveredSpaces)) {
      console.log(id, 'reachable=', info.reachable, 'stage=', info.stage ?? '-', 'err=', info.error ?? '-');
      if (info.reachable) {
        console.log('  endpoints:', Object.keys(info.namedEndpoints).join(', '));
      }
    }
    console.log('=== Gemini ListModels ===');
    console.log(JSON.stringify(geminiListModels, null, 2));
    process.exit(0);
  }

  const budget = new CallBudget(argSet.has('--resume') ? (existingReport.remoteCallsUsed ?? 0) : 0);
  if (argSet.has('--resume') && existingReport.quotaExceeded) {
    budget.quotaExceeded = true;
  }

  const runs: RunEntry[] = argSet.has('--resume') ? [...(existingReport.runs ?? [])] : [];
  const geminiModel =
    geminiListModels.models.find((m) => m.name.includes('gemini-2.5-flash-image'))?.name ??
    geminiListModels.models[0]?.name ??
    'models/gemini-2.5-flash-image';

  // Probe Gemini B2 once if requested or if no probe exists yet
  let geminiImageProbe = existingReport.geminiImageProbe;
  if (!geminiImageProbe && !argSet.has('--skip-b2-probe') && budget.canCall()) {
    console.log(`Probing B2 (${geminiModel}) once...`);
    const pRes = await generateGeminiImage(geminiModel, PROMPTS[0].en, budget);
    let savedFile: string | undefined;
    if (pRes.ok && pRes.buffer) {
      savedFile = 'eval/furniture/poc/1_B2_probe.png';
      fs.writeFileSync(path.join(ROOT, savedFile), pRes.buffer);
    }
    geminiImageProbe = {
      model: geminiModel,
      status: pRes.status,
      ok: pRes.ok,
      ms: pRes.ms,
      error: pRes.error,
      savedFile,
    };
    console.log('B2 probe result:', JSON.stringify(geminiImageProbe));
  }

  // Parse which prompts & paths to execute
  const promptFilterRaw = getVal('--prompts');
  const promptIndices = promptFilterRaw
    ? new Set(promptFilterRaw.split(/[,+]/).map((s) => Number(s.trim())).filter(Number.isFinite))
    : new Set(PROMPTS.map((p) => p.index));

  const pathsRaw = getVal('--paths') ?? 'A+B';
  const enabledPaths = new Set(pathsRaw.split(/[,+]/).map((s) => s.trim().toUpperCase()));

  let hunyuanFallbackUsed = runs.some((r) => Boolean(r.fallbackSpaceId));
  const geminiAlreadyBlocked = geminiImageProbe?.status === 403 || geminiImageProbe?.status === 429 || geminiImageProbe?.status === 404;

  for (const item of PROMPTS) {
    if (!promptIndices.has(item.index)) continue;
    if (!budget.canCall()) break;

    if (enabledPaths.has('A') && !runs.some((r) => r.index === item.index && r.path === 'A')) {
      console.log(`\n[Prompt ${item.index}] Path A: "${item.ko}"`);
      const entryA = await runPathA(item, budget);
      runs.push(entryA);
      console.log(`  -> ok=${entryA.ok} ms=${entryA.ms.total} bytes=${entryA.glbBytes} err=${entryA.error ?? '-'}`);
    }

    if (!budget.canCall()) break;

    if (enabledPaths.has('B') && !runs.some((r) => r.index === item.index && (r.path === 'B1' || r.path === 'B2'))) {
      console.log(`\n[Prompt ${item.index}] Path B: "${item.ko}"`);
      const entryB = await runPathB(item, budget, geminiModel, !hunyuanFallbackUsed, geminiAlreadyBlocked);
      if (entryB.fallbackSpaceId) hunyuanFallbackUsed = true;
      runs.push(entryB);
      console.log(`  -> ok=${entryB.ok} path=${entryB.path} ms=${entryB.ms.total} bytes=${entryB.glbBytes} err=${entryB.error ?? '-'}`);
    }
  }

  const report: PocReport = {
    generatedAt: new Date().toISOString(),
    authMode: getAuthMode(),
    maxRemoteCalls: MAX_REMOTE_CALLS,
    remoteCallsUsed: budget.used,
    quotaExceeded: budget.quotaExceeded,
    discoveredSpaces,
    geminiListModels,
    geminiImageProbe,
    runs,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nSaved report: ${REPORT_PATH}`);
  console.log(`Remote calls used: ${budget.used}/${MAX_REMOTE_CALLS}, quotaExceeded=${budget.quotaExceeded}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(classifyError(err).message);
  process.exit(1);
});
