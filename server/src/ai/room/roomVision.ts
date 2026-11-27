import type { RoomCalibration, RoomPrediction } from "../../types/room.types";
import HttpError from "../../utils/httpError";
import { pickKoreanRejectionReason } from "../blueprintSchema";
import { geminiFetch } from "../geminiFetch";
import { normalizeRoomPrediction, sanitizeRoomCalibration } from "./calibrate";

export const roomResponseSchema = {
  type: "OBJECT",
  properties: {
    isRoom: { type: "BOOLEAN" },
    rejectionReason: { type: "STRING" },
    room: { type: "OBJECT", properties: { width_m: { type: "NUMBER" }, depth_m: { type: "NUMBER" }, height_m: { type: "NUMBER" } }, required: ["width_m", "depth_m", "height_m"] },
    openings: { type: "ARRAY", items: { type: "OBJECT", properties: { type: { type: "STRING", enum: ["door", "window"] }, wall: { type: "STRING", enum: ["N", "E", "S", "W"] }, offset_m: { type: "NUMBER" }, width_m: { type: "NUMBER" }, height_m: { type: "NUMBER" } }, required: ["type", "wall", "offset_m", "width_m", "height_m"] } },
    items: { type: "ARRAY", items: { type: "OBJECT", properties: { category: { type: "STRING", enum: ["bed", "desk", "storage", "seating", "table", "lighting", "other"] }, size_m: { type: "ARRAY", items: { type: "NUMBER" } }, pos_m: { type: "ARRAY", items: { type: "NUMBER" } }, rotation_deg: { type: "NUMBER" } }, required: ["category", "size_m", "pos_m", "rotation_deg"] } },
    confidence: { type: "NUMBER" },
  }, required: ["room", "openings", "items", "confidence"],
};

export function buildRoomPrompt(calibration?: RoomCalibration): string {
  const safeCalibration = sanitizeRoomCalibration(calibration);
  const hint = safeCalibration ? `Calibration supplied: ${JSON.stringify(safeCalibration)}. Treat floorCorners as normalized image-coordinate hints [u,v], ordered left-back, right-back, right-front, left-front; do not treat them as metric values. Apply knownDimension/knownEdge as exact metric scale constraints.` : "No calibration supplied.";
  return `Estimate this room from the photo. First verify whether the image actually shows an indoor room/interior space or a 2D architectural floor plan: if it does NOT (e.g. a selfie/person, pet, food, outdoor landscape/street/car, document/code screenshot, blank image, or unrelated single object), set isRoom to false, confidence to 0, and write a concise Korean rejectionReason; otherwise set isRoom to true. If the image is a 2D architectural floor plan (top-down drawing) instead of a photo, read it as a plan: use printed area labels (e.g. 전용면적 m²) and dimension text for exact scale, take the overall outer wall rectangle as the room, the plan top as N, and set height_m to 2.4 when no height is given. Return only the requested JSON shape, with dimensions in meters. Coordinate convention: origin is the floor center; x increases toward the image-right (east), z increases away from the camera (north); the camera-facing wall is S, far wall N, image-right wall E, image-left wall W. Room width is x, depth is z. Item pos_m is [x,z], measured from room center; size_m is [width,depth,height]; rotation_deg is yaw from the width axis. Opening offset_m starts at the left end of its named wall when viewed from inside. Estimate scale using visible cues: door height about 2.0 m, bed length about 2.0 m, ceiling height usually 2.3–2.7 m, desk height about 0.73 m. Use the cues together and do not invent precise measurements unsupported by the image. Return a confidence from 0 to 1. ${hint}`;
}

function validPrediction(v: any): v is RoomPrediction & { confidence?: number } {
  const categories = ["bed", "desk", "storage", "seating", "table", "lighting", "other"];
  const walls = ["N", "E", "S", "W"];
  return !!v?.room
    && [v.room.width_m, v.room.depth_m, v.room.height_m].every((n: unknown) => typeof n === "number" && Number.isFinite(n))
    && Array.isArray(v.openings)
    && v.openings.every((o: any) => ["door", "window"].includes(o.type) && walls.includes(o.wall) && [o.offset_m, o.width_m, o.height_m].every(Number.isFinite))
    && Array.isArray(v.items)
    && v.items.every((i: any) => categories.includes(i.category) && Array.isArray(i.size_m) && i.size_m.length === 3 && i.size_m.every(Number.isFinite) && Array.isArray(i.pos_m) && i.pos_m.length === 2 && i.pos_m.every(Number.isFinite) && Number.isFinite(i.rotation_deg));
}

export async function inferRoom(imageDataUrl: string, calibration?: RoomCalibration): Promise<{ prediction: RoomPrediction; confidence: number }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(503, "AI service is not configured.");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const timeoutMs = Number(process.env.GEMINI_STREAM_TIMEOUT_MS) || 120_000;
  // 스트리밍(SSE): 응답 헤더가 즉시 도착해 Node fetch의 5분 헤더 타임아웃을 피함 (gemini-3.x는 사고 시간이 김)
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
          systemInstruction: { parts: [{ text: buildRoomPrompt(calibration) }] },
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: imageDataUrl.slice(5, imageDataUrl.indexOf(";")),
                    data: imageDataUrl.slice(imageDataUrl.indexOf(",") + 1),
                  },
                },
                { text: "Analyze the room image." },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: roomResponseSchema,
            temperature: 0.2,
            thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "low" },
          },
        }),
      },
      timeoutMs,
    );
  // 일시적 오류(429 요청 한도, 500/503 서버 혼잡)는 지수 백오프로 최대 4회 재시도
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
  const text = await readSseText(response);
  const parsed = JSON.parse(text || "{}");
  if (parsed && typeof parsed === "object" && parsed.isRoom === false) {
    throw new HttpError(
      422,
      pickKoreanRejectionReason(
        parsed.rejectionReason,
        "방이나 실내 도면과 관련이 없는 이미지예요. 실내 공간이나 평면도 사진을 올려 주세요.",
      ),
      "AI_UNRELATED_IMAGE",
    );
  }
  if (!validPrediction(parsed)) throw new Error("Gemini returned an invalid room prediction.");
  return { prediction: normalizeRoomPrediction(parsed, calibration), confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)) };
}

/** SSE 스트림의 각 청크에서 사고(thought)를 제외한 텍스트 파트를 이어 붙임 */
async function readSseText(response: Response): Promise<string> {
  const raw = await response.text();
  let out = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const chunk: any = JSON.parse(payload);
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text === "string" && !part.thought) out += part.text;
    }
  }
  return out;
}
