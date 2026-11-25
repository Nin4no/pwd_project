-- ??Supabase ?袁⑥쨮??븍뱜?癒?퐣 ?????뵠?됰텑猷삳맙??뺣０???뽰뱽 餓Β??쑵鍮??덈뼄.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null,
  avatar text not null default '',
  provider text not null default 'email',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dyr_profile_display_name check (length(btrim(display_name)) between 1 and 80)
);

create table if not exists public.rooms (
  id varchar(64) primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  title varchar(100) not null default '무제 방',
  walls jsonb not null default '[]'::jsonb,
  furniture jsonb not null default '[]'::jsonb,
  custom_specs jsonb default '[]'::jsonb,
  wall_height numeric(3, 2) not null default 2.40,
  thumbnail text,
  remixed_from varchar(64),
  facing varchar(4) not null default 'S',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dyr_room_title check (length(btrim(title)) between 1 and 100),
  constraint dyr_room_wall_height check (wall_height between 1.50 and 6.00),
  constraint dyr_room_facing check (facing in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'))
);

alter table public.rooms add column if not exists facing varchar(4) not null default 'S';
alter table public.rooms drop constraint if exists dyr_room_facing;
alter table public.rooms add constraint dyr_room_facing check (facing in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'));

create table if not exists public.showroom_posts (
  id varchar(64) primary key,
  author_id uuid references public.profiles(id) on delete set null,
  author varchar(50) not null,
  description varchar(300) not null default '',
  room_snapshot jsonb not null,
  likes integer not null default 0 check (likes >= 0),
  remix_count integer not null default 0 check (remix_count >= 0),
  builtin boolean not null default false,
  shared_at timestamptz not null default now(),
  constraint dyr_showroom_author check (length(btrim(author)) between 1 and 50)
);

create table if not exists public.showroom_likes (
  post_id varchar(64) not null references public.showroom_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists idx_rooms_owner_updated on public.rooms (owner_id, updated_at desc);
create index if not exists idx_showroom_posts_shared_at on public.showroom_posts (shared_at desc);

create or replace function public.dyr_touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists dyr_profiles_updated on public.profiles;
create trigger dyr_profiles_updated before update on public.profiles for each row execute function public.dyr_touch_updated_at();

drop trigger if exists dyr_rooms_updated on public.rooms;
create trigger dyr_rooms_updated before update on public.rooms for each row execute function public.dyr_touch_updated_at();

create or replace function public.dyr_handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id, email, display_name, avatar, provider)
  values (
    new.id,
    coalesce(new.email, ''),
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
        nullif(btrim(new.raw_user_meta_data->>'displayName'), ''),
        nullif(btrim(new.raw_user_meta_data->>'name'), ''),
        nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
        '사용자'
      ),
      80
    ),
    coalesce(new.raw_user_meta_data->>'avatar_url', ''),
    coalesce(new.raw_app_meta_data->>'provider', 'email')
  )
  on conflict(id) do nothing;
  return new;
end $$;

drop trigger if exists dyr_auth_user_created on auth.users;
create trigger dyr_auth_user_created after insert on auth.users for each row execute function public.dyr_handle_new_user();

insert into public.profiles(id, email, display_name, avatar, provider)
select
  id,
  coalesce(email, ''),
  left(
    coalesce(
      nullif(btrim(raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(raw_user_meta_data->>'displayName'), ''),
      nullif(btrim(raw_user_meta_data->>'name'), ''),
      nullif(btrim(raw_user_meta_data->>'full_name'), ''),
      '사용자'
    ),
    80
  ),
  coalesce(raw_user_meta_data->>'avatar_url', ''),
  coalesce(raw_app_meta_data->>'provider', 'email')
from auth.users on conflict(id) do nothing;

-- Ownership is checked in the same statement as the insert/update to avoid TOCTOU.
drop function if exists public.upsert_room(varchar, uuid, varchar, jsonb, jsonb, jsonb, numeric, text, varchar);

create or replace function public.upsert_room(
  p_id varchar,
  p_owner_id uuid,
  p_title varchar,
  p_walls jsonb,
  p_furniture jsonb,
  p_custom_specs jsonb,
  p_wall_height numeric,
  p_thumbnail text,
  p_remixed_from varchar,
  p_facing varchar default 'S'
) returns setof public.rooms language plpgsql security invoker set search_path='' as $$
begin
  return query
    insert into public.rooms(id, owner_id, title, walls, furniture, custom_specs, wall_height, thumbnail, remixed_from, facing)
    values (p_id, p_owner_id, p_title, p_walls, p_furniture, p_custom_specs, p_wall_height, p_thumbnail, p_remixed_from, coalesce(nullif(btrim(p_facing), ''), 'S'))
    on conflict (id) do update set
      title = excluded.title,
      walls = excluded.walls,
      furniture = excluded.furniture,
      custom_specs = excluded.custom_specs,
      wall_height = excluded.wall_height,
      thumbnail = excluded.thumbnail,
      remixed_from = excluded.remixed_from,
      facing = excluded.facing,
      updated_at = now()
    where public.rooms.owner_id = p_owner_id
    returning *;
  if not found then
    raise exception 'ROOM_FORBIDDEN' using errcode='42501';
  end if;
end $$;

create or replace function public.toggle_showroom_like(p_post_id varchar, p_user_id uuid)
returns table(liked boolean, likes integer) language plpgsql security invoker set search_path='' as $$
declare
  v_post public.showroom_posts;
  v_liked boolean;
begin
  select * into v_post from public.showroom_posts where id = p_post_id for update;
  if not found then
    raise exception 'POST_NOT_FOUND';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and is_active) then
    raise exception 'USER_NOT_FOUND';
  end if;
  if exists (select 1 from public.showroom_likes where post_id = p_post_id and user_id = p_user_id) then
    delete from public.showroom_likes where post_id = p_post_id and user_id = p_user_id;
    update public.showroom_posts
      set likes = greatest(0, public.showroom_posts.likes - 1)
      where id = p_post_id
      returning public.showroom_posts.likes into v_post.likes;
    v_liked := false;
  else
    insert into public.showroom_likes(post_id, user_id) values (p_post_id, p_user_id);
    update public.showroom_posts
      set likes = public.showroom_posts.likes + 1
      where id = p_post_id
      returning public.showroom_posts.likes into v_post.likes;
    v_liked := true;
  end if;
  return query select v_liked, v_post.likes;
end $$;

drop function if exists public.increment_showroom_remix(varchar);

create or replace function public.remix_showroom_post(p_post_id varchar, p_user_id uuid)
returns setof public.rooms language plpgsql security invoker set search_path='' as $$
declare
  v_post public.showroom_posts;
  v_snapshot jsonb;
  v_room_id varchar(64);
  v_facing varchar(4);
begin
  select * into v_post from public.showroom_posts where id = p_post_id for update;
  if not found then
    raise exception 'POST_NOT_FOUND';
  end if;

  v_snapshot := v_post.room_snapshot;
  v_room_id := 'room_' || gen_random_uuid()::text;
  v_facing := case
    when (v_snapshot->>'facing') in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')
      then v_snapshot->>'facing'
    else 'S'
  end;
  return query
    insert into public.rooms(id, owner_id, title, walls, furniture, custom_specs, wall_height, thumbnail, remixed_from, facing)
    values (
      v_room_id,
      p_user_id,
      v_snapshot->>'title',
      coalesce(v_snapshot->'walls', '[]'::jsonb),
      coalesce(v_snapshot->'furniture', '[]'::jsonb),
      coalesce(v_snapshot->'customSpecs', '[]'::jsonb),
      coalesce(nullif(v_snapshot->>'wallHeight', '')::numeric, 2.40),
      v_snapshot->>'thumbnail',
      p_post_id,
      v_facing
    )
    returning *;

  update public.showroom_posts
    set remix_count = remix_count + 1
    where id = p_post_id;
end $$;
create or replace function public.deactivate_account(p_user_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare
  target public.profiles;
begin
  select * into target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  update public.profiles set is_active = false where id = p_user_id;
end $$;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.showroom_posts enable row level security;
alter table public.showroom_likes enable row level security;

revoke all on table public.profiles, public.rooms, public.showroom_posts, public.showroom_likes from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.profiles, public.rooms, public.showroom_posts, public.showroom_likes to service_role;

revoke all on function
  public.dyr_touch_updated_at(),
  public.dyr_handle_new_user(),
  public.upsert_room(varchar, uuid, varchar, jsonb, jsonb, jsonb, numeric, text, varchar, varchar),
  public.toggle_showroom_like(varchar, uuid),
  public.remix_showroom_post(varchar, uuid),
  public.deactivate_account(uuid)
from public, anon, authenticated;

grant execute on function
  public.upsert_room(varchar, uuid, varchar, jsonb, jsonb, jsonb, numeric, text, varchar, varchar),
  public.toggle_showroom_like(varchar, uuid),
  public.remix_showroom_post(varchar, uuid),
  public.deactivate_account(uuid)
to service_role;

notify pgrst, 'reload schema';
commit;
