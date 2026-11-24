import { getSupabase, throwDatabaseError } from "../config/supabase";
import type { RoomRow } from "../types/database.types";
import type { Room } from "../types/domain.types";
import HttpError from "../utils/httpError";
import { objectBody, textField } from "../utils/input";

export function rowToRoom(row: RoomRow): Room {
  const parseJson = (val: unknown) => {
    if (!val) return [];
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return [];
      }
    }
    return val;
  };

  return {
    id: row.id,
    title: row.title,
    walls: parseJson(row.walls),
    furniture: parseJson(row.furniture),
    customSpecs: row.custom_specs ? parseJson(row.custom_specs) : undefined,
    wallHeight: Number(row.wall_height),
    thumbnail: row.thumbnail ?? undefined,
    remixedFrom: row.remixed_from ?? undefined,
    ownerId: row.owner_id ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export async function getRooms(userId: string): Promise<Room[]> {
  const { data, error } = await getSupabase()
    .from("rooms")
    .select("*")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throwDatabaseError(error);
  return (data ?? []).map(rowToRoom);
}

export async function getRoom(userId: string, roomId: string): Promise<Room> {
  const { data, error } = await getSupabase()
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throwDatabaseError(error);
  if (!data) {
    throw new HttpError(404, "방을 찾을 수 없습니다.");
  }
  return rowToRoom(data);
}

export async function upsertRoom(
  userId: string,
  roomId: string,
  body: unknown,
): Promise<Room> {
  const input = objectBody(body);

  const title =
    textField(input.title ?? "무제 방", "title", false, 100) || "무제 방";
  const walls = Array.isArray(input.walls) ? input.walls : [];
  const furniture = Array.isArray(input.furniture) ? input.furniture : [];
  const customSpecs = Array.isArray(input.customSpecs) ? input.customSpecs : [];
  const wallHeight =
    typeof input.wallHeight === "number" &&
    input.wallHeight >= 1.5 &&
    input.wallHeight <= 6.0
      ? input.wallHeight
      : 2.4;
  const thumbnail =
    typeof input.thumbnail === "string" ? input.thumbnail : null;
  const remixedFrom =
    typeof input.remixedFrom === "string" ? input.remixedFrom : null;

  const { data, error } = await getSupabase().rpc("upsert_room", {
    p_id: roomId,
    p_owner_id: userId,
    p_title: title,
    p_walls: walls as any,
    p_furniture: furniture as any,
    p_custom_specs: customSpecs as any,
    p_wall_height: wallHeight,
    p_thumbnail: thumbnail,
    p_remixed_from: remixedFrom,
  });

  if (error) throwDatabaseError(error);
  if (!data?.length) {
    throw new HttpError(403, "Room ownership does not allow this update.");
  }
  return rowToRoom(data[0]);
}

export async function deleteRoom(userId: string, roomId: string): Promise<void> {
  const existing = await getSupabase()
    .from("rooms")
    .select("id, owner_id")
    .eq("id", roomId)
    .maybeSingle();

  if (existing.error) throwDatabaseError(existing.error);
  if (!existing.data) {
    throw new HttpError(404, "방을 찾을 수 없습니다.");
  }
  if (existing.data.owner_id !== userId) {
    throw new HttpError(403, "소유자만 삭제할 수 있습니다.");
  }

  const { error } = await getSupabase()
    .from("rooms")
    .delete()
    .eq("id", roomId)
    .eq("owner_id", userId);

  if (error) throwDatabaseError(error);
}
