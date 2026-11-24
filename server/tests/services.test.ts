jest.mock("../src/config/supabase", () => ({
  ...jest.requireActual("../src/config/supabase"),
  getSupabase: jest.fn(),
}));

import { getSupabase } from "../src/config/supabase";
import * as rooms from "../src/services/rooms.service";
import * as showroom from "../src/services/showroom.service";
import * as users from "../src/services/users.service";
import type { RoomRow, ShowroomPostRow } from "../src/types/database.types";

const query = {
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  upsert: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  single: jest.fn(),
  maybeSingle: jest.fn(),
};

const client = {
  from: jest.fn(() => query),
  rpc: jest.fn(),
};

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";

const roomRow: RoomRow = {
  id: "room-101",
  owner_id: userId,
  title: "원룸",
  walls: [] as any,
  furniture: [] as any,
  custom_specs: [] as any,
  wall_height: 2.4,
  thumbnail: null,
  remixed_from: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const postRow: ShowroomPostRow = {
  id: "post-201",
  author_id: userId,
  author: "테스터",
  description: "내 방",
  room_snapshot: { id: "room-101", title: "원룸", walls: [], furniture: [], wallHeight: 2.4, createdAt: 0, updatedAt: 0 } as any,
  likes: 5,
  remix_count: 2,
  builtin: false,
  shared_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getSupabase)
    .mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);
  query.single.mockResolvedValue({ data: roomRow, error: null });
  query.maybeSingle.mockResolvedValue({ data: roomRow, error: null });
});

describe("rooms.service", () => {
  test("getRooms는 사용자 ID로 필터링하고 도메인 객체 배열을 반환한다", async () => {
    (query as any).then = undefined;
    query.order.mockResolvedValueOnce({ data: [roomRow], error: null });

    const result = await rooms.getRooms(userId);
    expect(query.eq).toHaveBeenCalledWith("owner_id", userId);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("room-101");
    expect(result[0].wallHeight).toBe(2.4);
  });

  test("getRoom은 타인의 방인 경우 404 에러를 던진다", async () => {
    query.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    await expect(rooms.getRoom(userId, "room-101")).rejects.toThrow("방을 찾을 수 없습니다.");
    expect(query.eq).toHaveBeenCalledWith("owner_id", userId);
  });

  test("upsertRoom rejects a foreign owner from the atomic RPC", async () => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: "ROOM_FORBIDDEN" } });
    await expect(rooms.upsertRoom(userId, "room-101", { title: "Other room" })).rejects.toThrow("Room ownership does not allow this update.");
  });

  test("upsertRoom sends the authenticated owner to the atomic RPC", async () => {
    client.rpc.mockResolvedValueOnce({ data: [{ ...roomRow, title: "New room" }], error: null });
    const result = await rooms.upsertRoom(userId, "room-101", { title: "New room" });
    expect(client.rpc).toHaveBeenCalledWith("upsert_room", expect.objectContaining({
      p_id: "room-101", p_owner_id: userId, p_title: "New room",
    }));
    expect(result.title).toBe("New room");
  });
  test("deleteRoom은 타인 방인 경우 403, 없으면 404를 던진다", async () => {
    // 404 테스트
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(rooms.deleteRoom(userId, "not-exist")).rejects.toThrow("방을 찾을 수 없습니다.");

    // 403 테스트
    query.maybeSingle.mockResolvedValueOnce({
      data: { id: "room-101", owner_id: otherUserId },
      error: null,
    });
    await expect(rooms.deleteRoom(userId, "room-101")).rejects.toThrow("소유자만 삭제할 수 있습니다.");
  });

  test("upsertRoom validates walls/furniture/customSpecs bounds, thumbnail allowlist, and remixedFrom", async () => {
    await expect(
      rooms.upsertRoom(userId, "room-101", { walls: Array.from({ length: 201 }, () => ({})) }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      rooms.upsertRoom(userId, "room-101", { furniture: Array.from({ length: 301 }, () => ({})) }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      rooms.upsertRoom(userId, "room-101", { customSpecs: Array.from({ length: 101 }, () => ({})) }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      rooms.upsertRoom(userId, "room-101", { walls: ["not-an-object"] }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      rooms.upsertRoom(userId, "room-101", { furniture: [null] }),
    ).rejects.toMatchObject({ statusCode: 400 });

    for (const badThumb of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml;base64,AA==",
      "http://insecure.example.com/thumb.png",
    ]) {
      await expect(
        rooms.upsertRoom(userId, "room-101", { thumbnail: badThumb }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }

    await expect(
      rooms.upsertRoom(userId, "room-101", { remixedFrom: "x".repeat(129) }),
    ).rejects.toMatchObject({ statusCode: 400 });

    client.rpc.mockResolvedValueOnce({ data: [roomRow], error: null });
    await rooms.upsertRoom(userId, "room-101", {
      walls: [{ id: "w1" }],
      furniture: [{ id: "f1" }],
      customSpecs: [{ id: "c1" }],
      thumbnail: "data:image/webp;base64,AA==",
      remixedFrom: "post-1",
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "upsert_room",
      expect.objectContaining({
        p_thumbnail: "data:image/webp;base64,AA==",
        p_remixed_from: "post-1",
      }),
    );

    client.rpc.mockResolvedValueOnce({ data: [roomRow], error: null });
    await rooms.upsertRoom(userId, "room-101", {
      thumbnail: "https://cdn.example.com/rooms/thumb.png",
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "upsert_room",
      expect.objectContaining({
        p_thumbnail: "https://cdn.example.com/rooms/thumb.png",
      }),
    );
  });
});

describe("showroom.service", () => {
  test("createShowroomPost는 요청 본문의 author를 표시 이름으로 사용한다", async () => {
    query.single.mockResolvedValueOnce({ data: postRow, error: null });
    await showroom.createShowroomPost(userId, "테스터", {
      id: "post-202",
      author: "  공유용 이름 ",
      room: { id: "room-101" },
    });
    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({ author_id: userId, author: "공유용 이름" }),
    );
  });

  test("createShowroomPost는 요청자 정보를 author 및 author_id로 바인딩한다", async () => {
    query.single.mockResolvedValueOnce({ data: postRow, error: null });

    const result = await showroom.createShowroomPost(userId, "테스터", {
      id: "post-201",
      description: "내 방",
      room: { id: "room-101" },
    });

    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "post-201",
        author_id: userId,
        author: "테스터",
      }),
    );
    expect(result.id).toBe("post-201");
  });

  test("deleteShowroomPost는 타인 작성 포스트인 경우 403 에러를 던진다", async () => {
    query.maybeSingle.mockResolvedValueOnce({
      data: { id: "post-201", author_id: otherUserId },
      error: null,
    });

    await expect(showroom.deleteShowroomPost(userId, "post-201")).rejects.toThrow(
      "작성자만 삭제할 수 있습니다.",
    );
  });

  test("toggleLike는 RPC를 호출하고 { liked, likes }를 반환한다", async () => {
    client.rpc.mockResolvedValueOnce({
      data: [{ liked: true, likes: 6 }],
      error: null,
    });

    const result = await showroom.toggleLike(userId, "post-201");
    expect(client.rpc).toHaveBeenCalledWith("toggle_showroom_like", {
      p_post_id: "post-201",
      p_user_id: userId,
    });
    expect(result).toEqual({ liked: true, likes: 6 });
  });

  test("remixPost는 remix_count를 증가시키고 복제된 새 방 객체를 반환한다", async () => {
    client.rpc.mockResolvedValueOnce({
      data: [{ ...roomRow, remixed_from: "post-201" }],
      error: null,
    });

    const result = await showroom.remixPost(userId, "post-201");
    expect(client.rpc).toHaveBeenCalledWith("remix_showroom_post", {
      p_post_id: "post-201",
      p_user_id: userId,
    });
    expect(result.room.remixedFrom).toBe("post-201");
    expect(result.room.ownerId).toBe(userId);
    expect(result.room.id).toBe(roomRow.id);
    expect(query.insert).not.toHaveBeenCalled();
  });

  test("public showroom reads return likedByMe false and load a user's likes in one query", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: postRow, error: null });
    query.in.mockResolvedValueOnce({ data: [{ post_id: postRow.id }], error: null });

    const post = await showroom.getShowroomPost(postRow.id, userId);
    expect(post.likedByMe).toBe(true);
    expect(query.in).toHaveBeenCalledWith("post_id", [postRow.id]);

    query.maybeSingle.mockResolvedValueOnce({ data: postRow, error: null });
    const publicPost = await showroom.getShowroomPost(postRow.id);
    expect(publicPost.likedByMe).toBe(false);

    query.order.mockResolvedValueOnce({ data: [postRow], error: null });
    query.in.mockResolvedValueOnce({ data: [{ post_id: postRow.id }], error: null });
    const posts = await showroom.getShowroomPosts(undefined, userId);
    expect(posts[0].likedByMe).toBe(true);
    expect(query.in).toHaveBeenCalledWith("post_id", [postRow.id]);
  });

  test("createShowroomPost rejects array/invalid room snapshots and getShowroomPosts caps limit at 100", async () => {
    await expect(
      showroom.createShowroomPost(userId, "테스터", {
        id: "post-bad-1",
        room: [],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      showroom.createShowroomPost(userId, "테스터", {
        id: "post-bad-2",
        room: { id: "r1", thumbnail: "data:image/svg+xml;base64,AA==" },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      showroom.createShowroomPost(userId, "테스터", {
        id: "post-bad-3",
        room: { id: "r1", walls: ["bad"] },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    query.limit.mockResolvedValueOnce({ data: [], error: null });
    await showroom.getShowroomPosts(500);
    expect(query.limit).toHaveBeenCalledWith(100);
  });
});

describe("users.service", () => {
  test("updateProfile은 빈 이름을 거절하고 유효한 이름을 업데이트한다", async () => {
    await expect(users.updateProfile(userId, { displayName: "   " })).rejects.toThrow();

    query.single.mockResolvedValueOnce({
      data: {
        id: userId,
        email: "user@example.test",
        display_name: "새이름",
        avatar: "",
        provider: "email",
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    });

    const result = await users.updateProfile(userId, { displayName: "새이름" });
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "새이름" }),
    );
    expect(result.displayName).toBe("새이름");
  });

  test("deactivateAccount는 deactivate_account RPC를 호출한다", async () => {
    client.rpc.mockResolvedValueOnce({ error: null });

    await users.deactivateAccount(userId);
    expect(client.rpc).toHaveBeenCalledWith("deactivate_account", {
      p_user_id: userId,
    });
  });
});
