jest.mock("../src/config/supabase", () => ({
  ...jest.requireActual("../src/config/supabase"),
  getSupabase: jest.fn(),
}));

import request from "supertest";
import createApp from "../src/app";
import { getSupabase } from "../src/config/supabase";

const baseProfile = {
  id: "photo-test-user",
  email: "photo@test.local",
  display_name: "photo-tester",
  avatar: "",
  provider: "email",
  is_active: true,
  created_at: "",
  updated_at: "",
};

function mockUser(userId: string) {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: { ...baseProfile, id: userId }, error: null }),
  };
  const client = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: jest.fn(() => query),
  };
  jest.mocked(getSupabase).mockReturnValue(client as any);
}

const app = createApp();
const samplePng = "data:image/png;base64,AA==";

describe("POST /api/ai/furniture-photo", () => {
  const oldFetch = global.fetch;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "";
    mockUser("photo-user-1");
  });

  afterEach(() => {
    global.fetch = oldFetch;
    delete process.env.GEMINI_API_KEY;
  });

  test("returns 401 when unauthenticated", async () => {
    const res = await request(app).post("/api/ai/furniture-photo").send({ imageDataUrl: samplePng });
    expect(res.status).toBe(401);
  });

  test("returns 400 on invalid imageDataUrl, hintName, or preferredCategory", async () => {
    mockUser("photo-user-invalid");
    const rMissing = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({});
    expect(rMissing.status).toBe(400);

    const rMime = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: "data:text/plain;base64,AA==" });
    expect(rMime.status).toBe(400);

    const rEmptyB64 = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: "data:image/png;base64," });
    expect(rEmptyB64.status).toBe(400);

    const rHint = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: samplePng, hintName: "x".repeat(121) });
    expect(rHint.status).toBe(400);

    const rCat = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: samplePng, preferredCategory: "spaceship" });
    expect(rCat.status).toBe(400);
  });

  test("returns 400 on oversized image (>5MB) without hitting 413 body limit", async () => {
    mockUser("photo-user-oversize");
    const oversizedPayload = "data:image/jpeg;base64," + "A".repeat(5 * 1024 * 1024 + 64);
    const res = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: oversizedPayload });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("5MB");
  });

  test("returns 400 on out-of-range knownWidthCm", async () => {
    mockUser("photo-user-width");
    const rLow = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: samplePng, knownWidthCm: 5 });
    expect(rLow.status).toBe(400);

    const rHigh = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: samplePng, knownWidthCm: 601 });
    expect(rHigh.status).toBe(400);

    const rType = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: samplePng, knownWidthCm: "120" });
    expect(rType.status).toBe(400);
  });

  test("returns 503 when GEMINI_API_KEY is absent", async () => {
    mockUser("photo-user-503");
    const res = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: samplePng });
    expect(res.status).toBe(503);
    expect(res.body.message).toBe("AI service is not configured.");
  });

  test("returns 200 with normalized blueprint, estimatedSizeM, confidence, and proportional knownWidthCm scaling from SSE response", async () => {
    mockUser("photo-user-sse");
    process.env.GEMINI_API_KEY = "test-key";
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const modelPayload = {
      name: "오크 서랍 책상",
      category: "desk",
      material: "wood_oak",
      accent: "steel_black",
      summary: "상단 선반과 하부 서랍이 있는 오크 책상",
      confidence: 0.87,
      root: {
        type: "table",
        w: 1.0,
        d: 0.5,
        h: 0.75,
        params: [{ key: "legs", value: "frame" }],
        children: [
          {
            type: "carcass",
            anchor: "top-back",
            w: 1.0,
            d: 0.25,
            h: 0.5,
            params: [
              { key: "kind", value: "open" },
              { key: "shelves", value: "1" },
            ],
          },
        ],
      },
    };

    const jsonText = JSON.stringify(modelPayload);
    const half = Math.floor(jsonText.length / 2);
    const sseBody =
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text: jsonText.slice(0, half) }] } }] })}\n\n` +
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: jsonText.slice(half) }] } }] })}\n\n` +
      `data: [DONE]\n\n`;

    (global as any).fetch = async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body || "{}"));
      return {
        ok: true,
        status: 200,
        text: async () => sseBody,
      };
    };

    const res = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({
        imageDataUrl: "data:image/jpeg;base64,AA==",
        hintName: "내 책상",
        knownWidthCm: 150,
        preferredCategory: "desk",
      });

    expect(res.status).toBe(200);
    expect(capturedUrl).toContain(":streamGenerateContent?alt=sse");
    expect(capturedUrl).not.toContain("key=");
    expect(capturedHeaders["x-goog-api-key"]).toBe("test-key");
    expect(capturedBody.generationConfig?.responseSchema?.required).toContain("confidence");
    expect(capturedBody.systemInstruction?.parts?.[0]?.text).toContain("150 cm (1.5 m)");
    expect(capturedBody.systemInstruction?.parts?.[0]?.text).toContain("내 책상");

    const data = res.body.data;
    expect(data.via).toBe("llm");
    expect(data.confidence).toBe(0.87);
    expect(data.summary).toBe("상단 선반과 하부 서랍이 있는 오크 책상");
    expect(data.blueprint.name).toBe("오크 서랍 책상");
    expect(data.blueprint.root.w).toBe(1.5);
    expect(data.blueprint.root.d).toBe(0.75);
    expect(data.blueprint.root.h).toBe(1.125);
    expect(data.estimatedSizeM).toEqual([1.5, 0.75, 1.125]);
    expect(data.blueprint.root.children[0].w).toBe(1.5);
    expect(data.blueprint.root.children[0].d).toBe(0.375);
    expect(data.blueprint.root.children[0].h).toBe(0.75);
    expect(data.blueprint.root.children[0].params).toEqual({ kind: "open", shelves: 1 });
  });

  test("accepts non-SSE .json() Gemini response and clamps confidence to 0..1", async () => {
    mockUser("photo-user-json");
    process.env.GEMINI_API_KEY = "test-key";

    (global as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    name: "패브릭 소파",
                    category: "seating",
                    material: "fabric_beige",
                    summary: "3인용 패브릭 소파",
                    confidence: 1.4,
                    root: {
                      type: "seat",
                      w: 2.1,
                      d: 0.9,
                      h: 0.85,
                      params: [
                        { key: "style", value: "sofa" },
                        { key: "seats", value: "3" },
                      ],
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const res = await request(app)
      .post("/api/ai/furniture-photo")
      .set("authorization", "Bearer ok")
      .send({ imageDataUrl: "data:image/webp;base64,AA==" });

    expect(res.status).toBe(200);
    expect(res.body.data.confidence).toBe(1);
    expect(res.body.data.estimatedSizeM).toEqual([2.1, 0.9, 0.85]);
    expect(res.body.data.blueprint.root.params).toEqual({ style: "sofa", seats: 3 });
  });

  test("masks upstream Gemini 502 details and returns 504 on timeout", async () => {
    mockUser("photo-user-errors");
    process.env.GEMINI_API_KEY = "test-key";
    const errLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      (global as any).fetch = async () => ({
        ok: false,
        status: 400,
        text: async () => "UPSTREAM_PHOTO_SECRET_BODY",
      });
      const r502 = await request(app)
        .post("/api/ai/furniture-photo")
        .set("authorization", "Bearer ok")
        .send({ imageDataUrl: samplePng });
      expect(r502.status).toBe(502);
      expect(r502.body.message).toBe("AI service request failed.");
      expect(JSON.stringify(r502.body)).not.toContain("UPSTREAM_PHOTO_SECRET_BODY");

      (global as any).fetch = async () => {
        const abortErr = new Error("aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      };
      const r504 = await request(app)
        .post("/api/ai/furniture-photo")
        .set("authorization", "Bearer ok")
        .send({ imageDataUrl: samplePng });
      expect(r504.status).toBe(504);
      expect(r504.body.message).toBe("AI service timed out.");
    } finally {
      errLog.mockRestore();
    }
  });
});
