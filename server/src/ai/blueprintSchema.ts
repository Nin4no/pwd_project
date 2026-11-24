export const FURNITURE_CATEGORIES = [
  "bed",
  "desk",
  "storage",
  "seating",
  "table",
  "lighting",
  "window",
  "door",
  "appliance",
] as const;

export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number];

export const MATERIAL_KEYS = [
  "wood_natural",
  "wood_oak",
  "wood_walnut",
  "wood_white",
  "white",
  "black",
  "gray",
  "steel",
  "steel_white",
  "steel_black",
  "gold",
  "fabric_gray",
  "fabric_beige",
  "fabric_navy",
  "fabric_green",
  "leather_brown",
  "leather_black",
  "glass",
  "mirror",
  "mattress",
  "led",
] as const;

export type MaterialKey = (typeof MATERIAL_KEYS)[number];

export const MODULE_TYPES = [
  "table",
  "carcass",
  "partition",
  "bedframe",
  "seat",
  "board",
  "rack",
  "lamp",
  "mirror",
  "appliance",
] as const;

export type ModuleType = (typeof MODULE_TYPES)[number];

export const ANCHORS = [
  "floor",
  "top",
  "top-back",
  "top-left",
  "top-right",
  "under",
  "left",
  "right",
] as const;

export type Anchor = (typeof ANCHORS)[number];

export const CHILD_ANCHORS = [
  "top",
  "top-back",
  "top-left",
  "top-right",
  "under",
  "left",
  "right",
] as const;

export const MOUNT_TYPES = ["floor", "wall"] as const;

export type ParamValue = number | string | boolean;

export interface ModuleSpec {
  type: ModuleType;
  anchor?: Anchor;
  w?: number;
  d?: number;
  h?: number;
  material?: MaterialKey;
  accent?: MaterialKey;
  params?: Record<string, ParamValue>;
  children?: ModuleSpec[];
}

export interface Blueprint {
  name: string;
  category: FurnitureCategory;
  material: MaterialKey;
  accent?: MaterialKey;
  mount?: "floor" | "wall";
  mountY?: number;
  root: ModuleSpec & { w: number; d: number; h: number };
  notes?: string[];
}

const paramItemSchema = {
  type: "OBJECT",
  propertyOrdering: ["key", "value"],
  properties: {
    key: { type: "STRING" },
    value: { type: "STRING" },
  },
  required: ["key", "value"],
};

function buildChildModuleSchema(remainingDepth: number): Record<string, any> {
  const properties: Record<string, any> = {
    type: { type: "STRING", enum: [...MODULE_TYPES] },
    anchor: { type: "STRING", enum: [...CHILD_ANCHORS] },
    w: { type: "NUMBER" },
    d: { type: "NUMBER" },
    h: { type: "NUMBER" },
    material: { type: "STRING", enum: [...MATERIAL_KEYS] },
    accent: { type: "STRING", enum: [...MATERIAL_KEYS] },
    params: { type: "ARRAY", items: paramItemSchema },
  };
  const propertyOrdering = ["type", "anchor", "w", "d", "h", "material", "accent", "params"];

  if (remainingDepth > 0) {
    properties.children = {
      type: "ARRAY",
      items: buildChildModuleSchema(remainingDepth - 1),
    };
    propertyOrdering.push("children");
  }

  return {
    type: "OBJECT",
    propertyOrdering,
    properties,
    required: ["type", "anchor"],
  };
}

const rootModuleSchema = {
  type: "OBJECT",
  propertyOrdering: ["type", "w", "d", "h", "material", "accent", "params", "children"],
  properties: {
    type: { type: "STRING", enum: [...MODULE_TYPES] },
    w: { type: "NUMBER" },
    d: { type: "NUMBER" },
    h: { type: "NUMBER" },
    material: { type: "STRING", enum: [...MATERIAL_KEYS] },
    accent: { type: "STRING", enum: [...MATERIAL_KEYS] },
    params: { type: "ARRAY", items: paramItemSchema },
    children: {
      type: "ARRAY",
      items: buildChildModuleSchema(2),
    },
  },
  required: ["type", "w", "d", "h"],
};

export const blueprintSchema = {
  type: "OBJECT",
  propertyOrdering: ["name", "category", "material", "accent", "mount", "mountY", "summary", "root"],
  properties: {
    name: { type: "STRING" },
    category: { type: "STRING", enum: [...FURNITURE_CATEGORIES] },
    material: { type: "STRING", enum: [...MATERIAL_KEYS] },
    accent: { type: "STRING", enum: [...MATERIAL_KEYS] },
    mount: { type: "STRING", enum: [...MOUNT_TYPES] },
    mountY: { type: "NUMBER" },
    summary: { type: "STRING" },
    root: rootModuleSchema,
  },
  required: ["name", "category", "material", "summary", "root"],
};

const MAX_DEPTH = 4;
const MIN_DIM = 0.05;
const MAX_DIM = 3.2;

function clampDim(value: unknown): number | undefined {
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) return undefined;
  return Math.round(Math.min(MAX_DIM, Math.max(MIN_DIM, num)) * 1000) / 1000;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

export function parseParamValue(raw: unknown): ParamValue | undefined {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  const num = Number(trimmed);
  if (Number.isFinite(num)) return num;
  return trimmed;
}

export function parseParams(input: unknown): Record<string, ParamValue> | undefined {
  const out: Record<string, ParamValue> = {};
  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const key = typeof (item as any).key === "string" ? (item as any).key.trim() : "";
      if (!key) continue;
      const parsed = parseParamValue((item as any).value);
      if (parsed !== undefined) out[key] = parsed;
    }
  } else if (input && typeof input === "object") {
    for (const [rawKey, rawVal] of Object.entries(input as Record<string, unknown>)) {
      const key = rawKey.trim();
      if (!key) continue;
      const parsed = parseParamValue(rawVal);
      if (parsed !== undefined) out[key] = parsed;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeChild(raw: unknown, depth: number): ModuleSpec | null {
  if (depth > MAX_DEPTH || !raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  const type = pickEnum(node.type, MODULE_TYPES);
  if (!type) return null;

  const spec: ModuleSpec = { type };
  const anchor = pickEnum(node.anchor, CHILD_ANCHORS);
  if (anchor) spec.anchor = anchor;

  const w = clampDim(node.w);
  const d = clampDim(node.d);
  const h = clampDim(node.h);
  if (w !== undefined) spec.w = w;
  if (d !== undefined) spec.d = d;
  if (h !== undefined) spec.h = h;

  const material = pickEnum(node.material, MATERIAL_KEYS);
  const accent = pickEnum(node.accent, MATERIAL_KEYS);
  if (material) spec.material = material;
  if (accent) spec.accent = accent;

  const params = parseParams(node.params);
  if (params) spec.params = params;

  if (depth < MAX_DEPTH && Array.isArray(node.children)) {
    const children = node.children
      .map((child) => normalizeChild(child, depth + 1))
      .filter((child): child is ModuleSpec => child !== null);
    if (children.length) spec.children = children;
  }

  return spec;
}

/** Normalize raw Gemini JSON into a valid Blueprint (strip invalid enums, parse params, clamp sizes 0.05-3.2m, cap depth at 4). */
export function normalizeBlueprint(raw: unknown): Blueprint {
  if (!raw || typeof raw !== "object") {
    throw new Error("Blueprint response must be an object.");
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.root || typeof obj.root !== "object") {
    throw new Error("Blueprint response is missing root module.");
  }

  const rawRoot = obj.root as Record<string, unknown>;
  const rootType = pickEnum(rawRoot.type, MODULE_TYPES);
  if (!rootType) {
    throw new Error(`Invalid root module type: ${String(rawRoot.type)}`);
  }

  const category = pickEnum(obj.category, FURNITURE_CATEGORIES) ?? "storage";
  const material =
    pickEnum(obj.material, MATERIAL_KEYS) ??
    (category === "appliance" ? "steel_white" : "wood_natural");
  const accent = pickEnum(obj.accent, MATERIAL_KEYS);
  const mount = pickEnum(obj.mount, MOUNT_TYPES);
  const mountY = mount === "wall" ? clampDim(obj.mountY) : undefined;
  const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "AI Furniture";

  const root: Blueprint["root"] = {
    type: rootType,
    w: clampDim(rawRoot.w) ?? 0.8,
    d: clampDim(rawRoot.d) ?? 0.6,
    h: clampDim(rawRoot.h) ?? 0.75,
  };

  const rootAnchor = pickEnum(rawRoot.anchor, ANCHORS);
  if (rootAnchor) root.anchor = rootAnchor;
  const rootMaterial = pickEnum(rawRoot.material, MATERIAL_KEYS);
  if (rootMaterial) root.material = rootMaterial;
  const rootAccent = pickEnum(rawRoot.accent, MATERIAL_KEYS);
  if (rootAccent) root.accent = rootAccent;
  const rootParams = parseParams(rawRoot.params);
  if (rootParams) root.params = rootParams;

  if (Array.isArray(rawRoot.children)) {
    const children = rawRoot.children
      .map((child) => normalizeChild(child, 1))
      .filter((child): child is ModuleSpec => child !== null);
    if (children.length) root.children = children;
  }

  const blueprint: Blueprint = {
    name,
    category,
    material,
    root,
  };
  if (accent) blueprint.accent = accent;
  if (mount) blueprint.mount = mount;
  if (mountY !== undefined) blueprint.mountY = mountY;

  return blueprint;
}
