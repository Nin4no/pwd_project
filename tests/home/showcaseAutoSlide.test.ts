import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOWCASE_ROTATION_COOLDOWN_MS,
  createShowcaseAutoSlideController,
  type ShowcaseAutoSlideTimers,
  type TimerHandle,
} from '../../src/features/home/showcaseAutoSlide';

interface FakeClock {
  timers: ShowcaseAutoSlideTimers;
  advance(ms: number): void;
  pendingCount(): number;
}

function createFakeClock(): FakeClock {
  let now = 0;
  let nextId = 1;
  const tasks = new Map<number, { due: number; fn: () => void }>();

  const timers: ShowcaseAutoSlideTimers = {
    setTimeout(fn: () => void, ms: number): TimerHandle {
      const id = nextId++;
      tasks.set(id, { due: now + ms, fn });
      return id as unknown as TimerHandle;
    },
    clearTimeout(handle: TimerHandle): void {
      tasks.delete(handle as unknown as number);
    },
  };

  const advance = (ms: number): void => {
    const target = now + ms;
    while (true) {
      let earliestId: number | null = null;
      let earliestDue = Infinity;
      for (const [id, task] of tasks) {
        if (task.due <= target && task.due < earliestDue) {
          earliestDue = task.due;
          earliestId = id;
        }
      }
      if (earliestId === null) break;
      const task = tasks.get(earliestId)!;
      tasks.delete(earliestId);
      now = task.due;
      task.fn();
    }
    now = target;
  };

  return {
    timers,
    advance,
    pendingCount: () => tasks.size,
  };
}

test('rotation pauses immediately and resumes after cooldown with no further rotation', () => {
  const clock = createFakeClock();
  const events: boolean[] = [];
  const ctrl = createShowcaseAutoSlideController({
    timers: clock.timers,
    onPauseChange: (paused) => events.push(paused),
  });

  assert.equal(SHOWCASE_ROTATION_COOLDOWN_MS, 5000);
  assert.equal(ctrl.isPaused(), false);

  ctrl.onRotate();
  assert.equal(ctrl.isPaused(), true);
  assert.deepEqual(events, [true]);

  clock.advance(4999);
  assert.equal(ctrl.isPaused(), true);

  clock.advance(1);
  assert.equal(ctrl.isPaused(), false);
  assert.deepEqual(events, [true, false]);
});

test('repeated rotation resets cooldown timer', () => {
  const clock = createFakeClock();
  const events: boolean[] = [];
  const ctrl = createShowcaseAutoSlideController({
    timers: clock.timers,
    onPauseChange: (paused) => events.push(paused),
  });

  ctrl.onRotate();
  clock.advance(3000);
  ctrl.onRotate();
  assert.equal(clock.pendingCount(), 1);

  clock.advance(3000);
  assert.equal(ctrl.isPaused(), true);

  clock.advance(1999);
  assert.equal(ctrl.isPaused(), true);

  clock.advance(1);
  assert.equal(ctrl.isPaused(), false);
  assert.deepEqual(events, [true, false]);
});

test('rotation clears passive hover pause so idle cursor resumes after cooldown, and leaving during cooldown does not prematurely resume', () => {
  const clock = createFakeClock();
  const events: boolean[] = [];
  const ctrl = createShowcaseAutoSlideController({
    timers: clock.timers,
    onPauseChange: (paused) => events.push(paused),
  });

  // Scenario A: cursor rests on showcase after rotating -> resumes after 5s
  ctrl.onPointerEnter('mouse');
  assert.equal(ctrl.isPaused(), true);
  ctrl.onPointerDown();
  ctrl.onRotate();
  ctrl.onPointerUpOrCancel();

  clock.advance(4999);
  assert.equal(ctrl.isPaused(), true);
  clock.advance(1);
  assert.equal(ctrl.isPaused(), false);
  assert.deepEqual(events, [true, false]);

  // Scenario B: leaving showcase during cooldown does NOT resume early
  ctrl.onPointerEnter('mouse');
  ctrl.onPointerDown();
  ctrl.onRotate();
  ctrl.onPointerUpOrCancel();
  ctrl.onPointerLeave();

  assert.equal(ctrl.isPaused(), true);
  clock.advance(4999);
  assert.equal(ctrl.isPaused(), true);
  clock.advance(1);
  assert.equal(ctrl.isPaused(), false);
});

test('holding pointer down keeps paused past initial timer, and releasing runs full cooldown from release', () => {
  const clock = createFakeClock();
  const events: boolean[] = [];
  const ctrl = createShowcaseAutoSlideController({
    timers: clock.timers,
    onPauseChange: (paused) => events.push(paused),
  });

  ctrl.onPointerDown();
  ctrl.onRotate();
  assert.equal(ctrl.isPaused(), true);

  // Hold longer than cooldown without further movement
  clock.advance(8000);
  assert.equal(ctrl.isPaused(), true);

  // Releasing starts a full 5s cooldown from release time
  ctrl.onPointerUpOrCancel();
  assert.equal(ctrl.isPaused(), true);
  clock.advance(4999);
  assert.equal(ctrl.isPaused(), true);

  clock.advance(1);
  assert.equal(ctrl.isPaused(), false);
  assert.deepEqual(events, [true, false]);
});

test('holding pointer down without rotating while a previous cooldown expires does not stick paused after release', () => {
  const clock = createFakeClock();
  const ctrl = createShowcaseAutoSlideController({ timers: clock.timers });

  ctrl.onRotate();
  clock.advance(2000);
  ctrl.onPointerDown(); // e.g., pan/press without rotating
  clock.advance(4000); // original cooldown expires while held
  assert.equal(ctrl.isPaused(), true);

  ctrl.onPointerUpOrCancel();
  assert.equal(ctrl.isPaused(), false);
});

test('mouse hover without rotation pauses/resumes; touch pointerenter does not stick hover pause', () => {
  const clock = createFakeClock();
  const events: boolean[] = [];
  const ctrl = createShowcaseAutoSlideController({
    timers: clock.timers,
    onPauseChange: (paused) => events.push(paused),
  });

  ctrl.onPointerEnter('mouse');
  assert.equal(ctrl.isPaused(), true);
  ctrl.onPointerLeave();
  assert.equal(ctrl.isPaused(), false);

  ctrl.onPointerEnter('touch');
  assert.equal(ctrl.isPaused(), false);
  ctrl.onPointerEnter('pen');
  assert.equal(ctrl.isPaused(), false);
  ctrl.onPointerEnter(undefined);
  assert.equal(ctrl.isPaused(), false);

  assert.deepEqual(events, [true, false]);
});

test('onSlideChanged cancels active cooldown and dispose clears pending timer', () => {
  const clock = createFakeClock();
  const events: boolean[] = [];
  const ctrl = createShowcaseAutoSlideController({
    timers: clock.timers,
    onPauseChange: (paused) => events.push(paused),
  });

  ctrl.onRotate();
  assert.equal(ctrl.isPaused(), true);
  assert.equal(clock.pendingCount(), 1);

  ctrl.onSlideChanged();
  assert.equal(ctrl.isPaused(), false);
  assert.equal(clock.pendingCount(), 0);
  assert.deepEqual(events, [true, false]);

  // dispose clears pending timer and prevents late notifications
  ctrl.onRotate();
  assert.equal(clock.pendingCount(), 1);
  ctrl.dispose();
  assert.equal(clock.pendingCount(), 0);
  clock.advance(10000);
  assert.deepEqual(events, [true, false, true]);
});
