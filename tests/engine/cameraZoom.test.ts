import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera3D, CameraController } from '../../src/engine/webgl/camera';
import { Vec3 } from '../../src/engine/webgl/math';

type Listener = (e: unknown) => void;

class StubEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

interface TestHarness {
  camera: Camera3D;
  controller: CameraController;
  canvas: StubEventTarget;
  win: StubEventTarget;
  cleanup: () => void;
}

function createHarness(): TestHarness {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;

  const win = new StubEventTarget();
  const doc = Object.assign(new StubEventTarget(), {
    pointerLockElement: null as unknown,
    exitPointerLock: () => {},
  });
  const canvas = Object.assign(new StubEventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    requestPointerLock: () => {},
  });

  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;

  const camera = new Camera3D();
  const controller = new CameraController(camera, canvas as unknown as HTMLCanvasElement);

  const cleanup = () => {
    controller.dispose();
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
    if (prevDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  };

  return { camera, controller, canvas, win, cleanup };
}

function cameraDistance(camera: Camera3D): number {
  return camera.position.distTo(camera.target);
}

test('wheel zoom: enabled by default, calls preventDefault and updates distance', () => {
  const { camera, controller, canvas, cleanup } = createHarness();
  try {
    assert.equal(controller.zoomEnabled, true);
    const initialDist = cameraDistance(camera);

    let prevented = false;
    canvas.dispatch('wheel', {
      deltaY: -120,
      clientX: 400,
      clientY: 300,
      preventDefault: () => {
        prevented = true;
      },
    });

    assert.equal(prevented, true);
    const zoomedInDist = cameraDistance(camera);
    assert.ok(zoomedInDist < initialDist - 0.1, `expected zoom-in (${zoomedInDist}) < initial (${initialDist})`);
  } finally {
    cleanup();
  }
});

test('wheel zoom: when zoomEnabled=false, does not call preventDefault and keeps distance unchanged', () => {
  const { camera, controller, canvas, cleanup } = createHarness();
  try {
    controller.zoomEnabled = false;
    const initialDist = cameraDistance(camera);
    const initialPos = camera.position.clone();
    const initialTarget = camera.target.clone();

    let prevented = false;
    canvas.dispatch('wheel', {
      deltaY: -120,
      clientX: 400,
      clientY: 300,
      preventDefault: () => {
        prevented = true;
      },
    });

    assert.equal(prevented, false);
    assert.equal(cameraDistance(camera), initialDist);
    assert.deepEqual(camera.position, initialPos);
    assert.deepEqual(camera.target, initialTarget);
  } finally {
    cleanup();
  }
});

test('Alt+right-drag dolly: blocked when zoomEnabled=false, works when zoomEnabled=true', () => {
  const { camera, controller, canvas, win, cleanup } = createHarness();
  try {
    controller.zoomEnabled = false;
    const initialDist = cameraDistance(camera);
    const initialPos = camera.position.clone();

    canvas.dispatch('pointerdown', { button: 2, altKey: true, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300 });
    win.dispatch('pointermove', { clientX: 400, clientY: 180 });
    win.dispatch('pointerup', {});

    assert.equal(cameraDistance(camera), initialDist);
    assert.deepEqual(camera.position, initialPos);

    // Enabling zoom allows dolly again, and disabling mid-drag stops zooming
    controller.zoomEnabled = true;
    canvas.dispatch('pointerdown', { button: 2, altKey: true, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300 });
    win.dispatch('pointermove', { clientX: 400, clientY: 220 });
    const midDist = cameraDistance(camera);
    assert.ok(Math.abs(midDist - initialDist) > 0.1, 'expected Alt+right-drag dolly to change distance when enabled');

    controller.zoomEnabled = false;
    win.dispatch('pointermove', { clientX: 400, clientY: 100 });
    win.dispatch('pointerup', {});
    assert.equal(cameraDistance(camera), midDist);
  } finally {
    cleanup();
  }
});

test('single-pointer orbit rotation continues to work when zoomEnabled=false with constant radius', () => {
  const { camera, controller, canvas, win, cleanup } = createHarness();
  try {
    controller.zoomEnabled = false;
    const initialDist = cameraDistance(camera);
    const initialPos = camera.position.clone();

    // Right-drag orbit
    canvas.dispatch('pointerdown', { button: 2, altKey: false, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300 });
    win.dispatch('pointermove', { clientX: 520, clientY: 260 });
    win.dispatch('pointerup', {});

    const afterRightDragPos = camera.position.clone();
    assert.ok(afterRightDragPos.distTo(initialPos) > 0.2, 'expected right-drag orbit to rotate camera');
    assert.ok(Math.abs(cameraDistance(camera) - initialDist) < 1e-6, 'expected orbit radius to remain constant');

    // Shift+left-drag orbit
    canvas.dispatch('pointerdown', { button: 0, altKey: false, shiftKey: true, ctrlKey: false, clientX: 520, clientY: 260 });
    win.dispatch('pointermove', { clientX: 420, clientY: 310 });
    win.dispatch('pointerup', {});

    assert.ok(camera.position.distTo(afterRightDragPos) > 0.2, 'expected Shift+left-drag orbit to rotate camera');
    assert.ok(Math.abs(cameraDistance(camera) - initialDist) < 1e-6, 'expected orbit radius to remain constant');
  } finally {
    cleanup();
  }
});

test('focusOn ignores frameDist zoom when zoomEnabled=false while resetView still frames the room', () => {
  const { camera, controller, cleanup } = createHarness();
  try {
    controller.zoomEnabled = false;
    const initialDist = cameraDistance(camera);
    const focusTarget = new Vec3(2, 0.5, -1.5);

    controller.focusOn(focusTarget, 2.0);
    for (let i = 0; i < 120; i += 1) {
      controller.update(0.05);
    }

    assert.ok(camera.target.distTo(focusTarget) < 0.01, 'expected focusOn to still pan toward target');
    assert.ok(
      Math.abs(cameraDistance(camera) - initialDist) < 1e-5,
      `expected radius (${cameraDistance(camera)}) to stay equal to initial (${initialDist}) when zoomEnabled=false`,
    );

    // resetView() must still frame the room (including updated roomSize) even when zoomEnabled=false
    controller.roomSize = 8;
    controller.resetView();
    for (let i = 0; i < 160; i += 1) {
      controller.update(0.05);
    }

    const expectedResetPos = new Vec3(8 * 0.9, 8 * 1.0, 8 * 1.1);
    assert.ok(camera.target.distTo(new Vec3(0, 0, 0)) < 0.01, 'expected resetView target at origin');
    assert.ok(camera.position.distTo(expectedResetPos) < 0.01, 'expected resetView to frame updated roomSize');

    // Sanity check: when zoomEnabled=true, focusOn with frameDist zooms in
    controller.zoomEnabled = true;
    const beforeZoomDist = cameraDistance(camera);
    controller.focusOn(focusTarget, 2.5);
    for (let i = 0; i < 160; i += 1) {
      controller.update(0.05);
    }
    assert.ok(
      cameraDistance(camera) < beforeZoomDist - 1.0,
      `expected focusOn to zoom in when zoomEnabled=true (${cameraDistance(camera)} vs ${beforeZoomDist})`,
    );
  } finally {
    cleanup();
  }
});
