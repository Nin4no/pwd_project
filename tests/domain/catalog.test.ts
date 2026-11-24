import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FurnitureSpec } from '../../src/domain/types';
import { CatalogRegistry, memoryCatalogStorage } from '../../src/domain/catalog';
import { FURNITURE } from '../../src/data/furniture';

const ai = (id: string, name = 'AI 가구'): FurnitureSpec => ({ id, name, category: 'storage', size: [1, 0.4, 1.8], color: '#fff', source: 'ai' });

test('기본 카탈로그 + 사용자 AI 가구 조회·검색·카테고리', () => {
  const storage = memoryCatalogStorage([ai('ai_1', '내 책장')]);
  const reg = new CatalogRegistry(FURNITURE, storage);
  assert.equal(reg.get('bed-single')?.category, 'bed');
  assert.equal(reg.get('ai_1')?.name, '내 책장');
  assert.equal(reg.list()[0].id, 'ai_1');
  assert.equal(reg.byCategory('ai').length, 1);
  assert.ok(reg.byCategory('bed').every((s) => s.category === 'bed'));
  assert.deepEqual(reg.search('내 책장').map((s) => s.id), ['ai_1']);
  assert.ok(reg.search('침대', 'bed').length >= 2);
});

test('사용자 가구 추가·삭제는 영속되고 구독자에게 알린다. 기본 카탈로그는 삭제 불가', () => {
  const storage = memoryCatalogStorage();
  const reg = new CatalogRegistry(FURNITURE, storage);
  let calls = 0;
  const off = reg.subscribe(() => calls++);
  const added = reg.addUserFurniture({ ...ai('ai_2'), source: 'catalog' });
  assert.equal(added.source, 'ai');
  assert.equal(storage.load().length, 1);
  reg.removeUserFurniture('bed-single');
  assert.ok(reg.get('bed-single'));
  reg.removeUserFurniture('ai_2');
  assert.equal(reg.get('ai_2'), undefined);
  assert.equal(storage.load().length, 0);
  assert.equal(calls, 2);
  off();
  reg.addUserFurniture(ai('ai_3'));
  assert.equal(calls, 2);
});

test('scoped(room)은 방에 내장된 스펙을 보이되 레지스트리를 오염시키지 않는다', () => {
  const reg = new CatalogRegistry(FURNITURE);
  const scoped = reg.scoped({ customSpecs: [ai('ai_room', '공유된 AI 가구')] });
  assert.equal(scoped.get('ai_room')?.name, '공유된 AI 가구');
  assert.equal(reg.get('ai_room'), undefined);
  assert.equal(scoped.byCategory('ai').length, 1);
  assert.equal(scoped.get('bed-single')?.id, 'bed-single');
  // 같은 id가 사용자 가구에도 있으면 사용자 가구 우선(레지스트리 값)
  reg.addUserFurniture(ai('ai_room', '내 버전'));
  assert.equal(scoped.get('ai_room')?.name, '내 버전');
  assert.equal(reg.scoped({}).list().length, reg.list().length);
});
