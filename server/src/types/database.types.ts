export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProfileRow = {
  id: string;
  email: string;
  display_name: string;
  avatar: string;
  provider: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = Pick<ProfileRow, "id" | "display_name"> &
  Partial<Omit<ProfileRow, "id" | "display_name">>;

export type ProfileUpdate = Partial<ProfileRow>;

export type RoomRow = {
  id: string;
  owner_id: string | null;
  title: string;
  walls: Json;
  furniture: Json;
  custom_specs: Json | null;
  wall_height: number;
  thumbnail: string | null;
  remixed_from: string | null;
  created_at: string;
  updated_at: string;
};

export type RoomInsert = Pick<RoomRow, "id"> & Partial<Omit<RoomRow, "id">>;

export type RoomUpdate = Partial<RoomRow>;

export type ShowroomPostRow = {
  id: string;
  author_id: string | null;
  author: string;
  description: string;
  room_snapshot: Json;
  likes: number;
  remix_count: number;
  builtin: boolean;
  shared_at: string;
};

export type ShowroomPostInsert = Pick<
  ShowroomPostRow,
  "id" | "author" | "room_snapshot"
> &
  Partial<Omit<ShowroomPostRow, "id" | "author" | "room_snapshot">>;

export type ShowroomPostUpdate = Partial<ShowroomPostRow>;

export type ShowroomLikeRow = {
  post_id: string;
  user_id: string;
  created_at: string;
};

export type ShowroomLikeInsert = Pick<ShowroomLikeRow, "post_id" | "user_id"> &
  Partial<Omit<ShowroomLikeRow, "post_id" | "user_id">>;

export type ShowroomLikeUpdate = Partial<ShowroomLikeRow>;

type Table<Row, Insert = Row, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow, ProfileInsert, ProfileUpdate>;
      rooms: Table<RoomRow, RoomInsert, RoomUpdate>;
      showroom_posts: Table<
        ShowroomPostRow,
        ShowroomPostInsert,
        ShowroomPostUpdate
      >;
      showroom_likes: Table<
        ShowroomLikeRow,
        ShowroomLikeInsert,
        ShowroomLikeUpdate
      >;
    };
    Views: Record<never, never>;
    Functions: {
      upsert_room: {
        Args: {
          p_id: string;
          p_owner_id: string;
          p_title: string;
          p_walls: Json;
          p_furniture: Json;
          p_custom_specs: Json;
          p_wall_height: number;
          p_thumbnail: string | null;
          p_remixed_from: string | null;
        };
        Returns: RoomRow[];
      };
      toggle_showroom_like: {
        Args: { p_post_id: string; p_user_id: string };
        Returns: { liked: boolean; likes: number }[];
      };
      remix_showroom_post: {
        Args: { p_post_id: string; p_user_id: string };
        Returns: RoomRow[];
      };
      deactivate_account: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
