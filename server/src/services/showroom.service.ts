import { getSupabase, throwDatabaseError } from "../config/supabase";
import type { ShowroomPostRow } from "../types/database.types";
import type { Room, ShowroomPost } from "../types/domain.types";
import { rowToRoom } from "./rooms.service";
import HttpError from "../utils/httpError";
import { objectBody, textField } from "../utils/input";
import {
  MAX_SHOWROOM_LIMIT,
  validateShowroomRoomSnapshot,
} from "../utils/roomValidation";

export function rowToShowroomPost(row: ShowroomPostRow): ShowroomPost {
  const parseJson = (val: unknown) => {
    if (!val) return {} as Room;
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return {} as Room;
      }
    }
    return val as Room;
  };

  return {
    id: row.id,
    room: parseJson(row.room_snapshot),
    author: row.author,
    authorId: row.author_id ?? undefined,
    description: row.description,
    likes: row.likes,
    remixCount: row.remix_count,
    sharedAt: new Date(row.shared_at).getTime(),
    builtin: row.builtin,
    likedByMe: false,
  };
}

async function attachLikedByMe(posts: ShowroomPost[], userId?: string): Promise<ShowroomPost[]> {
  if (!userId || posts.length === 0) return posts;
  const { data, error } = await getSupabase()
    .from("showroom_likes")
    .select("post_id")
    .eq("user_id", userId)
    .in("post_id", posts.map((post) => post.id));
  if (error) throwDatabaseError(error);
  const likedIds = new Set((data ?? []).map((like) => like.post_id));
  return posts.map((post) => ({ ...post, likedByMe: likedIds.has(post.id) }));
}

export async function getShowroomPosts(limit?: number, userId?: string): Promise<ShowroomPost[]> {
  let query = getSupabase()
    .from("showroom_posts")
    .select("*")
    .order("shared_at", { ascending: false });

  if (limit && Number.isInteger(limit) && limit > 0) {
    query = query.limit(Math.min(limit, MAX_SHOWROOM_LIMIT));
  }

  const { data, error } = await query;
  if (error) throwDatabaseError(error);
  return attachLikedByMe((data ?? []).map(rowToShowroomPost), userId);
}

export async function getShowroomPost(postId: string, userId?: string): Promise<ShowroomPost> {
  const { data, error } = await getSupabase()
    .from("showroom_posts")
    .select("*")
    .eq("id", postId)
    .maybeSingle();

  if (error) throwDatabaseError(error);
  if (!data) throw new HttpError(404, "게시물을 찾을 수 없습니다.");
  return (await attachLikedByMe([rowToShowroomPost(data)], userId))[0];
}

export async function createShowroomPost(
  userId: string,
  authorName: string,
  body: unknown,
): Promise<ShowroomPost> {
  const input = objectBody(body);
  const id = textField(input.id, "id", true, 64);
  // 공유 시 사용자가 지정한 표시 이름 (미지정 시 프로필 이름)
  const author = textField(input.author ?? "", "author", false, 50).trim() || authorName;
  const description = textField(
    input.description ?? "",
    "description",
    false,
    300,
  );

  const validatedRoom = validateShowroomRoomSnapshot(input.room);

  const { data, error } = await getSupabase()
    .from("showroom_posts")
    .insert({
      id,
      author_id: userId,
      author,
      description,
      room_snapshot: validatedRoom as any,
      likes: 0,
      remix_count: 0,
      builtin: false,
    })
    .select("*")
    .single();

  if (error) throwDatabaseError(error);
  return rowToShowroomPost(data!);
}

export async function deleteShowroomPost(
  userId: string,
  postId: string,
): Promise<void> {
  const existing = await getSupabase()
    .from("showroom_posts")
    .select("id, author_id")
    .eq("id", postId)
    .maybeSingle();

  if (existing.error) throwDatabaseError(existing.error);
  if (!existing.data) {
    throw new HttpError(404, "게시물을 찾을 수 없습니다.");
  }
  if (existing.data.author_id !== userId) {
    throw new HttpError(403, "작성자만 삭제할 수 있습니다.");
  }

  const { error } = await getSupabase()
    .from("showroom_posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", userId);

  if (error) throwDatabaseError(error);
}

export async function toggleLike(
  userId: string,
  postId: string,
): Promise<{ liked: boolean; likes: number }> {
  const { data, error } = await getSupabase().rpc("toggle_showroom_like", {
    p_post_id: postId,
    p_user_id: userId,
  });

  if (error) throwDatabaseError(error);
  if (!data || !data.length) {
    throw new HttpError(404, "게시물을 찾을 수 없습니다.");
  }
  return { liked: data[0].liked, likes: data[0].likes };
}

export async function remixPost(
  userId: string,
  postId: string,
): Promise<{ room: Room }> {
  const { data, error } = await getSupabase().rpc("remix_showroom_post", {
    p_post_id: postId,
    p_user_id: userId,
  });

  if (error) throwDatabaseError(error);
  if (!data || !data.length) {
    throw new HttpError(404, "게시물을 찾을 수 없습니다.");
  }

  return { room: rowToRoom(data[0]) };
}
