import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldShowCompassHud } from '../../src/features/studio/build/compassVisibility';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(projectRoot, relPath), 'utf8');
}

test('shouldShowCompassHud: 스튜디오 편집 화면(studio-build, studio-plan)은 기본 true, editable=false면 false', () => {
  assert.equal(shouldShowCompassHud('studio-build'), true);
  assert.equal(shouldShowCompassHud('studio-build', {}), true);
  assert.equal(shouldShowCompassHud('studio-build', { editable: true }), true);
  assert.equal(shouldShowCompassHud('studio-build', { editable: false }), false);
  assert.equal(shouldShowCompassHud('studio-build', { editable: false, showCompass: true }), false);

  assert.equal(shouldShowCompassHud('studio-plan'), true);
  assert.equal(shouldShowCompassHud('studio-plan', {}), true);
  assert.equal(shouldShowCompassHud('studio-plan', { editable: true }), true);
  assert.equal(shouldShowCompassHud('studio-plan', { editable: false }), false);
  assert.equal(shouldShowCompassHud('studio-plan', { editable: false, showCompass: true }), false);
});

test('shouldShowCompassHud: 읽기 전용 뷰어(viewer)는 기본 false, showCompass=true일 때만 true', () => {
  assert.equal(shouldShowCompassHud('viewer'), false);
  assert.equal(shouldShowCompassHud('viewer', {}), false);
  assert.equal(shouldShowCompassHud('viewer', { showCompass: false }), false);
  assert.equal(shouldShowCompassHud('viewer', { editable: true }), false);
  assert.equal(shouldShowCompassHud('viewer', { showCompass: true }), true);
});

test('shouldShowCompassHud: 홈 쇼케이스(home-showcase)는 어떤 옵션에서도 항상 false', () => {
  assert.equal(shouldShowCompassHud('home-showcase'), false);
  assert.equal(shouldShowCompassHud('home-showcase', { editable: true }), false);
  assert.equal(shouldShowCompassHud('home-showcase', { showCompass: true }), false);
  assert.equal(shouldShowCompassHud('home-showcase', { editable: true, showCompass: true }), false);
});

test('소스 배선: RoomViewer3D는 기본 showCompass=false이며 shouldShowCompassHud로 CompassHud를 조건부 렌더링한다', () => {
  const src = readSource('src/features/showroom/RoomViewer.tsx');
  assert.match(src, /showCompass\?:\s*boolean/);
  assert.match(src, /showCompass\s*=\s*false/);
  assert.match(src, /shouldShowCompassHud\(['"]viewer['"],\s*\{\s*showCompass\s*\}\)/);
  assert.match(src, /compassVisible\s*\?\s*<CompassHud\b/);
  assert.match(src, /onAzimuthChange=\{compassVisible\s*\?/);
});

test('소스 배선: HomePage 쇼케이스는 RoomViewer3D에 showCompass={false}를 명시 전달한다', () => {
  const src = readSource('src/features/home/HomePage.tsx');
  assert.match(src, /<RoomViewer3D[\s\S]*?showCompass=\{false\}/);
});

test('소스 배선: Studio SceneView는 shouldShowCompassHud로 게이트하고 PlanView는 CompassHud를 유지한다', () => {
  const sceneSrc = readSource('src/features/studio/build/SceneView.tsx');
  assert.match(sceneSrc, /shouldShowCompassHud\(['"]studio-build['"],\s*\{\s*editable\s*\}\)/);
  assert.match(sceneSrc, /<CompassHud\b/);

  const planSrc = readSource('src/features/studio/plan/PlanView.tsx');
  assert.match(planSrc, /<CompassHud\b/);
});
