import { getSupabase, throwDatabaseError } from "../config/supabase";
import { profileResponse } from "../types/auth.types";
import HttpError from "../utils/httpError";
import { objectBody, textField } from "../utils/input";

export async function updateProfile(id: string, body: unknown) {
  const input = objectBody(body);
  const update: { display_name?: string; avatar?: string } = {};

  const nameVal = input.displayName ?? input.display_name;
  if (nameVal !== undefined) {
    update.display_name = textField(nameVal, "displayName", true, 80);
  }
  if (input.avatar !== undefined) {
    update.avatar = textField(input.avatar, "avatar");
  }
  if (!Object.keys(update).length) {
    throw new HttpError(400, "수정할 닉네임 또는 아바타를 입력하세요.");
  }

  const { data, error } = await getSupabase()
    .from("profiles")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throwDatabaseError(error);
  return profileResponse(data!);
}

export async function deactivateAccount(id: string) {
  const { error } = await getSupabase().rpc("deactivate_account", {
    p_user_id: id,
  });
  if (error) throwDatabaseError(error);
}
