import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import HttpError from "../utils/httpError";

let client: SupabaseClient<Database> | undefined;

export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (
    !url ||
    !key ||
    url.includes("your-project-ref") ||
    key.includes("replace_with")
  ) {
    throw new Error("서버의 SUPABASE_URL과 SUPABASE_SECRET_KEY를 설정하세요.");
  }
  client = createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export function throwDatabaseError(error: {
  code?: string;
  message: string;
}): never {
  if (error.message.includes("ROOM_FORBIDDEN"))
    throw new HttpError(403, "Room ownership does not allow this update.");
  if (error.message.includes("POST_NOT_FOUND"))
    throw new HttpError(404, "게시물을 찾을 수 없습니다.");
  if (error.message.includes("USER_NOT_FOUND"))
    throw new HttpError(404, "사용자를 찾을 수 없습니다.");
  if (error.message.includes("ROOM_NOT_FOUND"))
    throw new HttpError(404, "방을 찾을 수 없습니다.");
  if (error.code === "23505")
    throw new HttpError(409, "이미 등록되었거나 처리된 데이터입니다.");
  if (["23502", "23503", "23514", "22P02"].includes(error.code ?? ""))
    throw new HttpError(400, "입력값 또는 참조한 데이터가 올바르지 않습니다.");
  console.error("[Supabase]", error.code ?? "request", error.message);
  throw new HttpError(503, "Supabase 요청에 실패했습니다.");
}
