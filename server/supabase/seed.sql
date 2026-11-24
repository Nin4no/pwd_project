-- 새 프로젝트의 빈 showroom_posts에만 샘플 게시물을 입력합니다. 기존 행을 덮어쓰지 않습니다.
begin;
lock table public.showroom_posts in exclusive mode;
do $$ begin
if not exists(select 1 from public.showroom_posts) then
insert into public.showroom_posts(id, author, description, room_snapshot, likes, remix_count, builtin, shared_at) values
(
  'post-sample-1',
  '이지은',
  '6평 원룸에 슈퍼싱글 + 책상 + 옷장까지! 문 열림 동선 확보했어요.',
  '{
    "id": "sample-oneroom",
    "title": "[래미안 포레스트 24A] 6평 원룸 미니멀 배치",
    "wallHeight": 2.4,
    "walls": [
      {"id": "sa_w0", "a": {"x": 0, "y": 0}, "b": {"x": 3.5, "y": 0}},
      {"id": "sa_w1", "a": {"x": 3.5, "y": 0}, "b": {"x": 3.5, "y": 4.0}},
      {"id": "sa_w2", "a": {"x": 3.5, "y": 4.0}, "b": {"x": 0, "y": 4.0}},
      {"id": "sa_w3", "a": {"x": 0, "y": 4.0}, "b": {"x": 0, "y": 0}}
    ],
    "furniture": [
      {"id": "sa_f1", "specId": "bed-super-single", "x": -1.13, "z": -0.94, "rotation": 0},
      {"id": "sa_f2", "specId": "desk-basic", "x": 1.39, "z": 0.4, "rotation": 90},
      {"id": "sa_f3", "specId": "chair", "x": 0.76, "z": 0.4, "rotation": 90},
      {"id": "sa_f4", "specId": "wardrobe", "x": 1.39, "z": -1.5, "rotation": -90},
      {"id": "sa_f5", "specId": "lamp-floor", "x": -1.5, "z": 1.6, "rotation": 0}
    ],
    "createdAt": 1789866000000,
    "updatedAt": 1789866000000
  }'::jsonb,
  128,
  34,
  true,
  '2026-09-20T10:00:00+09:00'
),
(
  'post-sample-2',
  '김자취',
  'ㄱ자 구조를 살려서 침실/작업 공간을 분리한 배치입니다.',
  '{
    "id": "sample-lshape",
    "title": "ㄱ자 원룸 · 홈오피스",
    "wallHeight": 2.4,
    "walls": [
      {"id": "sb_w0", "a": {"x": 0, "y": 0}, "b": {"x": 5, "y": 0}},
      {"id": "sb_w1", "a": {"x": 5, "y": 0}, "b": {"x": 5, "y": 3}},
      {"id": "sb_w2", "a": {"x": 5, "y": 3}, "b": {"x": 3, "y": 3}},
      {"id": "sb_w3", "a": {"x": 3, "y": 3}, "b": {"x": 3, "y": 4.5}},
      {"id": "sb_w4", "a": {"x": 3, "y": 4.5}, "b": {"x": 0, "y": 4.5}},
      {"id": "sb_w5", "a": {"x": 0, "y": 4.5}, "b": {"x": 0, "y": 0}}
    ],
    "furniture": [
      {"id": "sb_f1", "specId": "bed-queen", "x": -1.44, "z": 1.44, "rotation": 90},
      {"id": "sb_f2", "specId": "desk-motion", "x": 1.0, "z": -1.84, "rotation": 0},
      {"id": "sb_f3", "specId": "chair", "x": 1.0, "z": -1.15, "rotation": 180},
      {"id": "sb_f4", "specId": "shelf", "x": 2.29, "z": -0.6, "rotation": -90},
      {"id": "sb_f5", "specId": "sofa-2", "x": -1.3, "z": -1.76, "rotation": 0},
      {"id": "sb_f6", "specId": "table-low", "x": -1.3, "z": -0.7, "rotation": 0}
    ],
    "createdAt": 1789952400000,
    "updatedAt": 1789952400000
  }'::jsonb,
  96,
  21,
  true,
  '2026-09-21T10:00:00+09:00'
);
end if;
end $$;

-- 샘플 3 (거실): 기존 프로젝트에도 추가될 수 있도록 id 충돌 시 무시
insert into public.showroom_posts(id, author, description, room_snapshot, likes, remix_count, builtin, shared_at) values
(
  'post-sample-3',
  '홈카페러버',
  '거실을 카페처럼! 원형 테이블과 플로어 조명 포인트.',
  '{
    "id": "sample-studio",
    "title": "투룸 거실 · 카페 무드",
    "wallHeight": 2.5,
    "walls": [
      {"id": "sc_w0", "a": {"x": 0, "y": 0}, "b": {"x": 4.5, "y": 0}},
      {"id": "sc_w1", "a": {"x": 4.5, "y": 0}, "b": {"x": 4.5, "y": 3.6}},
      {"id": "sc_w2", "a": {"x": 4.5, "y": 3.6}, "b": {"x": 0, "y": 3.6}},
      {"id": "sc_w3", "a": {"x": 0, "y": 3.6}, "b": {"x": 0, "y": 0}}
    ],
    "furniture": [
      {"id": "sc_f1", "specId": "sofa-2", "x": 0, "z": 1.31, "rotation": 180},
      {"id": "sc_f2", "specId": "table-round", "x": -1.3, "z": -0.9, "rotation": 0},
      {"id": "sc_f3", "specId": "chair", "x": -0.58, "z": -0.9, "rotation": -90},
      {"id": "sc_f4", "specId": "shelf", "x": 1.0, "z": -1.59, "rotation": 0},
      {"id": "sc_f5", "specId": "drawer", "x": 1.96, "z": 0.5, "rotation": -90},
      {"id": "sc_f6", "specId": "lamp-floor", "x": 1.9, "z": 1.4, "rotation": 0},
      {"id": "sc_f7", "specId": "table-low", "x": 0, "z": 0.3, "rotation": 0}
    ],
    "createdAt": 1790038800000,
    "updatedAt": 1790038800000
  }'::jsonb,
  77,
  12,
  true,
  '2026-09-22T10:00:00+09:00'
)
on conflict (id) do nothing;

-- 샘플 4, 5 (모던 침실 · 홈시네마 거실): 기존 프로젝트에도 추가될 수 있도록 id 충돌 시 무시
insert into public.showroom_posts(id, author, description, room_snapshot, likes, remix_count, builtin, shared_at) values
(
  'post-sample-4',
  '박서연',
  '알코브 입구와 드레스존을 나눈 4.7평 모던 침실 · 파우더 공간입니다.',
  '{
    "id": "sample-bedroom",
    "title": "화이트 모던 침실 · 드레스룸",
    "wallHeight": 2.5,
    "walls": [
      {"id": "sd_w0", "a": {"x": 0.8, "y": 0}, "b": {"x": 4.4, "y": 0}},
      {"id": "sd_w1", "a": {"x": 4.4, "y": 0}, "b": {"x": 4.4, "y": 3.8}},
      {"id": "sd_w2", "a": {"x": 4.4, "y": 3.8}, "b": {"x": 0, "y": 3.8}},
      {"id": "sd_w3", "a": {"x": 0, "y": 3.8}, "b": {"x": 0, "y": 1.4}},
      {"id": "sd_w4", "a": {"x": 0, "y": 1.4}, "b": {"x": 0.8, "y": 1.4}},
      {"id": "sd_w5", "a": {"x": 0.8, "y": 1.4}, "b": {"x": 0.8, "y": 0}}
    ],
    "furniture": [
      {"id": "sd_f1", "specId": "bed-queen", "x": 1.0, "z": -0.82, "rotation": 0},
      {"id": "sd_f2", "specId": "wardrobe", "x": -1.83, "z": 0.18, "rotation": 90},
      {"id": "sd_f3", "specId": "hanger", "x": -1.9, "z": 1.23, "rotation": 90},
      {"id": "sd_f4", "specId": "drawer", "x": -1.1, "z": 1.6, "rotation": 180},
      {"id": "sd_f5", "specId": "table-round", "x": 1.45, "z": 1.25, "rotation": 0},
      {"id": "sd_f6", "specId": "chair", "x": 0.65, "z": 1.25, "rotation": 90},
      {"id": "sd_f7", "specId": "lamp-floor", "x": 1.95, "z": -1.65, "rotation": 0},
      {"id": "sd_f8", "specId": "air-purifier", "x": -0.15, "z": 1.66, "rotation": 0},
      {"id": "sd_f9", "specId": "window-l", "x": 0.3, "z": 1.9, "rotation": 180},
      {"id": "sd_f10", "specId": "door-white", "x": -1.4, "z": -1.2, "rotation": 90, "swing": {"hinge": "left", "dir": "in"}}
    ],
    "createdAt": 1790125200000,
    "updatedAt": 1790125200000
  }'::jsonb,
  64,
  15,
  true,
  '2026-09-23T10:00:00+09:00'
),
(
  'post-sample-5',
  '최민준',
  '65인치 스탠드 TV와 다이닝 바가 공존하는 미니멀 홈시네마 거실입니다.',
  '{
    "id": "sample-cinema-loft",
    "title": "미니멀 거실 · 1인 홈시네마",
    "wallHeight": 2.6,
    "walls": [
      {"id": "se_w0", "a": {"x": 0, "y": 0}, "b": {"x": 5.2, "y": 0}},
      {"id": "se_w1", "a": {"x": 5.2, "y": 0}, "b": {"x": 5.2, "y": 3.8}},
      {"id": "se_w2", "a": {"x": 5.2, "y": 3.8}, "b": {"x": 0, "y": 3.8}},
      {"id": "se_w3", "a": {"x": 0, "y": 3.8}, "b": {"x": 0, "y": 0}}
    ],
    "furniture": [
      {"id": "se_f1", "specId": "tv-65-stand", "x": -1.1, "z": -1.6, "rotation": 0},
      {"id": "se_f2", "specId": "aircon-stand", "x": -2.32, "z": -1.65, "rotation": 0},
      {"id": "se_f3", "specId": "sofa-2", "x": -1.1, "z": 1.4, "rotation": 180},
      {"id": "se_f4", "specId": "table-low", "x": -1.1, "z": 0.25, "rotation": 0},
      {"id": "se_f5", "specId": "lamp-floor", "x": -2.32, "z": 1.62, "rotation": 0},
      {"id": "se_f6", "specId": "shelf", "x": 0.65, "z": -1.68, "rotation": 0},
      {"id": "se_f7", "specId": "fridge-mini", "x": 1.55, "z": -1.58, "rotation": 0},
      {"id": "se_f8", "specId": "table-round", "x": 1.55, "z": 0.35, "rotation": 0},
      {"id": "se_f9", "specId": "chair", "x": 0.75, "z": 0.35, "rotation": 90},
      {"id": "se_f10", "specId": "chair", "x": 1.55, "z": 1.15, "rotation": 180},
      {"id": "se_f11", "specId": "window-balcony", "x": 2.6, "z": 0, "rotation": -90},
      {"id": "se_f12", "specId": "door-sliding", "x": -2.6, "z": 0, "rotation": 90}
    ],
    "createdAt": 1790211600000,
    "updatedAt": 1790211600000
  }'::jsonb,
  52,
  9,
  true,
  '2026-09-24T10:00:00+09:00'
)
on conflict (id) do nothing;
commit;
