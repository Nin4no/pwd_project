# Design Your Room

> 모눈종이에 쓱 그리는 내 방, 원클릭 3D 가구 배치 · AI 인테리어 & 공유 플랫폼

전문 3D 툴 없이 브라우저에서 2D 도면을 그리면 실제 비율의 **순수 WebGL2 3D 방**이 자동 생성되고, 실규격 가구 및 **AI가 즉석에서 생성한 3D 가구**를 배치하거나 **AI 공간 맞춤 배치 추천**을 받아 간섭·동선을 확인할 수 있는 웹 서비스입니다.

## 주요 기능
| 기능 | 구분 |
|---|---|
| 2D 모눈종이 도면 에디터 (벽 그리기 / 지우개 / 초기화, 실시간 길이·면적) | P1 |
| **순수 WebGL2 3D 렌더링 엔진** (다각형 바닥 Ear-Clipping, 창문 벽 개구부 X-Slab 분할, 카메라 방향 벽 자동 컷어웨이) | Core |
| 3D 가구 드래그 배치 · 회전 · 삭제 (OBB Raycasting), 3D 쿼터뷰 / 탑뷰 / 1인칭 워크 | P1 |
| **✨ AI 절차적 3D 가구 생성** (자연어 프롬프트 → 다중 부품 3D 메쉬 자동 합성 및 카탈로그 등록) | AI |
| **🧭 AI 맞춤 가구 배치 추천** (방 면적·벽체·창문 분석 기반 4종 프리셋 무간섭 자동 배치) | AI |
| **🔐 계정 인증 & 하이브리드 DB** (로그인/회원가입/1초 데모 계정, Supabase Cloud & Local DB 자동 전환) | DB/Auth |
| **↩ 실행 취소 / 다시 실행 (Undo/Redo)** (`Ctrl+Z` / `Ctrl+Y`, 드래그 단위 스냅샷 기록) | UX |
| 쇼룸 갤러리 피드 & 3D 뷰어, 좋아요, Remix, JSON 내보내기 / 공유 링크 | P2~P3 |

## 기술 스택
React 18 + Vite + TypeScript · HTML5 Canvas · **Pure WebGL2 OOP Engine** (`src/engine/webgl/`, React와 분리) · zustand · Supabase REST / LocalStorage DB

## 실행
```bash
npm install
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드 (dist/)
npm run preview  # 빌드 결과 미리보기
```

## 스튜디오 단축키
| 키 | 동작 |
|---|---|
| 드래그 | 가구 이동 |
| R / Q / E | 90° / -15° / +15° 회전 |
| 방향키 (Shift) | 미세 이동 2cm (10cm) |
| Delete | 선택 가구 삭제 |
| Ctrl+Z / Ctrl+Y | 실행 취소 (Undo) / 다시 실행 (Redo) |
| Ctrl+S | 저장 |
| WASD | 카메라 이동 (1인칭 워크 / 쿼터뷰 / 탑뷰) |
| 더블클릭 / F / Home | 포커스 이동 / 선택 가구 포커스 / 시점 초기화 |

## 폴더 구조
```
src/
  main.tsx      부트스트랩 (/auth/callback이면 AuthCallback, 아니면 App)
  app/          App · router(라우트 표) · providers(카탈로그·저장소·토스트) · Shell · Header
  design/       tokens.css · base.css(유일한 전역 CSS) · components/ (Button·IconButton·Segmented·Tabs·Field·
                NumberField·Menu·Modal·Sheet·Toast·Badge·EmptyState·Spinner)
  domain/       types · room(순수 연산) · catalog(CatalogRegistry) · share/(v1·v2 코덱) · migrate · ids
  engine/       geometry · webgl/(sceneRenderer·RoomMesh 등, React 無) · layout/(배치 엔진·recommender)
                · furniture/(설계도 조립·규칙 파서) · floorplan/(FloorplanEditor, React 無) · vision/(사진 분석)
  features/
    session/    useSessionStore · AuthModal · SocialLoginButtons · AuthCallback · AuthErrorScreen
    rooms/      repository/(Local·Cloud·Synced·Showroom·syncQueue) · SaveDialog · ShareDialog · RoomThumb
    studio/     StudioPage · TopBar · ModeSwitch · HelpDialog · store(zustand)·history·shortcuts
                · build/(SceneView·RoomCanvas·CatalogPanel·Inspector·PlacedList·CameraPills)
                · plan/(PlanView·PlanToolbar·PlanInspector) · photo/(PhotoWizard·보정) · ai/(가구 생성·배치 추천)
    home/ saved/ showroom/ share/   페이지
  services/api/ http(axios)·supabase 클라이언트 · {auth,rooms,showroom,ai}.api
  data/         furniture(기본 카탈로그 배열) · appliances · sampleRooms
tests/          domain/ · engine/ · features/   (npm test)
eval/           layout/(배치 audit) · room/·floorplan/(사진 분석 평가) · furniture/(프롬프트 셋)
server/         Express API (Gemini 프록시·방·쇼룸)
```
