import HttpError from "../utils/httpError";
import { geminiFetch } from "./geminiFetch";
import {
  blueprintSchema,
  normalizeBlueprint,
  type Blueprint,
  type FurnitureCategory,
  type ModuleSpec,
} from "./blueprintSchema";

export interface FurniturePhotoOptions {
  hintName?: string;
  knownWidthCm?: number;
  preferredCategory?: FurnitureCategory;
}

export interface FurniturePhotoResult {
  blueprint: Blueprint;
  estimatedSizeM: [number, number, number];
  summary: string;
  confidence: number;
  via: "llm";
}

export const BLUEPRINT_MODULE_RULES = `Do NOT output coordinates. Output a furniture blueprint: choose modules (table, carcass, partition, bedframe, seat, board, rack, lamp, mirror, appliance) and anchors (top, top-back, top-left, top-right, under, left, right), real-world sizes in meters, materials from the enum.
Root module requires type, w, d, h (each 0.05-3.2m). Children attach via anchor (omit w/d/h to inherit default). Put module parameters in \`params\` as [{ key, value }] string pairs.
Module params:
- table: legs ('four'|'panel'|'frame'|'trestle'|'round'), top (thickness m, e.g. '0.03'), drawers ('0'..'3')
- carcass: shelves (count), drawers (count), doors ('0'|'1'|'2'), plinth (m, '0.05'), back ('true'|'false'), kind ('open'|'closed'), side ('left'|'right'|'center' when anchor='under')
- partition: sides ('true'|'false'), back ('true'|'false'), shelf ('true'|'false'), led ('true'|'false')
- bedframe: headboard ('true'|'false'), legs ('low'|'four'|'platform'), drawers ('0'..'4'), bunk ('true'|'false' — 2층 침대)
- seat: style ('chair'|'sofa'|'bench'|'stool'), arms ('true'|'false'), back ('true'|'false'), seats ('1'..'3' sofa seat cushions), legs ('four'|'base')
- board: kind ('pegboard'|'shelf'), holes (hole grid spacing m, e.g. '0.05'), shelves ('0'..'3'), hooks ('0'..'6'); set mount='wall', mountY (m, e.g. '1.1')
- rack: shelves (count)
- lamp: style ('floor'|'desk')
- mirror: stand ('true' standing | 'false' wall-mounted with mount='wall'), arch ('true'|'false')
- appliance: kind ('fridge' 2-door|'fridge1' 1-door|'minifridge'|'washer' drum|'toploader'|'dryer'|'tv' with cabinet|'tvstand'|'aircon'|'purifier'|'styler'); use steel/steel_white/steel_black/white/black/gray/glass — never wood unless explicitly asked.
Compound furniture examples:
- Study carrel (독서실 책상): table(legs:'panel') + child partition(anchor:'top', h:0.55, shelf:'true', led:'true')
- Hutch/bookshelf desk (책장형 책상): table + child carcass(anchor:'top-back', d:0.28, h:0.6, kind:'open', shelves:'1')
- Desk + side bookcase (책상 옆 책장): table + child carcass(anchor:'right', w:0.4, h:1.6, shelves:'4')
- L-shaped / corner desk (L자·ㄱ자·코너 책상): root table(w:1.0, d:0.6) + child table(anchor:'right', w:0.6, d:1.2, same h) — the wing is back-aligned and extends forward, forming an L
- Desk with under drawers (서랍 책상): table + child carcass(anchor:'under', side:'left', drawers:'3')
Typical WxDxH (m): bed 1.5-2.0x2.0-2.1x0.45-1.1, desk 1.0-1.6x0.55-0.8x0.72-0.76, storage 0.6-1.2x0.25-0.5x0.8-2.0, seating 0.5-2.2x0.5-0.95x0.75-0.95, table 0.6-1.6x0.6-1.0x0.4-0.76, lighting 0.2-0.5x0.2-0.5x0.35-1.7, appliance 0.5-0.9x0.5-0.75x0.8-1.9.`;

export const furniturePhotoSchema = {
  type: "OBJECT",
  propertyOrdering: [...blueprintSchema.propertyOrdering, "confidence"],
  properties: {
    ...blueprintSchema.properties,
    confidence: { type: "NUMBER" },
  },
  required: ["name", "category", "material", "summary", "root", "confidence"],
};

export function buildFurniturePhotoSystemPrompt(opts: FurniturePhotoOptions = {}): string {
  const hints: string[] = [];
  if (opts.knownWidthCm !== undefined) {
    const exactW = Math.round((opts.knownWidthCm / 100) * 1000) / 1000;
    hints.push(
      `Known real-world width constraint: ${opts.knownWidthCm} cm (${exactW} m). Treat ${exactW} m as the exact root.w and scale root.d and root.h proportionally.`,
    );
  }
  if (opts.hintName?.trim()) {
    hints.push(`User hint for furniture name: "${opts.hintName.trim()}". Use this unless clearly contradicted by the photo.`);
  }
  if (opts.preferredCategory) {
    hints.push(`User preferred category: "${opts.preferredCategory}". Use this unless clearly contradicted by the photo.`);
  }
  const hintBlock = hints.length ? `\nUser hints:\n- ${hints.join("\n- ")}` : "";

  return `Analyze the single target piece of furniture shown in the photo (ignore background clutter or surrounding room items) and output a Furniture Blueprint v2 JSON.
Inspect the photo carefully to infer:
- category, realistic primary material (MaterialKey) and optional accent material
- overall proportions [w, d, h] in meters (each clamped to 0.05..3.2m) based on real-world furniture cues
- compound structure and child modules (drawers, shelves, partitions, cushions, legs, doors, boards, racks) attached via anchors
- confidence score from 0 to 1 reflecting visual clarity and occlusion

${BLUEPRINT_MODULE_RULES}${hintBlock}
Respond JSON only matching the schema.`;
}

function clampDimValue(val: number): number {
  return Math.round(Math.min(3.2, Math.max(0.05, val)) * 1000) / 1000;
}

function scaleChildren(children: ModuleSpec[] | undefined, k: number): ModuleSpec[] | undefined {
  if (!children?.length) return undefined;
  return children.map((child) => ({
    ...child,
    ...(child.w !== undefined ? { w: clampDimValue(child.w * k) } : {}),
    ...(child.d !== undefined ? { d: clampDimValue(child.d * k) } : {}),
    ...(child.h !== undefined ? { h: clampDimValue(child.h * k) } : {}),
    ...(child.children ? { children: scaleChildren(child.children, k) } : {}),
  }));
}

function applyKnownWidth(blueprint: Blueprint, knownWidthCm?: number): Blueprint {
  if (
    knownWidthCm === undefined ||
    !Number.isFinite(knownWidthCm) ||
    knownWidthCm <= 0 ||
    !Number.isFinite(blueprint.root.w) ||
    blueprint.root.w <= 0
  ) {
    return blueprint;
  }
  const targetW = knownWidthCm / 100;
  const k = targetW / blueprint.root.w;
  return {
    ...blueprint,
    ...(blueprint.mountY !== undefined ? { mountY: clampDimValue(blueprint.mountY * k) } : {}),
    root: {
      ...blueprint.root,
      w: clampDimValue(targetW),
      d: clampDimValue(blueprint.root.d * k),
      h: clampDimValue(blueprint.root.h * k),
      ...(blueprint.root.children ? { children: scaleChildren(blueprint.root.children, k) } : {}),
    },
  };
}

function extractTextFromCandidates(data: any): string {
  let out = "";
  for (const part of data?.candidates?.[0]?.content?.parts ?? []) {
    if (typeof part?.text === "string" && !part.thought) {
      out += part.text;
    }
  }
  return out;
}

async function parseGeminiResponse(response: Response): Promise<any> {
  if (typeof response.text === "function") {
    const raw = await response.text();
    const lines = raw.split(/\r?\n/);
    if (lines.some((line) => line.startsWith("data:"))) {
      let out = "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const chunk: any = JSON.parse(payload);
        out += extractTextFromCandidates(chunk);
      }
      return JSON.parse(out || "{}");
    }
    const parsed = JSON.parse(raw || "{}");
    if (parsed?.candidates) {
      return JSON.parse(extractTextFromCandidates(parsed) || "{}");
    }
    return parsed;
  }

  if (typeof response.json === "function") {
    const data: any = await response.json();
    if (data?.candidates) {
      return JSON.parse(extractTextFromCandidates(data) || "{}");
    }
    return data;
  }

  return {};
}

export async function inferFurniturePhoto(
  imageDataUrl: string,
  opts: FurniturePhotoOptions = {},
): Promise<FurniturePhotoResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(503, "AI service is not configured.");

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const mimeType = imageDataUrl.slice(5, imageDataUrl.indexOf(";"));
  const data = imageDataUrl.slice(imageDataUrl.indexOf(",") + 1);
  const systemPrompt = buildFurniturePhotoSystemPrompt(opts);

  const userHints = [
    opts.hintName?.trim() ? `name hint: ${opts.hintName.trim()}` : "",
    opts.preferredCategory ? `category hint: ${opts.preferredCategory}` : "",
    opts.knownWidthCm !== undefined ? `known width: ${opts.knownWidthCm} cm` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const userText = userHints
    ? `Extract the target furniture blueprint from this photo (${userHints}).`
    : "Extract the target furniture blueprint from this photo.";

  const timeoutMs = Number(process.env.GEMINI_STREAM_TIMEOUT_MS) || 120_000;
  const send = () =>
    geminiFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [{ inlineData: { mimeType, data } }, { text: userText }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: furniturePhotoSchema,
            temperature: 0.25,
            thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "low" },
          },
        }),
      },
      timeoutMs,
    );

  let response = await send();
  for (let attempt = 1; attempt <= 4 && [429, 500, 503].includes(response.status); attempt++) {
    await response.text?.().catch(() => "");
    await new Promise((resolve) => setTimeout(resolve, 5000 * 2 ** (attempt - 1)));
    response = await send();
  }

  if (!response.ok) {
    const detail = (await response.text?.().catch(() => "")) ?? "";
    console.error("[AI] Gemini upstream error", {
      status: response.status,
      detail: detail.slice(0, 300),
    });
    throw new HttpError(502, "AI service request failed.");
  }

  const parsed = await parseGeminiResponse(response);
  const normalized = normalizeBlueprint(parsed);
  const blueprint = applyKnownWidth(normalized, opts.knownWidthCm);

  const rawConfidence = Number(parsed?.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0;
  const summary =
    typeof parsed?.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : `${blueprint.name} generated`;

  return {
    blueprint,
    estimatedSizeM: [blueprint.root.w, blueprint.root.d, blueprint.root.h],
    summary,
    confidence,
    via: "llm" as const,
  };
}
