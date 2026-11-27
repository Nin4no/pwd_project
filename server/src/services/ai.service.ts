import fs from "node:fs";
import path from "node:path";
import HttpError from "../utils/httpError";
import { geminiFetch } from "../ai/geminiFetch";
import { inferRoom } from "../ai/room/roomVision";
import { isValidRoomCalibration } from "../ai/room/calibrate";
import type { RoomCalibration } from "../types/room.types";
import {
  assertFurnitureRelevance,
  blueprintSchema,
  FURNITURE_CATEGORIES,
  normalizeBlueprint,
} from "../ai/blueprintSchema";
import {
  BLUEPRINT_MODULE_RULES,
  inferFurniturePhoto,
  type FurniturePhotoOptions,
} from "../ai/furniturePhoto";
import {
  guardFurniturePrompt,
  guardHintName,
  USER_REQUEST_BOUNDARY,
  wrapUserRequest,
} from "../ai/promptGuard";

export type Primitive = Record<string, any>;

const categories = ["bed", "desk", "storage", "seating", "table", "lighting", "window", "door", "appliance"];
const schema = {
  type: "OBJECT",
  propertyOrdering: ["name", "category", "materials", "plan", "size", "color", "summary", "primitives"],
  properties: {
    isFurniture: { type: "BOOLEAN" },
    rejectionReason: { type: "STRING" },
    name: { type: "STRING" },
    category: { type: "STRING", enum: categories },
    materials: { type: "ARRAY", items: { type: "STRING" } },
    plan: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        propertyOrdering: ["part", "count", "material", "size_m"],
        properties: {
          part: { type: "STRING" },
          count: { type: "INTEGER" },
          material: { type: "STRING" },
          size_m: { type: "ARRAY", items: { type: "NUMBER" } },
        },
        required: ["part", "count", "material", "size_m"],
      },
    },
    size: { type: "ARRAY", items: { type: "NUMBER" } },
    color: { type: "STRING" },
    summary: { type: "STRING" },
    primitives: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["box", "cylinder"] },
          pos: { type: "ARRAY", items: { type: "NUMBER" } },
          size: { type: "ARRAY", items: { type: "NUMBER" } },
          radius: { type: "NUMBER" },
          height: { type: "NUMBER" },
          radiusTop: { type: "NUMBER" },
          color: { type: "STRING" },
          roughness: { type: "NUMBER" },
          metalness: { type: "NUMBER" },
        },
        required: ["kind", "pos", "color"],
      },
    },
  },
  required: ["name", "category", "materials", "plan", "size", "color", "summary", "primitives"],
};

function loadFewshot(filename: string) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), `src/ai/${filename}`), "utf8"));
  } catch {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, `../ai/${filename}`), "utf8"));
    } catch {
      return [];
    }
  }
}

const fewshots = loadFewshot("fewshot.json");
const blueprintFewshots = loadFewshot("fewshot.blueprint.json");

export function validatePrimitives(input: any): {
  primitives: Primitive[];
  size: [number, number, number];
  errors: string[];
  floating: number;
} {
  const errors: string[] = [];
  if (!Array.isArray(input) || input.length < 1 || input.length > 120) {
    return {
      primitives: [],
      size: [1, 1, 1],
      errors: [`Primitives count must be between 1 and 120 (got ${Array.isArray(input) ? input.length : 0}).`],
      floating: 0,
    };
  }

  const primitives: Primitive[] = [];
  for (const [index, primitive] of input.entries()) {
    const validPosition = Array.isArray(primitive?.pos) && primitive.pos.length === 3 && primitive.pos.every(Number.isFinite);
    if (!primitive || !["box", "cylinder"].includes(primitive.kind) || !validPosition) {
      errors.push(`부품 ${index + 1}: 잘못된 위치/형태`);
      continue;
    }

    const dimensions = primitive.kind === "box"
      ? primitive.size
      : [primitive.radius * 2, primitive.height, primitive.radius * 2];
    if (!Array.isArray(dimensions) || dimensions.length !== 3 || dimensions.some((n: number) => !Number.isFinite(n) || n <= 0 || n > 4)) {
      errors.push(`부품 ${index + 1}: 치수는 0 초과 4m 이하여야 합니다.`);
      continue;
    }
    primitives.push({ ...primitive });
  }
  if (!primitives.length) return { primitives: [], size: [1, 1, 1], errors, floating: 0 };

  const minY = Math.min(...primitives.map((primitive) => primitive.pos[1] - (primitive.kind === "box" ? primitive.size[1] : primitive.height) / 2));
  for (const primitive of primitives) primitive.pos[1] -= minY;

  const bounds = [0, 1, 2].map((axis) => [
    Math.min(...primitives.map((p) => p.pos[axis] - (p.kind === "box" ? p.size[axis] / 2 : axis === 1 ? p.height / 2 : p.radius))),
    Math.max(...primitives.map((p) => p.pos[axis] + (p.kind === "box" ? p.size[axis] / 2 : axis === 1 ? p.height / 2 : p.radius))),
  ]);
  const axisSpans = bounds.map(([min, max]) => max - min);
  if (axisSpans.some((span) => span > 3.2 || span < 0.05)) {
    errors.push(
      `Overall bounding box [w,h,d] is [${axisSpans.map((s) => s.toFixed(3)).join(", ")}]m; each axis must be between 0.05m and 3.2m.`,
    );
  }

  // Treat 3 cm AABB gaps as connected to absorb coordinate rounding and recognize structural joins.
  const tolerance = 0.03;
  const aabb = (primitive: Primitive): number[][] => {
    const half = [
      primitive.kind === "box" ? primitive.size[0] / 2 : primitive.radius,
      primitive.kind === "box" ? primitive.size[1] / 2 : primitive.height / 2,
      primitive.kind === "box" ? primitive.size[2] / 2 : primitive.radius,
    ];
    return primitive.pos.map((value: number, axis: number) => [value - half[axis], value + half[axis]]);
  };
  const boxes = primitives.map(aabb);
  const floating = primitives.filter((_primitive, index) => {
    if (boxes[index][1][0] <= tolerance) return false;
    return !primitives.some((_other, otherIndex) => index !== otherIndex && boxes[index].every(([low, high], axis) => {
      const [otherLow, otherHigh] = boxes[otherIndex][axis];
      return Math.max(0, otherLow - high, low - otherHigh) <= tolerance;
    }));
  }).length;
  if (floating) errors.push(`${floating}개 부품이 공중에 떠 있습니다.`);

  return {
    primitives,
    size: [bounds[0], bounds[2], bounds[1]].map(([min, max]) => Math.max(0.01, max - min)) as [number, number, number],
    errors,
    floating,
  };
}

function sanitizeRetryFeedback(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

const FURNITURE_RELEVANCE_RULE =
  "First verify whether <user_request> asks for furniture, an interior fixture, lighting, a mirror, an opening (door/window), a home appliance, or a room prop. If it is NOT related to furniture/interior items (e.g. weather, food/menu, coding, math, chat, unrelated topics), set isFurniture to false and provide a concise Korean rejectionReason; otherwise set isFurniture to true.";

const UNRELATED_FURNITURE_TEXT_MSG =
  "가구와 관련이 없는 내용이라 가구를 생성하지 않았어요. 침대·책상·수납장 같은 가구 설명을 입력해 주세요.";

const furnitureSystemPrompt = `First list materials and decompose the real-world structure into parts in \`plan\` (part, count, material, size_m [w,h,d]), then build \`primitives\` matching every plan item's count and size. Coordinates are meters, Y-up, floor at y=0; pos is each primitive center. Boxes need size [w,h,d], cylinders radius and height. Build structurally connected, realistic furniture (touching/overlapping, no floating) using 6-80 primitives, panels/boards >= 0.015m thick, and symmetric legs/frames.
Typical WxDxH (m) by category:
- bed: 1.5-2.0 x 2.0-2.1 x 0.45-1.1
- desk: 1.0-1.6 x 0.55-0.8 x 0.72-0.76
- storage: 0.6-1.2 x 0.25-0.5 x 0.8-2.0
- seating: 0.5-2.2 x 0.5-0.95 x 0.75-0.95
- table: 0.6-1.6 x 0.6-1.0 x 0.4-0.76
- lighting: 0.2-0.5 x 0.2-0.5 x 0.35-1.7
- window: 0.8-1.8 x 0.1-0.2 x 0.9-1.5
- door: 0.8-1.0 x 0.1-0.15 x 2.0-2.15
- appliance: 0.5-0.9 x 0.5-0.75 x 0.8-1.9
Compound furniture (desk with hutch/bookshelf, study carrel, bed with storage, wardrobe with desk) = build each module in plan (base desk, side panels, back/privacy panels, upper shelf/hutch with supports) and connect them; upper modules must rest on the desktop or side panels, never float.
For holes, slots or grids, model a thin panel + small dark box grid on the front face (e.g. pegboard holes 25mm spacing); model hooks/hangers as small cylinders. Use realistic materials for the object type: appliances (refrigerator, washer, TV, air conditioner…) are painted steel / stainless / glass / plastic in white, silver, gray or black — never wood unless the user explicitly asks; metal rack/pegboard -> painted steel or white board. Set each primitive's color, metalness and roughness to match. Respond JSON. Examples: ${JSON.stringify(fewshots)}
${FURNITURE_RELEVANCE_RULE}
${USER_REQUEST_BOUNDARY}`;

const blueprintSystemPrompt = `${BLUEPRINT_MODULE_RULES}
Respond JSON. Examples: ${JSON.stringify(blueprintFewshots)}
${FURNITURE_RELEVANCE_RULE}
${USER_REQUEST_BOUNDARY}`;

async function gemini(prompt: string, image?: string, mode: "blueprint" | "primitives" = "blueprint"): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(503, "AI service is not configured.");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS) || 60_000;
  const imageParts = image
    ? [{ inlineData: { mimeType: image.slice(5, image.indexOf(";")), data: image.slice(image.indexOf(",") + 1) } }]
    : [];
  const systemText = image
    ? "Analyze room dimensions and geometry. Return JSON only."
    : mode === "primitives"
      ? furnitureSystemPrompt
      : blueprintSystemPrompt;
  const responseSchema = image ? undefined : mode === "primitives" ? schema : blueprintSchema;
  const response = await geminiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemText }],
        },
        contents: [{ parts: [...imageParts, { text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0.35, thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "low" } },
      }),
    },
    timeoutMs,
  );
  if (!response.ok) {
    const detail = (await response.text?.().catch(() => "")) ?? "";
    // 429 = 요청 한도 초과 (무료 등급은 모델별 일일 요청 수 제한)
    console.error("[AI] Gemini upstream error", {
      status: response.status,
      detail: detail.slice(0, 300),
    });
    throw new HttpError(502, "AI service request failed.");
  }
  const data: any = await response.json();
  return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
}

async function createFurniturePrimitives(safePrompt: string) {
  let last: any;
  const wrappedPrompt = wrapUserRequest(safePrompt);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const feedback = last?.errors?.length ? sanitizeRetryFeedback(last.errors.join("; ")) : "";
      const raw = await gemini(
        `${wrappedPrompt}\n${feedback ? `Fix these validation errors: ${feedback}` : ""}`,
        undefined,
        "primitives",
      );
      assertFurnitureRelevance(raw, "AI_UNRELATED_PROMPT", UNRELATED_FURNITURE_TEXT_MSG);
      const validated = validatePrimitives(raw.primitives);
      const errors = [...validated.errors];
      if (Array.isArray(raw.primitives) && raw.primitives.length >= 1 && raw.primitives.length < 3) {
        errors.push(
          `Only ${raw.primitives.length} primitive(s) provided; use 3 to 120 primitives (aim for 6-80) matching the decomposed plan parts.`,
        );
      }
      if (errors.length) {
        last = { ...validated, errors };
        continue;
      }
      const category = categories.includes(raw.category) ? raw.category : "storage";
      const baseSummary = String(raw.summary || `${raw.name || "AI Furniture"} generated`);
      const mats = Array.isArray(raw.materials)
        ? raw.materials.map((m: unknown) => String(m).trim()).filter(Boolean)
        : [];
      const planCount = Array.isArray(raw.plan)
        ? raw.plan.reduce((sum: number, item: any) => sum + (Number.isFinite(Number(item?.count)) ? Number(item.count) : 1), 0)
        : 0;
      const summaryExtras = [
        mats.length ? `materials: ${mats.join(", ")}` : "",
        planCount > 0 ? `planned parts: ${planCount}` : "",
      ].filter(Boolean);
      const summary = summaryExtras.length ? `${baseSummary} (${summaryExtras.join("; ")})` : baseSummary;
      return {
        spec: {
          id: `ai_${Date.now()}`,
          name: String(raw.name || "AI Furniture"),
          category,
          size: validated.size,
          color: raw.color || (category === "appliance" ? "#e5e7eb" : "#b98c62"),
          source: "ai",
          prompt: safePrompt,
          primitives: validated.primitives,
        },
        summary,
        via: "llm" as const,
        retries: attempt,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (attempt === 2) {
        console.error("[AI] Furniture primitives generation failed", error);
        throw new HttpError(502, "Failed to generate valid furniture specification.");
      }
    }
  }
  console.error("[AI] Furniture primitives validation failed", last?.errors);
  throw new HttpError(502, "Failed to generate valid furniture specification.");
}

// Note: src/engine/furniture lives outside server/tsconfig.json rootDir ("."), so server-side assemble() validation
// is skipped here and performed on the client (assemble.ts) instead of duplicating the assembly engine.
async function createFurnitureBlueprint(safePrompt: string) {
  let lastError = "";
  const wrappedPrompt = wrapUserRequest(safePrompt);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await gemini(
        `${wrappedPrompt}\n${lastError ? `Fix these validation errors: ${lastError}` : ""}`,
        undefined,
        "blueprint",
      );
      assertFurnitureRelevance(raw, "AI_UNRELATED_PROMPT", UNRELATED_FURNITURE_TEXT_MSG);
      const blueprint = normalizeBlueprint(raw);
      const summary: string = typeof raw?.summary === "string" && raw.summary.trim()
        ? raw.summary.trim()
        : `${blueprint.name} generated`;
      return {
        blueprint,
        summary,
        via: "llm" as const,
        retries: attempt,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      lastError = sanitizeRetryFeedback(error);
      if (attempt === 2) {
        console.error("[AI] Furniture blueprint generation failed", error);
        throw new HttpError(502, "Failed to generate valid furniture blueprint.");
      }
    }
  }
  throw new HttpError(502, "Failed to generate valid furniture blueprint.");
}

export async function createFurniture(prompt: string) {
  const safePrompt = guardFurniturePrompt(prompt);
  if (process.env.AI_FURNITURE_MODE === "primitives") {
    return createFurniturePrimitives(safePrompt);
  }
  return createFurnitureBlueprint(safePrompt);
}

export async function analyzeRoom(imageDataUrl: string, calibration?: RoomCalibration) {
  const commaIdx = typeof imageDataUrl === "string" ? imageDataUrl.indexOf(",") : -1;
  if (
    typeof imageDataUrl !== "string" ||
    !/^data:image\/(png|jpeg|webp);base64,/.test(imageDataUrl) ||
    commaIdx < 0 ||
    imageDataUrl.slice(commaIdx + 1).trim().length === 0 ||
    Buffer.byteLength(imageDataUrl, "utf8") > 5 * 1024 * 1024
  ) {
    throw new HttpError(400, "imageDataUrl must be an image data URL of at most 5MB.", "AI_INVALID_PROMPT");
  }
  if (!isValidRoomCalibration(calibration)) {
    throw new HttpError(400, "calibration is invalid.", "AI_INVALID_PROMPT");
  }
  try {
    return await inferRoom(imageDataUrl, calibration);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.message === "AI service is not configured.") throw new HttpError(503, error.message);
    console.error("[AI] Room analysis failed", error);
    throw new HttpError(502, "Room analysis failed.");
  }
}

export async function analyzeFurniturePhoto(imageDataUrl: string, opts: FurniturePhotoOptions = {}) {
  const commaIdx = typeof imageDataUrl === "string" ? imageDataUrl.indexOf(",") : -1;
  if (
    typeof imageDataUrl !== "string" ||
    !/^data:image\/(png|jpeg|webp);base64,/.test(imageDataUrl) ||
    commaIdx < 0 ||
    imageDataUrl.slice(commaIdx + 1).trim().length === 0 ||
    Buffer.byteLength(imageDataUrl, "utf8") > 5 * 1024 * 1024
  ) {
    throw new HttpError(400, "imageDataUrl must be an image data URL of at most 5MB.", "AI_INVALID_PROMPT");
  }
  if (opts.knownWidthCm !== undefined) {
    if (typeof opts.knownWidthCm !== "number" || !Number.isFinite(opts.knownWidthCm) || opts.knownWidthCm < 10 || opts.knownWidthCm > 600) {
      throw new HttpError(400, "knownWidthCm must be between 10 and 600.", "AI_INVALID_PROMPT");
    }
  }
  const safeHintName = guardHintName(opts.hintName);
  if (opts.preferredCategory !== undefined) {
    if (!(FURNITURE_CATEGORIES as readonly string[]).includes(opts.preferredCategory)) {
      throw new HttpError(400, "preferredCategory is invalid.", "AI_INVALID_PROMPT");
    }
  }

  try {
    return await inferFurniturePhoto(imageDataUrl, {
      hintName: safeHintName,
      knownWidthCm: opts.knownWidthCm,
      preferredCategory: opts.preferredCategory,
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.message === "AI service is not configured.") {
      throw new HttpError(503, error.message);
    }
    console.error("[AI] Furniture photo analysis failed", error);
    throw new HttpError(502, "Furniture photo analysis failed.");
  }
}
