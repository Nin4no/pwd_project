import HttpError from "./httpError";

export const MAX_WALLS = 200;
export const MAX_FURNITURE = 300;
export const MAX_CUSTOM_SPECS = 100;
export const MAX_THUMBNAIL_BYTES = 1_500_000;
export const MAX_REMIXED_FROM_LEN = 128;
export const MAX_SHOWROOM_LIMIT = 100;

const MAX_HTTPS_URL_LEN = 2048;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateObjectArray(
  value: unknown,
  field: string,
  maxLength: number,
): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HttpError(400, `'${field}' must be an array.`);
  }
  if (value.length > maxLength) {
    throw new HttpError(400, `'${field}' must contain at most ${maxLength} items.`);
  }
  for (const item of value) {
    if (!isPlainObject(item)) {
      throw new HttpError(400, `'${field}' items must be objects.`);
    }
  }
  return value as Record<string, unknown>[];
}

export function validateThumbnail(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "thumbnail must be an image data URL or https URL.");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_THUMBNAIL_BYTES) {
    throw new HttpError(400, "thumbnail exceeds maximum allowed size.");
  }
  if (DATA_IMAGE_RE.test(value)) {
    return value;
  }
  if (value.length <= MAX_HTTPS_URL_LEN) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:") {
        return value;
      }
    } catch {
      // fall through to 400 error
    }
  }
  throw new HttpError(400, "thumbnail must be a PNG/JPEG/WebP data URL or https URL.");
}

export function validateRemixedFrom(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "remixedFrom must be a string.");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_REMIXED_FROM_LEN) {
    throw new HttpError(400, `remixedFrom must be at most ${MAX_REMIXED_FROM_LEN} characters.`);
  }
  return trimmed;
}

export function validateRoomFields(input: Record<string, unknown>): {
  walls: Record<string, unknown>[];
  furniture: Record<string, unknown>[];
  customSpecs: Record<string, unknown>[];
  thumbnail: string | null;
  remixedFrom: string | null;
} {
  return {
    walls: validateObjectArray(input.walls, "walls", MAX_WALLS),
    furniture: validateObjectArray(input.furniture, "furniture", MAX_FURNITURE),
    customSpecs: validateObjectArray(input.customSpecs, "customSpecs", MAX_CUSTOM_SPECS),
    thumbnail: validateThumbnail(input.thumbnail),
    remixedFrom: validateRemixedFrom(input.remixedFrom),
  };
}

export function validateShowroomRoomSnapshot(room: unknown): Record<string, unknown> {
  if (!isPlainObject(room)) {
    throw new HttpError(400, "room 데이터가 필요합니다.");
  }
  const validated = validateRoomFields(room);
  return {
    ...room,
    ...(room.walls !== undefined ? { walls: validated.walls } : {}),
    ...(room.furniture !== undefined ? { furniture: validated.furniture } : {}),
    ...(room.customSpecs !== undefined ? { customSpecs: validated.customSpecs } : {}),
    ...(room.thumbnail !== undefined ? { thumbnail: validated.thumbnail } : {}),
    ...(room.remixedFrom !== undefined ? { remixedFrom: validated.remixedFrom } : {}),
  };
}
