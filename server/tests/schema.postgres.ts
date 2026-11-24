import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { test, before, beforeEach, after } from "node:test";

const schema = readFileSync(
  path.join(__dirname, "../supabase/schema.sql"),
  "utf8",
);
const seed = readFileSync(path.join(__dirname, "../supabase/seed.sql"), "utf8");

const user1Id = "11111111-1111-4111-8111-111111111111";
const user2Id = "22222222-2222-4222-8222-222222222222";

const authBootstrap = `create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb);`;

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(authBootstrap);
  await db.exec(schema);
});

beforeEach(async () => {
  await db.exec(
    "reset role; truncate auth.users, public.profiles, public.rooms, public.showroom_posts, public.showroom_likes restart identity cascade;",
  );
  await db.exec(seed);
  await db.query(
    `insert into auth.users values
      ($1, 'user1@example.test', '{"display_name":"사용자1"}', '{"provider":"email"}'),
      ($2, 'user2@example.test', '{"display_name":"사용자2"}', '{"provider":"email"}')`,
    [user1Id, user2Id],
  );
});

after(async () => {
  await db?.close();
});

test("빈 DB에 구조와 기본 쇼룸 게시물을 만들고 재실행해도 데이터·프로필을 보존한다", async () => {
  const fresh = new PGlite();
  const id = "55555555-5555-4555-8555-555555555555";
  try {
    await fresh.exec(authBootstrap);
    await fresh.query(
      `insert into auth.users values ($1, 'before@example.test', '{"display_name":"사전등록"}', '{"provider":"email"}')`,
      [id],
    );
    await fresh.exec(schema);

    const tables = await fresh.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' order by table_name",
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ["profiles", "rooms", "showroom_likes", "showroom_posts"],
    );

    const profile = await fresh.query<{ id: string; display_name: string }>(
      "select id, display_name from public.profiles where id=$1",
      [id],
    );
    assert.equal(profile.rows[0].id, id);
    assert.equal(profile.rows[0].display_name, "사전등록");

    await fresh.exec(seed);
    const postCount = await fresh.query("select * from public.showroom_posts");
    assert.equal(postCount.rows.length, 5);

    await fresh.exec(
      "update public.showroom_posts set description='다시 실행해도 보존' where id='post-sample-1'",
    );
    await fresh.exec(schema);
    await fresh.exec(seed);

    assert.equal((await fresh.query("select * from public.showroom_posts")).rows.length, 5);
    const desc = await fresh.query<{ description: string }>(
      "select description from public.showroom_posts where id='post-sample-1'",
    );
    assert.equal(desc.rows[0].description, "다시 실행해도 보존");
  } finally {
    await fresh.close();
  }
});

test("이메일·이름이 없는 네이버 OIDC 사용자도 UUID 프로필을 만들고 이름을 보완할 수 있다", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  await db.query(
    `insert into auth.users values ($1, null, '{}', '{"provider":"custom:naver"}')`,
    [id],
  );

  const { rows } = await db.query<{
    id: string;
    email: string;
    display_name: string;
    provider: string;
  }>("select * from public.profiles where id=$1", [id]);

  assert.equal(rows[0].id, id);
  assert.equal(rows[0].email, "");
  assert.equal(rows[0].display_name, "사용자");
  assert.equal(rows[0].provider, "custom:naver");

  await db.query(
    "update public.profiles set display_name='네이버 네임' where id=$1",
    [id],
  );
  const updated = await db.query<{ display_name: string }>(
    "select display_name from public.profiles where id=$1",
    [id],
  );
  assert.equal(updated.rows[0].display_name, "네이버 네임");
});

test("서버 역할은 테이블에 접근할 수 있고 브라우저 역할은 테이블·RPC에 접근할 수 없다", async () => {
  const grants = await db.query<{ role_name: string; allowed: boolean }>(
    `select role_name, has_function_privilege(role_name, 'public.remix_showroom_post(character varying, uuid)', 'EXECUTE') as allowed
     from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)`,
  );
  assert.deepEqual(grants.rows, [
    { role_name: "anon", allowed: false },
    { role_name: "authenticated", allowed: false },
    { role_name: "service_role", allowed: true },
  ]);

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const table of ["profiles", "rooms", "showroom_posts", "showroom_likes"]) {
      await assert.rejects(db.query(`select * from public.${table}`), {
        code: "42501",
      });
    }
    await assert.rejects(
      db.query("select * from public.toggle_showroom_like('post-sample-1', $1)", [user1Id]),
      { code: "42501" },
    );
    await assert.rejects(
      db.query("select * from public.upsert_room('r1',$1,'Room','[]','[]','[]',2.4,null,null)", [user1Id]),
      { code: "42501" },
    );
    await assert.rejects(
      db.query("select * from public.remix_showroom_post('post-sample-1', '11111111-1111-4111-8111-111111111111')"),
      { code: "42501" },
    );
    await assert.rejects(
      db.query("select public.deactivate_account($1)", [user1Id]),
      { code: "42501" },
    );
    await db.exec("reset role");
  }

  await db.exec("set role service_role");
  await db.query(
    "update public.showroom_posts set description='서버 수정 성공' where id='post-sample-1'",
  );
  await db.exec("reset role");
});

test("room upsert atomically preserves ownership and rejects a foreign owner", async () => {
  const args = [user1Id, "First", "[]", "[]", "[]", 2.4, null, null];
  const first = await db.query<{ owner_id: string; title: string }>(
    "select * from public.upsert_room('owned-room',$1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8)",
    args,
  );
  assert.equal(first.rows[0].owner_id, user1Id);

  await db.query(
    "select * from public.upsert_room('owned-room',$1,'Updated','[]','[]','[]',2.4,null,null)",
    [user1Id],
  );
  await assert.rejects(
    db.query(
      "select * from public.upsert_room('owned-room',$1,'Hijack','[]','[]','[]',2.4,null,null)",
      [user2Id],
    ),
    /ROOM_FORBIDDEN/,
  );
  const saved = await db.query<{ owner_id: string; title: string }>(
    "select owner_id,title from public.rooms where id='owned-room'",
  );
  assert.equal(saved.rows[0].owner_id, user1Id);
  assert.equal(saved.rows[0].title, "Updated");
});

test("room upsert rejects claiming a room whose owner_id is null", async () => {
  await db.exec("set role service_role");
  await db.query(
    "insert into public.rooms(id, owner_id, title) values ('orphan-room', null, 'Orphan')",
  );
  await assert.rejects(
    db.query(
      "select * from public.upsert_room('orphan-room',$1,'Hijack','[]','[]','[]',2.4,null,null)",
      [user2Id],
    ),
    /ROOM_FORBIDDEN/,
  );
  const row = await db.query<{ owner_id: string | null; title: string }>(
    "select owner_id, title from public.rooms where id='orphan-room'",
  );
  await db.exec("reset role");
  assert.equal(row.rows[0].owner_id, null);
  assert.equal(row.rows[0].title, "Orphan");
});

test("쇼룸 좋아요 토글 함수(toggle_showroom_like)가 좋아요 수와 상태를 원자적으로 변경한다", async () => {
  const initial = await db.query<{ likes: number }>(
    "select likes from public.showroom_posts where id='post-sample-1'",
  );
  const baseLikes = initial.rows[0].likes;

  // 1회 클릭 -> 좋아요 추가
  const first = await db.query<{ liked: boolean; likes: number }>(
    "select * from public.toggle_showroom_like('post-sample-1', $1)",
    [user1Id],
  );
  assert.equal(first.rows[0].liked, true);
  assert.equal(first.rows[0].likes, baseLikes + 1);

  // 2회 클릭 -> 좋아요 취소
  const second = await db.query<{ liked: boolean; likes: number }>(
    "select * from public.toggle_showroom_like('post-sample-1', $1)",
    [user1Id],
  );
  assert.equal(second.rows[0].liked, false);
  assert.equal(second.rows[0].likes, baseLikes);

  // 잘못된 포스트 ID -> POST_NOT_FOUND
  await assert.rejects(
    db.query("select * from public.toggle_showroom_like('invalid-post', $1)", [user1Id]),
    /POST_NOT_FOUND/,
  );

  // 존재하지 않는 사용자 ID -> USER_NOT_FOUND
  await assert.rejects(
    db.query(
      "select * from public.toggle_showroom_like('post-sample-1', '99999999-9999-9999-9999-999999999999')",
    ),
    /USER_NOT_FOUND/,
  );
});

test("concurrent like toggles keep the denormalized count equal to unique rows", async () => {
  const before = await db.query<{ likes: number }>("select likes from public.showroom_posts where id='post-sample-1'");
  await Promise.all([
    db.query("select * from public.toggle_showroom_like('post-sample-1',$1)", [user1Id]),
    db.query("select * from public.toggle_showroom_like('post-sample-1',$1)", [user2Id]),
  ]);
  const after = await db.query<{ likes: number }>("select likes from public.showroom_posts where id='post-sample-1'");
  const count = await db.query<{ count: number }>("select count(*)::int as count from public.showroom_likes where post_id='post-sample-1'");
  assert.equal(after.rows[0].likes, before.rows[0].likes + 2);
  assert.equal(after.rows[0].likes, before.rows[0].likes + count.rows[0].count);
});
test("remix RPC inserts a copied room and increments remix_count atomically", async () => {
  const initial = await db.query<{ remix_count: number }>(
    "select remix_count from public.showroom_posts where id='post-sample-1'",
  );
  const baseCount = initial.rows[0].remix_count;
  const sourceTitle = await db.query<{ title: string }>(
    "select room_snapshot->>'title' as title from public.showroom_posts where id='post-sample-1'",
  );

  const result = await db.query<{ id: string; owner_id: string; title: string; remixed_from: string }>(
    "select * from public.remix_showroom_post('post-sample-1', $1)", [user1Id],
  );
  assert.match(result.rows[0].id, /^room_/);
  assert.equal(result.rows[0].owner_id, user1Id);
  assert.equal(result.rows[0].title, sourceTitle.rows[0].title);
  assert.equal(result.rows[0].remixed_from, "post-sample-1");
  const after = await db.query<{ remix_count: number }>(
    "select remix_count from public.showroom_posts where id='post-sample-1'",
  );
  assert.equal(after.rows[0].remix_count, baseCount + 1);

  await assert.rejects(
    db.query("select * from public.remix_showroom_post('invalid-post', $1)", [user1Id]),
    /POST_NOT_FOUND/,
  );

  await db.query("update public.showroom_posts set room_snapshot = jsonb_set(room_snapshot, '{title}', '\"\"'::jsonb) where id='post-sample-1'");
  const countBeforeFailure = after.rows[0].remix_count;
  await assert.rejects(
    db.query("select * from public.remix_showroom_post('post-sample-1', $1)", [user1Id]),
    { code: "23514" },
  );
  const countAfterFailure = await db.query<{ remix_count: number }>(
    "select remix_count from public.showroom_posts where id='post-sample-1'",
  );
  assert.equal(countAfterFailure.rows[0].remix_count, countBeforeFailure);
});

test("계정 비활성화 함수(deactivate_account)가 is_active를 false로 변경한다", async () => {
  await db.query("select public.deactivate_account($1)", [user1Id]);
  const user = await db.query<{ is_active: boolean }>(
    "select is_active from public.profiles where id=$1",
    [user1Id],
  );
  assert.equal(user.rows[0].is_active, false);

  // 비활성화된 계정은 좋아요 불가
  await assert.rejects(
    db.query("select * from public.toggle_showroom_like('post-sample-1', $1)", [user1Id]),
    /USER_NOT_FOUND/,
  );

  await assert.rejects(
    db.query("select public.deactivate_account('99999999-9999-9999-9999-999999999999')"),
    /USER_NOT_FOUND/,
  );
});

test("DB 제약조건: 빈 이름 및 잘못된 천장고 거절", async () => {
  await assert.rejects(
    db.query("update public.profiles set display_name='   ' where id=$1", [user1Id]),
    { code: "23514" },
  );

  await assert.rejects(
    db.query(
      "insert into public.rooms(id, owner_id, title, wall_height) values ('r1', $1, '테스트', 1.00)",
      [user1Id],
    ),
    { code: "23514" },
  );

  await assert.rejects(
    db.query(
      "insert into public.rooms(id, owner_id, title, wall_height) values ('r2', $1, '테스트', 7.00)",
      [user1Id],
    ),
    { code: "23514" },
  );
});
