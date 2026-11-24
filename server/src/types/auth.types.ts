import type { ProfileRow } from "./database.types";
import type { User } from "./domain.types";

export function profileResponse(row: ProfileRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatar: row.avatar || null,
    provider: row.provider,
    isActive: row.is_active,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export type AppUser = ReturnType<typeof profileResponse>;

declare global {
  namespace Express {
    interface Request {
      auth?: AppUser;
    }
  }
}
