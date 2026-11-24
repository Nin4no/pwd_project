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

function assertVec3Close(actual: Vec3, expected: Vec3, eps = 1e-6, label = ''): void {
  assert.ok(
    actual.distTo(expected) <= eps,
    `${label} expected (${expected.x}, ${expected.y}, ${expected.z}), got (${actual.x}, ${actual.y}, ${actual.z})`,
  );
}

test('onRotate fires only on actual drag rotation (right-drag and shift+left-drag), not on hover/click/zero-delta/pan/dolly/wheel/programmatic', () => {
  const { controller, canvas, win, cleanup } = createHarness();
  try {
    let rotateCount = 0;
    controller.onRotate = () => {
      rotateCount += 1;
    };

    // 1. Hover without pointerdown
    win.dispatch('pointermove', { clientX: 200, clientY: 150 });
    win.dispatch('pointermove', { clientX: 250, clientY: 180 });
    assert.equal(rotateCount, 0);

    // 2. Right-click without drag
    canvas.dispatch('pointerdown', { button: 2, altKey: false, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300 });
    win.dispatch('pointerup', {});
    assert.equal(rotateCount, 0);

    // 3. Right-drag with zero-delta pointermove
    canvas.dispatch('pointerdown', { button: 2, altKey: false, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300 });
    win.dispatch('pointermove', { clientX: 400, clientY: 300 });
    assert.equal(rotateCount, 0);

    // 4. Actual right-drag movement fires onRotate
    win.dispatch('pointermove', { clientX: 440, clientY: 300 });
    assert.equal(rotateCount, 1);
    win.dispatch('pointermove', { clientX: 440, clientY: 300 }); // zero-delta again
    assert.equal(rotateCount, 1);
    win.dispatch('pointermove', { clientX: 440, clientY: 280 });
    assert.equal(rotateCount, 2);
    win.dispatch('pointerup', {});

    // 5. Shift+left-drag fires onRotate
    canvas.dispatch('pointerdown', { button: 0, altKey: false, shiftKey: true, ctrlKey: false, clientX: 300, clientY: 300 });
    win.dispatch('pointermove', { clientX: 330, clientY: 290 });
    win.dispatch('pointerup', {});
    assert.equal(rotateCount, 3);

    // 6. Left-drag pan does NOT fire onRotate
    canvas.dispatch('pointerdown', { button: 0, altKey: false, shiftKey: false, ctrlKey: false, clientX: 300, clientY: 300 });
    win.dispatch('pointermove', { clientX: 360, clientY: 340 });
    win.dispatch('pointerup', {});
    assert.equal(rotateCount, 3);

    // 7. Alt+right-drag dolly does NOT fire onRotate
    canvas.dispatch('pointerdown', { button: 2, altKey: true, shiftKey: false, ctrlKey: false, clientX: 300, clientY: 300 });
    win.dispatch('pointermove', { clientX: 300, clientY: 220 });
    win.dispatch('pointerup', {});
    assert.equal(rotateCount, 3);

    // 8. Wheel zoom does NOT fire onRotate
    canvas.dispatch('wheel', { deltaY: -120, clientX: 400, clientY: 300, preventDefault: () => {} });
    assert.equal(rotateCount, 3);

    // 9. Programmatic resetView / setMode do NOT fire onRotate
    controller.resetView();
    controller.update(0.05);
    controller.resetView({ immediate: true });
    controller.setMode('top', 6);
    controller.setMode('orbit', 5);
    assert.equal(rotateCount, 3);
  } finally {
    cleanup();
  }
});

test('pointercancel cleanly terminates active rotate drag', () => {
  const { camera, controller, canvas, win, cleanup } = createHarness();
  try {
    let rotateCount = 0;
    controller.onRotate = () => {
      rotateCount += 1;
    };

    canvas.dispatch('pointerdown', { button: 2, altKey: false, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300 });
    win.dispatch('pointermove', { clientX: 460, clientY: 280 });
    assert.equal(rotateCount, 1);

    const posAtCancel = camera.position.clone();
    win.dispatch('pointercancel', {});

    win.dispatch('pointermove', { clientX: 560, clientY: 200 });
    assert.equal(rotateCount, 1);
    assertVec3Close(camera.position, posAtCancel, 1e-6, 'position after pointercancel');
  } finally {
    cleanup();
  }
});

test('resetView({ immediate: true }) immediately restores orbit & top initial view for updated roomSize, cancels active goal & drag, and never fires onRotate', () => {
  const { camera, controller, canvas, win, cleanup } = createHarness();
  try {
    let rotateCount = 0;
    controller.onRotate = () => {
      rotateCount += 1;
    };

    // Rotate & start an active focus goal + active drag
    canvas.dispatch('pointerdown', { button: 2, altKey: false, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300 });
    win.dispatch('pointermove', { clientX: 560, clientY: 220 });
    assert.equal(rotateCount, 1);
    controller.focusOn(new Vec3(3, 1, -2), 2.5);

    // Update roomSize (simulating slide switch to a differently sized room) and reset immediately
    controller.roomSize = 7;
    controller.resetView({ immediate: true });

    const expectedOrbitPos = new Vec3(7 * 0.9, 7 * 1.0, 7 * 1.1);
    assertVec3Close(camera.target, new Vec3(0, 0, 0), 1e-6, 'orbit target');
    assertVec3Close(camera.up, new Vec3(0, 1, 0), 1e-6, 'orbit up');
    assertVec3Close(camera.position, expectedOrbitPos, 1e-6, 'orbit position');
    assert.equal(rotateCount, 1);

    // Active goal was cancelled: update() must not pull camera away
    controller.update(0.05);
    assertVec3Close(camera.target, new Vec3(0, 0, 0), 1e-6, 'orbit target after update');
    assertVec3Close(camera.position, expectedOrbitPos, 1e-6, 'orbit position after update');

    // Active drag was cancelled: pointermove without new pointerdown must not rotate
    win.dispatch('pointermove', { clientX: 700, clientY: 150 });
    assert.equal(rotateCount, 1);
    assertVec3Close(camera.position, expectedOrbitPos, 1e-6, 'orbit position after cancelled drag move');

    // Top mode immediate reset respects updated roomSize
    controller.setMode('top', 5);
    canvas.dispatch('pointerdown', { button: 0, altKey: false, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300 });
    win.dispatch('pointermove', { clientX: 520, clientY: 420 });
    win.dispatch('pointerup', {});
    assert.ok(camera.target.distTo(new Vec3(0, 0, 0)) > 0.1, 'expected top pan to move target');

    controller.roomSize = 9;
    controller.resetView({ immediate: true });
    assertVec3Close(camera.target, new Vec3(0, 0, 0), 1e-6, 'top target');
    assertVec3Close(camera.up, new Vec3(0, 1, 0), 1e-6, 'top up');
    assertVec3Close(camera.position, new Vec3(0, 9 * 1.9, 0.001), 1e-6, 'top position');
    assert.equal(rotateCount, 1);
  } finally {
    cleanup();
  }
});

test('resetView() without immediate preserves animated goal interpolation', () => {
  const { camera, controller, canvas, win, cleanup } = createHarness();
  try {
    let rotateCount = 0;
    controller.onRotate = () => {
      rotateCount += 1;
    };

    // Rotate away from initial pose
    canvas.dispatch('pointerdown', { button: 2, altKey: false, shiftKey: false, ctrlKey: false, clientX: 400, clientY: 300 });
    win.dispatch('pointermove', { clientX: 560, clientY: 220 });
    win.dispatch('pointerup', {});
    const rotatedPos = camera.position.clone();
    const expectedInitPos = new Vec3(5 * 0.9, 5 * 1.0, 5 * 1.1);
    assert.ok(rotatedPos.distTo(expectedInitPos) > 0.5, 'expected camera to be rotated away');

    // Default resetView() sets animation goal rather than snapping synchronously
    controller.resetView();
    assertVec3Close(camera.position, rotatedPos, 1e-6, 'position immediately after animated resetView');

    // Converges over update() steps
    for (let i = 0; i < 160; i += 1) {
      controller.update(0.05);
    }
    assertVec3Close(camera.target, new Vec3(0, 0, 0), 0.01, 'target after animated resetView');
    assertVec3Close(camera.position, expectedInitPos, 0.01, 'position after animated resetView');
    assert.equal(rotateCount, 1);
  } finally {
    cleanup();
  }
});
