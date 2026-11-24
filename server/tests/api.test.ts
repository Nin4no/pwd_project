jest.mock("../src/config/supabase", () => ({
  ...jest.requireActual("../src/config/supabase"),
  getSupabase: jest.fn(),
}));
jest.mock("../src/services/rooms.service");
jest.mock("../src/services/showroom.service");
jest.mock("../src/services/users.service");

import request from "supertest";
import createApp from "../src/app";
import { getSupabase } from "../src/config/supabase";
import * as rooms from "../src/services/rooms.service";
import * as showroom from "../src/services/showroom.service";
import * as users from "../src/services/users.service";
import type { ProfileRow } from "../src/types/database.types";
import HttpError from "../src/utils/httpError";

const profile: ProfileRow = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "user@example.test",
  display_name: "사용자",
  avatar: "",
  provider: "email",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const profileQuery = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn(),
};

const client = {
  auth: { getUser: jest.fn() },
  from: jest.fn(() => profileQuery),
};

const app = createApp();

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getSupabase)
    .mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);
  client.auth.getUser.mockResolvedValue({
    data: { user: { id: profile.id } },
    error: null,
  });
  profileQuery.maybeSingle.mockResolvedValue({
    data: { ...profile },
    error: null,
  });
});

const protectedRoutes: [string, string][] = [
  ["get", "/api/auth/me"],
  ["put", "/api/users/profile"],
  ["delete", "/api/users/account"],
  ["get", "/api/rooms"],
  ["get", "/api/rooms/r1"],
  ["put", "/api/rooms/r1"],
  ["delete", "/api/rooms/r1"],
  ["post", "/api/showroom"],
  ["delete", "/api/showroom/p1"],
  ["post", "/api/showroom/p1/like"],
  ["post", "/api/showroom/p1/remix"],
];

test.each(protectedRoutes)("비로그인 %s %s 요청은 401", async (method, url) => {
  const result = await request(app)[method as "get"](url);
  expect(result.status).toBe(401);
  expect(getSupabase).not.toHaveBeenCalled();
});

test("공개 엔드포인트(health, showroom 목록/상세)는 인증 없이 접근 가능", async () => {
  jest.mocked(showroom.getShowroomPosts).mockResolvedValue([]);
  jest.mocked(showroom.getShowroomPost).mockResolvedValue({
    id: "p1",
    room: {
      id: "r1",
      title: "방",
      walls: [],
      furniture: [],
      wallHeight: 2.4,
      createdAt: 0,
      updatedAt: 0,
    },
    author: "작성자",
    description: "",
    likes: 0,
    remixCount: 0,
    sharedAt: 0,
    likedByMe: false,
  });

  const h1 = await request(app).get("/health");
  expect(h1.status).toBe(200);
  expect(h1.body).toEqual({ status: "ok" });

  const h2 = await request(app).get("/api/health");
  expect(h2.status).toBe(200);
  expect(h2.body).toEqual({ status: "ok" });

  const sList = await request(app).get("/api/showroom");
  expect(sList.status).toBe(200);
  expect(sList.body).toEqual({ data: [] });

  const sItem = await request(app).get("/api/showroom/p1");
  expect(sItem.status).toBe(200);
  expect(sItem.body.data.id).toBe("p1");

  expect(client.auth.getUser).not.toHaveBeenCalled();
});

test("인증된 사용자 요청이 각 서비스로 올바르게 전달된다", async () => {
  jest.mocked(rooms.getRooms).mockResolvedValue([]);
  jest.mocked(rooms.getRoom).mockResolvedValue({
    id: "r1",
    title: "방1",
    walls: [],
    furniture: [],
    wallHeight: 2.4,
    createdAt: 0,
    updatedAt: 0,
  });
  jest.mocked(rooms.upsertRoom).mockResolvedValue({
    id: "r1",
    title: "방1",
    walls: [],
    furniture: [],
    wallHeight: 2.4,
    createdAt: 0,
    updatedAt: 0,
  });
  jest.mocked(rooms.deleteRoom).mockResolvedValue();

  jest.mocked(showroom.createShowroomPost).mockResolvedValue({
    id: "p1",
    room: {
      id: "r1",
      title: "방1",
      walls: [],
      furniture: [],
      wallHeight: 2.4,
      createdAt: 0,
      updatedAt: 0,
    },
    author: "사용자",
    description: "설명",
    likes: 0,
    remixCount: 0,
    sharedAt: 0,
    likedByMe: false,
  });
  jest.mocked(showroom.deleteShowroomPost).mockResolvedValue();
  jest.mocked(showroom.toggleLike).mockResolvedValue({ liked: true, likes: 1 });
  jest.mocked(showroom.remixPost).mockResolvedValue({
    room: {
      id: "new-r",
      title: "방1",
      walls: [],
      furniture: [],
      wallHeight: 2.4,
      createdAt: 0,
      updatedAt: 0,
    },
  });

  const authHeader = { Authorization: "Bearer valid-token" };

  const meRes = await request(app).get("/api/auth/me").set(authHeader);
  expect(meRes.status).toBe(200);
  expect(meRes.body.data.id).toBe(profile.id);

  const roomsRes = await request(app).get("/api/rooms").set(authHeader);
  expect(roomsRes.status).toBe(200);
  expect(roomsRes.body).toEqual({ data: [] });

  const roomRes = await request(app).get("/api/rooms/r1").set(authHeader);
  expect(roomRes.status).toBe(200);

  const upsertRes = await request(app)
    .put("/api/rooms/r1")
    .set(authHeader)
    .send({ title: "방1" });
  expect(upsertRes.status).toBe(200);

  const delRoomRes = await request(app).delete("/api/rooms/r1").set(authHeader);
  expect(delRoomRes.status).toBe(200);

  const postRes = await request(app)
    .post("/api/showroom")
    .set(authHeader)
    .send({ id: "p1", room: {}, description: "설명" });
  expect(postRes.status).toBe(201);

  const delPostRes = await request(app).delete("/api/showroom/p1").set(authHeader);
  expect(delPostRes.status).toBe(200);

  const likeRes = await request(app).post("/api/showroom/p1/like").set(authHeader);
  expect(likeRes.status).toBe(200);
  expect(likeRes.body.data).toEqual({ liked: true, likes: 1 });

  const remixRes = await request(app).post("/api/showroom/p1/remix").set(authHeader);
  expect(remixRes.status).toBe(200);
  expect(remixRes.body.data.room.id).toBe("new-r");
  expect(showroom.remixPost).toHaveBeenCalledWith(profile.id, "p1");
  expect(remixRes.body).toHaveProperty("data.room");
});

test("showroom reads accept valid, absent, and invalid optional bearer tokens", async () => {
  const post = {
    id: "p1", room: { id: "r1", title: "Room", walls: [], furniture: [], wallHeight: 2.4, createdAt: 0, updatedAt: 0 },
    author: "Tester", description: "", likes: 1, remixCount: 0, sharedAt: 0, likedByMe: true,
  };
  jest.mocked(showroom.getShowroomPosts).mockResolvedValue([post]);
  const valid = await request(app).get("/api/showroom").set("Authorization", "Bearer valid-token");
  expect(valid.status).toBe(200);
  expect(valid.body.data[0].likedByMe).toBe(true);
  expect(showroom.getShowroomPosts).toHaveBeenCalledWith(undefined, profile.id);

  jest.clearAllMocks();
  jest.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);
  client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "Invalid JWT", status: 401 } as any });
  jest.mocked(showroom.getShowroomPosts).mockResolvedValue([{ ...post, likedByMe: false }]);
  const invalid = await request(app).get("/api/showroom").set("Authorization", "Bearer bad-token");
  expect(invalid.status).toBe(200);
  expect(invalid.body.data[0].likedByMe).toBe(false);
  expect(showroom.getShowroomPosts).toHaveBeenCalledWith(undefined, undefined);

  jest.clearAllMocks();
  const authLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
  client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "Auth unavailable", status: 503 } as any });
  jest.mocked(showroom.getShowroomPosts).mockResolvedValue([{ ...post, likedByMe: false }]);
  const outage = await request(app).get("/api/showroom").set("Authorization", "Bearer token");
  expect(outage.status).toBe(200);
  expect(outage.body.data[0].likedByMe).toBe(false);
  expect(authLog).toHaveBeenCalled();
  authLog.mockRestore();

  jest.clearAllMocks();
  jest.mocked(showroom.getShowroomPosts).mockResolvedValue([{ ...post, likedByMe: false }]);
  const anonymous = await request(app).get("/api/showroom");
  expect(anonymous.status).toBe(200);
  expect(anonymous.body.data[0].likedByMe).toBe(false);
  expect(showroom.getShowroomPosts).toHaveBeenCalledWith(undefined, undefined);

  jest.clearAllMocks();
  client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: profile.id } }, error: null });
  jest.mocked(showroom.getShowroomPost).mockResolvedValue({ ...post, likedByMe: true });
  const detail = await request(app).get("/api/showroom/p1").set("Authorization", "Bearer valid-token");
  expect(detail.status).toBe(200);
  expect(detail.body.data.likedByMe).toBe(true);
  expect(showroom.getShowroomPost).toHaveBeenCalledWith("p1", profile.id);
});

test("remix returns 404 when the source post is missing", async () => {
  jest.mocked(showroom.remixPost).mockRejectedValue(new HttpError(404, "post not found"));
  const result = await request(app).post("/api/showroom/missing/remix").set("Authorization", "Bearer valid-token");
  expect(result.status).toBe(404);
});

test("토큰 오류, 프로필 누락, 비활성 계정을 거절한다", async () => {
  // 1. 유효하지 않은 토큰
  client.auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: { message: "Invalid JWT", status: 401 } as any,
  });
  const res1 = await request(app)
    .get("/api/auth/me")
    .set("Authorization", "Bearer bad-token");
  expect(res1.status).toBe(401);

  // 2. 프로필 누락
  profileQuery.maybeSingle.mockResolvedValueOnce({
    data: null,
    error: null,
  });
  const res2 = await request(app)
    .get("/api/auth/me")
    .set("Authorization", "Bearer valid-token");
  expect(res2.status).toBe(403);

  // 3. 비활성 계정
  profileQuery.maybeSingle.mockResolvedValueOnce({
    data: { ...profile, is_active: false },
    error: null,
  });
  const res3 = await request(app)
    .get("/api/auth/me")
    .set("Authorization", "Bearer valid-token");
  expect(res3.status).toBe(403);
});

test("oversized JSON requests return 413 in the API error envelope", async () => {
  const result = await request(app)
    .post("/api/showroom")
    .set("Authorization", "Bearer valid-token")
    .send({ payload: "x".repeat(5 * 1024 * 1024) });
  expect(result.status).toBe(413);
  expect(result.body.message).toBeTruthy();
  expect(result.body.error.message).toBe(result.body.message);
});

test("CORS allows configured development origins and omits headers for unknown origins", async () => {
  const allowed = await request(app)
    .options("/api/health")
    .set("Origin", "http://localhost:5173")
    .set("Access-Control-Request-Method", "GET");
  expect(allowed.status).toBe(204);
  expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

  const denied = await request(app).get("/api/health").set("Origin", "https://attacker.invalid");
  expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
});
test("room ownership fields in request bodies cannot override the authenticated identity", async () => {
  jest.mocked(rooms.upsertRoom).mockResolvedValue({
    id: "r1", title: "Room", walls: [], furniture: [], wallHeight: 2.4, createdAt: 0, updatedAt: 0,
  });
  const body = { ownerId: "22222222-2222-4222-8222-222222222222" };
  const result = await request(app).put("/api/rooms/r1").set("Authorization", "Bearer valid-token").send(body);
  expect(result.status).toBe(200);
  expect(rooms.upsertRoom).toHaveBeenCalledWith(profile.id, "r1", body);
});
test("auth provider outages fail closed with 503", async () => {
  client.auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: { message: "temporary outage", status: 503 } as any,
  });
  const result = await request(app).get("/api/rooms").set("Authorization", "Bearer token");
  expect(result.status).toBe(503);
});

test("security headers are applied via helmet and x-powered-by is absent", async () => {
  jest.mocked(showroom.getShowroomPosts).mockResolvedValue([]);
  const res = await request(app).get("/api/showroom");
  expect(res.status).toBe(200);
  expect(res.headers["x-powered-by"]).toBeUndefined();
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
  expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
});

test("unexpected 500 errors are masked while HttpError messages and codes are preserved", async () => {
  const errLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    jest.mocked(rooms.getRooms).mockRejectedValueOnce(new Error("sensitive db credentials leak"));
    const masked = await request(app).get("/api/rooms").set("Authorization", "Bearer valid-token");
    expect(masked.status).toBe(500);
    expect(masked.body).toEqual({
      message: "Internal server error.",
      error: { message: "Internal server error." },
    });
    expect(JSON.stringify(masked.body)).not.toContain("sensitive db");
    expect(errLog).toHaveBeenCalled();

    jest.mocked(rooms.getRooms).mockRejectedValueOnce(
      new HttpError(503, "AI service is not configured.", "SERVICE_UNAVAILABLE"),
    );
    const explicit = await request(app).get("/api/rooms").set("Authorization", "Bearer valid-token");
    expect(explicit.status).toBe(503);
    expect(explicit.body).toEqual({
      message: "AI service is not configured.",
      code: "SERVICE_UNAVAILABLE",
      error: { message: "AI service is not configured.", code: "SERVICE_UNAVAILABLE" },
    });
  } finally {
    errLog.mockRestore();
  }
});

test("global /api rate limiter enforces cap while bypassing /health and /api/health", async () => {
  const prevLimit = process.env.API_RATE_LIMIT_MAX;
  process.env.API_RATE_LIMIT_MAX = "3";
  try {
    const limitedApp = createApp();
    jest.mocked(showroom.getShowroomPosts).mockResolvedValue([]);

    for (let i = 0; i < 5; i++) {
      const h1 = await request(limitedApp).get("/health");
      const h2 = await request(limitedApp).get("/api/health");
      expect(h1.status).toBe(200);
      expect(h2.status).toBe(200);
    }

    for (let i = 0; i < 3; i++) {
      const ok = await request(limitedApp).get("/api/showroom");
      expect(ok.status).toBe(200);
    }

    const blocked = await request(limitedApp).get("/api/showroom");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body.message).toBeTruthy();
    expect(blocked.body.error.message).toBe(blocked.body.message);
  } finally {
    if (prevLimit === undefined) delete process.env.API_RATE_LIMIT_MAX;
    else process.env.API_RATE_LIMIT_MAX = prevLimit;
  }
});

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

describe("DELETE /api/users/account MFA step-up", () => {
  test("non-MFA user succeeds without step-up", async () => {
    jest.mocked(users.deactivateAccount).mockResolvedValueOnce();
    client.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: profile.id, factors: [] } },
      error: null,
    });
    const res = await request(app)
      .delete("/api/users/account")
      .set("Authorization", `Bearer ${makeFakeJwt({ sub: profile.id, aal: "aal1" })}`);
    expect(res.status).toBe(200);
    expect(users.deactivateAccount).toHaveBeenCalledWith(profile.id);
  });

  test("MFA user at aal1 is rejected with 403 MFA_STEP_UP_REQUIRED", async () => {
    client.auth.getUser.mockResolvedValueOnce({
      data: {
        user: {
          id: profile.id,
          factors: [{ id: "factor-1", status: "verified", factor_type: "totp" }],
        },
      },
      error: null,
    });
    const res = await request(app)
      .delete("/api/users/account")
      .set("Authorization", `Bearer ${makeFakeJwt({ sub: profile.id, aal: "aal1" })}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MFA_STEP_UP_REQUIRED");
    expect(res.body.error.code).toBe("MFA_STEP_UP_REQUIRED");
    expect(users.deactivateAccount).not.toHaveBeenCalled();
  });

  test("MFA user at aal2 succeeds", async () => {
    jest.mocked(users.deactivateAccount).mockResolvedValueOnce();
    client.auth.getUser.mockResolvedValueOnce({
      data: {
        user: {
          id: profile.id,
          factors: [{ id: "factor-1", status: "verified", factor_type: "totp" }],
        },
      },
      error: null,
    });
    const res = await request(app)
      .delete("/api/users/account")
      .set("Authorization", `Bearer ${makeFakeJwt({ sub: profile.id, aal: "aal2" })}`);
    expect(res.status).toBe(200);
    expect(users.deactivateAccount).toHaveBeenCalledWith(profile.id);
  });

  test("falls back to admin.mfa.listFactors when user.factors is omitted and fails closed on error", async () => {
    const listFactors = jest.fn().mockResolvedValueOnce({
      data: { factors: [{ id: "f-admin", status: "verified" }] },
      error: null,
    });
    const adminClient = {
      ...client,
      auth: {
        ...client.auth,
        admin: { mfa: { listFactors } },
      },
    };
    jest.mocked(getSupabase).mockReturnValue(adminClient as unknown as ReturnType<typeof getSupabase>);
    client.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: profile.id } },
      error: null,
    });

    const blocked = await request(app)
      .delete("/api/users/account")
      .set("Authorization", `Bearer ${makeFakeJwt({ sub: profile.id, aal: "aal1" })}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("MFA_STEP_UP_REQUIRED");
    expect(listFactors).toHaveBeenCalledWith({ userId: profile.id });

    const errLog = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      listFactors.mockResolvedValueOnce({ data: null, error: { message: "admin outage" } });
      client.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: profile.id } },
        error: null,
      });
      const outage = await request(app)
        .delete("/api/users/account")
        .set("Authorization", `Bearer ${makeFakeJwt({ sub: profile.id, aal: "aal1" })}`);
      expect(outage.status).toBe(503);
    } finally {
      errLog.mockRestore();
    }
  });
});
