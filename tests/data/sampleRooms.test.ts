import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_POSTS } from '../../src/data/sampleRooms';
import { FURNITURE } from '../../src/data/furniture';
import { APPLIANCES } from '../../src/data/appliances';
import { CatalogRegistry } from '../../src/domain/catalog';
import { collisionsOf, floorPolygons, furnitureOutside } from '../../src/domain/room';

const catalog = new CatalogRegistry(FURNITURE);
const combinedCatalogIds = new Set([...FURNITURE, ...APPLIANCES].map((item) => item.id));

test('SAMPLE_POSTS는 post-sample-1..5 총 5개의 고유한 기본 쇼룸 게시물을 제공한다', () => {
  assert.equal(SAMPLE_POSTS.length, 5);
  assert.deepEqual(
    SAMPLE_POSTS.map((p) => p.id),
    ['post-sample-1', 'post-sample-2', 'post-sample-3', 'post-sample-4', 'post-sample-5'],
  );

  const postIds = new Set(SAMPLE_POSTS.map((p) => p.id));
  const roomIds = new Set(SAMPLE_POSTS.map((p) => p.room.id));
  assert.equal(postIds.size, 5);
  assert.equal(roomIds.size, 5);
  for (const post of SAMPLE_POSTS) {
    assert.equal(post.builtin, true);
  }
});

test('모든 샘플 게시물의 메타데이터, 벽, 가구 스펙이 유효하다', () => {
  for (const post of SAMPLE_POSTS) {
    const { room } = post;
    assert.ok(room.title.length >= 1 && room.title.length <= 100, `${post.id} title length`);
    assert.ok(post.author.length >= 1 && post.author.length <= 50, `${post.id} author length`);
    assert.ok(post.description.length <= 300, `${post.id} description length`);
    assert.ok(room.wallHeight >= 1.5 && room.wallHeight <= 6.0, `${post.id} wallHeight`);
    assert.ok(room.walls.length >= 3, `${post.id} walls count`);
    assert.ok(floorPolygons(room).length >= 1, `${post.id} closed polygon`);
    assert.ok(room.furniture.length >= 1, `${post.id} furniture count`);

    const itemIds = new Set<string>();
    for (const item of room.furniture) {
      assert.equal(itemIds.has(item.id), false, `${post.id} duplicate item id ${item.id}`);
      itemIds.add(item.id);
      assert.ok(combinedCatalogIds.has(item.specId), `${post.id} unknown specId ${item.specId}`);
      assert.ok(catalog.get(item.specId), `${post.id} missing catalog entry ${item.specId}`);
    }
  }
});

test('모든 샘플 방은 가구 충돌과 방 경계 이탈이 0건이다', () => {
  for (const post of SAMPLE_POSTS) {
    const collisions = [...collisionsOf(post.room, catalog)];
    assert.deepEqual(collisions, [], `${post.id} (${post.room.id}) collisions`);
    const outside = furnitureOutside(post.room, catalog);
    assert.deepEqual(outside, [], `${post.id} (${post.room.id}) outside`);
  }
});
